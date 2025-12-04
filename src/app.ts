import "dotenv/config";

import {
  ApiError,
  CheckoutPaymentIntent,
  Client,
  CustomError,
  Environment,
  LogLevel,
  OrdersController,
  PatchOp,
} from '@paypal/paypal-server-sdk';

export interface OrderInput {
  description: string;
  orderAmount: string;
  shippingAmount: string;
  currency: string;
}

export interface OrderUpdateInput {
  description?: string;
  orderAmount?: string;
  shippingAmount?: string;
  currency?: string;
}

interface PayPalClientBundle {
  client: Client;
  ordersController: OrdersController;
}

/**
 * Create a configured PayPal client and OrdersController instance
 * using environment variables PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET.
 */
export function createPayPalClient(): PayPalClientBundle {
  const clientId = process.env.PAYPAL_CLIENT_ID ?? '';
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET ?? '';

  const client = new Client({
    clientCredentialsAuthCredentials: {
      oAuthClientId: clientId,
      oAuthClientSecret: clientSecret,
    },
    timeout: 0,
    environment: Environment.Sandbox,
    logging: {
      logLevel: LogLevel.Info,
      logRequest: { logBody: true },
      logResponse: { logHeaders: true },
    },
  });

  const ordersController = new OrdersController(client);

  return { client, ordersController };
}

function handlePayPalError(error: unknown): never {
  if (error instanceof ApiError) {
    // eslint-disable-next-line no-console
    console.error('PayPal API Error:', error.statusCode, error.body);
    if (error instanceof CustomError) {
      // eslint-disable-next-line no-console
      console.error('PayPal Custom Error:', error.result?.name, error.result?.message);
    }
  } else {
    // eslint-disable-next-line no-console
    console.error('Unexpected PayPal Error:', error);
  }

  throw error;
}

/**
 * 1) Create an order using the PayPal Create Order endpoint.
 * Allows caller (e.g. CLI or HTTP handler) to pass in user-provided values.
 * If no input is supplied, sensible defaults are used so that the function
 * can still be exercised in automated tests.
 */
export async function createOrder(input?: OrderInput) {
  const { ordersController } = createPayPalClient();

  const effectiveInput: OrderInput =
    input ??
    ({
      description: 'Sample order',
      orderAmount: '10.00',
      shippingAmount: '0.00',
      currency: 'USD',
    } as OrderInput);

  const collect = {
    body: {
      intent: CheckoutPaymentIntent.Capture,
      purchaseUnits: [
        {
          amount: {
            currencyCode: effectiveInput.currency,
            value: effectiveInput.orderAmount,
            breakdown: {
              shipping: {
                currencyCode: effectiveInput.currency,
                value: effectiveInput.shippingAmount,
              },
            },
          },
          description: effectiveInput.description,
        },
      ],
    },
    prefer: 'return=representation',
  };

  try {
    const response = await ordersController.createOrder(collect);
    const order = response.result;

    // eslint-disable-next-line no-console
    console.log('Order created:', order?.id);

    return order;
  } catch (error) {
    handlePayPalError(error);
  }
}

/**
 * 2) Retrieve the order using the PayPal Get Order endpoint.
 */
export async function getOrder(orderId: string) {
  const { ordersController } = createPayPalClient();

  try {
    const response = await ordersController.getOrder({ id: orderId });
    const order = response.result;

    // eslint-disable-next-line no-console
    console.log('Order retrieved:', order?.id);

    return order;
  } catch (error) {
    handlePayPalError(error);
  }
}

/**
 * 3) Print order details and allow caller to make changes.
 * This function is intentionally pure with respect to PayPal APIs
 * so it can be used in tests or higher-level flows that gather user input.
 */
export function printOrderDetails(order: any): string {
  if (!order) {
    const message = 'No order data available.';
    // eslint-disable-next-line no-console
    console.log(message);
    return message;
  }

  const id = order.id ?? 'N/A';
  const status = order.status ?? 'N/A';
  const firstPurchaseUnit = Array.isArray(order.purchase_units)
    ? order.purchase_units[0]
    : undefined;
  const description = firstPurchaseUnit?.description ?? 'N/A';
  const amount = firstPurchaseUnit?.amount?.value ?? 'N/A';
  const currency =
    firstPurchaseUnit?.amount?.currency_code ??
    firstPurchaseUnit?.amount?.currencyCode ??
    'N/A';
  const shippingAmount =
    firstPurchaseUnit?.amount?.breakdown?.shipping?.value ?? '0.00';

  const details = [
    `Order ID: ${id}`,
    `Status: ${status}`,
    `Description: ${description}`,
    `Amount: ${amount}`,
    `Shipping: ${shippingAmount}`,
    `Currency: ${currency}`,
  ].join('\n');

  // eslint-disable-next-line no-console
  console.log(details);

  return details;
}

/**
 * Helper to apply local (in-memory) changes to an order representation.
 * This does not call PayPal; it prepares the updated structure that can
 * subsequently be persisted via saveOrderChanges.
 */
export function applyOrderChanges(order: any, changes: OrderUpdateInput): any {
  if (!order) {
    return order;
  }

  const updated = { ...order };
  if (!Array.isArray(updated.purchase_units) || updated.purchase_units.length === 0) {
    updated.purchase_units = [{}];
  }

  const pu = { ...(updated.purchase_units[0] ?? {}) };

  if (!pu.amount) {
    pu.amount = {};
  }
  if (!pu.amount.breakdown) {
    pu.amount.breakdown = {};
  }
  if (!pu.amount.breakdown.shipping) {
    pu.amount.breakdown.shipping = {};
  }

  if (typeof changes.description === 'string') {
    pu.description = changes.description;
  }
  if (typeof changes.orderAmount === 'string') {
    pu.amount.value = changes.orderAmount;
  }
  if (typeof changes.currency === 'string') {
    // Handle both possible casings depending on context.
    pu.amount.currency_code = changes.currency;
    pu.amount.currencyCode = changes.currency;
  }
  if (typeof changes.shippingAmount === 'string') {
    pu.amount.breakdown.shipping.value = changes.shippingAmount;
  }

  updated.purchase_units[0] = pu;
  return updated;
}

/**
 * 4) Save order changes back to PayPal using the Patch Order endpoint.
 * This function accepts partial changes and persists them.
 */
export async function saveOrderChanges(orderId: string, changes: OrderUpdateInput) {
  const { ordersController } = createPayPalClient();

  const ops: any[] = [];

  if (typeof changes.description === 'string') {
    ops.push({
      op: PatchOp.Replace,
      path: "/purchase_units/@reference_id=='default'/description",
      value: changes.description,
    });
  }

  if (
    typeof changes.orderAmount === 'string' ||
    typeof changes.currency === 'string' ||
    typeof changes.shippingAmount === 'string'
  ) {
    const amountValue = changes.orderAmount ?? undefined;
    const currencyCode = changes.currency ?? undefined;
    const shippingValue = changes.shippingAmount ?? undefined;

    const amountPatch: any = {
      value: {},
    };

    if (currencyCode) {
      amountPatch.value.currency_code = currencyCode;
    }
    if (amountValue) {
      amountPatch.value.value = amountValue;
    }
    if (shippingValue) {
      amountPatch.value.breakdown = {
        shipping: {
          value: shippingValue,
        },
      };
    }

    ops.push({
      op: PatchOp.Replace,
      path: "/purchase_units/@reference_id=='default'/amount",
      ...amountPatch,
    });
  }

  if (ops.length === 0) {
    // Nothing to persist; simply return the current remote order.
    return getOrder(orderId);
  }

  try {
    await ordersController.patchOrder({
      id: orderId,
      body: ops,
    });

    // Return the fresh order from PayPal after patching.
    return getOrder(orderId);
  } catch (error) {
    handlePayPalError(error);
  }
}


