import "dotenv/config";

const PAYPAL_API_BASE =
  process.env.PAYPAL_API_BASE ?? "https://api-m.sandbox.paypal.com";
const PAYPAL_CLIENT_ID = process.env.PAYPAL_CLIENT_ID ?? "";
const PAYPAL_CLIENT_SECRET = process.env.PAYPAL_CLIENT_SECRET ?? "";

if (!globalThis.fetch) {
  throw new Error(
    "Global fetch API is not available. Please run on a Node.js version that supports fetch.",
  );
}

async function generateAccessToken(): Promise<string> {
  if (!PAYPAL_CLIENT_ID || !PAYPAL_CLIENT_SECRET) {
    throw new Error(
      "Missing PAYPAL_CLIENT_ID or PAYPAL_CLIENT_SECRET environment variables.",
    );
  }

  const basicAuth = Buffer.from(
    `${PAYPAL_CLIENT_ID}:${PAYPAL_CLIENT_SECRET}`,
    "utf8",
  ).toString("base64");

  const response = await fetch(`${PAYPAL_API_BASE}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basicAuth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `Failed to generate PayPal access token: ${response.status} ${text}`,
    );
  }

  const data = (await response.json()) as { access_token?: string };
  if (!data.access_token) {
    throw new Error("PayPal access token missing from response.");
  }

  return data.access_token;
}

export type PurchaseUnitAmount = {
  currency_code: string;
  value: string;
};

export type PurchaseUnit = {
  reference_id?: string;
  amount: PurchaseUnitAmount;
};

const DEFAULT_PURCHASE_UNITS: PurchaseUnit[] = [
  {
    amount: {
      currency_code: "USD",
      value: "100.00",
    },
  },
];

/**
 * Create a PayPal order using the Checkout Orders API.
 *
 * @param purchaseUnits - Optional array of purchase units describing the order.
 * @returns The PayPal order resource as returned by the API.
 */
export async function createOrder(
  purchaseUnits?: PurchaseUnit[],
): Promise<any> {
  const units =
    Array.isArray(purchaseUnits) && purchaseUnits.length > 0
      ? purchaseUnits
      : DEFAULT_PURCHASE_UNITS;

  const accessToken = await generateAccessToken();

  const response = await fetch(`${PAYPAL_API_BASE}/v2/checkout/orders`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      intent: "CAPTURE",
      purchase_units: units,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to create PayPal order: ${response.status} ${text}`);
  }

  return response.json();
}

/**
 * Retrieve an existing PayPal order by its ID.
 *
 * @param orderId - The PayPal order ID to retrieve.
 * @returns The PayPal order resource as returned by the API.
 */
export async function getOrder(orderId: string): Promise<any> {
  if (!orderId) {
    throw new Error("orderId is required to get an order.");
  }

  const accessToken = await generateAccessToken();

  const response = await fetch(
    `${PAYPAL_API_BASE}/v2/checkout/orders/${encodeURIComponent(orderId)}`,
    {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
    },
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to fetch PayPal order: ${response.status} ${text}`);
  }

  return response.json();
}


