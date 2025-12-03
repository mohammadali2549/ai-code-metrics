type PayPalEnvironment = {
  clientId: string;
  clientSecret: string;
  apiBaseUrl: string;
};

type PayPalAmount = {
  currency_code: string;
  value: string;
};

type PayPalPurchaseUnit = {
  reference_id?: string;
  description?: string;
  amount: PayPalAmount;
};

export type CreateOrderRequest = {
  intent: "CAPTURE" | "AUTHORIZE";
  purchase_units: PayPalPurchaseUnit[];
};

export type PayPalOrder = {
  id: string;
  status: string;
  [key: string]: unknown;
};

/**
 * NOTE: `fetch` is available in modern Node runtimes.
 * We declare it as `any` here so TypeScript can compile without DOM lib types.
 */
declare const fetch: any;

function getEnvironment(): PayPalEnvironment {
  const clientId = process.env.PAYPAL_CLIENT_ID;
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET;
  const apiBaseUrl =
    process.env.PAYPAL_API_BASE ?? "https://api-m.sandbox.paypal.com";

  if (!clientId || !clientSecret) {
    throw new Error(
      "Missing PayPal credentials. Please set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET environment variables."
    );
  }

  return {
    clientId,
    clientSecret,
    apiBaseUrl,
  };
}

async function getAccessToken(env: PayPalEnvironment): Promise<string> {
  const credentials = Buffer.from(
    `${env.clientId}:${env.clientSecret}`,
    "utf8"
  ).toString("base64");

  const response = await fetch(`${env.apiBaseUrl}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });

  if (!response.ok) {
    const bodyText = await response.text();
    throw new Error(
      `Failed to obtain PayPal access token (${response.status}): ${bodyText}`
    );
  }

  const data = (await response.json()) as { access_token?: string };
  if (!data.access_token) {
    throw new Error("PayPal access token missing from response.");
  }

  return data.access_token;
}

/**
 * Create a new PayPal order.
 *
 * This function expects at least one purchase unit with amount details.
 */
export async function createOrder(
  request: CreateOrderRequest
): Promise<PayPalOrder> {
  const env = getEnvironment();
  const accessToken = await getAccessToken(env);

  const response = await fetch(`${env.apiBaseUrl}/v2/checkout/orders`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    const bodyText = await response.text();
    throw new Error(
      `Failed to create PayPal order (${response.status}): ${bodyText}`
    );
  }

  const data = (await response.json()) as PayPalOrder;
  return data;
}

/**
 * Retrieve an existing PayPal order by its ID.
 */
export async function getOrder(orderId: string): Promise<PayPalOrder> {
  if (!orderId) {
    throw new Error("orderId is required to retrieve a PayPal order.");
  }

  const env = getEnvironment();
  const accessToken = await getAccessToken(env);

  const response = await fetch(`${env.apiBaseUrl}/v2/checkout/orders/${orderId}`, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    const bodyText = await response.text();
    throw new Error(
      `Failed to fetch PayPal order (${response.status}): ${bodyText}`
    );
  }

  const data = (await response.json()) as PayPalOrder;
  return data;
}


