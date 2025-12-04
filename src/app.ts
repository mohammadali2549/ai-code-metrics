import * as dotenv from "dotenv";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

dotenv.config();

const PAYPAL_BASE_URL =
  process.env.PAYPAL_BASE_URL ?? "https://api-m.sandbox.paypal.com";

interface Money {
  currency_code: string;
  value: string;
}

interface AmountWithBreakdown extends Money {
  breakdown?: {
    item_total?: Money;
    shipping?: Money;
  };
}

interface PurchaseUnit {
  reference_id?: string;
  description?: string;
  amount: AmountWithBreakdown;
}

interface Order {
  id: string;
  status: string;
  purchase_units: PurchaseUnit[];
}

async function getAccessToken(): Promise<string> {
  const clientId = process.env.PAYPAL_CLIENT_ID;
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error(
      "Missing PAYPAL_CLIENT_ID or PAYPAL_CLIENT_SECRET environment variables."
    );
  }

  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString(
    "base64"
  );

  const response = await fetch(`${PAYPAL_BASE_URL}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ grant_type: "client_credentials" }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `Failed to obtain PayPal access token: ${response.status} ${text}`
    );
  }

  const data = (await response.json()) as { access_token?: string };
  if (!data.access_token) {
    throw new Error("PayPal response missing access_token field.");
  }

  return data.access_token;
}

export async function createOrder(
  token?: string,
  description?: string,
  totalAmount?: number,
  shippingAmount?: number,
  currency?: string
): Promise<Order> {
  if (
    !token ||
    description === undefined ||
    totalAmount === undefined ||
    shippingAmount === undefined ||
    !currency
  ) {
    throw new Error(
      "createOrder requires token, description, totalAmount, shippingAmount, and currency."
    );
  }

  const itemTotal = totalAmount - shippingAmount;

  const body = {
    intent: "CAPTURE",
    purchase_units: [
      {
        description,
        amount: {
          currency_code: currency,
          value: totalAmount.toFixed(2),
          breakdown: {
            item_total: {
              currency_code: currency,
              value: itemTotal.toFixed(2),
            },
            shipping: {
              currency_code: currency,
              value: shippingAmount.toFixed(2),
            },
          },
        },
      },
    ],
  };

  const response = await fetch(`${PAYPAL_BASE_URL}/v2/checkout/orders`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `Failed to create order: ${response.status} ${text}`
    );
  }

  const order = (await response.json()) as Order;
  return order;
}

export async function getOrder(
  token?: string,
  orderId?: string
): Promise<Order> {
  if (!token || !orderId) {
    throw new Error("getOrder requires both token and orderId.");
  }

  const response = await fetch(
    `${PAYPAL_BASE_URL}/v2/checkout/orders/${orderId}`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
      },
    }
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `Failed to retrieve order: ${response.status} ${text}`
    );
  }

  const order = (await response.json()) as Order;
  return order;
}

async function patchOrder(
  token: string,
  orderId: string,
  referenceId: string,
  updated: {
    description?: string;
    totalAmount?: number;
    shippingAmount?: number;
    currency?: string;
  }
): Promise<void> {
  const ops: Array<Record<string, unknown>> = [];

  if (typeof updated.description === "string") {
    ops.push({
      op: "replace",
      path: `/purchase_units/@reference_id=='${referenceId}'/description`,
      value: updated.description,
    });
  }

  if (
    typeof updated.totalAmount === "number" &&
    typeof updated.shippingAmount === "number" &&
    typeof updated.currency === "string"
  ) {
    const itemTotal = updated.totalAmount - updated.shippingAmount;

    ops.push({
      op: "replace",
      path: `/purchase_units/@reference_id=='${referenceId}'/amount`,
      value: {
        currency_code: updated.currency,
        value: updated.totalAmount.toFixed(2),
        breakdown: {
          item_total: {
            currency_code: updated.currency,
            value: itemTotal.toFixed(2),
          },
          shipping: {
            currency_code: updated.currency,
            value: updated.shippingAmount.toFixed(2),
          },
        },
      },
    });
  }

  if (ops.length === 0) {
    return;
  }

  const response = await fetch(
    `${PAYPAL_BASE_URL}/v2/checkout/orders/${orderId}`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(ops),
    }
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `Failed to update order: ${response.status} ${text}`
    );
  }
}

function printOrder(order: Order): void {
  const pu = order.purchase_units?.[0];

  if (!pu) {
    console.log("---------------");
    console.log("Order details (no purchase_units in response):");
    console.log(`Order ID: ${order.id}`);
    console.log(`Status:   ${order.status}`);
    console.log(
      "Raw order payload:",
      JSON.stringify(order, null, 2)
    );
    console.log("---------------");
    return;
  }

  const amount = pu.amount;
  const breakdown = amount?.breakdown;

  const description = pu.description ?? "(none)";
  const currency = amount?.currency_code ?? "N/A";
  const totalValue = amount?.value ?? "N/A";
  const itemTotal = breakdown?.item_total?.value ?? "N/A";
  const shipping = breakdown?.shipping?.value ?? "N/A";

  console.log("---------------");
  console.log(`Order ID:      ${order.id}`);
  console.log(`Status:        ${order.status}`);
  console.log(`Description:   ${description}`);
  console.log(`Currency:      ${currency}`);
  console.log(`Total amount:  ${totalValue}`);
  console.log(`Item total:    ${itemTotal}`);
  console.log(`Shipping:      ${shipping}`);
  console.log("---------------");
}

async function promptNumber(
  rl: readline.Interface,
  promptText: string,
  options?: { min?: number }
): Promise<number> {
  while (true) {
    const raw = await rl.question(promptText);
    const value = Number(raw);
    if (!Number.isNaN(value)) {
      if (options?.min !== undefined && value < options.min) {
        console.log(`Please enter a number >= ${options.min}.`);
      } else {
        return value;
      }
    } else {
      console.log("Please enter a valid number.");
    }
  }
}

async function main(): Promise<void> {
  const rl = readline.createInterface({ input, output });

  try {
    console.log("PayPal Order CLI");
    console.log("================");

    const description = await rl.question(
      "Enter order description: "
    );

    const totalAmount = await promptNumber(
      rl,
      "Enter total order amount: ",
      { min: 0.01 }
    );

    let shippingAmount: number;
    while (true) {
      shippingAmount = await promptNumber(
        rl,
        "Enter shipping amount: ",
        { min: 0 }
      );

      if (shippingAmount > totalAmount) {
        console.log(
          "Shipping amount cannot exceed total amount. Please re-enter."
        );
      } else {
        break;
      }
    }

    let currency = await rl.question(
      "Enter currency code (default USD): "
    );
    if (!currency.trim()) {
      currency = "USD";
    }
    currency = currency.toUpperCase();

    console.log("\nObtaining PayPal access token...");
    const token = await getAccessToken();

    console.log("Creating order with PayPal...");
    const createdOrder = await createOrder(
      token,
      description,
      totalAmount,
      shippingAmount,
      currency
    );

    console.log("\nOrder created. Details from Create Order response:");
    printOrder(createdOrder);

    console.log("\nRetrieving order using Get Order endpoint...");
    const retrievedOrder = await getOrder(token, createdOrder.id);
    printOrder(retrievedOrder);

    const editAnswer = await rl.question(
      "Do you want to edit this order? (y/N): "
    );

    if (editAnswer.trim().toLowerCase() === "y") {
      const pu = retrievedOrder.purchase_units[0];
      const currentAmount = pu?.amount;
      const currentBreakdown = currentAmount?.breakdown;

      const currentDescription = pu?.description ?? "";
      const currentCurrency = currentAmount?.currency_code ?? currency;
      const currentTotal = Number(currentAmount?.value ?? totalAmount);
      const currentShipping = Number(
        currentBreakdown?.shipping?.value ?? shippingAmount
      );

      console.log("\nPress ENTER to keep the current value in brackets.");

      const newDescription = await rl.question(
        `Description [${currentDescription || "(none)"}]: `
      );

      const totalPrompt = await rl.question(
        `Total amount [${currentTotal.toFixed(2)}]: `
      );
      const newTotalAmount =
        totalPrompt.trim().length > 0
          ? Number(totalPrompt)
          : currentTotal;

      const shippingPrompt = await rl.question(
        `Shipping amount [${currentShipping.toFixed(2)}]: `
      );
      const newShippingAmount =
        shippingPrompt.trim().length > 0
          ? Number(shippingPrompt)
          : currentShipping;

      let newCurrency = await rl.question(
        `Currency [${currentCurrency}]: `
      );
      if (!newCurrency.trim()) {
        newCurrency = currentCurrency;
      }
      newCurrency = newCurrency.toUpperCase();

      if (Number.isNaN(newTotalAmount) || newTotalAmount <= 0) {
        console.log(
          "Invalid total amount entered. Skipping order update."
        );
      } else if (
        Number.isNaN(newShippingAmount) ||
        newShippingAmount < 0 ||
        newShippingAmount > newTotalAmount
      ) {
        console.log(
          "Invalid shipping amount entered. Skipping order update."
        );
      } else {
        console.log("\nSaving order changes with PayPal...");
        const referenceId = pu?.reference_id ?? "default";
        await patchOrder(token, retrievedOrder.id, referenceId, {
          description:
            newDescription.trim().length > 0
              ? newDescription
              : currentDescription,
          totalAmount: newTotalAmount,
          shippingAmount: newShippingAmount,
          currency: newCurrency,
        });

        console.log("Order updated. Fetching updated details...");
        const updatedOrder = await getOrder(token, retrievedOrder.id);
        printOrder(updatedOrder);
      }
    } else {
      console.log("No changes applied to the order.");
    }
  } catch (err) {
    console.error("An error occurred while processing the order.");
    if (err instanceof Error) {
      console.error(err.message);
    } else {
      console.error(String(err));
    }
  } finally {
    rl.close();
  }
}

await main();


