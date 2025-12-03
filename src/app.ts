import express, { Request, Response } from 'express';
import {
  ApiError,
  CheckoutPaymentIntent,
  Client,
  Environment,
  LogLevel,
  OrdersController,
} from '@paypal/paypal-server-sdk';

const app = express();
app.use(express.json());

// Initialize PayPal client using environment variables.
// Make sure to set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET in your environment.
const client = new Client({
  clientCredentialsAuthCredentials: {
    oAuthClientId: process.env.PAYPAL_CLIENT_ID ?? '',
    oAuthClientSecret: process.env.PAYPAL_CLIENT_SECRET ?? '',
  },
  environment: Environment.Sandbox,
  timeout: 0,
  logging: {
    logLevel: LogLevel.Info,
    logRequest: {
      logBody: true,
    },
    logResponse: {
      logHeaders: true,
    },
  },
});

const ordersController = new OrdersController(client);

// POST /orders - Create an order with a hard-coded purchase unit
app.post('/orders', async (req: Request, res: Response) => {
  const collect = {
    body: {
      intent: CheckoutPaymentIntent.Capture,
      purchaseUnits: [
        {
          amount: {
            currencyCode: 'USD',
            value: '100.00',
          },
        },
      ],
    },
    prefer: 'return=minimal',
  };

  try {
    const response = await ordersController.createOrder(collect);
    res.status(response.statusCode).json(response.result);
  } catch (error) {
    if (error instanceof ApiError) {
      // Log detailed PayPal SDK error information
      // eslint-disable-next-line no-console
      console.error('PayPal API Error (createOrder):', error.statusCode, error.body);
      res.status(error.statusCode).json({ error: error.body });
    } else {
      // eslint-disable-next-line no-console
      console.error('Unexpected error during createOrder:', error);
      res.status(500).json({ error: 'Internal Server Error' });
    }
  }
});

// GET /orders/:id - Retrieve an order by ID
app.get('/orders/:id', async (req: Request, res: Response) => {
  const collect = {
    id: req.params.id,
  };

  try {
    const response = await ordersController.getOrder(collect);
    res.status(response.statusCode).json(response.result);
  } catch (error) {
    if (error instanceof ApiError) {
      // eslint-disable-next-line no-console
      console.error('PayPal API Error (getOrder):', error.statusCode, error.body);
      res.status(error.statusCode).json({ error: error.body });
    } else {
      // eslint-disable-next-line no-console
      console.error('Unexpected error during getOrder:', error);
      res.status(500).json({ error: 'Internal Server Error' });
    }
  }
});

// Exported helper function for creating an order (used by tests)
export async function createOrder() {
  const collect = {
    body: {
      intent: CheckoutPaymentIntent.Capture,
      purchaseUnits: [
        {
          amount: {
            currencyCode: 'USD',
            value: '100.00',
          },
        },
      ],
    },
    prefer: 'return=minimal',
  };

  const response = await ordersController.createOrder(collect);
  return response.result;
}

// Exported helper function for retrieving an order by ID (used by tests)
export async function getOrder(id: string) {
  const collect = {
    id,
  };

  const response = await ordersController.getOrder(collect);
  return response.result;
}

export default app;


