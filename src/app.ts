import * as dotenv from 'dotenv';
import * as http from 'http';
import express = require('express');
import cors = require('cors');
import {
  ApiError,
  Client,
  Environment,
  SubscriptionsController,
  SubscriptionProductsController,
  SubscriptionStatusController,
} from '@maxio-com/advanced-billing-sdk';

// Load environment variables from `.env` if it exists.
// If running in GitHub Actions, variables will already be present on process.env
dotenv.config();

type Nullable<T> = T | null;

export type UiSubscriptionStatusFilter =
  | 'all'
  | 'active'
  | 'canceled'
  | 'past_due'
  | 'trialing';

export type ChangeSubscriptionWhen = 'immediately' | 'next_billing';

export type CancelSubscriptionWhen = 'immediately' | 'at_period_end';

export interface SubscriptionSummary {
  id: Nullable<number>;
  customerName: Nullable<string>;
  customerEmail: Nullable<string>;
  /** Human-readable plan name (for UI display). */
  plan: Nullable<string>;
  /** Backwards-compatible alias for plan name. */
  planName: Nullable<string>;
  status: Nullable<string>;
  nextBillingDate: Nullable<string>;
  monthlyAmount: Nullable<number>;
}

export interface SubscriptionDetails {
  id: Nullable<number>;
  customerName: Nullable<string>;
  customerEmail: Nullable<string>;
  /** Human-readable plan name (for UI display). */
  plan: Nullable<string>;
  /** Backwards-compatible alias for plan name. */
  planName: Nullable<string>;
  price: Nullable<number>;
  status: Nullable<string>;
  billingPeriodUnit: Nullable<string>;
  billingPeriod: Nullable<number>;
  nextBillingDate: Nullable<string>;
  paymentMethod: Nullable<string>;
  customerInfo: {
    name: Nullable<string>;
    email: Nullable<string>;
  };
  currentPlan: Nullable<string>;
  billingCycle: {
    currentPeriodStartedAt: Nullable<string>;
    currentPeriodEndsAt: Nullable<string>;
  };
}

interface MaxioEnvConfig {
  site: string;
  username: string;
  password: string;
}

let cachedClient: Client | null = null;
let cachedSubscriptionsController: SubscriptionsController | null = null;
let cachedSubscriptionProductsController: SubscriptionProductsController | null = null;
let cachedSubscriptionStatusController: SubscriptionStatusController | null = null;

/**
 * Read Maxio configuration from environment variables.
 * Supports both local `.env` files (via dotenv) and GitHub Actions environment.
 */
export function getMaxioEnvConfig(): MaxioEnvConfig {
  const site = process.env.MAXIO_SITE;
  const username = process.env.MAXIO_BASIC_AUTH_USERNAME;
  const password = process.env.MAXIO_BASIC_AUTH_PASSWORD;

  if (!site || !username || !password) {
    throw new Error(
      'Missing Maxio environment configuration. Ensure MAXIO_SITE, MAXIO_BASIC_AUTH_USERNAME, and MAXIO_BASIC_AUTH_PASSWORD are set.',
    );
  }

  return {
    site,
    username,
    password,
  };
}

function getClient(): Client {
  if (cachedClient) {
    return cachedClient;
  }

  const { site, username, password } = getMaxioEnvConfig();

  cachedClient = new Client({
    site,
    environment: Environment.US,
    timeout: 120000,
    basicAuthCredentials: {
      username,
      password,
    },
  });

  return cachedClient;
}

function getSubscriptionsController(): SubscriptionsController {
  if (!cachedSubscriptionsController) {
    cachedSubscriptionsController = new SubscriptionsController(getClient());
  }
  return cachedSubscriptionsController;
}

function getSubscriptionProductsController(): SubscriptionProductsController {
  if (!cachedSubscriptionProductsController) {
    cachedSubscriptionProductsController = new SubscriptionProductsController(getClient());
  }
  return cachedSubscriptionProductsController;
}

function getSubscriptionStatusController(): SubscriptionStatusController {
  if (!cachedSubscriptionStatusController) {
    cachedSubscriptionStatusController = new SubscriptionStatusController(getClient());
  }
  return cachedSubscriptionStatusController;
}

function handleApiError(error: unknown): never {
  if (error instanceof ApiError) {
    const message = `Maxio API error: status=${error.statusCode}`;
    throw new Error(message);
  }

  if (error instanceof Error) {
    throw error;
  }

  throw new Error('Unknown error calling Maxio API');
}

/**
 * View all subscriptions, optionally filtered by subscription state and search term.
 *
 * @param statusFilter - Optional subscription state filter (e.g. 'active', 'canceled', 'past_due', 'trialing').
 * @param searchTerm - Optional search term for customer name or email.
 */
export async function viewAllSubscriptions(
  statusFilter?: UiSubscriptionStatusFilter,
  searchTerm?: string,
): Promise<SubscriptionSummary[]> {
  const subscriptionsController = getSubscriptionsController();

  try {
    const params: any = {
      page: 1,
      perPage: 50,
    };

    if (statusFilter && statusFilter !== 'all') {
      params.state = statusFilter;
    }

    if (searchTerm) {
      params.q = searchTerm;
    }

    const response: any = await subscriptionsController.listSubscriptions(params);
    const list: any[] = response?.result ?? [];

    return list.map((item: any): SubscriptionSummary => {
      const subscription = item.subscription ?? {};
      const customer = item.customer ?? {};

      const customerName =
        customer.firstName || customer.lastName
          ? `${customer.firstName ?? ''} ${customer.lastName ?? ''}`.trim() || null
          : customer.organization || null;

      const monthlyAmountCents =
        subscription.productPriceInCents ?? subscription.recurringRevenueInCents ?? null;

      return {
        id: subscription.id ?? null,
        customerName: customerName ?? null,
        customerEmail: customer.email ?? null,
        plan: subscription.productHandle ?? subscription.productName ?? null,
        planName: subscription.productHandle ?? subscription.productName ?? null,
        status: subscription.state ?? null,
        nextBillingDate: subscription.currentPeriodEndsAt ?? null,
        monthlyAmount:
          typeof monthlyAmountCents === 'number' ? monthlyAmountCents / 100 : null,
      };
    });
  } catch (error) {
    handleApiError(error);
  }
}

/**
 * View details of a single subscription by ID.
 *
 * @param subscriptionId - The ID of the subscription to retrieve.
 */
export async function viewSubscriptionDetails(
  subscriptionId: number,
): Promise<SubscriptionDetails> {
  const subscriptionsController = getSubscriptionsController();

  try {
    const response: any = await subscriptionsController.readSubscription(subscriptionId);
    const result: any = response?.result ?? {};
    const subscription = result.subscription ?? {};
    const customer = result.customer ?? {};
    const paymentProfile = result.paymentProfile ?? {};

    const customerName =
      customer.firstName || customer.lastName
        ? `${customer.firstName ?? ''} ${customer.lastName ?? ''}`.trim() || null
        : customer.organization || null;

    const monthlyAmountCents =
      subscription.productPriceInCents ?? subscription.recurringRevenueInCents ?? null;

    const billingPeriodUnit =
      subscription.product?.intervalUnit ?? subscription.intervalUnit ?? null;
    const billingPeriod =
      subscription.product?.interval ?? subscription.interval ?? null;

    let paymentMethod: Nullable<string> = null;
    if (paymentProfile) {
      const cardType = paymentProfile.cardType ?? paymentProfile.card_type;
      const lastFour = paymentProfile.lastFour ?? paymentProfile.last_4;
      if (cardType && lastFour) {
        paymentMethod = `${cardType} ****${lastFour}`;
      }
    }

    return {
      id: subscription.id ?? null,
      customerName: customerName ?? null,
      customerEmail: customer.email ?? null,
      plan: subscription.productHandle ?? subscription.productName ?? null,
      planName: subscription.productHandle ?? subscription.productName ?? null,
      price:
        typeof monthlyAmountCents === 'number' ? monthlyAmountCents / 100 : null,
      status: subscription.state ?? null,
      billingPeriodUnit,
      billingPeriod,
      nextBillingDate: subscription.currentPeriodEndsAt ?? null,
      paymentMethod,
      customerInfo: {
        name: customerName ?? null,
        email: customer.email ?? null,
      },
      currentPlan: subscription.productHandle ?? subscription.productName ?? null,
      billingCycle: {
        currentPeriodStartedAt: subscription.currentPeriodStartedAt ?? null,
        currentPeriodEndsAt: subscription.currentPeriodEndsAt ?? null,
      },
    };
  } catch (error) {
    handleApiError(error);
  }
}

/**
 * Change the subscription plan.
 *
 * @param subscriptionId - The ID of the subscription to change.
 * @param newProductPricePointId - The target product price point ID.
 * @param applyAt - When the change should take effect: 'immediately' or 'next_billing'.
 */
export async function changeSubscriptionPlan(
  subscriptionId: number,
  newProductPricePointId: number,
  applyAt: ChangeSubscriptionWhen,
): Promise<SubscriptionDetails> {
  const subscriptionProductsController = getSubscriptionProductsController();

  try {
    const body: any = {
      migration: {
        productPricePointId: newProductPricePointId,
        // If apply at next billing, preserve the current billing period so the change
        // takes effect on the next renewal rather than immediately.
        preservePeriod: applyAt === 'next_billing',
      },
    };

    const response: any = await subscriptionProductsController.migrateSubscriptionProduct(
      subscriptionId,
      body,
    );

    const result: any = response?.result ?? {};
    const subscription = result.subscription ?? {};
    const customer = result.customer ?? {};
    const paymentProfile = result.paymentProfile ?? {};

    const customerName =
      customer.firstName || customer.lastName
        ? `${customer.firstName ?? ''} ${customer.lastName ?? ''}`.trim() || null
        : customer.organization || null;

    const monthlyAmountCents =
      subscription.productPriceInCents ?? subscription.recurringRevenueInCents ?? null;

    const billingPeriodUnit =
      subscription.product?.intervalUnit ?? subscription.intervalUnit ?? null;
    const billingPeriod =
      subscription.product?.interval ?? subscription.interval ?? null;

    let paymentMethod: Nullable<string> = null;
    if (paymentProfile) {
      const cardType = paymentProfile.cardType ?? paymentProfile.card_type;
      const lastFour = paymentProfile.lastFour ?? paymentProfile.last_4;
      if (cardType && lastFour) {
        paymentMethod = `${cardType} ****${lastFour}`;
      }
    }

    return {
      id: subscription.id ?? null,
      customerName: customerName ?? null,
      customerEmail: customer.email ?? null,
      plan: subscription.productHandle ?? subscription.productName ?? null,
      planName: subscription.productHandle ?? subscription.productName ?? null,
      price:
        typeof monthlyAmountCents === 'number' ? monthlyAmountCents / 100 : null,
      status: subscription.state ?? null,
      billingPeriodUnit,
      billingPeriod,
      nextBillingDate: subscription.currentPeriodEndsAt ?? null,
      paymentMethod,
      customerInfo: {
        name: customerName ?? null,
        email: customer.email ?? null,
      },
      currentPlan: subscription.productHandle ?? subscription.productName ?? null,
      billingCycle: {
        currentPeriodStartedAt: subscription.currentPeriodStartedAt ?? null,
        currentPeriodEndsAt: subscription.currentPeriodEndsAt ?? null,
      },
    };
  } catch (error) {
    handleApiError(error);
  }
}

/**
 * Cancel a subscription.
 *
 * @param subscriptionId - The ID of the subscription to cancel.
 * @param cancelAt - When the cancellation should occur: 'immediately' or 'at_period_end'.
 * @param cancellationMessage - Optional cancellation reason / note.
 */
export async function cancelSubscription(
  subscriptionId: number,
  cancelAt: CancelSubscriptionWhen,
  cancellationMessage?: string,
): Promise<SubscriptionDetails> {
  const subscriptionStatusController = getSubscriptionStatusController();

  try {
    const body: any = {
      subscription: {
        cancellationMessage,
        // Simple reason code mapping for reporting; adjust to match your catalog if needed.
        reasonCode: cancelAt === 'at_period_end' ? 'end_of_period' : 'immediate',
        cancelAtEndOfPeriod: cancelAt === 'at_period_end',
      },
    };

    const response: any = await subscriptionStatusController.cancelSubscription(
      subscriptionId,
      body,
    );

    const result: any = response?.result ?? {};
    const subscription = result.subscription ?? {};
    const customer = result.customer ?? {};
    const paymentProfile = result.paymentProfile ?? {};

    const customerName =
      customer.firstName || customer.lastName
        ? `${customer.firstName ?? ''} ${customer.lastName ?? ''}`.trim() || null
        : customer.organization || null;

    const monthlyAmountCents =
      subscription.productPriceInCents ?? subscription.recurringRevenueInCents ?? null;

    const billingPeriodUnit =
      subscription.product?.intervalUnit ?? subscription.intervalUnit ?? null;
    const billingPeriod =
      subscription.product?.interval ?? subscription.interval ?? null;

    let paymentMethod: Nullable<string> = null;
    if (paymentProfile) {
      const cardType = paymentProfile.cardType ?? paymentProfile.card_type;
      const lastFour = paymentProfile.lastFour ?? paymentProfile.last_4;
      if (cardType && lastFour) {
        paymentMethod = `${cardType} ****${lastFour}`;
      }
    }

    return {
      id: subscription.id ?? null,
      customerName: customerName ?? null,
      customerEmail: customer.email ?? null,
      plan: subscription.productHandle ?? subscription.productName ?? null,
      planName: subscription.productHandle ?? subscription.productName ?? null,
      price:
        typeof monthlyAmountCents === 'number' ? monthlyAmountCents / 100 : null,
      status: subscription.state ?? null,
      billingPeriodUnit,
      billingPeriod,
      nextBillingDate: subscription.currentPeriodEndsAt ?? null,
      paymentMethod,
      customerInfo: {
        name: customerName ?? null,
        email: customer.email ?? null,
      },
      currentPlan: subscription.productHandle ?? subscription.productName ?? null,
      billingCycle: {
        currentPeriodStartedAt: subscription.currentPeriodStartedAt ?? null,
        currentPeriodEndsAt: subscription.currentPeriodEndsAt ?? null,
      },
    };
  } catch (error) {
    handleApiError(error);
  }
}

/**
 * Convenience wrapper used by tests: get details for a single subscription.
 */
export async function getSubscriptionDetails(
  subscriptionId: number,
): Promise<SubscriptionDetails> {
  return viewSubscriptionDetails(subscriptionId);
}

/**
 * Core cancellation helper used by tests.
 */
export async function cancelSubscriptionCore(
  subscriptionId: number,
  cancelAt: CancelSubscriptionWhen,
  cancellationMessage?: string,
): Promise<SubscriptionDetails> {
  return cancelSubscription(subscriptionId, cancelAt, cancellationMessage);
}

/**
 * Minimal Express server wiring the subscription helpers to HTTP endpoints.
 * This is primarily intended for integration tests and a simple subscription view.
 */
const app = express();

app.use(cors());
app.use(express.json());

// List subscriptions with optional filtering and search
app.get('/subscriptions', async (req, res) => {
  try {
    const status = (req.query.status as UiSubscriptionStatusFilter | undefined) ?? undefined;
    const search = (req.query.search as string | undefined) ?? undefined;
    const subscriptions = await viewAllSubscriptions(status, search);
    res.json(subscriptions);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

// Get a single subscription by ID
app.get('/subscriptions/:id', async (req, res) => {
  try {
    const subscriptionId = Number(req.params.id);
    const details = await viewSubscriptionDetails(subscriptionId);
    res.json(details);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

// Change subscription plan
app.post('/subscriptions/:id/change-plan', async (req, res) => {
  try {
    const subscriptionId = Number(req.params.id);
    const { newProductPricePointId, applyAt } = req.body as {
      newProductPricePointId: number;
      applyAt: ChangeSubscriptionWhen;
    };
    const details = await changeSubscriptionPlan(subscriptionId, newProductPricePointId, applyAt);
    res.json(details);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

// Cancel subscription
app.post('/subscriptions/:id/cancel', async (req, res) => {
  try {
    const subscriptionId = Number(req.params.id);
    const { cancelAt, cancellationMessage } = req.body as {
      cancelAt: CancelSubscriptionWhen;
      cancellationMessage?: string;
    };
    const details = await cancelSubscription(subscriptionId, cancelAt, cancellationMessage);
    res.json(details);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

export const server = http.createServer(app);

