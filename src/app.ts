import { config as loadEnv } from 'dotenv';
import * as https from 'https';

// Load environment variables from a .env file if present.
loadEnv();

const PAYPAL_BASE_URL =
  process.env.PAYPAL_API_BASE ?? 'https://api-m.sandbox.paypal.com';

export interface PayPalAmount {
  currency_code: string;
  value: string;
}

export interface PayPalPurchaseUnit {
  amount: PayPalAmount;
  reference_id?: string;
}

export interface PayPalCreateOrderRequest {
  intent?: 'CAPTURE' | 'AUTHORIZE';
  purchase_units?: PayPalPurchaseUnit[];
  [key: string]: unknown;
}

export interface PayPalOrder {
  id: string;
  status: string;
  [key: string]: unknown;
}

interface PayPalAuthResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

function getRequiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function paypalHttpRequest<T>(
  path: string,
  method: string,
  body?: string,
  headers: Record<string, string> = {},
): Promise<T> {
  const url = new URL(path, PAYPAL_BASE_URL);

  const requestOptions: https.RequestOptions = {
    method,
    protocol: url.protocol,
    hostname: url.hostname,
    path: `${url.pathname}${url.search}`,
    headers: {
      ...(body ? { 'Content-Length': Buffer.byteLength(body).toString() } : {}),
      ...headers,
    },
  };

  return new Promise<T>((resolve, reject) => {
    const req = https.request(requestOptions, (res) => {
      const chunks: Buffer[] = [];

      res.on('data', (chunk: Buffer) => {
        chunks.push(chunk);
      });

      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');

        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          try {
            const parsed = raw ? (JSON.parse(raw) as T) : ({} as T);
            resolve(parsed);
          } catch (error) {
            reject(
              new Error(
                `Failed to parse PayPal response as JSON: ${(error as Error).message}`,
              ),
            );
          }
        } else {
          const status = res.statusCode ?? 0;
          const message = `PayPal API error (${status}): ${raw}`;
          reject(new Error(message));
        }
      });
    });

    req.on('error', (error) => {
      reject(error);
    });

    if (body) {
      req.write(body);
    }

    req.end();
  });
}

async function getAccessToken(): Promise<string> {
  const clientId = getRequiredEnv('PAYPAL_CLIENT_ID');
  const clientSecret = getRequiredEnv('PAYPAL_CLIENT_SECRET');

  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString(
    'base64',
  );

  const body = new URLSearchParams({
    grant_type: 'client_credentials',
  }).toString();

  const authResponse = await paypalHttpRequest<PayPalAuthResponse>(
    '/v1/oauth2/token',
    'POST',
    body,
    {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
  );

  return authResponse.access_token;
}

function buildDefaultOrderRequest(): PayPalCreateOrderRequest {
  return {
    intent: 'CAPTURE',
    purchase_units: [
      {
        amount: {
          currency_code: 'USD',
          value: '10.00',
        },
      },
    ],
  };
}

/**
 * Create a PayPal order.
 *
 * - If no payload is provided, a minimal default order for 10.00 USD is created.
 * - If a payload is provided, it is sent as-is to the PayPal Orders API.
 */
export async function createOrder(
  payload: PayPalCreateOrderRequest = buildDefaultOrderRequest(),
): Promise<PayPalOrder> {
  const accessToken = await getAccessToken();
  const body = JSON.stringify(payload);

  const order = await paypalHttpRequest<PayPalOrder>(
    '/v2/checkout/orders',
    'POST',
    body,
    {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
  );

  return order;
}

/**
 * Retrieve a PayPal order by its ID.
 */
export async function getOrder(orderId: string): Promise<PayPalOrder> {
  if (!orderId) {
    throw new Error('orderId is required to retrieve a PayPal order');
  }

  const accessToken = await getAccessToken();

  const order = await paypalHttpRequest<PayPalOrder>(
    `/v2/checkout/orders/${encodeURIComponent(orderId)}`,
    'GET',
    undefined,
    {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
  );

  return order;
}


