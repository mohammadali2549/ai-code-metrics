// PayPal Orders helper functions
// Implements Create Order and Get Order using @paypal/checkout-server-sdk

// Use CommonJS require to avoid TypeScript type declaration issues for this SDK.
// The SDK is JavaScript-only, so it will be treated as 'any' by TypeScript.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const paypal = require('@paypal/checkout-server-sdk');

type PaypalEnvironment = InstanceType<
  typeof paypal.core.SandboxEnvironment | typeof paypal.core.LiveEnvironment
>;

type PaypalClient = InstanceType<typeof paypal.core.PayPalHttpClient>;

function getPaypalEnvironment(): PaypalEnvironment {
  const clientId = process.env.PAYPAL_CLIENT_ID;
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error(
      'PayPal client credentials are not configured. Please set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET.',
    );
  }

  const nodeEnv = process.env.NODE_ENV ?? 'development';

  if (nodeEnv === 'production') {
    return new paypal.core.LiveEnvironment(clientId, clientSecret);
  }

  // Default to sandbox for non-production environments.
  return new paypal.core.SandboxEnvironment(clientId, clientSecret);
}

function getPaypalClient(): PaypalClient {
  const environment = getPaypalEnvironment();
  return new paypal.core.PayPalHttpClient(environment);
}

/**
 * Create a PayPal order.
 *
 * By default this creates a simple order for 1.00 USD,
 * but you can override amount and currency if needed.
 */
export async function createOrder(
  amount: string = '1.00',
  currencyCode: string = 'USD',
) {
  const client = getPaypalClient();

  const request = new paypal.orders.OrdersCreateRequest();
  request.prefer('return=representation');
  request.requestBody({
    intent: 'CAPTURE',
    purchase_units: [
      {
        amount: {
          currency_code: currencyCode,
          value: amount,
        },
      },
    ],
  });

  try {
    const response = await client.execute(request);
    // Return the full order result so callers can access id and other fields.
    return response.result;
  } catch (error) {
    // Surface a clear error while preserving original error details.
    const message =
      error instanceof Error ? error.message : 'Unknown error creating PayPal order';
    throw new Error(`Failed to create PayPal order: ${message}`);
  }
}

/**
 * Retrieve details for an existing PayPal order by ID.
 */
export async function getOrder(orderId: string) {
  if (!orderId) {
    throw new Error('orderId is required to retrieve a PayPal order.');
  }

  const client = getPaypalClient();
  const request = new paypal.orders.OrdersGetRequest(orderId);

  try {
    const response = await client.execute(request);
    return response.result;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Unknown error retrieving PayPal order';
    throw new Error(`Failed to get PayPal order ${orderId}: ${message}`);
  }
}


