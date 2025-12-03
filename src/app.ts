import * as https from 'https';

type PayPalEnvironment = 'sandbox' | 'live';

interface PayPalConfig {
  clientId: string;
  clientSecret: string;
  host: string;
}

export interface PayPalOrderAmount {
  currency_code: string;
  value: string;
}

export interface PayPalOrderRequest {
  intent?: 'CAPTURE' | 'AUTHORIZE';
  amount: PayPalOrderAmount;
}

export interface PayPalOrder {
  id: string;
  status: string;
  [key: string]: unknown;
}

function getPayPalConfig(): PayPalConfig {
  const clientId = process.env.PAYPAL_CLIENT_ID;
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET;
  const environment =
    (process.env.PAYPAL_ENVIRONMENT as PayPalEnvironment | undefined) ?? 'sandbox';

  if (!clientId || !clientSecret) {
    throw new Error(
      'Missing PayPal credentials. Please set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET environment variables.',
    );
  }

  const host = environment === 'live' ? 'api-m.paypal.com' : 'api-m.sandbox.paypal.com';

  return {
    clientId,
    clientSecret,
    host,
  };
}

async function getAccessToken(config: PayPalConfig): Promise<string> {
  const auth = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64');

  const body = 'grant_type=client_credentials';
  const options: https.RequestOptions = {
    method: 'POST',
    host: config.host,
    path: '/v1/oauth2/token',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(body),
    },
  };

  const response = await httpsRequest<{ access_token: string }>(options, body);

  if (!response.access_token) {
    throw new Error('Failed to obtain PayPal access token.');
  }

  return response.access_token;
}

function httpsRequest<T>(
  options: https.RequestOptions,
  body?: string,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        const statusCode = res.statusCode ?? 0;

        if (statusCode < 200 || statusCode >= 300) {
          reject(
            new Error(
              `PayPal API request failed with status ${statusCode}: ${data}`,
            ),
          );
          return;
        }

        try {
          const parsed = data ? (JSON.parse(data) as T) : ({} as T);
          resolve(parsed);
        } catch (error) {
          reject(error);
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

export async function createOrder(
  request: PayPalOrderRequest,
): Promise<PayPalOrder> {
  const config = getPayPalConfig();
  const accessToken = await getAccessToken(config);

  const payload = JSON.stringify({
    intent: request.intent ?? 'CAPTURE',
    purchase_units: [
      {
        amount: request.amount,
      },
    ],
  });

  const options: https.RequestOptions = {
    method: 'POST',
    host: config.host,
    path: '/v2/checkout/orders',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload),
    },
  };

  const order = await httpsRequest<PayPalOrder>(options, payload);
  return order;
}

export async function getOrder(orderId: string): Promise<PayPalOrder> {
  if (!orderId) {
    throw new Error('Order ID is required to fetch a PayPal order.');
  }

  const config = getPayPalConfig();
  const accessToken = await getAccessToken(config);

  const options: https.RequestOptions = {
    method: 'GET',
    host: config.host,
    path: `/v2/checkout/orders/${encodeURIComponent(orderId)}`,
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  };

  const order = await httpsRequest<PayPalOrder>(options);
  return order;
}

