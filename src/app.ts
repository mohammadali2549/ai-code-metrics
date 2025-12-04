import * as https from 'https';
import { URL } from 'url';
import "dotenv/config";

/**
 * Simple types describing the order data we care about.
 */
export interface OrderDetailsInput {
  description: string;
  orderAmount: number;
  shippingAmount: number;
  currency: string;
}

export type OrderChanges = Partial<OrderDetailsInput>;

// We do not try to model the entire PayPal response – keep it flexible.
export interface PayPalOrder extends Record<string, any> {
  id?: string;
  status?: string;
}

type HttpMethod = 'GET' | 'POST';

/**
 * Minimal PayPal API client using Node's https module.
 * It supports:
 *  - POST /v1/oauth2/token   (to obtain an access token)
 *  - POST /v2/checkout/orders (to create an order)
 *  - GET  /v2/checkout/orders/{id} (to retrieve an order)
 */
class PayPalApiClient {
  private accessToken?: string;

  constructor(
    private readonly clientId: string,
    private readonly clientSecret: string,
    private readonly baseUrl = 'https://api-m.sandbox.paypal.com',
  ) {}

  private async getAccessToken(): Promise<string> {
    if (this.accessToken) {
      return this.accessToken;
    }

    const auth = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');
    const body = 'grant_type=client_credentials';

    const response = await this.request<any>(
      '/v1/oauth2/token',
      'POST',
      body,
      {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    );

    const token = response?.access_token;
    if (!token) {
      throw new Error('Failed to obtain PayPal access token.');
    }

    this.accessToken = token;
    return token;
  }

  private async authedRequest<T>(path: string, method: HttpMethod, body?: any): Promise<T> {
    const token = await this.getAccessToken();
    return this.request<T>(path, method, body, {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    });
  }

  private async request<T>(
    path: string,
    method: HttpMethod,
    body?: string | object,
    extraHeaders: Record<string, string> = {},
  ): Promise<T> {
    const url = new URL(path, this.baseUrl);

    const payload =
      typeof body === 'string'
        ? body
        : body != null
        ? JSON.stringify(body)
        : undefined;

    const headers: Record<string, string> = {
      Accept: 'application/json',
      ...extraHeaders,
    };

    if (payload && !headers['Content-Type']) {
      headers['Content-Type'] = 'application/json';
    }

    if (payload) {
      headers['Content-Length'] = Buffer.byteLength(payload).toString();
    }

    return new Promise<T>((resolve, reject) => {
      const req = https.request(
        {
          method,
          hostname: url.hostname,
          path: url.pathname + url.search,
          headers,
        },
        (res) => {
          let raw = '';
          res.setEncoding('utf8');
          res.on('data', (chunk) => {
            raw += chunk;
          });
          res.on('end', () => {
            if (res.statusCode && res.statusCode >= 400) {
              return reject(
                new Error(
                  `PayPal API request failed with status ${res.statusCode}: ${raw}`,
                ),
              );
            }

            if (!raw) {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              return resolve(undefined as any);
            }

            try {
              resolve(JSON.parse(raw));
            } catch {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              resolve(raw as any);
            }
          });
        },
      );

      req.on('error', (err) => reject(err));

      if (payload) {
        req.write(payload);
      }

      req.end();
    });
  }

  async createOrder(details: OrderDetailsInput): Promise<PayPalOrder> {
    const { description, orderAmount, shippingAmount, currency } = details;
    const total = (orderAmount + shippingAmount).toFixed(2);

    const body = {
      intent: 'CAPTURE',
      purchase_units: [
        {
          description,
          amount: {
            currency_code: currency,
            value: total,
            breakdown: {
              item_total: {
                currency_code: currency,
                value: orderAmount.toFixed(2),
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

    return this.authedRequest<PayPalOrder>('/v2/checkout/orders', 'POST', body);
  }

  async getOrder(orderId: string): Promise<PayPalOrder> {
    return this.authedRequest<PayPalOrder>(
      `/v2/checkout/orders/${encodeURIComponent(orderId)}`,
      'GET',
    );
  }
}

function buildClient(): PayPalApiClient {
  const clientId = process.env.PAYPAL_CLIENT_ID;
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error(
      'PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET environment variables must be set.',
    );
  }

  const baseUrl = process.env.PAYPAL_BASE_URL || 'https://api-m.sandbox.paypal.com';
  return new PayPalApiClient(clientId, clientSecret, baseUrl);
}

/**
 * 1) Create an order using the PayPal Create Order endpoint.
 *
 * The caller provides description, order amount, shipping amount, and currency.
 */
export async function createOrder(details: OrderDetailsInput): Promise<PayPalOrder> {
  const client = buildClient();
  return client.createOrder(details);
}

/**
 * 2) Retrieve an order using the PayPal Get Order endpoint.
 */
export async function getOrder(orderId: string): Promise<PayPalOrder> {
  const client = buildClient();
  return client.getOrder(orderId);
}

/**
 * 3) Print order details in a readable multi-line string so the caller
 *    can display them and optionally allow the user to edit values.
 */
export function printOrderDetails(order: PayPalOrder): string {
  const purchaseUnit = Array.isArray(order.purchase_units)
    ? order.purchase_units[0] ?? {}
    : {};

  const description: string = purchaseUnit.description ?? '';
  const amount = purchaseUnit.amount ?? {};
  const currency: string = amount.currency_code ?? '';
  const total: string = amount.value ?? '';

  const breakdown = amount.breakdown ?? {};
  const itemTotal = breakdown.item_total ?? {};
  const shipping = breakdown.shipping ?? {};

  const orderAmount: string = itemTotal.value ?? '';
  const shippingAmount: string = shipping.value ?? '';

  return [
    `Order ID: ${order.id ?? ''}`,
    `Status: ${order.status ?? ''}`,
    `Description: ${description}`,
    `Order Amount: ${orderAmount} ${currency}`,
    `Shipping Amount: ${shippingAmount} ${currency}`,
    `Total: ${total} ${currency}`,
  ].join('\n');
}

/**
 * 4) Save order changes locally by returning a new order object with updated
 *    description, amounts, or currency. This function does not call PayPal –
 *    it simply applies the requested changes to the order structure.
 */
export function saveOrderChanges(
  order: PayPalOrder,
  changes: OrderChanges,
): PayPalOrder {
  const updated: PayPalOrder = JSON.parse(JSON.stringify(order ?? {}));

  if (!Array.isArray(updated.purchase_units) || !updated.purchase_units[0]) {
    updated.purchase_units = updated.purchase_units ?? [];
    updated.purchase_units[0] = {};
  }

  const purchaseUnit = updated.purchase_units[0];

  const currentAmount = purchaseUnit.amount ?? {};
  const currentBreakdown = currentAmount.breakdown ?? {};
  const currentItemTotal = currentBreakdown.item_total ?? {};
  const currentShipping = currentBreakdown.shipping ?? {};

  const currency =
    changes.currency ??
    currentAmount.currency_code ??
    currentItemTotal.currency_code ??
    currentShipping.currency_code ??
    'USD';

  const orderAmountNum =
    changes.orderAmount !== undefined
      ? changes.orderAmount
      : Number(currentItemTotal.value ?? 0);
  const shippingAmountNum =
    changes.shippingAmount !== undefined
      ? changes.shippingAmount
      : Number(currentShipping.value ?? 0);

  const description =
    changes.description !== undefined
      ? changes.description
      : purchaseUnit.description;

  const total = (orderAmountNum + shippingAmountNum).toFixed(2);

  purchaseUnit.description = description;
  purchaseUnit.amount = {
    currency_code: currency,
    value: total,
    breakdown: {
      item_total: {
        currency_code: currency,
        value: orderAmountNum.toFixed(2),
      },
      shipping: {
        currency_code: currency,
        value: shippingAmountNum.toFixed(2),
      },
    },
  };

  return updated;
}


