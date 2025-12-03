type FetchResponse = {
  ok: boolean;
  status: number;
  text(): Promise<string>;
  json(): Promise<unknown>;
};

type FetchFn = (input: string, init?: Record<string, unknown>) => Promise<FetchResponse>;

const fetchFn: FetchFn = ((input: string, init?: Record<string, unknown>) => {
  const f = (globalThis as unknown as { fetch?: FetchFn }).fetch;
  if (!f) {
    throw new Error(
      "Global fetch is not available. Ensure you are running on Node 18+ or provide a fetch polyfill.",
    );
  }
  return f(input, init);
}) as FetchFn;

type NodeProcessEnv = Record<string, string | undefined>;

function getEnvVar(name: string): string | undefined {
  const g = globalThis as { process?: { env?: NodeProcessEnv } };
  return g.process?.env?.[name];
}

function toBase64(value: string): string {
  const g = globalThis as {
    Buffer?: { from(input: string, encoding?: string): { toString(encoding?: string): string } };
    btoa?: (input: string) => string;
  };

  if (g.Buffer) {
    return g.Buffer.from(value).toString("base64");
  }

  if (typeof g.btoa === "function") {
    return g.btoa(value);
  }

  throw new Error("No base64 encoder (Buffer or btoa) is available in the current runtime.");
}

const PAYPAL_BASE_URL = getEnvVar("PAYPAL_BASE_URL") ?? "https://api-m.sandbox.paypal.com";

interface PayPalAmount {
  currency_code: string;
  value: string;
}

interface PayPalPurchaseUnit {
  reference_id?: string;
  amount: PayPalAmount;
}

export interface PayPalOrder {
  id: string;
  status?: string;
  intent?: string;
  purchase_units?: PayPalPurchaseUnit[];
  [key: string]: unknown;
}

export interface CreateOrderInput {
  /**
   * PayPal checkout intent. Defaults to "CAPTURE".
   */
  intent?: "CAPTURE" | "AUTHORIZE";
  /**
   * One or more purchase units. At least one is required by PayPal.
   */
  purchase_units: PayPalPurchaseUnit[];
}

async function generateAccessToken(): Promise<string> {
  const clientId = getEnvVar("PAYPAL_CLIENT_ID");
  const clientSecret = getEnvVar("PAYPAL_CLIENT_SECRET");

  if (!clientId || !clientSecret) {
    throw new Error("Missing PAYPAL_CLIENT_ID or PAYPAL_CLIENT_SECRET environment variables.");
  }

  const credentials = toBase64(`${clientId}:${clientSecret}`);
  const body = new URLSearchParams({ grant_type: "client_credentials" }).toString();

  const response = await fetchFn(`${PAYPAL_BASE_URL}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${credentials}`,
    },
    body,
  });

  if (!response.ok) {
    const errorText = await safeReadBody(response);
    throw new Error(
      `Failed to generate PayPal access token. Status: ${response.status}. Body: ${errorText}`,
    );
  }

  const data = (await response.json()) as { access_token?: string };
  if (!data.access_token) {
    throw new Error("PayPal response did not include an access_token.");
  }

  return data.access_token;
}

async function safeReadBody(response: FetchResponse): Promise<string> {
  try {
    return await response.text();
  } catch {
    return "";
  }
}

/**
 * Create a PayPal order using the v2/checkout/orders API.
 *
 * This function expects the necessary environment variables to be configured:
 * - PAYPAL_CLIENT_ID
 * - PAYPAL_CLIENT_SECRET
 * - PAYPAL_BASE_URL (optional, defaults to sandbox)
 */
export async function createOrder(input: CreateOrderInput): Promise<PayPalOrder> {
  if (!input.purchase_units || input.purchase_units.length === 0) {
    throw new Error("createOrder requires at least one purchase unit.");
  }

  const accessToken = await generateAccessToken();

  const payload = {
    intent: input.intent ?? "CAPTURE",
    purchase_units: input.purchase_units,
  };

  const response = await fetchFn(`${PAYPAL_BASE_URL}/v2/checkout/orders`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorText = await safeReadBody(response);
    throw new Error(`Failed to create PayPal order. Status: ${response.status}. Body: ${errorText}`);
  }

  const order = (await response.json()) as PayPalOrder;
  return order;
}

/**
 * Retrieve a PayPal order by ID using the v2/checkout/orders API.
 *
 * Environment variables:
 * - PAYPAL_CLIENT_ID
 * - PAYPAL_CLIENT_SECRET
 * - PAYPAL_BASE_URL (optional, defaults to sandbox)
 */
export async function getOrder(orderId: string): Promise<PayPalOrder> {
  if (!orderId) {
    throw new Error("getOrder requires a non-empty orderId.");
  }

  const accessToken = await generateAccessToken();

  const response = await fetchFn(`${PAYPAL_BASE_URL}/v2/checkout/orders/${encodeURIComponent(orderId)}`, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    const errorText = await safeReadBody(response);
    throw new Error(`Failed to retrieve PayPal order. Status: ${response.status}. Body: ${errorText}`);
  }

  const order = (await response.json()) as PayPalOrder;
  return order;
}


