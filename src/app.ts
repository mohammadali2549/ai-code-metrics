import * as dotenv from "dotenv";
import * as https from "https";
import type { IncomingHttpHeaders } from "http";

dotenv.config();

const PAYPAL_CLIENT_ID = process.env.PAYPAL_CLIENT_ID;
const PAYPAL_CLIENT_SECRET = process.env.PAYPAL_CLIENT_SECRET;
const PAYPAL_BASE_URL =
  process.env.PAYPAL_BASE_URL ?? "https://api-m.sandbox.paypal.com";

interface HttpRequestOptions {
  method?: string;
  headers?: Record<string, string | number | readonly string[]>;
  body?: string;
}

interface HttpResponse {
  statusCode: number;
  headers: IncomingHttpHeaders;
  body: string;
}

function httpRequest(urlStr: string, options: HttpRequestOptions = {}): Promise<HttpResponse> {
  return new Promise<HttpResponse>((resolve, reject) => {
    const url = new URL(urlStr);

    const requestOptions: https.RequestOptions = {
      method: options.method ?? "GET",
      headers: options.headers,
      hostname: url.hostname,
      port: url.port
        ? Number(url.port)
        : url.protocol === "https:"
          ? 443
          : 80,
      path: url.pathname + url.search,
    };

    const req = https.request(requestOptions, (res) => {
      let data = "";

      res.on("data", (chunk: Buffer) => {
        data += chunk.toString("utf8");
      });

      res.on("end", () => {
        resolve({
          statusCode: res.statusCode ?? 0,
          headers: res.headers,
          body: data,
        });
      });
    });

    req.on("error", (err) => {
      reject(err);
    });

    if (options.body) {
      req.write(options.body);
    }

    req.end();
  });
}

async function getAccessToken(): Promise<string> {
  if (!PAYPAL_CLIENT_ID || !PAYPAL_CLIENT_SECRET) {
    throw new Error(
      "Missing PayPal credentials. Set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET environment variables before calling PayPal APIs.",
    );
  }

  const body = "grant_type=client_credentials";
  const auth = Buffer.from(
    `${PAYPAL_CLIENT_ID}:${PAYPAL_CLIENT_SECRET}`,
    "utf8",
  ).toString("base64");

  const response = await httpRequest(`${PAYPAL_BASE_URL}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "Content-Length": Buffer.byteLength(body),
    },
    body,
  });

  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error(
      `PayPal OAuth token request failed with status ${response.statusCode}: ${response.body}`,
    );
  }

  const parsed = JSON.parse(response.body) as {
    access_token?: string;
    [key: string]: unknown;
  };

  if (!parsed.access_token) {
    throw new Error("PayPal OAuth response did not include an access_token.");
  }

  return parsed.access_token;
}

export interface CreateOrderRequest {
  intent: "CAPTURE" | "AUTHORIZE";
  purchase_units: Array<{
    amount: {
      currency_code: string;
      value: string;
      [key: string]: unknown;
    };
    [key: string]: unknown;
  }>;
  [key: string]: unknown;
}

export interface PayPalOrder {
  id: string;
  status?: string;
  [key: string]: unknown;
}

export async function createOrder(): Promise<PayPalOrder>;
export async function createOrder(
  payload: CreateOrderRequest,
): Promise<PayPalOrder>;
export async function createOrder(
  payload?: CreateOrderRequest,
): Promise<PayPalOrder> {
  const accessToken = await getAccessToken();
  const requestPayload: CreateOrderRequest =
    payload ?? {
      intent: "CAPTURE",
      purchase_units: [
        {
          amount: {
            currency_code: "USD",
            value: "1.00",
          },
        },
      ],
    };

  const body = JSON.stringify(requestPayload);

  const response = await httpRequest(`${PAYPAL_BASE_URL}/v2/checkout/orders`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(body),
    },
    body,
  });

  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error(
      `PayPal create order failed with status ${response.statusCode}: ${response.body}`,
    );
  }

  return JSON.parse(response.body) as PayPalOrder;
}

export async function getOrder(orderId: string): Promise<PayPalOrder> {
  if (!orderId) {
    throw new Error("orderId is required to retrieve an order.");
  }

  const accessToken = await getAccessToken();

  const response = await httpRequest(
    `${PAYPAL_BASE_URL}/v2/checkout/orders/${encodeURIComponent(orderId)}`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  );

  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error(
      `PayPal get order failed with status ${response.statusCode}: ${response.body}`,
    );
  }

  return JSON.parse(response.body) as PayPalOrder;
}

