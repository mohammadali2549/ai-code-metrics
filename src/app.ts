import readline from 'node:readline';
import { stdin as input, stdout as output } from 'node:process';
import {
  ApiError,
  CheckoutPaymentIntent,
  Client,
  CustomError,
  Environment,
  LogLevel,
  OrdersController,
  PatchOp,
} from '@paypal/paypal-server-sdk';

type OrderInput = {
  description: string;
  amount: number;
  shipping: number;
  currency: string;
};

const client = new Client({
  clientCredentialsAuthCredentials: {
    oAuthClientId: process.env.PAYPAL_CLIENT_ID ?? '',
    oAuthClientSecret: process.env.PAYPAL_CLIENT_SECRET ?? '',
  },
  timeout: 0,
  environment: Environment.Sandbox,
  logging: {
    logLevel: LogLevel.Info,
    logRequest: { logBody: true },
    logResponse: { logHeaders: true },
  },
});

const ordersController = new OrdersController(client);

function createInterface() {
  return readline.createInterface({ input, output });
}

function askQuestion(rl: readline.Interface, question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => resolve(answer.trim()));
  });
}

async function promptForOrderDetails(
  rl: readline.Interface,
  existing?: Partial<OrderInput>,
): Promise<OrderInput> {
  const current = existing ?? {};

  const description =
    (await askQuestion(
      rl,
      `Enter order description${current.description ? ` [${current.description}]` : ''}: `,
    )) || current.description;

  const amountStr =
    (await askQuestion(
      rl,
      `Enter item amount (excluding shipping)${current.amount != null ? ` [${current.amount}]` : ''}: `,
    )) || (current.amount != null ? String(current.amount) : '');

  const shippingStr =
    (await askQuestion(
      rl,
      `Enter shipping amount${current.shipping != null ? ` [${current.shipping}]` : ''}: `,
    )) || (current.shipping != null ? String(current.shipping) : '0');

  const currency =
    (await askQuestion(
      rl,
      `Enter currency code (e.g. USD, EUR)${current.currency ? ` [${current.currency}]` : ' [USD]'}: `,
    )) || current.currency || 'USD';

  const amount = Number.parseFloat(amountStr);
  const shipping = Number.parseFloat(shippingStr || '0');

  if (!description) {
    throw new Error('Description is required.');
  }

  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error('Item amount must be a positive number.');
  }

  if (!Number.isFinite(shipping) || shipping < 0) {
    throw new Error('Shipping amount must be a non-negative number.');
  }

  if (!currency) {
    throw new Error('Currency code is required.');
  }

  return { description, amount, shipping, currency: currency.toUpperCase() };
}

export async function createOrder(inputData?: OrderInput) {
  if (!process.env.PAYPAL_CLIENT_ID || !process.env.PAYPAL_CLIENT_SECRET) {
    throw new Error(
      'Missing PayPal credentials. Set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET environment variables before calling PayPal APIs.',
    );
  }

  const effectiveInput: OrderInput =
    inputData ??
    ({
      description: 'Sample order from CLI',
      amount: 10,
      shipping: 0,
      currency: 'USD',
    } as const);

  const { description, amount, shipping, currency } = effectiveInput;
  const total = (amount + shipping).toFixed(2);

  const collect = {
    body: {
      intent: CheckoutPaymentIntent.Capture,
      purchaseUnits: [
        {
          referenceId: 'default',
          description,
          amount: {
            currencyCode: currency,
            value: total,
            breakdown: {
              itemTotal: { currencyCode: currency, value: amount.toFixed(2) },
              shipping: { currencyCode: currency, value: shipping.toFixed(2) },
            },
          },
        },
      ],
    },
    prefer: 'return=representation',
  };

  const response = await ordersController.createOrder(collect);
  if (response.result.id) {
    console.log('\nOrder created with ID:', response.result.id);
  }
  return response.result;
}

export async function getOrder(orderId?: string) {
  if (!orderId) {
    throw new Error('orderId is required to retrieve an order.');
  }
  const response = await ordersController.getOrder({ id: orderId });
  return response.result;
}

async function patchOrder(orderId: string, inputData: OrderInput) {
  const { description, amount, shipping, currency } = inputData;
  const total = (amount + shipping).toFixed(2);

  const collect = {
    id: orderId,
    body: [
      {
        op: PatchOp.Replace,
        path: '/purchase_units/@reference_id==\'default\'/amount',
        value: {
          currencyCode: currency,
          value: total,
          breakdown: {
            itemTotal: { currencyCode: currency, value: amount.toFixed(2) },
            shipping: { currencyCode: currency, value: shipping.toFixed(2) },
          },
        },
      },
      {
        op: PatchOp.Replace,
        path: '/purchase_units/@reference_id==\'default\'/description',
        value: description,
      },
    ],
  };

  await ordersController.patchOrder(collect);
}

function handleError(error: unknown): void {
  if (error instanceof ApiError) {
    console.error('PayPal API Error:', error.statusCode, JSON.stringify(error.body, null, 2));
    if (error instanceof CustomError) {
      console.error('Custom Error:', error.result?.name, error.result?.message);
    }
  } else {
    console.error('Unexpected Error:', error);
  }
}

async function main() {
  if (!process.env.PAYPAL_CLIENT_ID || !process.env.PAYPAL_CLIENT_SECRET) {
    console.error(
      'Missing PAYPAL_CLIENT_ID or PAYPAL_CLIENT_SECRET environment variables. Please set them before running the CLI.',
    );
    process.exitCode = 1;
    return;
  }

  const rl = createInterface();

  try {
    console.log('=== PayPal Order CLI ===\n');

    const initialInput = await promptForOrderDetails(rl);

    const createdOrder = await createOrder(initialInput);
    const orderId = createdOrder.id!;

    const fetchedOrder = await getOrder(orderId);
    console.log('\nCurrent order details:');
    console.log(JSON.stringify(fetchedOrder, null, 2));

    const updateAnswer = await askQuestion(
      rl,
      '\nDo you want to update this order? (y/N): ',
    );

    if (updateAnswer.toLowerCase() === 'y' || updateAnswer.toLowerCase() === 'yes') {
      const existing: Partial<OrderInput> = {
        description: fetchedOrder.purchaseUnits?.[0]?.description ?? initialInput.description,
        amount:
          Number.parseFloat(
            fetchedOrder.purchaseUnits?.[0]?.amount?.breakdown?.itemTotal?.value ??
              String(initialInput.amount),
          ) || initialInput.amount,
        shipping:
          Number.parseFloat(
            fetchedOrder.purchaseUnits?.[0]?.amount?.breakdown?.shipping?.value ??
              String(initialInput.shipping),
          ) || initialInput.shipping,
        currency: fetchedOrder.purchaseUnits?.[0]?.amount?.currencyCode ?? initialInput.currency,
      };

      const updatedInput = await promptForOrderDetails(rl, existing);
      await patchOrder(orderId, updatedInput);

      const updatedOrder = await getOrder(orderId);
      console.log('\nOrder updated successfully. New details:');
      console.log(JSON.stringify(updatedOrder, null, 2));
    } else {
      console.log('\nNo changes applied to the order.');
    }
  } catch (error) {
    handleError(error);
  } finally {
    rl.close();
  }
}

void main();


