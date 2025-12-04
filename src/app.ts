import * as https from 'https';
import { URL } from 'url';
import * as readline from 'readline';
import * as dotenv from 'dotenv';

dotenv.config();

interface CreateOrderInput {
  description: string;
  amount: string; // item amount (without shipping)
  shipping: string;
  currency: string;
}

interface PayPalAmountBreakdownPart {
  currency_code: string;
  value: string;
}

interface PayPalAmount {
  currency_code: string;
  value: string;
  breakdown?: {
    item_total?: PayPalAmountBreakdownPart;
    shipping?: PayPalAmountBreakdownPart;
  };
}

interface PayPalPurchaseUnit {
  description?: string;
  amount?: PayPalAmount;
}

interface PayPalOrder {
  id: string;
  status: string;
  purchase_units?: PayPalPurchaseUnit[];
}

interface JsonPatchOperation {
  op: 'replace';
  path: string;
  value: unknown;
}

const PAYPAL_BASE_URL =
  process.env.PAYPAL_BASE_URL || 'https://api-m.sandbox.paypal.com';

function httpRequest<T>(
  urlString: string,
  method: string,
  headers: Record<string, string>,
  body?: string,
): Promise<T> {
  return new Promise((resolve, reject) => {
    try {
      const url = new URL(urlString);

      const options: https.RequestOptions = {
        hostname: url.hostname,
        path: url.pathname + url.search,
        method,
        headers,
      };

      const req = https.request(options, (res) => {
        let data = '';

        res.on('data', (chunk) => {
          data += chunk;
        });

        res.on('end', () => {
          const statusCode = res.statusCode ?? 0;
          const isSuccess = statusCode >= 200 && statusCode < 300;

          if (!isSuccess) {
            return reject(
              new Error(
                `HTTP ${statusCode} ${res.statusMessage ?? ''} - ${data}`,
              ),
            );
          }

          if (!data) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            resolve({} as any);
            return;
          }

          try {
            resolve(JSON.parse(data) as T);
          } catch {
            // If response is not JSON, return as-is
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            resolve(data as any);
          }
        });
      });

      req.on('error', (err) => {
        reject(err);
      });

      if (body) {
        req.write(body);
      }

      req.end();
    } catch (err) {
      reject(err);
    }
  });
}

async function getAccessToken(): Promise<string> {
  const clientId = process.env.PAYPAL_CLIENT_ID;
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error(
      'Missing PayPal credentials. Set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET environment variables before calling PayPal APIs.',
    );
  }

  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString(
    'base64',
  );

  const body = 'grant_type=client_credentials';

  const response = await httpRequest<{ access_token: string }>(
    `${PAYPAL_BASE_URL}/v1/oauth2/token`,
    'POST',
    {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(body).toString(),
    },
    body,
  );

  return response.access_token;
}

export async function createOrder(
  input?: CreateOrderInput,
): Promise<PayPalOrder> {
  const accessToken = await getAccessToken();

  const effectiveInput: CreateOrderInput =
    input ?? {
      description: 'Sample order from createOrder()',
      amount: '10.00',
      shipping: '0.00',
      currency: 'USD',
    };

  const itemAmount = Number(effectiveInput.amount);
  const shippingAmount = Number(effectiveInput.shipping);

  const total = (itemAmount + shippingAmount).toFixed(2);

  const payload = {
    intent: 'CAPTURE',
    purchase_units: [
      {
        description: effectiveInput.description,
        amount: {
          currency_code: effectiveInput.currency,
          value: total,
          breakdown: {
            item_total: {
              currency_code: effectiveInput.currency,
              value: itemAmount.toFixed(2),
            },
            shipping: {
              currency_code: effectiveInput.currency,
              value: shippingAmount.toFixed(2),
            },
          },
        },
      },
    ],
  };

  return httpRequest<PayPalOrder>(
    `${PAYPAL_BASE_URL}/v2/checkout/orders`,
    'POST',
    {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    JSON.stringify(payload),
  );
}

export async function getOrder(orderId: string): Promise<PayPalOrder> {
  if (typeof orderId !== 'string' || orderId.trim() === '') {
    throw new Error('orderId is required to retrieve an order.');
  }

  const accessToken = await getAccessToken();

  return httpRequest<PayPalOrder>(
    `${PAYPAL_BASE_URL}/v2/checkout/orders/${orderId}`,
    'GET',
    {
      Authorization: `Bearer ${accessToken}`,
    },
  );
}

async function updateOrder(
  orderId: string,
  operations: JsonPatchOperation[],
): Promise<void> {
  const accessToken = await getAccessToken();

  await httpRequest<unknown>(
    `${PAYPAL_BASE_URL}/v2/checkout/orders/${orderId}`,
    'PATCH',
    {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    JSON.stringify(operations),
  );
}

function createReadline(): readline.Interface {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
}

function askQuestion(rl: readline.Interface, question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => resolve(answer));
  });
}

async function askMoney(
  rl: readline.Interface,
  label: string,
  defaultValue?: string,
): Promise<string> {
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const prompt =
      defaultValue !== undefined
        ? `${label} [current: ${defaultValue}]: `
        : `${label}: `;
    const raw = (await askQuestion(rl, prompt)).trim();
    const value = raw === '' && defaultValue !== undefined ? defaultValue : raw;

    const num = Number(value);
    if (!Number.isNaN(num) && num >= 0) {
      return num.toFixed(2);
    }

    // eslint-disable-next-line no-console
    console.log('Please enter a valid non-negative number (e.g. 10.00).');
  }
}

async function askText(
  rl: readline.Interface,
  label: string,
  defaultValue?: string,
): Promise<string> {
  const prompt =
    defaultValue !== undefined
      ? `${label} [current: ${defaultValue}]: `
      : `${label}: `;
  const raw = (await askQuestion(rl, prompt)).trim();

  if (raw === '' && defaultValue !== undefined) {
    return defaultValue;
  }

  return raw;
}

async function askCurrency(
  rl: readline.Interface,
  defaultValue?: string,
): Promise<string> {
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const prompt =
      defaultValue !== undefined
        ? `Currency (3-letter code, e.g. USD) [current: ${defaultValue}]: `
        : 'Currency (3-letter code, e.g. USD): ';

    const raw = (await askQuestion(rl, prompt)).trim().toUpperCase();

    if (raw === '' && defaultValue) {
      return defaultValue;
    }

    if (/^[A-Z]{3}$/.test(raw)) {
      return raw;
    }

    // eslint-disable-next-line no-console
    console.log('Please enter a valid 3-letter currency code (e.g. USD).');
  }
}

function printOrder(order: PayPalOrder): void {
  const purchaseUnit = order.purchase_units?.[0];
  const description = purchaseUnit?.description ?? '';
  const amount = purchaseUnit?.amount;

  const currency = amount?.currency_code ?? 'N/A';
  const total = amount?.value ?? 'N/A';
  const itemTotal = amount?.breakdown?.item_total?.value ?? 'N/A';
  const shipping = amount?.breakdown?.shipping?.value ?? 'N/A';

  // eslint-disable-next-line no-console
  console.log('\n=== Order Details ===');
  // eslint-disable-next-line no-console
  console.log(`ID: ${order.id}`);
  // eslint-disable-next-line no-console
  console.log(`Status: ${order.status}`);
  // eslint-disable-next-line no-console
  console.log(`Description: ${description}`);
  // eslint-disable-next-line no-console
  console.log(`Currency: ${currency}`);
  // eslint-disable-next-line no-console
  console.log(`Item amount: ${itemTotal}`);
  // eslint-disable-next-line no-console
  console.log(`Shipping amount: ${shipping}`);
  // eslint-disable-next-line no-console
  console.log(`Total amount: ${total}`);
  // eslint-disable-next-line no-console
  console.log('=====================\n');
}

async function main(): Promise<void> {
  const rl = createReadline();

  try {
    // eslint-disable-next-line no-console
    console.log(
      'PayPal Order CLI\nMake sure PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET are set in your environment.\n',
    );

    const description = await askText(rl, 'Order description');
    const amount = await askMoney(rl, 'Order amount (item total)');
    const shipping = await askMoney(rl, 'Shipping amount');
    const currency = await askCurrency(rl, 'USD');

    // Create order
    const order = await createOrder({
      description,
      amount,
      shipping,
      currency,
    });

    // eslint-disable-next-line no-console
    console.log('\nOrder created successfully.');
    printOrder(order);

    // Retrieve order
    const fetchedOrder = await getOrder(order.id);
    // eslint-disable-next-line no-console
    console.log('Order retrieved from PayPal:');
    printOrder(fetchedOrder);

    // Allow user to make changes
    const purchaseUnit = fetchedOrder.purchase_units?.[0];
    const currentDescription = purchaseUnit?.description ?? description;
    const currentAmount =
      purchaseUnit?.amount?.breakdown?.item_total?.value ??
      purchaseUnit?.amount?.value ??
      amount;
    const currentShipping =
      purchaseUnit?.amount?.breakdown?.shipping?.value ?? shipping;
    const currentCurrency =
      purchaseUnit?.amount?.currency_code ?? currency ?? 'USD';

    const shouldEditRaw = (
      await askQuestion(
        rl,
        'Do you want to edit the order details before saving? (y/N): ',
      )
    )
      .trim()
      .toLowerCase();

    if (shouldEditRaw === 'y' || shouldEditRaw === 'yes') {
      const newDescription = await askText(
        rl,
        'Order description',
        currentDescription,
      );
      const newAmount = await askMoney(
        rl,
        'Order amount (item total)',
        currentAmount,
      );
      const newShipping = await askMoney(
        rl,
        'Shipping amount',
        currentShipping,
      );
      const newCurrency = await askCurrency(rl, currentCurrency);

      const operations: JsonPatchOperation[] = [];

      if (newDescription !== currentDescription) {
        operations.push({
          op: 'replace',
          path: '/purchase_units/0/description',
          value: newDescription,
        });
      }

      if (
        newAmount !== currentAmount ||
        newShipping !== currentShipping ||
        newCurrency !== currentCurrency
      ) {
        const newItemAmount = Number(newAmount);
        const newShippingAmount = Number(newShipping);
        const newTotal = (newItemAmount + newShippingAmount).toFixed(2);

        operations.push(
          {
            op: 'replace',
            path: '/purchase_units/0/amount/currency_code',
            value: newCurrency,
          },
          {
            op: 'replace',
            path: '/purchase_units/0/amount/value',
            value: newTotal,
          },
          {
            op: 'replace',
            path: '/purchase_units/0/amount/breakdown/item_total/value',
            value: newItemAmount.toFixed(2),
          },
          {
            op: 'replace',
            path: '/purchase_units/0/amount/breakdown/item_total/currency_code',
            value: newCurrency,
          },
          {
            op: 'replace',
            path: '/purchase_units/0/amount/breakdown/shipping/value',
            value: newShippingAmount.toFixed(2),
          },
          {
            op: 'replace',
            path: '/purchase_units/0/amount/breakdown/shipping/currency_code',
            value: newCurrency,
          },
        );
      }

      if (operations.length > 0) {
        await updateOrder(order.id, operations);

        // eslint-disable-next-line no-console
        console.log('\nOrder updated successfully.');
      } else {
        // eslint-disable-next-line no-console
        console.log('\nNo changes detected. Order was not updated.');
      }

      const updatedOrder = await getOrder(order.id);
      // eslint-disable-next-line no-console
      console.log('Final order details:');
      printOrder(updatedOrder);
    } else {
      // eslint-disable-next-line no-console
      console.log('No changes requested. Order remains as created.');
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Error during PayPal order flow:', err);
  } finally {
    rl.close();
  }
}

void main();


