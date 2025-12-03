import {
  ApiError,
  CheckoutPaymentIntent,
  Client,
  Environment,
  LogLevel,
  OrdersController,
} from '@paypal/paypal-server-sdk';

const environment =
  process.env.PAYPAL_ENV === 'live'
    ? (Environment as any).Live ?? (Environment as any).LIVE ?? Environment.Sandbox
    : Environment.Sandbox;

const client = new Client({
  clientCredentialsAuthCredentials: {
    oAuthClientId: process.env.PAYPAL_CLIENT_ID || '',
    oAuthClientSecret: process.env.PAYPAL_CLIENT_SECRET || '',
  },
  timeout: 0,
  environment,
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

  try {
    const response = await ordersController.createOrder(collect);
    return {
      orderId: response.result.id,
      order: response.result,
    };
  } catch (error) {
    if (error instanceof ApiError) {
      // eslint-disable-next-line no-console
      console.error('Error creating order:', error);
    }
    throw error;
  }
}

export async function getOrder(orderId: string) {
  const collect = {
    id: orderId,
  };

  try {
    const response = await ordersController.getOrder(collect);
    return response.result;
  } catch (error) {
    if (error instanceof ApiError) {
      // eslint-disable-next-line no-console
      console.error('Error fetching order:', error);
    }
    throw error;
  }
}

