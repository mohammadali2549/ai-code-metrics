import express, { type Request, type Response } from 'express';
import {
  ApiError,
  CheckoutPaymentIntent,
  Client,
  Environment,
  LogLevel,
  OrdersController,
} from '@paypal/paypal-server-sdk';

const clientId = process.env.PAYPAL_CLIENT_ID ?? 'YourClientId';
const clientSecret = process.env.PAYPAL_CLIENT_SECRET ?? 'YourClientSecret';
const paypalEnvironment =
  process.env.NODE_ENV === 'production'
    ? ((Environment as unknown as Record<string, (typeof Environment)[keyof typeof Environment]>)
        .Live ?? Environment.Sandbox)
    : Environment.Sandbox;

const paypalClient = new Client({
  clientCredentialsAuthCredentials: {
    oAuthClientId: clientId,
    oAuthClientSecret: clientSecret,
  },
  timeout: 0,
  environment: paypalEnvironment,
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

const ordersController = new OrdersController(paypalClient);

const app = express();
app.use(express.json());

export async function createOrder() {
  const collect = {
    body: {
      intent: CheckoutPaymentIntent.Capture,
      purchaseUnits: [
        {
          amount: {
            currencyCode: 'USD',
            value: '10.00',
          },
        },
      ],
    },
    prefer: 'return=minimal',
  };

  const response = await ordersController.createOrder(collect);
  return response.result;
}

export async function getOrder(orderId: string) {
  const collect = {
    id: orderId,
  };

  const response = await ordersController.getOrder(collect);
  return response.result;
}

app.post('/orders', async (req: Request, res: Response) => {
  try {
    const result = await createOrder();
    res.status(201).json(result);
  } catch (error: unknown) {
    if (error instanceof ApiError) {
      res.status(error.statusCode).json({
        error: error.result?.name,
        message: error.result?.message,
      });
    } else {
      res.status(500).json({ error: 'Internal Server Error' });
    }
  }
});

app.get('/orders/:orderId', async (req: Request, res: Response) => {
  const orderId = req.params.orderId;

  if (!orderId) {
    res.status(400).json({ error: 'Missing orderId' });
    return;
  }

  try {
    const result = await getOrder(orderId);
    res.status(200).json(result);
  } catch (error: unknown) {
    if (error instanceof ApiError) {
      res.status(error.statusCode).json({
        error: error.result?.name,
        message: error.result?.message,
      });
    } else {
      res.status(500).json({ error: 'Internal Server Error' });
    }
  }
});

const PORT = process.env.PORT ?? 3000;

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Server is running on port ${PORT}`);
});

export { app };

