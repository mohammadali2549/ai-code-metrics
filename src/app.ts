import readline from "readline";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import path from "path";
import {
  ApiError,
  CheckoutPaymentIntent,
  Client,
  Environment,
  LogLevel,
  OrdersController,
  PatchOp
} from "@paypal/paypal-server-sdk";

dotenv.config();

type CliOrderInput = {
  description: string;
  currencyCode: string;
  amountValue: string;
  shippingValue: string;
};

function createInterface() {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
}

function askQuestion(rl: readline.Interface, question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => resolve(answer.trim()));
  });
}

function buildClient(): OrdersController {
  const clientId = process.env.PAYPAL_CLIENT_ID;
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    console.error("PAYPAL_CLIENT_ID or PAYPAL_CLIENT_SECRET is not set in environment.");
    process.exit(1);
  }

  const client = new Client({
    clientCredentialsAuthCredentials: {
      oAuthClientId: clientId,
      oAuthClientSecret: clientSecret
    },
    environment: Environment.Sandbox,
    timeout: 0,
    logging: {
      logLevel: LogLevel.Info,
      logRequest: { logBody: true },
      logResponse: { logHeaders: true }
    }
  });

  return new OrdersController(client);
}

async function promptForOrderInput(rl: readline.Interface): Promise<CliOrderInput> {
  const description = await askQuestion(rl, "Enter order description: ");
  const currencyCodeInput =
    (await askQuestion(rl, "Enter currency code (e.g. USD, EUR) [USD]: ")) || "USD";

  let amountValue = "0.00";
  let shippingValue = "0.00";

  // Ensure shipping does not exceed total and no negative values are used.
  while (true) {
    const amountRaw =
      (await askQuestion(rl, "Enter order amount (total, e.g. 100.00): ")) || "0.00";
    const shippingRaw =
      (await askQuestion(rl, "Enter shipping amount (e.g. 10.00): ")) || "0.00";

    const total = Number.parseFloat(amountRaw);
    const shipping = Number.parseFloat(shippingRaw);

    if (
      Number.isNaN(total) ||
      Number.isNaN(shipping) ||
      total < 0 ||
      shipping < 0
    ) {
      console.error("Amounts must be valid non-negative numbers. Please try again.\n");
      continue;
    }

    if (shipping > total) {
      console.error(
        "Shipping amount cannot be greater than total amount. Please enter values again.\n"
      );
      continue;
    }

    amountValue = total.toFixed(2);
    shippingValue = shipping.toFixed(2);
    break;
  }

  return {
    description,
    currencyCode: currencyCodeInput.toUpperCase(),
    amountValue,
    shippingValue
  };
}

async function createOrderInternal(
  ordersController: OrdersController,
  input: CliOrderInput
): Promise<string | null> {
  const { description, currencyCode, amountValue, shippingValue } = input;

  const itemTotal = (
    Number.parseFloat(amountValue) - Number.parseFloat(shippingValue || "0")
  ).toFixed(2);

  const request = {
    body: {
      intent: CheckoutPaymentIntent.Capture,
      purchaseUnits: [
        {
          referenceId: "default",
          description,
          amount: {
            currencyCode,
            value: amountValue,
            breakdown: {
              itemTotal: { currencyCode, value: itemTotal },
              shipping: { currencyCode, value: shippingValue }
            }
          }
        }
      ]
    },
    prefer: "return=representation" as const
  };

  try {
    const response = await ordersController.createOrder(request);
    if (response.result) {
      console.log("Order created successfully. ID:", response.result.id);
      return response.result.id ?? null;
    }
  } catch (error) {
    if (error instanceof ApiError) {
      console.error("PayPal API error while creating order:", error.statusCode, error.body);
    } else {
      console.error("Unexpected error while creating order:", error);
    }
  }
  return null;
}

async function getOrderInternal(
  ordersController: OrdersController,
  id: string
): Promise<any | null> {
  try {
    const response = await ordersController.getOrder({ id });
    if (response.result) {
      return response.result;
    }
  } catch (error) {
    if (error instanceof ApiError) {
      console.error("PayPal API error while fetching order:", error.statusCode, error.body);
    } else {
      console.error("Unexpected error while fetching order:", error);
    }
  }
  return null;
}

function printOrderSummary(order: any) {
  console.log("Current order details:");
  console.log(JSON.stringify(order, null, 2));
}

async function promptForOrderEdits(
  rl: readline.Interface,
  current: CliOrderInput
): Promise<CliOrderInput> {
  console.log("\nYou can now modify the order details. Press Enter to keep current value.");

  const description =
    (await askQuestion(
      rl,
      `Description [${current.description || "none"}]: `
    )) || current.description;

  const currencyCodeInput =
    (await askQuestion(
      rl,
      `Currency [${current.currencyCode || "USD"}]: `
    )) || current.currencyCode;

  let amountValue = current.amountValue;
  let shippingValue = current.shippingValue;

  // Validate updated amounts similarly to initial input.
  while (true) {
    const amountRaw =
      (await askQuestion(
        rl,
        `Total amount [${current.amountValue}]: `
      )) || current.amountValue;

    const shippingRaw =
      (await askQuestion(
        rl,
        `Shipping amount [${current.shippingValue}]: `
      )) || current.shippingValue;

    const total = Number.parseFloat(amountRaw);
    const shipping = Number.parseFloat(shippingRaw);

    if (
      Number.isNaN(total) ||
      Number.isNaN(shipping) ||
      total < 0 ||
      shipping < 0
    ) {
      console.error("Amounts must be valid non-negative numbers. Please try again.\n");
      continue;
    }

    if (shipping > total) {
      console.error(
        "Shipping amount cannot be greater than total amount. Please enter values again.\n"
      );
      continue;
    }

    amountValue = total.toFixed(2);
    shippingValue = shipping.toFixed(2);
    break;
  }

  return {
    description,
    currencyCode: currencyCodeInput.toUpperCase(),
    amountValue,
    shippingValue
  };
}

async function patchOrder(
  ordersController: OrdersController,
  orderId: string,
  updated: CliOrderInput
): Promise<boolean> {
  const { description, currencyCode, amountValue, shippingValue } = updated;

  const itemTotal = (
    Number.parseFloat(amountValue) - Number.parseFloat(shippingValue || "0")
  ).toFixed(2);

  const patches = [
    {
      op: PatchOp.Replace,
      path: "/purchase_units/@reference_id=='default'/amount",
      // Use snake_case keys to match PayPal Orders V2 API schema.
      // Cast as any to satisfy the SDK's type expectations.
      value: {
        currency_code: currencyCode,
        value: amountValue,
        breakdown: {
          item_total: { currency_code: currencyCode, value: itemTotal },
          shipping: { currency_code: currencyCode, value: shippingValue }
        }
      } as any
    },
    {
      op: PatchOp.Replace,
      path: "/purchase_units/@reference_id=='default'/description",
      value: description
    }
  ];

  try {
    await ordersController.patchOrder({ id: orderId, body: patches });
    console.log("Order updated successfully.");
    return true;
  } catch (error) {
    if (error instanceof ApiError) {
      console.error("PayPal API error while updating order:", error.statusCode, error.body);
    } else {
      console.error("Unexpected error while updating order:", error);
    }
    return false;
  }
}

async function main() {
  const rl = createInterface();
  const ordersController = buildClient();

  try {
    console.log("=== PayPal Order CLI ===");
    const initialInput = await promptForOrderInput(rl);

    const orderId = await createOrderInternal(ordersController, initialInput);
    if (!orderId) {
      console.error("Failed to create order; exiting.");
      return;
    }

    const order = await getOrderInternal(ordersController, orderId);
    if (!order) {
      console.error("Failed to retrieve order; exiting.");
      return;
    }

    printOrderSummary(order);

    const updatedInput = await promptForOrderEdits(rl, initialInput);

    const confirm = await askQuestion(
      rl,
      "Save these changes to the PayPal order? (y/N): "
    );

    if (confirm.toLowerCase() === "y" || confirm.toLowerCase() === "yes") {
      const success = await patchOrder(ordersController, orderId, updatedInput);
      if (success) {
        const updatedOrder = await getOrderInternal(ordersController, orderId);
        if (updatedOrder) {
          console.log("\nUpdated order from PayPal:");
          printOrderSummary(updatedOrder);
        }
      }
    } else {
      console.log("Changes were not saved to PayPal. Exiting.");
    }
  } finally {
    rl.close();
  }
}

// Execute only when run directly, not when imported.
const thisFilePath = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === thisFilePath) {
  // Errors are already logged inside helpers; ensure process exit code reflects failure.
  main().catch((err) => {
    console.error("Fatal error in CLI:", err);
    process.exit(1);
  });
}

// Exported helpers expected by tests; delegate to internal implementations.
export async function createOrder(): Promise<string | null> {
  const ordersController = buildClient();
  const defaultInput: CliOrderInput = {
    description: "",
    currencyCode: "USD",
    amountValue: "0.00",
    shippingValue: "0.00"
  };
  return createOrderInternal(ordersController, defaultInput);
}

export async function getOrder(orderId?: string): Promise<any | null> {
  if (!orderId) {
    return null;
  }
  const ordersController = buildClient();
  return getOrderInternal(ordersController, orderId);
}


