import express, { Request, Response } from 'express';
import paypal from '@paypal/paypal-server-sdk';
import "dotenv/config";

/**
 * Simple Express application that exposes endpoints for working with PayPal
 * orders using the PayPal Orders API.
 *
 * Features:
 * 1) Create an order (Create Order endpoint)
 * 2) Retrieve an order (Get Order endpoint)
 * 3) Return order details so the user can review/modify them
 * 4) Persist order changes using the Orders Patch endpoint
 */

const app = express();
app.use(express.json());

// ---- PayPal client setup ----------------------------------------------------

const PAYPAL_CLIENT_ID = process.env.PAYPAL_CLIENT_ID || '';
const PAYPAL_CLIENT_SECRET = process.env.PAYPAL_CLIENT_SECRET || '';
const PAYPAL_ENVIRONMENT = (process.env.PAYPAL_ENVIRONMENT || 'sandbox').toLowerCase();

function createPayPalClient() {
  const env =
    PAYPAL_ENVIRONMENT === 'live'
      ? new paypal.core.LiveEnvironment(PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET)
      : new paypal.core.SandboxEnvironment(PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET);

  return new paypal.core.PayPalHttpClient(env);
}

const paypalClient = createPayPalClient();

// ---- Helpers ----------------------------------------------------------------

type MoneyInput = string | number | undefined | null;

interface OrderInput {
  description: string;
  orderAmount: MoneyInput;
  shippingAmount: MoneyInput;
  currency: string;
}

function toNumber(value: MoneyInput): number {
  if (value === null || value === undefined || value === '') {
    return 0;
  }
  const num = Number(value);
  if (!Number.isFinite(num)) {
    throw new Error('Invalid monetary value');
  }
  return num;
}

function formatAmount(num: number): string {
  return num.toFixed(2);
}

/**
 * Build a PayPal purchase unit from user-provided values.
 * We explicitly set reference_id to "default" so that subsequent PATCH
 * operations can target this unit via the documented path.
 */
function buildPurchaseUnit(input: OrderInput) {
  const itemTotal = toNumber(input.orderAmount);
  const shipping = toNumber(input.shippingAmount);
  const total = itemTotal + shipping;

  return {
    reference_id: 'default',
    description: input.description,
    amount: {
      currency_code: input.currency,
      value: formatAmount(total),
      breakdown: {
        item_total: {
          currency_code: input.currency,
          value: formatAmount(itemTotal),
        },
        shipping: {
          currency_code: input.currency,
          value: formatAmount(shipping),
        },
      },
    },
  };
}

// ---- Routes -----------------------------------------------------------------

/**
 * 1) Create an order using the PayPal Create Order endpoint.
 *    Body: { description, orderAmount, shippingAmount, currency }
 */
app.post('/orders', async (req: Request, res: Response) => {
  try {
    const { description, orderAmount, shippingAmount, currency } = req.body || {};

    if (!description || !currency) {
      return res
        .status(400)
        .json({ error: 'Both description and currency are required to create an order.' });
    }

    const purchaseUnit = buildPurchaseUnit({
      description,
      orderAmount,
      shippingAmount,
      currency,
    });

    const request = new paypal.orders.OrdersCreateRequest();
    request.prefer('return=representation');
    request.requestBody({
      intent: 'CAPTURE',
      purchase_units: [purchaseUnit],
    });

    const response = await paypalClient.execute(request as any);

    return res.status(201).json({
      id: response.result.id,
      status: response.result.status,
      details: response.result,
    });
  } catch (error) {
    // In a production app, you would log this with proper logging tooling.
    // eslint-disable-next-line no-console
    console.error('Error creating PayPal order:', error);
    return res.status(500).json({ error: 'Failed to create PayPal order.' });
  }
});

/**
 * 2) Retrieve an order using the PayPal Get Order endpoint.
 */
app.get('/orders/:orderId', async (req: Request, res: Response) => {
  try {
    const { orderId } = req.params;

    const request = new paypal.orders.OrdersGetRequest(orderId);
    const response = await paypalClient.execute(request as any);

    // 3) "Print" order details by returning them to the caller.
    return res.json(response.result);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Error retrieving PayPal order:', error);
    return res.status(500).json({ error: 'Failed to retrieve PayPal order.' });
  }
});

/**
 * 3 & 4) Allow the user to submit updated order details and persist them
 *        using the PayPal Orders Patch endpoint.
 *
 *    Route: PATCH /orders/:orderId
 *    Body (any subset is allowed):
 *      { description, orderAmount, shippingAmount, currency }
 *
 *    The endpoint will apply the provided changes and then return the
 *    updated order details to the caller.
 */
app.patch('/orders/:orderId', async (req: Request, res: Response) => {
  try {
    const { orderId } = req.params;
    const { description, orderAmount, shippingAmount, currency } = req.body || {};

    const patches: any[] = [];

    if (description !== undefined) {
      patches.push({
        op: 'replace',
        path: "/purchase_units/@reference_id=='default'/description",
        value: description,
      });
    }

    if (
      orderAmount !== undefined ||
      shippingAmount !== undefined ||
      currency !== undefined
    ) {
      // Retrieve the current order so we can compute the updated amount.
      const getRequest = new paypal.orders.OrdersGetRequest(orderId);
      const current = await paypalClient.execute(getRequest as any);
      const currentUnit = current.result.purchase_units?.[0];

      const effectiveCurrency =
        currency || currentUnit?.amount?.currency_code || 'USD';

      const currentItemTotal = Number(
        currentUnit?.amount?.breakdown?.item_total?.value || 0,
      );
      const currentShipping = Number(
        currentUnit?.amount?.breakdown?.shipping?.value || 0,
      );

      const newItemTotal =
        orderAmount !== undefined ? toNumber(orderAmount) : currentItemTotal;
      const newShipping =
        shippingAmount !== undefined
          ? toNumber(shippingAmount)
          : currentShipping;

      const updatedUnit = buildPurchaseUnit({
        description: description || currentUnit?.description || '',
        orderAmount: newItemTotal,
        shippingAmount: newShipping,
        currency: effectiveCurrency,
      });

      patches.push({
        op: 'replace',
        path: "/purchase_units/@reference_id=='default'/amount",
        value: updatedUnit.amount,
      });
    }

    if (patches.length === 0) {
      return res
        .status(400)
        .json({ error: 'No updatable fields were provided in the request body.' });
    }

    const patchRequest = new paypal.orders.OrdersPatchRequest(orderId);
    patchRequest.requestBody(patches);

    await paypalClient.execute(patchRequest as any);

    // Fetch and return the updated order so the caller sees final details.
    const getUpdatedRequest = new paypal.orders.OrdersGetRequest(orderId);
    const updated = await paypalClient.execute(getUpdatedRequest as any);

    return res.json(updated.result);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Error updating PayPal order:', error);
    return res.status(500).json({ error: 'Failed to update PayPal order.' });
  }
});

// Export the app for testing / external usage.
export { app };
export default app;


