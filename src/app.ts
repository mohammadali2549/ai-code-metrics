/**
 * PayPal Order utilities
 *
 * This module exposes two main functions:
 *  - createOrder: Create a new PayPal order via the REST API
 *  - getOrder: Retrieve an existing PayPal order by ID
 *
 * The implementation relies on environment variables for configuration:
 *  - PAYPAL_CLIENT_ID:    Your PayPal REST client id
 *  - PAYPAL_CLIENT_SECRET:Your PayPal REST client secret
 *  - PAYPAL_BASE_URL:     Optional override of the PayPal API base URL
 *                          (defaults to https://api-m.sandbox.paypal.com)
 *
 * The functions are written to be framework-agnostic so they can be used
 * from any HTTP server, tests, or scripts.
 */

type FetchFn = (input: string, init?: any) => Promise<any>;

/**
 * Resolve a fetch-like function from the global scope.
 * This keeps the implementation compatible with Node runtimes that
 * provide global fetch while avoiding a hard dependency on any library.
 */
function resolveFetch(): FetchFn {
  const globalAny = globalThis as any;
  const fetchCandidate: unknown = globalAny.fetch;

  if (typeof fetchCandidate !== "function") {
    throw new Error(
      "Fetch API is not available in the current runtime. " +
        "Provide a global fetch implementation or run on a Node version that includes fetch."
    );
  }

  return fetchCandidate as FetchFn;
}

const fetchFn = resolveFetch();

export interface PayPalConfig {
  clientId: string;
  clientSecret: string;
  baseUrl?: string;
}

/**
 * Read PayPal configuration from environment variables.
 */
export function getPayPalConfig(): PayPalConfig {
  const clientId = process.env.PAYPAL_CLIENT_ID;
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET;
  const baseUrl = process.env.PAYPAL_BASE_URL ?? "https://api-m.sandbox.paypal.com";

  if (!clientId || !clientSecret) {
    throw new Error(
      "Missing PayPal configuration. Please set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET."
    );
  }

  return { clientId, clientSecret, baseUrl };
}

interface PayPalAccessTokenResponse {
  access_token: string;
  token_type?: string;
  expires_in?: number;
  [key: string]: unknown;
}

async function getAccessToken(config: PayPalConfig): Promise<string> {
  const { clientId, clientSecret, baseUrl } = config;

  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  const response = await fetchFn(`${baseUrl ?? "https://api-m.sandbox.paypal.com"}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${credentials}`
    },
    body: "grant_type=client_credentials"
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to obtain PayPal access token: ${response.status} ${text}`);
  }

  const data: PayPalAccessTokenResponse = await response.json();

  if (!data.access_token) {
    throw new Error("PayPal response did not include an access_token.");
  }

  return data.access_token;
}

export interface PayPalAmount {
  currency_code: string;
  value: string;
  [key: string]: unknown;
}

export interface PayPalPurchaseUnit {
  amount: PayPalAmount;
  [key: string]: unknown;
}

export interface CreateOrderParams {
  intent?: "CAPTURE" | "AUTHORIZE";
  purchase_units: PayPalPurchaseUnit[];
  application_context?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface PayPalOrder {
  id: string;
  status?: string;
  [key: string]: unknown;
}

/**
 * Create a PayPal order.
 *
 * If called without parameters, a minimal default order will be created
 * for demonstration / testing purposes.
 *
 * Example:
 *   await createOrder({
 *     purchase_units: [
 *       {
 *         amount: { currency_code: "USD", value: "10.00" }
 *       }
 *     ]
 *   });
 */
export async function createOrder(params?: CreateOrderParams): Promise<PayPalOrder> {
  const config = getPayPalConfig();
  const accessToken = await getAccessToken(config);

  const effectiveParams: CreateOrderParams =
    params ??
    ({
      purchase_units: [
        {
          amount: { currency_code: "USD", value: "10.00" }
        }
      ]
    } as CreateOrderParams);

  const payload: Record<string, unknown> = {
    intent: effectiveParams.intent ?? "CAPTURE",
    purchase_units: effectiveParams.purchase_units
  };

  if (effectiveParams.application_context) {
    payload.application_context = effectiveParams.application_context;
  }

  const response = await fetchFn(`${config.baseUrl ?? "https://api-m.sandbox.paypal.com"}/v2/checkout/orders`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to create PayPal order: ${response.status} ${text}`);
  }

  const order: PayPalOrder = await response.json();
  return order;
}

/**
 * Retrieve an existing PayPal order by ID.
 */
export async function getOrder(orderId: string): Promise<PayPalOrder> {
  if (!orderId) {
    throw new Error("orderId is required to fetch a PayPal order.");
  }

  const config = getPayPalConfig();
  const accessToken = await getAccessToken(config);

  const response = await fetchFn(`${config.baseUrl ?? "https://api-m.sandbox.paypal.com"}/v2/checkout/orders/${encodeURIComponent(orderId)}`, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`
    }
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to fetch PayPal order ${orderId}: ${response.status} ${text}`);
  }

  const order: PayPalOrder = await response.json();
  return order;
}


