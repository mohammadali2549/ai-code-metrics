// Type-only or fallback declaration for PayPal SDK, if @types not present and linter persists
// @ts-ignore
import paypal from '@paypal/checkout-server-sdk';
import express from 'express';
import type { Request, Response } from 'express';

const app = express();
app.use(express.json());

// TODO: Replace with environment variables or secure config in production
const PAYPAL_CLIENT_ID = 'YOUR_CLIENT_ID';
const PAYPAL_CLIENT_SECRET = 'YOUR_CLIENT_SECRET';

function environment() {
  return new paypal.core.SandboxEnvironment(PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET);
}

function client() {
  return new paypal.core.PayPalHttpClient(environment());
}

// Create Order
app.post('/orders', async (req: Request, res: Response) => {
  const { value = '100.00', currency_code = 'USD' } = req.body || {};
  const request = new paypal.orders.OrdersCreateRequest();
  request.prefer('return=representation');
  request.requestBody({
    intent: 'CAPTURE',
    purchase_units: [
      {
        amount: {
          currency_code,
          value,
        },
      },
    ],
  });
  try {
    const response = await client().execute(request);
    res.status(201).json(response.result);
  } catch (err: unknown) {
    const errorMsg = err && typeof err === 'object' && 'message' in err ? (err as Error).message : String(err);
    res.status(500).json({ error: 'PayPal Create Order Failed', details: errorMsg });
  }
});

// Get Order
app.get('/orders/:orderId', async (req: Request, res: Response) => {
  const { orderId } = req.params;
  // Always pass a string to OrdersGetRequest, even if undefined fallback to empty
  const request = new paypal.orders.OrdersGetRequest(orderId || "");
  try {
    const response = await client().execute(request);
    res.json(response.result);
  } catch (err: unknown) {
    const errorMsg = err && typeof err === 'object' && 'message' in err ? (err as Error).message : String(err);
    res.status(500).json({ error: 'PayPal Get Order Failed', details: errorMsg });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});

export default app;
