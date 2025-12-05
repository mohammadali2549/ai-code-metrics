import * as dotenv from 'dotenv';
import express = require("express");

import { Server } from 'http';
import {
  ApiError,
  CancellationRequest,
  Client,
  Environment,
  SubscriptionListInclude,
  SubscriptionProductMigrationRequest,
  SubscriptionProductsController,
  SubscriptionsController,
  SubscriptionStatusController,
} from '@maxio-com/advanced-billing-sdk';

// Load environment variables from `.env` when present.
// In GitHub Actions, the variables are already available on process.env.
dotenv.config();

type Nullable<T> = T | null;

export type SubscriptionStatusFilter = 'active' | 'canceled' | 'past_due' | 'trial';

// UI-oriented aliases that tests import.
export type UiSubscriptionStatusFilter = SubscriptionStatusFilter;
export type ChangeSubscriptionWhen = 'immediately' | 'next_billing';
export type CancelSubscriptionWhen = 'immediately' | 'period_end';

export interface SubscriptionSummary {
  // Tests expect `id` and `plan` properties.
  id: number;
  plan: Nullable<string>;
  customerName: Nullable<string>;
  customerEmail: Nullable<string>;
  status: Nullable<string>;
  nextBillingDate: Nullable<string>;
  monthlyAmount: Nullable<number>;
  // Internal aliases, useful for callers but not required by tests.
  subscriptionId: number;
  planName: Nullable<string>;
}

export interface SubscriptionDetails {
  // High-level fields used in tests
  id: number;
  customerInfo: {
    name: Nullable<string>;
    email: Nullable<string>;
  };
  currentPlan: Nullable<string>;
  status: Nullable<string>;
  nextBillingDate: Nullable<string>;
  billingCycle: {
    currentPeriodStartedAt: Nullable<string>;
    currentPeriodEndsAt: Nullable<string>;
  };
  paymentMethodType: Nullable<string>;
  paymentMethodMaskedNumber: Nullable<string>;

  // Additional useful details (not strictly required by tests)
  subscriptionId: number;
  customerName: Nullable<string>;
  customerEmail: Nullable<string>;
  planName: Nullable<string>;
  price: Nullable<number>;
  currency: Nullable<string>;
  billingPeriodUnit: Nullable<string>;
  billingPeriodQuantity: Nullable<number>;
}

export interface ChangeSubscriptionPlanOptions {
  subscriptionId: number;
  newProductId: number;
  /**
   * When the change should take effect:
   * - 'immediately'  -> proration occurs now
   * - 'next_billing' -> change is scheduled for next billing period
   */
  effectiveFrom: 'immediately' | 'next_billing';
}

export interface CancelSubscriptionOptions {
  subscriptionId: number;
  /**
   * - 'immediately' -> cancel now
   * - 'period_end' -> cancel at end of current billing period
   */
  cancelAt: CancelSubscriptionWhen;
  reason?: string;
}

let cachedClient: Client | null = null;

function ensureMaxioEnv(): void {
  const required = [
    'MAXIO_SITE',
    'MAXIO_BASIC_AUTH_USERNAME',
    'MAXIO_BASIC_AUTH_PASSWORD',
  ] as const;

  const missing = required.filter((key) => !process.env[key]);

  if (missing.length > 0) {
    // .env may be absent in CI; in that case we rely entirely on GitHub Actions env.
    // If values are still missing here, it is a configuration error.
    throw new Error(
      `Missing required Maxio environment variables: ${missing.join(', ')}`,
    );
  }
}

function getClient(): Client {
  if (!cachedClient) {
    ensureMaxioEnv();

    cachedClient = new Client({
      basicAuthCredentials: {
        username: process.env.MAXIO_BASIC_AUTH_USERNAME || '',
        password: process.env.MAXIO_BASIC_AUTH_PASSWORD || '',
      },
      timeout: 120000,
      environment: Environment.US,
      site: process.env.MAXIO_SITE || '',
    });
  }

  return cachedClient;
}

// Exposed for tests so they can force re-initialisation with different env values.
export function resetMaxioClientForTests(): void {
  cachedClient = null;
}

function getControllers() {
  const client = getClient();

  return {
    subscriptionsController: new SubscriptionsController(client),
    subscriptionProductsController: new SubscriptionProductsController(client),
    subscriptionStatusController: new SubscriptionStatusController(client),
  };
}

function normaliseStatus(status: unknown): Nullable<string> {
  if (typeof status !== 'string') return null;
  return status.toLowerCase();
}

function matchesStatusFilter(
  subscriptionState: unknown,
  filter?: SubscriptionStatusFilter,
): boolean {
  if (!filter) return true;
  const normalized = normaliseStatus(subscriptionState);

  if (!normalized) return false;

  switch (filter) {
    case 'active':
      return normalized === 'active';
    case 'canceled':
      return normalized === 'canceled';
    case 'past_due':
      return normalized === 'past_due';
    case 'trial':
      return normalized === 'trial' || normalized === 'trialing';
    default:
      return true;
  }
}

function matchesSearchFilter(
  customer: any,
  search?: string,
): boolean {
  if (!search) return true;
  const needle = search.toLowerCase();

  const nameParts: string[] = [];
  if (customer?.firstName) nameParts.push(String(customer.firstName));
  if (customer?.lastName) nameParts.push(String(customer.lastName));

  const fullName = nameParts.join(' ').toLowerCase();
  const email = (customer?.email || '').toLowerCase();

  return (
    fullName.includes(needle) ||
    email.includes(needle)
  );
}

/**
 * 1. View All Subscriptions
 * - Filter by: Active, Canceled, Past Due, Trial
 * - Search by: customer name or email
 */
export async function viewAllSubscriptions(
  status?: UiSubscriptionStatusFilter,
  search?: string,
): Promise<SubscriptionSummary[]> {
  const { subscriptionsController } = getControllers();

  const page = 1;
  const perPage = 50;

  try {
    const response: any = await subscriptionsController.listSubscriptions({
      page,
      perPage,
      // Fetch related customer data so we can show name/email when available.
      include: ['customer'],
    } as any);

    const items: any[] = response?.result ?? [];

    return items
      .filter((item) =>
        matchesStatusFilter(item?.subscription?.state, status),
      )
      .filter((item) =>
        matchesSearchFilter(item?.customer ?? item?.subscription?.customer, search),
      )
      .map<SubscriptionSummary>((item) => {
        const subscription = item?.subscription ?? {};
        const customer = item?.customer ?? subscription.customer ?? {};

        const planName: Nullable<string> =
          subscription.product?.name ??
          subscription.productHandle ??
          null;

        const monthlyAmount: Nullable<number> =
          typeof subscription.productPriceInCents === 'number'
            ? subscription.productPriceInCents / 100
            : null;

        const nextBillingDate: Nullable<string> =
          subscription.nextBillingAt ??
          subscription.currentPeriodEndsAt ??
          null;

        return {
          id: subscription.id ?? 0,
          plan: planName,
          customerName:
            customer.firstName || customer.lastName
              ? `${customer.firstName ?? ''} ${customer.lastName ?? ''}`.trim()
              : customer.organization || null,
          customerEmail: customer.email ?? null,
          status: normaliseStatus(subscription.state),
          nextBillingDate,
          monthlyAmount,
          subscriptionId: subscription.id ?? 0,
          planName,
        };
      });
  } catch (error) {
    if (error instanceof ApiError) {
      // Re-throw a simpler error for tests / callers.
      throw new Error(
        `Failed to list subscriptions: ${error.statusCode}`,
      );
    }
    throw error;
  }
}

/**
 * 2. View Single Subscription Details
 */
export async function viewSingleSubscriptionDetails(
  subscriptionId: number,
): Promise<SubscriptionDetails> {
  const { subscriptionsController } = getControllers();

  try {
    const response: any = await subscriptionsController.readSubscription(
      subscriptionId,
      // Ask the API to include related customer and payment profile data.
      ['customer'] as any,
    );

    const payload: any = response?.result ?? {};
    const subscription: any = payload.subscription ?? {};
    const customer: any =
      payload.customer ?? subscription.customer ?? {};
    const paymentProfile: any =
      payload.paymentProfile ??
      subscription.paymentProfile ??
      payload.defaultPaymentProfile ??
      {};

    const planName: Nullable<string> =
      subscription.product?.name ??
      subscription.productHandle ??
      null;

    const price: Nullable<number> =
      typeof subscription.productPriceInCents === 'number'
        ? subscription.productPriceInCents / 100
        : null;

    const currency: Nullable<string> =
      subscription.currency ??
      subscription.productCurrency ??
      null;

    const nextBillingDate: Nullable<string> =
      subscription.nextBillingAt ??
      subscription.currentPeriodEndsAt ??
      null;

    return {
      id: subscription.id ?? subscriptionId,
      customerInfo: {
        name:
          customer.firstName || customer.lastName
            ? `${customer.firstName ?? ''} ${customer.lastName ?? ''}`.trim()
            : customer.organization || null,
        email: customer.email ?? null,
      },
      currentPlan: planName,
      status: normaliseStatus(subscription.state),
      nextBillingDate,
      billingCycle: {
        currentPeriodStartedAt:
          subscription.currentPeriodStartedAt ?? null,
        currentPeriodEndsAt:
          subscription.currentPeriodEndsAt ?? null,
      },
      paymentMethodType:
        paymentProfile.paymentType ?? paymentProfile.cardType ?? null,
      paymentMethodMaskedNumber:
        paymentProfile.maskedCardNumber ??
        paymentProfile.lastFour ??
        null,
      // extra fields
      subscriptionId: subscription.id ?? subscriptionId,
      customerName:
        customer.firstName || customer.lastName
          ? `${customer.firstName ?? ''} ${customer.lastName ?? ''}`.trim()
          : customer.organization || null,
      customerEmail: customer.email ?? null,
      planName,
      price,
      currency,
      billingPeriodUnit: subscription.productPeriodUnit ?? null,
      billingPeriodQuantity: subscription.productPeriod ?? null,
    };
  } catch (error) {
    if (error instanceof ApiError) {
      throw new Error(
        `Failed to fetch subscription ${subscriptionId}: ${error.statusCode}`,
      );
    }
    throw error;
  }
}

// Alias used by tests.
export async function getSubscriptionDetails(
  subscriptionId: number,
): Promise<SubscriptionDetails> {
  return viewSingleSubscriptionDetails(subscriptionId);
}

/**
 * 3. Change Subscription Plan (upgrade / downgrade)
 */
export async function changeSubscriptionPlan(
  subscriptionId: number,
  newProductId: number,
  when: ChangeSubscriptionWhen,
): Promise<any> {
  const { subscriptionProductsController } = getControllers();

  const preservePeriod = when === 'next_billing';

  const body: SubscriptionProductMigrationRequest = {
    migration: {
      productId: newProductId,
      preservePeriod,
    },
  };

  try {
    const response: any =
      await subscriptionProductsController.migrateSubscriptionProduct(
        subscriptionId,
        body as any,
      );

    return response?.result;
  } catch (error) {
    if (error instanceof ApiError) {
      throw new Error(
        `Failed to change subscription plan for ${subscriptionId}: ${error.statusCode}`,
      );
    }
    throw error;
  }
}

/**
 * 4. Cancel Subscription
 */
export async function cancelSubscription(
  options: CancelSubscriptionOptions,
): Promise<any> {
  const { subscriptionStatusController } = getControllers();

  try {
    if (options.cancelAt === 'immediately') {
      const response: any =
        await subscriptionStatusController.cancelSubscription(
          options.subscriptionId,
        );
      return response?.result;
    }

    const body: CancellationRequest = {
      subscription: {
        cancellationMessage: options.reason,
      },
    };

    const response: any =
      await subscriptionStatusController.initiateDelayedCancellation(
        options.subscriptionId,
        body as any,
      );

    return response?.result;
  } catch (error) {
    if (error instanceof ApiError) {
      throw new Error(
        `Failed to cancel subscription ${options.subscriptionId}: ${error.statusCode}`,
      );
    }
    throw error;
  }
}

// Core helper used by tests.
export async function cancelSubscriptionCore(
  subscriptionId: number,
  when: CancelSubscriptionWhen,
  reason?: string,
): Promise<any> {
  return cancelSubscription({
    subscriptionId,
    cancelAt: when,
    reason,
  });
}

// Minimal Express server exposing the core subscription operations.
const app = express();
app.use(express.json());

app.get('/subscriptions', async (req, res) => {
  try {
    const status = (req.query.status as UiSubscriptionStatusFilter | undefined) || undefined;
    const search = (req.query.search as string | undefined) || undefined;
    const subscriptions = await viewAllSubscriptions(status, search);
    res.json(subscriptions);
  } catch (error: any) {
    res
      .status(500)
      .json({ error: error?.message ?? 'Failed to fetch subscriptions' });
  }
});

app.get('/subscriptions/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const details = await getSubscriptionDetails(id);
    res.json(details);
  } catch (error: any) {
    res
      .status(500)
      .json({ error: error?.message ?? 'Failed to fetch subscription' });
  }
});

app.post('/subscriptions/:id/change-plan', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { productId, when } = req.body as {
      productId: number;
      when: ChangeSubscriptionWhen;
    };
    const result = await changeSubscriptionPlan(id, productId, when);
    res.json(result);
  } catch (error: any) {
    res
      .status(500)
      .json({ error: error?.message ?? 'Failed to change plan' });
  }
});

app.post('/subscriptions/:id/cancel', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { when, reason } = req.body as {
      when: CancelSubscriptionWhen;
      reason?: string;
    };
    const result = await cancelSubscriptionCore(id, when, reason);
    res.json(result);
  } catch (error: any) {
    res
      .status(500)
      .json({ error: error?.message ?? 'Failed to cancel subscription' });
  }
});

export const server: Server = app.listen(0);

