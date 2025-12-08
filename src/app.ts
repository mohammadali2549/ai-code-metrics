// Core Maxio Advanced Billing integration for subscription management.
// NOTE: Per instructions, all implementation for this task lives in this file.

import * as fs from 'fs';
import * as http from 'http';
import * as dotenv from 'dotenv';

// Use a dynamic require so that TypeScript compilation does not depend on the
// presence of the SDK's type declarations. In CI / GitHub Actions, the actual
// package is expected to be installed.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const maxioSdk = require('@maxio-com/advanced-billing-sdk');

const {
  Client,
  Environment,
  CustomersController,
  SubscriptionsController,
  SubscriptionStatusController,
} = maxioSdk;

// Load environment variables from .env when available; otherwise rely on
// the process environment (e.g., GitHub Actions).
if (fs.existsSync('.env')) {
  dotenv.config();
}

type SubscriptionFilterStatus = 'active' | 'canceled' | 'past_due' | 'trial';

// UI-facing filter type used by tests.
export type UiSubscriptionStatusFilter = SubscriptionFilterStatus | 'all';

export interface SubscriptionListItem {
  id: number | string | null;
  customerName: string | null;
  customerEmail: string | null;
  plan: string | null;
  status: string | null;
  nextBillingDate: string | null;
  monthlyAmount: number | null;
  monthlyAmountCents?: number | null;
}

export interface SubscriptionDetails {
  id: number | string | null;
  customerName: string | null;
  email: string | null;
  customerInfo: {
    name: string | null;
    email: string | null;
  };
  currentPlan: string | null;
  price: number | null;
  status: string | null;
  billingCycle: {
    currentPeriodStartedAt: string | null;
    currentPeriodEndsAt: string | null;
  };
  nextBillingDate: string | null;
  paymentMethod: string | null;
}

export type PlanChangeTiming = 'immediate' | 'immediately' | 'next_billing';
export type CancelTiming = 'immediate' | 'immediately' | 'period_end';

// Aliases matching the test expectations.
export type ChangeSubscriptionWhen = PlanChangeTiming;
export type CancelSubscriptionWhen = CancelTiming;

// Minimal request type for updating subscriptions; the real SDK provides
// stronger typings, but we only need the structure used here.
type UpdateSubscriptionRequest = {
  subscription: {
    productId: number;
    productChangeDelayed?: boolean;
  };
};

function getRequiredEnv(name: 'MAXIO_SITE' | 'MAXIO_BASIC_AUTH_USERNAME' | 'MAXIO_BASIC_AUTH_PASSWORD'): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

// Initialize Maxio Advanced Billing SDK client and controllers.
const maxioSite = getRequiredEnv('MAXIO_SITE');
const maxioUsername = getRequiredEnv('MAXIO_BASIC_AUTH_USERNAME');
const maxioPassword = getRequiredEnv('MAXIO_BASIC_AUTH_PASSWORD');

const maxioClient = new Client({
  basicAuthCredentials: {
    username: maxioUsername,
    password: maxioPassword,
  },
  timeout: 120000,
  environment: Environment.US,
  site: maxioSite,
});

const customersController = new CustomersController(maxioClient);
const subscriptionsController = new SubscriptionsController(maxioClient);
const subscriptionStatusController = new SubscriptionStatusController(maxioClient);

// Simple HTTP server export to satisfy tests expecting a `server` value.
// The NestJS application is still bootstrapped via main.ts; this lightweight
// server is only used for test harnessing.
export const server = http.createServer();

/**
 * View all subscriptions with optional filtering by status and search by
 * customer name or email.
 */
export async function viewAllSubscriptions(
  filterStatus?: UiSubscriptionStatusFilter,
  searchQuery?: string,
): Promise<SubscriptionListItem[]> {
  const listOptions: Record<string, unknown> = {
    page: 1,
    perPage: 50,
  };

  if (filterStatus && filterStatus !== 'all') {
    listOptions.state = filterStatus;
  }

  try {
    const response = await subscriptionsController.listSubscriptions(listOptions as never);

    // `response.result` is expected to be an array of subscription wrapper objects
    // following the SDK's typings.
    let items: SubscriptionListItem[] = (response as any).result.map((sub: any) => {
      const subscription = sub.subscription ?? sub;
      const customer = subscription?.customer ?? (sub.customer ?? null);
      const product = subscription?.product ?? null;

      const id: number | string | null =
        subscription?.id ??
        sub.id ??
        null;

      const firstName = customer?.firstName ?? '';
      const lastName = customer?.lastName ?? '';
      const fullName = `${firstName} ${lastName}`.trim() || null;

      const email: string | null = customer?.email ?? null;

      const priceInCents: number | null =
        typeof subscription?.productPriceInCents === 'number'
          ? subscription.productPriceInCents
          : null;

      const nextBillingDate: string | null =
        subscription?.nextAssessmentAt ??
        subscription?.currentPeriodEndsAt ??
        null;

      return {
        id,
        customerName: fullName,
        customerEmail: email,
        plan: product?.name ?? null,
        status: subscription?.state ?? null,
        nextBillingDate,
        monthlyAmount: priceInCents !== null ? priceInCents / 100 : null,
        monthlyAmountCents: priceInCents,
      };
    });

    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      items = items.filter((item, index) => {
        const wrapper = (response as any).result[index];
        const subscription = wrapper.subscription ?? wrapper;
        const customer = subscription?.customer ?? wrapper.customer ?? null;
        const nameMatch =
          (item.customerName ?? '').toLowerCase().includes(query);
        const emailMatch =
          (customer?.email ?? '').toLowerCase().includes(query);
        return nameMatch || emailMatch;
      });
    }

    return items;
  } catch (error: any) {
    // eslint-disable-next-line no-console
    console.error('Maxio API error (viewAllSubscriptions)', error);
    throw error;
  }
}

/**
 * View a single subscription's details by its ID.
 */
export async function viewSubscriptionDetails(
  subscriptionId: string | number,
): Promise<SubscriptionDetails> {
  try {
    const idNumeric = Number(subscriptionId);
    const response = await subscriptionsController.readSubscription(idNumeric as never);
    const subscription = (response as any).result.subscription;
    const customer = subscription?.customer ?? null;
    const product = subscription?.product ?? null;

    const id: number | string | null = subscription?.id ?? null;

    const firstName = customer?.firstName ?? '';
    const lastName = customer?.lastName ?? '';
    const fullName = `${firstName} ${lastName}`.trim() || null;

    const priceInCents: number | null =
      typeof subscription?.productPriceInCents === 'number'
        ? subscription.productPriceInCents
        : null;

    const currentPeriodStartedAt: string | null =
      subscription?.currentPeriodStartedAt ?? null;

    const currentPeriodEndsAt: string | null =
      subscription?.currentPeriodEndsAt ?? null;

    const nextBillingDate: string | null =
      subscription?.nextAssessmentAt ??
      subscription?.currentPeriodEndsAt ??
      null;

    const paymentMethod: string | null =
      subscription?.creditCard?.cardType ??
      subscription?.paymentProfile?.cardType ??
      null;

    return {
      id,
      customerName: fullName,
      email: customer?.email ?? null,
      customerInfo: {
        name: fullName,
        email: customer?.email ?? null,
      },
      currentPlan: product?.name ?? null,
      price: priceInCents !== null ? priceInCents / 100 : null,
      status: subscription?.state ?? null,
      billingCycle: {
        currentPeriodStartedAt,
        currentPeriodEndsAt,
      },
      nextBillingDate,
      paymentMethod,
    };
  } catch (error: any) {
    // eslint-disable-next-line no-console
    console.error('Maxio API error (viewSubscriptionDetails)', error);
    throw error;
  }
}

// Backwards-compatible name expected by tests.
export async function getSubscriptionDetails(
  subscriptionId: string | number,
): Promise<SubscriptionDetails> {
  return viewSubscriptionDetails(subscriptionId);
}

/**
 * Change a subscription's plan, either immediately or at the next billing date.
 * Proration is handled automatically by Maxio when changing the product.
 */
export async function changeSubscriptionPlan(
  subscriptionId: string | number,
  newPlanId: string | number,
  changeTiming: ChangeSubscriptionWhen,
): Promise<any> {
  const body: UpdateSubscriptionRequest = {
    subscription: {
      productId: Number(newPlanId),
      // When true, the product change is delayed until the next billing date.
      productChangeDelayed: changeTiming === 'next_billing',
    },
  };

  try {
    const id = Number(subscriptionId);
    const response = await subscriptionsController.updateSubscription(
      id as never,
      body as never,
    );
    return (response as any).result.subscription;
  } catch (error: any) {
    // eslint-disable-next-line no-console
    console.error('Maxio API error (changeSubscriptionPlan)', error);
    throw error;
  }
}

/**
 * Cancel a subscription either immediately or at the end of the current period,
 * optionally recording a cancellation reason.
 */
export async function cancelSubscription(
  subscriptionId: string | number,
  cancelTiming: CancelSubscriptionWhen,
  reason?: string,
): Promise<string | undefined> {
  try {
    const id = Number(subscriptionId);

    if (cancelTiming === 'immediate' || cancelTiming === 'immediately') {
      const response = await subscriptionStatusController.cancelSubscription(
        id as never,
        {
          subscription: {
            cancellationMessage: reason,
          },
        } as never,
      );
      return (response as any).result?.message;
    }

    const response = await subscriptionStatusController.initiateDelayedCancellation(
      id as never,
    );
    return (response as any).result?.message;
  } catch (error: any) {
    // eslint-disable-next-line no-console
    console.error('Maxio API error (cancelSubscription)', error);
    throw error;
  }
}

// Backwards-compatible core function expected by tests.
export async function cancelSubscriptionCore(
  subscriptionId: string | number,
  cancelTiming: CancelSubscriptionWhen,
  reason?: string,
): Promise<string | undefined> {
  return cancelSubscription(subscriptionId, cancelTiming, reason);
}



