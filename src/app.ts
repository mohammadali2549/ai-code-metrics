import "dotenv/config";

import {
  ApiError,
  CheckoutPaymentIntent,
  Client,
  CustomError,
  Environment,
  LogLevel,
  OrdersController,
} from "@paypal/paypal-server-sdk";

// Initialize a PayPal API client using environment variables.
// Expected env vars:
// - PAYPAL_CLIENT_ID
// - PAYPAL_CLIENT_SECRET
const client = new Client({
  clientCredentialsAuthCredentials: {
    oAuthClientId: process.env.PAYPAL_CLIENT_ID ?? "",
    oAuthClientSecret: process.env.PAYPAL_CLIENT_SECRET ?? "",
  },
  timeout: 0,
  environment: Environment.Sandbox,
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

/**
 * Create a PayPal order with a single purchase unit:
 * - currency: USD
 * - value: 10.00
 */
export async function createOrder() {
  const collect = {
    body: {
      intent: CheckoutPaymentIntent.Capture,
      purchaseUnits: [
        {
          amount: {
            currencyCode: "USD",
            value: "10.00",
          },
        },
      ],
    },
    prefer: "return=minimal",
  };

  try {
    const response = await ordersController.createOrder(collect);
    if (response.result) {
      // Log basic identifiers for observability.
      // Consumers can use the returned result for their own purposes.
      console.log("Created PayPal order", response.result.id, response.result.status);
    }
    return response.result;
  } catch (error: unknown) {
    if (error instanceof ApiError) {
      console.error("PayPal API error (createOrder):", {
        statusCode: error.statusCode,
        headers: error.headers,
        body: error.body,
      });
      if (error instanceof CustomError) {
        console.error("PayPal API error details (createOrder):", {
          name: error.result?.name,
          message: error.result?.message,
        });
      }
    }
    throw error;
  }
}

/**
 * Retrieve an existing PayPal order by ID.
 */
export async function getOrder(orderId: string) {
  const collect = {
    id: orderId,
  };

  try {
    const response = await ordersController.getOrder(collect);
    if (response.result) {
      console.log("Fetched PayPal order", response.result.id, response.result.status);
    }
    return response.result;
  } catch (error: unknown) {
    if (error instanceof ApiError) {
      console.error("PayPal API error (getOrder):", {
        statusCode: error.statusCode,
        headers: error.headers,
        body: error.body,
      });
      if (error instanceof CustomError) {
        console.error("PayPal API error details (getOrder):", {
          name: error.result?.name,
          message: error.result?.message,
        });
      }
    }
    throw error;
  }
}

// Optional: export the low-level client & controller for reuse/testing.
export { client, ordersController };


