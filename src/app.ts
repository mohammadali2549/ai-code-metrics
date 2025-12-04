import dotenv from 'dotenv';
import { createInterface } from 'node:readline/promises';
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

dotenv.config();

type OrderDetailsInput = {
  description: string;
  orderAmount: string;
  shippingAmount: string;
  currency: string;
};

function createOrdersController(): OrdersController {
  const clientId = process.env.PAYPAL_CLIENT_ID;
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error(
      'Missing PayPal credentials. Set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET environment variables before calling PayPal APIs.',
    );
  }

  const client = new Client({
    clientCredentialsAuthCredentials: {
      oAuthClientId: clientId,
      oAuthClientSecret: clientSecret,
    },
    timeout: 0,
    environment: Environment.Sandbox,
    logging: {
      logLevel: LogLevel.Info,
      logRequest: {
        logBody: true,
      },
      logResponse: {
        logHeaders: true,
      },
    },
  });

  return new OrdersController(client);
}

async function promptOrderDetails(
  rl: ReturnType<typeof createInterface>,
  defaults?: Partial<OrderDetailsInput>,
): Promise<OrderDetailsInput> {
  const description = await rl.question(
    `Enter order description${defaults?.description ? ` [${defaults.description}]` : ''}: `,
  );
  const currency = await rl.question(
    `Enter currency (e.g. USD, EUR)${defaults?.currency ? ` [${defaults.currency}]` : ''}: `,
  );
  const orderAmount = await rl.question(
    `Enter order amount (total)${defaults?.orderAmount ? ` [${defaults.orderAmount}]` : ''}: `,
  );
  const shippingAmount = await rl.question(
    `Enter shipping amount${defaults?.shippingAmount ? ` [${defaults.shippingAmount}]` : ''}: `,
  );

  return {
    description: description || defaults?.description || '',
    currency: currency || defaults?.currency || 'USD',
    orderAmount: orderAmount || defaults?.orderAmount || '0.00',
    shippingAmount: shippingAmount || defaults?.shippingAmount || '0.00',
  };
}

async function promptYesNo(rl: ReturnType<typeof createInterface>, question: string): Promise<boolean> {
  const answer = await rl.question(`${question} (y/N): `);
  const normalized = answer.trim().toLowerCase();
  return normalized === 'y' || normalized === 'yes';
}

export async function createOrder(details?: OrderDetailsInput): Promise<unknown> {
  const ordersController = createOrdersController();

  const effectiveDetails: OrderDetailsInput =
    details ??
    ({
      description: 'Sample order from createOrder()',
      orderAmount: '100.00',
      shippingAmount: '10.00',
      currency: 'USD',
    } as const);

  const { description, orderAmount, shippingAmount, currency } = effectiveDetails;

  // For PayPal Orders V2, amount.value must equal the sum of the breakdown
  // components (item_total + tax_total + shipping + ...). To avoid
  // AMOUNT_MISMATCH errors, compute a simple item total as
  // orderAmount - shippingAmount when both are numeric.
  let itemTotalValue: string | undefined;
  const totalNumber = Number(orderAmount);
  const shippingNumber = Number(shippingAmount);

  if (Number.isFinite(totalNumber) && Number.isFinite(shippingNumber)) {
    const computedItemTotal = totalNumber - shippingNumber;
    if (computedItemTotal >= 0) {
      itemTotalValue = computedItemTotal.toFixed(2);
    }
  }

  const collect = {
    body: {
      intent: CheckoutPaymentIntent.Capture,
      purchaseUnits: [
        {
          referenceId: 'default',
          description,
          amount: {
            currencyCode: currency,
            value: orderAmount,
            breakdown: {
              ...(itemTotalValue && {
                itemTotal: {
                  currencyCode: currency,
                  value: itemTotalValue,
                },
              }),
              shipping: {
                currencyCode: currency,
                value: shippingAmount,
              },
            },
          },
        },
      ],
    },
    prefer: 'return=representation' as const,
  };

  const response = await ordersController.createOrder(collect);

  if (response.result?.id) {
    console.log('\nOrder created successfully.');
    console.log(`Order ID: ${response.result.id}`);
    console.log(`Status: ${response.result.status}`);
  }

  // Return the full order result so tests can access `.id`.
  return response.result;
}

export async function getOrder(
  orderId: string,
): Promise<unknown> {
  if (!orderId || typeof orderId !== 'string' || orderId.trim().length === 0) {
    throw new Error('orderId is required to retrieve an order.');
  }

  const ordersController = createOrdersController();
  const response = await ordersController.getOrder({ id: orderId });
  return response.result;
}

async function getOrderAndPrint(orderId: string): Promise<void> {
  try {
    const order = await getOrder(orderId);
    console.log('\nCurrent order details:');
    // eslint-disable-next-line no-console
    console.dir(order, { depth: null });
  } catch (error) {
    handleError(error);
  }
}

async function updateOrder(orderId: string, updated: OrderDetailsInput): Promise<void> {
  const ordersController = createOrdersController();

  const patches = [
    {
      op: PatchOp.Replace,
      path: "/purchase_units/@reference_id=='default'/amount",
      value: {
        currencyCode: updated.currency,
        value: updated.orderAmount,
        breakdown: {
          shipping: {
            currencyCode: updated.currency,
            value: updated.shippingAmount,
          },
        },
      },
    },
    {
      op: PatchOp.Replace,
      path: "/purchase_units/@reference_id=='default'/description",
      value: updated.description,
    },
  ];

  try {
    await ordersController.patchOrder({ id: orderId, body: patches });
    console.log('\nOrder updated successfully.');
  } catch (error) {
    handleError(error);
  }
}

function handleError(error: unknown): void {
  if (error instanceof ApiError) {
    console.error('PayPal API Error:', error.statusCode, error.body);
    if (error instanceof CustomError) {
      console.error('PayPal Custom Error:', error.result?.name, error.result?.message);
    }
  } else {
    console.error('Unexpected error:', error);
  }
}

async function main(): Promise<void> {
  console.log('=== PayPal Order CLI ===');
  console.log('This tool will create a new PayPal order, fetch it, and optionally let you update it.\n');

  const rl = createInterface({ input, output });

  try {
    const initialDetails = await promptOrderDetails(rl);

    const createdOrder = await createOrder(initialDetails);

    const orderId =
      createdOrder &&
      typeof createdOrder === 'object' &&
      'id' in createdOrder &&
      typeof (createdOrder as { id: unknown }).id === 'string'
        ? (createdOrder as { id: string }).id
        : undefined;

    if (!orderId) {
      console.error('Unable to create order. Exiting.');
      return;
    }

    await getOrderAndPrint(orderId);

    const wantsUpdate = await promptYesNo(rl, '\nDo you want to modify this order before saving changes?');
    if (!wantsUpdate) {
      console.log('\nNo changes requested. Exiting.');
      return;
    }

    const updatedDetails = await promptOrderDetails(rl, initialDetails);
    await updateOrder(orderId, updatedDetails);

    // Fetch and print the updated order
    await getOrderAndPrint(orderId);
  } finally {
    rl.close();
  }
}

// Run the CLI only when this module is executed directly, not when imported (e.g. in tests).
if (import.meta.url === new URL(process.argv[1]!, 'file:').href) {
  main().catch((error) => {
    handleError(error);
    process.exitCode = 1;
  });
}