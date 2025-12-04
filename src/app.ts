import readline from 'readline';
import {
  ApiError,
  CheckoutPaymentIntent,
  Client,
  Environment,
  LogLevel,
  OrdersController,
  PatchOp,
} from '@paypal/paypal-server-sdk';

type Metrics = {
  issuesFound: number;
  issuesFixed: number;
  fixAttempts: number;
};

const metrics: Metrics = {
  issuesFound: 0,
  issuesFixed: 0,
  fixAttempts: 0,
};

function trackIssue(found: boolean, fixed: boolean) {
  if (found) {
    metrics.issuesFound += 1;
  }
  if (fixed) {
    metrics.issuesFixed += 1;
  }
}

function trackFixAttempt() {
  metrics.fixAttempts += 1;
}

function ask(rl: readline.Interface, question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => resolve(answer.trim()));
  });
}

const MISSING_CREDS_MESSAGE =
  'Missing PayPal credentials. Set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET environment variables before calling PayPal APIs.';

function createClient(): Client {
  const clientId = process.env.PAYPAL_CLIENT_ID;
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    console.error(MISSING_CREDS_MESSAGE);
    throw new Error(MISSING_CREDS_MESSAGE);
  }

  return new Client({
    clientCredentialsAuthCredentials: {
      oAuthClientId: clientId,
      oAuthClientSecret: clientSecret,
    },
    timeout: 0,
    environment: Environment.Sandbox,
    logging: {
      logLevel: LogLevel.Info,
      logRequest: { logBody: true },
      logResponse: { logHeaders: true },
    },
  });
}

type OrderInput = {
  description: string;
  currency: string;
  orderAmount: string;
  shippingAmount: string;
};

async function createOrderRequest(
  ordersController: OrdersController,
  input: OrderInput
) {
  const { description, currency, orderAmount, shippingAmount } = input;

  const request = {
    body: {
      intent: CheckoutPaymentIntent.Capture,
      purchaseUnits: [
        {
          referenceId: 'default',
          amount: {
            currencyCode: currency,
            value: orderAmount,
            breakdown: {
              itemTotal: { currencyCode: currency, value: orderAmount },
              shipping: { currencyCode: currency, value: shippingAmount },
            },
          },
          description,
        },
      ],
    },
    prefer: 'return=representation' as const,
  };

  const response = await ordersController.createOrder(request);
  return response.result;
}

async function createOrderFlow(
  ordersController: OrdersController,
  rl: readline.Interface
): Promise<string | undefined> {
  const description = await ask(rl, 'Enter order description: ');
  const currency = await ask(rl, 'Enter currency (e.g. USD): ');
  const orderAmount = await ask(rl, 'Enter order amount (e.g. 100.00): ');
  const shippingAmount = await ask(rl, 'Enter shipping amount (e.g. 10.00): ');

  try {
    const createdOrder = await createOrderRequest(ordersController, {
      description,
      currency,
      orderAmount,
      shippingAmount,
    });
    const orderId =
      createdOrder && typeof createdOrder === 'object'
        ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (createdOrder as any).id
        : undefined;

    console.log('\nOrder created successfully.');
    console.log('Order ID:', orderId);
    return orderId;
  } catch (error: any) {
    if (error instanceof ApiError) {
      console.error('PayPal API error while creating order:', error.statusCode);
      console.error(error.body);
    } else {
      console.error('Unexpected error while creating order:', error);
    }
    return undefined;
  }
}

async function getOrderFlow(
  ordersController: OrdersController,
  orderId: string
) {
  try {
    const response = await ordersController.getOrder({ id: orderId });
    console.log('\nCurrent order details:');
    console.dir(response.result, { depth: null });
    return response.result;
  } catch (error: any) {
    if (error instanceof ApiError) {
      console.error('PayPal API error while getting order:', error.statusCode);
      console.error(error.body);
    } else {
      console.error('Unexpected error while getting order:', error);
    }
    return undefined;
  }
}

async function editAndPatchOrderFlow(
  ordersController: OrdersController,
  rl: readline.Interface,
  orderId: string
) {
  const newDescription = await ask(
    rl,
    'Enter new description (leave blank to keep current): '
  );
  const newCurrency = await ask(
    rl,
    'Enter new currency (leave blank to keep current): '
  );
  const newOrderAmount = await ask(
    rl,
    'Enter new order amount (leave blank to keep current): '
  );
  const newShippingAmount = await ask(
    rl,
    'Enter new shipping amount (leave blank to keep current): '
  );

  const patches: Array<{
    op: PatchOp;
    path: string;
    value: unknown;
  }> = [];

  if (newDescription) {
    patches.push({
      op: PatchOp.Replace,
      path: "/purchase_units/@reference_id=='default'/description",
      value: newDescription,
    });
  }

  if (newCurrency || newOrderAmount || newShippingAmount) {
    const currency = newCurrency || 'USD';
    const amountValue = newOrderAmount || '0.00';
    const shippingValue = newShippingAmount || '0.00';

    patches.push({
      op: PatchOp.Replace,
      path: "/purchase_units/@reference_id=='default'/amount",
      value: {
        currencyCode: currency,
        value: amountValue,
        breakdown: {
          itemTotal: { currencyCode: currency, value: amountValue },
          shipping: { currencyCode: currency, value: shippingValue },
        },
      },
    });
  }

  if (patches.length === 0) {
    console.log('No changes entered. Skipping update.');
    return;
  }

  const request = {
    id: orderId,
    body: patches,
  };

  try {
    await ordersController.patchOrder(request);
    console.log('\nOrder updated successfully.');
  } catch (error: any) {
    if (error instanceof ApiError) {
      console.error('PayPal API error while patching order:', error.statusCode);
      console.error(error.body);
    } else {
      console.error('Unexpected error while patching order:', error);
    }
  }
}

export async function main() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    const client = createClient();
    const ordersController = new OrdersController(client);

    const orderId = await createOrderFlow(ordersController, rl);
    if (!orderId) {
      return;
    }

    await getOrderFlow(ordersController, orderId);

    const editAnswer = await ask(
      rl,
      '\nDo you want to edit this order? (y/N): '
    );
    if (editAnswer.toLowerCase() === 'y') {
      await editAndPatchOrderFlow(ordersController, rl, orderId);
      await getOrderFlow(ordersController, orderId);
    } else {
      console.log('No changes made to the order.');
    }
  } finally {
    rl.close();
  }
}

// Exported helpers used by tests (non-interactive).
// These create their own PayPal client and controller instances.
export async function createOrder(): Promise<unknown> {
  const client = createClient();
  const ordersController = new OrdersController(client);

  // Use simple default values when not running in interactive CLI mode.
  return createOrderRequest(ordersController, {
    description: 'Sample order created by tests',
    currency: 'USD',
    orderAmount: '100.00',
    shippingAmount: '10.00',
  });
}

export async function getOrder(orderId: string): Promise<unknown> {
  if (!orderId) {
    throw new Error('orderId is required to retrieve an order.');
  }

  const client = createClient();
  const ordersController = new OrdersController(client);

  return getOrderFlow(ordersController, orderId);
}

// Execute the CLI only when run directly via Node, not when imported in tests.
if (process.argv[1] && process.argv[1].endsWith('app.js')) {
  main().catch((err) => {
    console.error('Fatal error in CLI:', err);
  });
}

