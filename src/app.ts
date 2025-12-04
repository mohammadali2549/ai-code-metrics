import "dotenv/config";
import fetch from "node-fetch";
import readline from "node:readline";
import { stdin as input, stdout as output } from "node:process";

type PayPalEnvironment = string;

interface CreateOrderInput {
  description: string;
  amountValue: string;
  shippingValue: string;
  currencyCode: string;
}

interface PurchaseUnitAmount {
  currency_code: string;
  value: string;
  breakdown?: {
    item_total?: {
      currency_code: string;
      value: string;
    };
    shipping?: {
      currency_code: string;
      value: string;
    };
  };
}

interface PurchaseUnit {
  reference_id?: string;
  description?: string;
  amount: PurchaseUnitAmount;
}

interface PayPalOrder {
  id: string;
  status: string;
  purchase_units?: PurchaseUnit[];
}

async function getAccessToken(env: PayPalEnvironment): Promise<string> {
  const clientId = process.env.PAYPAL_CLIENT_ID;
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error(
      "PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET must be set in environment variables."
    );
  }

  const baseUrl =
    env === "live" ? "https://api.paypal.com" : "https://api.sandbox.paypal.com";

  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  const response = await fetch(`${baseUrl}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to obtain PayPal access token: ${response.status} ${text}`);
  }

  const data = (await response.json()) as { access_token: string };
  return data.access_token;
}

function getBaseUrl(env: PayPalEnvironment): string {
  return env === "live" ? "https://api.paypal.com" : "https://api.sandbox.paypal.com";
}

export async function createOrder(
  env?: PayPalEnvironment,
  accessToken?: string,
  inputData?: CreateOrderInput
): Promise<PayPalOrder> {
  if (!env || !accessToken || !inputData) {
    throw new Error("createOrder requires environment, access token, and input data.");
  }

  const baseUrl = getBaseUrl(env);

  const amountNumber = Number(inputData.amountValue);
  const shippingNumber = Number(inputData.shippingValue);

  if (Number.isNaN(amountNumber) || Number.isNaN(shippingNumber)) {
    throw new Error("Amount and shipping must be numeric values.");
  }

  const total = (amountNumber + shippingNumber).toFixed(2);

  const body = {
    intent: "CAPTURE",
    purchase_units: [
      {
        reference_id: "default",
        description: inputData.description,
        amount: {
          currency_code: inputData.currencyCode,
          value: total,
          breakdown: {
            item_total: {
              currency_code: inputData.currencyCode,
              value: amountNumber.toFixed(2),
            },
            shipping: {
              currency_code: inputData.currencyCode,
              value: shippingNumber.toFixed(2),
            },
          },
        },
      },
    ],
  };

  const response = await fetch(`${baseUrl}/v2/checkout/orders`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to create order: ${response.status} ${text}`);
  }

  const data = (await response.json()) as PayPalOrder;
  return data;
}

export async function getOrder(
  env?: PayPalEnvironment,
  accessToken?: string,
  orderId?: string
): Promise<PayPalOrder> {
  if (!env || !accessToken || !orderId) {
    throw new Error("getOrder requires environment, access token, and order ID.");
  }

  const baseUrl = getBaseUrl(env);
  const response = await fetch(`${baseUrl}/v2/checkout/orders/${orderId}`, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to get order: ${response.status} ${text}`);
  }

  const data = (await response.json()) as PayPalOrder;
  return data;
}

async function patchOrder(
  env: PayPalEnvironment,
  accessToken: string,
  orderId: string,
  updated: CreateOrderInput
): Promise<void> {
  const baseUrl = getBaseUrl(env);

  const amountNumber = Number(updated.amountValue);
  const shippingNumber = Number(updated.shippingValue);

  if (Number.isNaN(amountNumber) || Number.isNaN(shippingNumber)) {
    throw new Error("Amount and shipping must be numeric values.");
  }

  const total = (amountNumber + shippingNumber).toFixed(2);

  const amount: PurchaseUnitAmount = {
    currency_code: updated.currencyCode,
    value: total,
    breakdown: {
      item_total: {
        currency_code: updated.currencyCode,
        value: amountNumber.toFixed(2),
      },
      shipping: {
        currency_code: updated.currencyCode,
        value: shippingNumber.toFixed(2),
      },
    },
  };

  const patchBody = [
    {
      op: "replace",
      path: "/purchase_units/@reference_id=='default'/description",
      value: updated.description,
    },
    {
      op: "replace",
      path: "/purchase_units/@reference_id=='default'/amount",
      value: amount,
    },
  ];

  const response = await fetch(`${baseUrl}/v2/checkout/orders/${orderId}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(patchBody),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to patch order: ${response.status} ${text}`);
  }
}

function printOrder(order: PayPalOrder): void {
  const pu = order.purchase_units?.[0];
  const amount = pu?.amount;
  const breakdown = amount?.breakdown;

  console.log("---- Order Details ----");
  console.log(`ID: ${order.id}`);
  console.log(`Status: ${order.status}`);
  console.log(`Description: ${pu?.description ?? ""}`);
  console.log(`Currency: ${amount?.currency_code ?? ""}`);
  console.log(`Total Amount: ${amount?.value ?? ""}`);
  console.log(
    `Item Amount: ${breakdown?.item_total?.value ?? ""} | Shipping: ${breakdown?.shipping?.value ?? ""}`
  );
  console.log("-----------------------");
}

async function askQuestion(rl: readline.Interface, question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => resolve(answer.trim()));
  });
}

async function main(): Promise<void> {
  const rl = readline.createInterface({ input, output });

  try {
    const envInput = await askQuestion(
      rl,
      "Select PayPal environment (sandbox/live) [sandbox]: "
    );
    const env: PayPalEnvironment =
      envInput === "live" || envInput === "sandbox" ? envInput : "sandbox";

    const description = await askQuestion(rl, "Order description: ");
    const amountValue = await askQuestion(rl, "Order amount (e.g., 10.00): ");
    const shippingValue = await askQuestion(rl, "Shipping amount (e.g., 2.50): ");
    const currencyCodeInput = await askQuestion(
      rl,
      "Currency code (e.g., USD, EUR) [USD]: "
    );
    const currencyCode = (currencyCodeInput || "USD").toUpperCase();

    console.log("\nObtaining access token from PayPal...");
    const accessToken = await getAccessToken(env);

    console.log("Creating order...");
    const createdOrder = await createOrder(env, accessToken, {
      description,
      amountValue,
      shippingValue,
      currencyCode,
    });
    console.log("Order created successfully.\n");

    const createdOrderId = createdOrder.id;
    console.log(`Created Order ID: ${createdOrderId}\n`);

    console.log("Retrieving created order...");
    const fetchedOrder = await getOrder(env, accessToken, createdOrderId);
    printOrder(fetchedOrder);

    const modify = await askQuestion(
      rl,
      "Would you like to modify this order before saving changes? (y/N): "
    );

    if (modify.toLowerCase() === "y" || modify.toLowerCase() === "yes") {
      const newDescription = await askQuestion(
        rl,
        `New description [${description}]: `
      );
      const newAmountValue = await askQuestion(
        rl,
        `New order amount [${amountValue}]: `
      );
      const newShippingValue = await askQuestion(
        rl,
        `New shipping amount [${shippingValue}]: `
      );
      const newCurrencyCodeInput = await askQuestion(
        rl,
        `New currency code [${currencyCode}]: `
      );

      const updatedInput: CreateOrderInput = {
        description: newDescription || description,
        amountValue: newAmountValue || amountValue,
        shippingValue: newShippingValue || shippingValue,
        currencyCode: (newCurrencyCodeInput || currencyCode).toUpperCase(),
      };

      console.log("\nSaving order changes (patching order on PayPal)...");
      await patchOrder(env, accessToken, createdOrderId, updatedInput);
      console.log("Order updated successfully.\n");

      console.log("Retrieving updated order...");
      const updatedOrder = await getOrder(env, accessToken, createdOrderId);
      printOrder(updatedOrder);
    } else {
      console.log("No changes applied to the order.");
    }

    console.log("CLI flow completed.");
  } catch (err) {
    console.error("Error:", err instanceof Error ? err.message : err);
  } finally {
    rl.close();
  }
}

// Execute the CLI when this file is run directly.
void main();
