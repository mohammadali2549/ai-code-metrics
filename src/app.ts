import * as dotenv from 'dotenv';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

dotenv.config();

type OrderInput = {
  description: string;
  amount: string;
  shipping: string;
  currency: string;
};

type PayPalOrder = {
  id: string;
  status?: string;
  purchase_units?: Array<{
    description?: string;
    amount?: {
      currency_code?: string;
      value?: string;
      breakdown?: {
        item_total?: {
          currency_code?: string;
          value?: string;
        };
        shipping?: {
          currency_code?: string;
          value?: string;
        };
      };
    };
  }>;
};

const PAYPAL_CLIENT_ID = process.env.PAYPAL_CLIENT_ID;
const PAYPAL_CLIENT_SECRET = process.env.PAYPAL_CLIENT_SECRET;
const PAYPAL_ENV = process.env.PAYPAL_ENVIRONMENT ?? 'sandbox';

function getPaypalBaseUrl(): string {
  return PAYPAL_ENV === 'live'
    ? 'https://api-m.paypal.com'
    : 'https://api-m.sandbox.paypal.com';
}

async function getAccessToken(): Promise<string> {
  if (!PAYPAL_CLIENT_ID || !PAYPAL_CLIENT_SECRET) {
    throw new Error(
      'Missing PayPal credentials. Set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET environment variables before calling PayPal APIs.',
    );
  }

  const credentials = `${PAYPAL_CLIENT_ID}:${PAYPAL_CLIENT_SECRET}`;
  const encodedCredentials = Buffer.from(credentials, 'utf8').toString('base64');

  const response = await fetch(`${getPaypalBaseUrl()}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${encodedCredentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ grant_type: 'client_credentials' }).toString(),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `Failed to obtain PayPal access token. Status: ${response.status}. Body: ${text}`,
    );
  }

  const data: { access_token?: string } = await response.json();
  if (!data.access_token) {
    throw new Error('PayPal response did not include an access token.');
  }

  return data.access_token;
}

function validateAmount(input: string): string {
  const value = Number.parseFloat(input);
  if (Number.isNaN(value) || value < 0) {
    throw new Error('Amount must be a non-negative number.');
  }

  return value.toFixed(2);
}

async function promptForOrder(
  rl: readline.Interface,
): Promise<OrderInput> {
  const description = await rl.question('Order description: ');
  const currencyRaw = await rl.question('Currency code (e.g. USD, EUR): ');
  const amountRaw = await rl.question('Order amount (total): ');
  const shippingRaw = await rl.question('Shipping amount: ');

  let amount: string;
  let shipping: string;

  try {
    amount = validateAmount(amountRaw);
    shipping = validateAmount(shippingRaw);
  } catch (error) {
    if (error instanceof Error) {
      // eslint-disable-next-line no-console
      console.error(`Invalid numeric input: ${error.message}`);
    }
    return promptForOrder(rl);
  }

  const currency = currencyRaw.trim().toUpperCase() || 'USD';

  return {
    description: description.trim(),
    amount,
    shipping,
    currency,
  };
}

async function createOrderInternal(
  accessToken: string,
  inputOrder: OrderInput,
): Promise<PayPalOrder> {
  const total = Number.parseFloat(inputOrder.amount);
  const shipping = Number.parseFloat(inputOrder.shipping);
  const itemTotal = Math.max(total - shipping, 0);

  const payload = {
    intent: 'CAPTURE',
    purchase_units: [
      {
        description: inputOrder.description,
        amount: {
          currency_code: inputOrder.currency,
          value: inputOrder.amount,
          breakdown: {
            item_total: {
              currency_code: inputOrder.currency,
              value: itemTotal.toFixed(2),
            },
            shipping: {
              currency_code: inputOrder.currency,
              value: inputOrder.shipping,
            },
          },
        },
      },
    ],
  };

  const response = await fetch(`${getPaypalBaseUrl()}/v2/checkout/orders`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `Failed to create order. Status: ${response.status}. Body: ${text}`,
    );
  }

  const order = (await response.json()) as PayPalOrder;
  return order;
}

async function getOrderInternal(
  accessToken: string,
  orderId: string,
): Promise<PayPalOrder> {
  const response = await fetch(
    `${getPaypalBaseUrl()}/v2/checkout/orders/${orderId}`,
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `Failed to retrieve order. Status: ${response.status}. Body: ${text}`,
    );
  }

  const order = (await response.json()) as PayPalOrder;
  return order;
}

function printOrder(order: PayPalOrder): void {
  // eslint-disable-next-line no-console
  console.log('\n--- PayPal Order ---');
  // eslint-disable-next-line no-console
  console.log(`ID: ${order.id}`);
  if (order.status) {
    // eslint-disable-next-line no-console
    console.log(`Status: ${order.status}`);
  }

  const pu = order.purchase_units?.[0];
  if (pu) {
    if (pu.description) {
      // eslint-disable-next-line no-console
      console.log(`Description: ${pu.description}`);
    }
    if (pu.amount) {
      const { amount } = pu;
      // eslint-disable-next-line no-console
      console.log(
        `Amount: ${amount.value ?? 'N/A'} ${amount.currency_code ?? ''}`,
      );

      const shipping = amount.breakdown?.shipping;
      if (shipping) {
        // eslint-disable-next-line no-console
        console.log(
          `Shipping: ${shipping.value ?? 'N/A'} ${
            shipping.currency_code ?? ''
          }`,
        );
      }

      const itemTotal = amount.breakdown?.item_total;
      if (itemTotal) {
        // eslint-disable-next-line no-console
        console.log(
          `Item total: ${itemTotal.value ?? 'N/A'} ${
            itemTotal.currency_code ?? ''
          }`,
        );
      }
    }
  }
  // eslint-disable-next-line no-console
  console.log('--------------------\n');
}

// Public API functions used by tests. These obtain credentials internally.
async function createOrder(): Promise<PayPalOrder> {
  const accessToken = await getAccessToken();
  const defaultOrder: OrderInput = {
    description: 'Sample order from API',
    amount: '10.00',
    shipping: '0.00',
    currency: 'USD',
  };

  return createOrderInternal(accessToken, defaultOrder);
}

async function getOrder(orderId: string): Promise<PayPalOrder> {
  if (!orderId) {
    throw new Error('orderId is required to retrieve an order.');
  }

  const accessToken = await getAccessToken();
  return getOrderInternal(accessToken, orderId);
}

async function promptForUpdates(
  rl: readline.Interface,
  current: PayPalOrder,
): Promise<OrderInput | null> {
  const pu = current.purchase_units?.[0];
  const amount = pu?.amount;
  const shipping = amount?.breakdown?.shipping;

  const currentDescription = pu?.description ?? '';
  const currentCurrency = amount?.currency_code ?? 'USD';
  const currentTotal = amount?.value ?? '0.00';
  const currentShipping = shipping?.value ?? '0.00';

  const shouldEdit = await rl.question(
    'Do you want to edit this order? (y/N): ',
  );
  if (shouldEdit.trim().toLowerCase() !== 'y') {
    return null;
  }

  const newDescription = await rl.question(
    `New description (leave blank to keep "${currentDescription}"): `,
  );
  const newCurrency = await rl.question(
    `New currency (leave blank to keep "${currentCurrency}"): `,
  );
  const newTotalRaw = await rl.question(
    `New total amount (leave blank to keep "${currentTotal}"): `,
  );
  const newShippingRaw = await rl.question(
    `New shipping amount (leave blank to keep "${currentShipping}"): `,
  );

  const description = newDescription.trim() || currentDescription;
  const currency = (newCurrency.trim() || currentCurrency).toUpperCase();

  const totalRaw = newTotalRaw.trim() || currentTotal;
  const shippingRaw = newShippingRaw.trim() || currentShipping;

  let total: string;
  let shippingAmount: string;
  try {
    total = validateAmount(totalRaw);
    shippingAmount = validateAmount(shippingRaw);
  } catch (error) {
    if (error instanceof Error) {
      // eslint-disable-next-line no-console
      console.error(`Invalid numeric input: ${error.message}`);
    }
    return promptForUpdates(rl, current);
  }

  return {
    description,
    currency,
    amount: total,
    shipping: shippingAmount,
  };
}

async function updateOrder(
  accessToken: string,
  orderId: string,
  updated: OrderInput,
): Promise<void> {
  const total = Number.parseFloat(updated.amount);
  const shipping = Number.parseFloat(updated.shipping);
  const itemTotal = Math.max(total - shipping, 0);

  const patchBody = [
    {
      op: 'replace',
      path: '/purchase_units/0/description',
      value: updated.description,
    },
    {
      op: 'replace',
      path: '/purchase_units/0/amount',
      value: {
        currency_code: updated.currency,
        value: updated.amount,
        breakdown: {
          item_total: {
            currency_code: updated.currency,
            value: itemTotal.toFixed(2),
          },
          shipping: {
            currency_code: updated.currency,
            value: updated.shipping,
          },
        },
      },
    },
  ];

  const response = await fetch(
    `${getPaypalBaseUrl()}/v2/checkout/orders/${orderId}`,
    {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(patchBody),
    },
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `Failed to update order. Status: ${response.status}. Body: ${text}`,
    );
  }
}

async function main(): Promise<void> {
  const rl = readline.createInterface({ input, output });

  try {
    const accessToken = await getAccessToken();

    // Step 1: Create an order
    const orderInput = await promptForOrder(rl);
    const createdOrder = await createOrderInternal(accessToken, orderInput);

    // Step 2: Retrieve the order using Get Order endpoint
    const retrievedOrder = await getOrderInternal(accessToken, createdOrder.id);

    // Step 3: Print order details
    printOrder(retrievedOrder);

    // Step 4: Allow user to modify & save order
    const updates = await promptForUpdates(rl, retrievedOrder);
    if (updates) {
      await updateOrder(accessToken, retrievedOrder.id, updates);
      const updatedOrder = await getOrderInternal(accessToken, retrievedOrder.id);
      // eslint-disable-next-line no-console
      console.log('Order updated successfully.');
      printOrder(updatedOrder);
    } else {
      // eslint-disable-next-line no-console
      console.log('No changes made to the order.');
    }
  } catch (error) {
    if (error instanceof Error) {
      // eslint-disable-next-line no-console
      console.error(`Error: ${error.message}`);
    } else {
      // eslint-disable-next-line no-console
      console.error('An unknown error occurred.');
    }
  } finally {
    rl.close();
  }
}

// Execute CLI
// eslint-disable-next-line @typescript-eslint/no-floating-promises
main();

// Export selected functions for testing purposes.
export { createOrder, getOrder };
