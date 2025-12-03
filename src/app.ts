import { Controller, Get, Injectable, Param, Post } from '@nestjs/common';
import {
  ApiError,
  CheckoutPaymentIntent,
  Client,
  Environment,
  LogLevel,
  OrdersController,
} from '@paypal/paypal-server-sdk';

/**
 * PayPalService wraps the PayPal Server SDK client and exposes helpers
 * for creating and retrieving orders.
 */
@Injectable()
export class PayPalService {
  private readonly client: Client;
  private readonly ordersController: OrdersController;

  constructor() {
    this.client = new Client({
      clientCredentialsAuthCredentials: {
        oAuthClientId: process.env.PAYPAL_CLIENT_ID,
        oAuthClientSecret: process.env.PAYPAL_CLIENT_SECRET,
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

    this.ordersController = new OrdersController(this.client);
  }

  /**
   * Create a PayPal order using a simple fixed amount.
   * In a real application, you would likely accept amount/currency in the body.
   */
  async createOrder() {
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
      const response = await this.ordersController.createOrder(collect);
      return {
        id: response.result.id,
        status: response.result.status,
        links: response.result.links,
      };
    } catch (error) {
      if (error instanceof ApiError) {
        // Re-throw with a cleaner message; Nest will convert to 500 by default.
        throw new Error(
          `PayPal API error (${error.statusCode}): ${error.result?.message}`,
        );
      }
      throw error;
    }
  }

  /**
   * Retrieve an existing PayPal order by ID.
   */
  async getOrder(id: string) {
    const collect = { id };

    try {
      const response = await this.ordersController.getOrder(collect);
      return {
        id: response.result.id,
        status: response.result.status,
        links: response.result.links,
      };
    } catch (error) {
      if (error instanceof ApiError) {
        throw new Error(
          `PayPal API error (${error.statusCode}): ${error.result?.message}`,
        );
      }
      throw error;
    }
  }
}

/**
 * PayPalController exposes endpoints for creating and fetching orders.
 *
 * POST /paypal/orders       -> create order
 * GET  /paypal/orders/:id   -> get order details
 */
@Controller('paypal/orders')
export class PayPalController {
  constructor(private readonly payPalService: PayPalService) {}

  @Post()
  async createOrder() {
    return this.payPalService.createOrder();
  }

  @Get(':id')
  async getOrder(@Param('id') id: string) {
    return this.payPalService.getOrder(id);
  }
}

/**
 * Top-level helper functions used by tests.
 * These mirror the service methods and are exported for direct import.
 */
export async function createOrder() {
  const service = new PayPalService();
  return service.createOrder();
}

export async function getOrder(id: string) {
  const service = new PayPalService();
  return service.getOrder(id);
}


