import * as readline from "readline";
import "dotenv/config";

import {
  ApiError,
  CheckoutPaymentIntent,
  Client,
  CustomError,
  Environment,
  LogLevel,
  OrdersController,
  PatchOp,
} from "@paypal/paypal-server-sdk";

type CliOrderInput = {
  description: string;
  orderAmount: string;
  shippingAmount: string;
  currency: string;
};

function createQuestion(rl: readline.Interface): (q: string) => Promise<string> {
  return (q: string) =>
    new Promise<string>((resolve) => {
      rl.question(q, (answer) => resolve(answer));
    });
}

function createPayPalClient() {
  const clientId =
    process.env.OAUTH_CLIENT_ID ||
    process.env.PAYPAL_CLIENT_ID ||
    process.env.CLIENT_ID;
  const clientSecret =
    process.env.OAUTH_CLIENT_SECRET ||
    process.env.PAYPAL_CLIENT_SECRET ||
    process.env.CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error(
      "Missing PayPal credentials. Please set OAUTH_CLIENT_ID/OAUTH_CLIENT_SECRET (or PAYPAL_CLIENT_ID/PAYPAL_CLIENT_SECRET, or CLIENT_ID/CLIENT_SECRET) environment variables."
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

async function promptForOrder(
  question: (q: string) => Promise<string>
): Promise<CliOrderInput> {
  const description =
    (await question("Enter order description: ")).trim() || "Sample order";

  const orderAmountRaw =
    (await question("Enter order amount (e.g. 100.00): ")).trim() || "100.00";
  const shippingAmountRaw =
    (await question("Enter shipping amount (e.g. 10.00): ")).trim() || "0.00";
  const currencyRaw =
    (await question("Enter currency code (e.g. USD): ")).trim() || "USD";

  const orderAmount = orderAmountRaw;
  const shippingAmount = shippingAmountRaw;
  const currency = currencyRaw.toUpperCase();

  return {
    description,
    orderAmount,
    shippingAmount,
    currency,
  };
}

async function createOrderWithController(
  ordersController: OrdersController,
  input: CliOrderInput
): Promise<string | undefined> {
  const collect = {
    body: {
      intent: CheckoutPaymentIntent.Capture,
      purchaseUnits: [
        {
          referenceId: "default",
          amount: {
            currencyCode: input.currency,
            value: input.orderAmount,
            breakdown: {
              itemTotal: {
                currencyCode: input.currency,
                value: input.orderAmount,
              },
              shipping: {
                currencyCode: input.currency,
                value: input.shippingAmount,
              },
            },
          },
          description: input.description,
        },
      ],
    },
    prefer: "return=minimal",
  };

  try {
    const response = await ordersController.createOrder(collect);
    if (response.result) {
      // eslint-disable-next-line no-console
      console.log("Order created with ID:", response.result.id);
    }
    return response.result?.id;
  } catch (error) {
    handleError(error);
    return undefined;
  }
}

async function getOrderWithController(
  ordersController: OrdersController,
  orderId: string
) {
  const collect = { id: orderId };

  try {
    const response = await ordersController.getOrder(collect);
    if (response.result) {
      // eslint-disable-next-line no-console
      console.log("Retrieved order details:");
      // eslint-disable-next-line no-console
      console.dir(response.result, { depth: null });
    }
    return response.result;
  } catch (error) {
    handleError(error);
    return undefined;
  }
}

async function promptForEdits(
  question: (q: string) => Promise<string>,
  current: CliOrderInput
): Promise<CliOrderInput> {
  const edit = (await question("Do you want to edit the order? (y/N): "))
    .trim()
    .toLowerCase();
  if (edit !== "y" && edit !== "yes") {
    return current;
  }

  const description =
    (await question(
      `Description [${current.description}]: `
    )).trim() || current.description;

  const orderAmountInput =
    (await question(
      `Order amount [${current.orderAmount}]: `
    )).trim() || current.orderAmount;

  const shippingAmountInput =
    (await question(
      `Shipping amount [${current.shippingAmount}]: `
    )).trim() || current.shippingAmount;

  const currencyInput =
    (await question(`Currency [${current.currency}]: `)).trim() ||
    current.currency;

  return {
    description,
    orderAmount: orderAmountInput,
    shippingAmount: shippingAmountInput,
    currency: currencyInput.toUpperCase(),
  };
}

async function updateOrderWithController(
  ordersController: OrdersController,
  orderId: string,
  updated: CliOrderInput
): Promise<void> {
  const collect = {
    id: orderId,
    body: [
      {
        op: PatchOp.Replace,
        path: "/purchase_units/@reference_id=='default'/amount",
        value: {
          currencyCode: updated.currency,
          value: updated.orderAmount,
          breakdown: {
            itemTotal: {
              currencyCode: updated.currency,
              value: updated.orderAmount,
            },
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
    ],
  };

  try {
    await ordersController.patchOrder(collect);
    // eslint-disable-next-line no-console
    console.log("Order updated successfully.");
  } catch (error) {
    handleError(error);
  }
}

function handleError(error: unknown) {
  if (error instanceof ApiError) {
    // eslint-disable-next-line no-console
    console.error("PayPal API Error:", error.statusCode, error.body);
    if (error instanceof CustomError) {
      // eslint-disable-next-line no-console
      console.error(
        "Custom Error:",
        error.result?.name,
        error.result?.message
      );
    }
  } else {
    // eslint-disable-next-line no-console
    console.error("Unexpected error:", error);
  }
}

export async function createOrder(): Promise<string | undefined>;
export async function createOrder(
  ordersController: OrdersController,
  input: CliOrderInput
): Promise<string | undefined>;
export async function createOrder(
  ordersControllerOrInput?: OrdersController | CliOrderInput,
  maybeInput?: CliOrderInput
): Promise<string | undefined> {
  if (
    ordersControllerOrInput instanceof OrdersController &&
    maybeInput !== undefined
  ) {
    return createOrderWithController(ordersControllerOrInput, maybeInput);
  }

  const ordersController = createPayPalClient();
  const input: CliOrderInput = {
    description: "Sample order from tests",
    orderAmount: "100.00",
    shippingAmount: "0.00",
    currency: "USD",
  };

  return createOrderWithController(ordersController, input);
}

export async function getOrder(orderId: string): Promise<unknown>;
export async function getOrder(
  ordersController: OrdersController,
  orderId: string
): Promise<unknown>;
export async function getOrder(
  ordersControllerOrOrderId: OrdersController | string,
  maybeOrderId?: string
): Promise<unknown> {
  if (ordersControllerOrOrderId instanceof OrdersController) {
    const ordersController = ordersControllerOrOrderId;
    const orderId = maybeOrderId as string;
    return getOrderWithController(ordersController, orderId);
  }

  const ordersController = createPayPalClient();
  const orderId = ordersControllerOrOrderId;
  return getOrderWithController(ordersController, orderId);
}

async function main() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  const question = createQuestion(rl);

  try {
    const ordersController = createPayPalClient();

    const initialInput = await promptForOrder(question);

    const orderId = await createOrderWithController(
      ordersController,
      initialInput
    );
    if (!orderId) {
      return;
    }

    const order = await getOrderWithController(ordersController, orderId);
    const purchaseUnit = order?.purchaseUnits?.[0];
    const amount = purchaseUnit?.amount;

    const currentInput: CliOrderInput = {
      description: purchaseUnit?.description ?? initialInput.description,
      orderAmount: amount?.value ?? initialInput.orderAmount,
      shippingAmount:
        amount?.breakdown?.shipping?.value ?? initialInput.shippingAmount,
      currency: amount?.currencyCode ?? initialInput.currency,
    };

    const updatedInput = await promptForEdits(question, currentInput);

    await updateOrderWithController(ordersController, orderId, updatedInput);
  } finally {
    rl.close();
  }
}

if (require.main === module) {
  // eslint-disable-next-line @typescript-eslint/no-floating-promises
  main();
}
