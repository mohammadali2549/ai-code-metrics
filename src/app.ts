import 'dotenv/config';
import * as http from 'http';

import {
  ApiError,
  Client,
  Environment,
  SubscriptionListInclude,
  SubscriptionSort,
  SubscriptionStateFilter,
  SubscriptionsController,
  SubscriptionInclude,
  SubscriptionProductsController,
  SubscriptionProductMigrationRequest,
  SubscriptionStatusController,
  SubscriptionNotesController,
  UpdateSubscriptionNoteRequest,
} from '@maxio-com/advanced-billing-sdk';

/**
 * Simple helper to read environment variables.
 * In local development, values are loaded from `.env` via dotenv.
 * In GitHub Actions, values come directly from the Actions environment.
 */
function getEnv(name: string): string | undefined {
  return process.env[name];
}

const MAXIO_SITE = getEnv('MAXIO_SITE') ?? '';
const MAXIO_BASIC_AUTH_USERNAME = getEnv('MAXIO_BASIC_AUTH_USERNAME') ?? '';
const MAXIO_BASIC_AUTH_PASSWORD = getEnv('MAXIO_BASIC_AUTH_PASSWORD') ?? '';

// Initialize Maxio Advanced Billing client
const client = new Client({
  basicAuthCredentials: {
    username: MAXIO_BASIC_AUTH_USERNAME,
    password: MAXIO_BASIC_AUTH_PASSWORD,
  },
  timeout: 120000,
  environment: Environment.US,
  site: MAXIO_SITE,
});

const subscriptionsController = new SubscriptionsController(client);
const subscriptionProductsController = new SubscriptionProductsController(client);
const subscriptionStatusController = new SubscriptionStatusController(client);
const subscriptionNotesController = new SubscriptionNotesController(client);

export type SubscriptionStatusFilterLabel =
  | 'active'
  | 'canceled'
  | 'past_due'
  | 'trialing';

export interface SubscriptionFilters {
  status?: SubscriptionStatusFilterLabel;
  search?: string;
}

export interface SubscriptionSummary {
  id?: number;
  customerName: string | null;
  customerEmail?: string | null;
  plan?: string | null;
  status?: string | null;
  nextBillingDate?: string | null;
  monthlyAmount?: number | null;
}

export interface SubscriptionBillingCycle {
  currentPeriodStartedAt: string | null;
  currentPeriodEndsAt: string | null;
}

export interface SubscriptionDetails {
  id?: number;
  customerInfo: {
    name: string | null;
    email: string | null | undefined;
  };
  currentPlan: string | null | undefined;
  price: number | null | undefined;
  subscriptionStatus: string | null | undefined;
  billingCycle: SubscriptionBillingCycle | null;
  nextBillingDate: string | null | undefined;
  paymentMethodOnFile: string | null | undefined;
}

function mapStatusToStateFilter(
  status?: SubscriptionStatusFilterLabel,
): SubscriptionStateFilter | undefined {
  if (!status) return undefined;
  return status as SubscriptionStateFilter;
}

function toLowerSafe(value: string | null | undefined): string {
  return (value ?? '').toLowerCase();
}

/**
 * View all subscriptions with optional status filter and search by
 * customer name or email.
 */
export async function viewAllSubscriptions(
  filtersOrStatus?: SubscriptionFilters | SubscriptionStatusFilterLabel,
  search?: string,
): Promise<SubscriptionSummary[]> {
  const effectiveFilters: SubscriptionFilters = {};

  if (typeof filtersOrStatus === 'string') {
    effectiveFilters.status = filtersOrStatus;
  } else if (filtersOrStatus) {
    Object.assign(effectiveFilters, filtersOrStatus);
  }

  if (typeof search === 'string' && search.trim()) {
    effectiveFilters.search = search;
  }

  const stateFilter = mapStatusToStateFilter(effectiveFilters.status);

  const params: {
    page: number;
    perPage: number;
    sort: SubscriptionSort;
    include: SubscriptionListInclude[];
    state?: SubscriptionStateFilter;
  } = {
    page: 1,
    perPage: 50,
    sort: SubscriptionSort.SignupDate,
    include: [SubscriptionListInclude.SelfServicePageToken],
  };

  if (stateFilter) {
    params.state = stateFilter;
  }

  try {
    const response = await subscriptionsController.listSubscriptions(params);
    const results = response.result ?? [];

    let filtered = results;
    const searchTerm = effectiveFilters.search
      ? effectiveFilters.search.trim().toLowerCase()
      : '';

    if (searchTerm) {
      filtered = results.filter((item) => {
        const subscription = item.subscription;
        const customer = subscription?.customer;
        const fullName = `${customer?.firstName ?? ''} ${customer?.lastName ?? ''}`.trim();

        return (
          toLowerSafe(fullName).includes(searchTerm) ||
          toLowerSafe(customer?.email).includes(searchTerm)
        );
      });
    }

    return filtered
      .map<SubscriptionSummary | null>((item) => {
        const subscription = item.subscription;
        if (!subscription) return null;

        const customer = subscription.customer;
        const product = subscription.product;

        const firstName = customer?.firstName ?? '';
        const lastName = customer?.lastName ?? '';
        const customerName = `${firstName} ${lastName}`.trim() || null;

        return {
          id: subscription.id ?? undefined,
          customerName,
          customerEmail: customer?.email,
          plan: product?.name ?? null,
          status: subscription.state ?? null,
          nextBillingDate:
            (subscription as any).nextAssessmentAt ??
            subscription.currentPeriodEndsAt ??
            null,
          monthlyAmount:
            subscription.productPriceInCents != null
              ? Number(subscription.productPriceInCents)
              : null,
        };
      })
      .filter((s): s is SubscriptionSummary => s !== null);
  } catch (error) {
    if (error instanceof ApiError) {
      // Log useful debugging information while still surfacing the error to callers/tests.
      // eslint-disable-next-line no-console
      console.error('Maxio listSubscriptions error', error.statusCode, error.body);
    }
    throw error;
  }
}

/**
 * View detailed information for a single subscription.
 */
export async function viewSubscriptionDetails(
  subscriptionId: number,
): Promise<SubscriptionDetails | null> {
  const include: SubscriptionInclude[] = [
    SubscriptionInclude.Coupons,
    SubscriptionInclude.SelfServicePageToken,
  ];

  try {
    const response = await subscriptionsController.readSubscription(subscriptionId, include);
    const subscription = response.result?.subscription;
    if (!subscription) {
      return null;
    }

    const customer = subscription.customer;
    const product = subscription.product;

    const firstName = customer?.firstName ?? '';
    const lastName = customer?.lastName ?? '';
    const name = `${firstName} ${lastName}`.trim() || null;

    const periodStart = subscription.currentPeriodStartedAt ?? null;
    const periodEnd = subscription.currentPeriodEndsAt ?? null;
    const billingCycle: SubscriptionBillingCycle | null =
      periodStart || periodEnd
        ? {
            currentPeriodStartedAt: periodStart,
            currentPeriodEndsAt: periodEnd,
          }
        : null;

    const nextBilling =
      (subscription as any).nextAssessmentAt ??
      subscription.currentPeriodEndsAt ??
      null;

    return {
      id: subscription.id ?? undefined,
      customerInfo: {
        name,
        email: customer?.email,
      },
      currentPlan: product?.name ?? null,
      price:
        subscription.productPriceInCents != null
          ? Number(subscription.productPriceInCents)
          : null,
      subscriptionStatus: subscription.state ?? null,
      billingCycle,
      nextBillingDate: nextBilling,
      paymentMethodOnFile: subscription.creditCard?.maskedCardNumber ?? null,
    };
  } catch (error) {
    if (error instanceof ApiError) {
      // eslint-disable-next-line no-console
      console.error('Maxio readSubscription error', error.statusCode, error.body);
    }
    throw error;
  }
}

export type PlanChangeTiming = 'immediately' | 'next_billing';

/**
 * Change a subscription's plan, either immediately or on the next billing cycle.
 */
export async function changeSubscriptionPlan(
  subscriptionId: number,
  newPlanId: number,
  timing: PlanChangeTiming,
) {
  const preservePeriod = timing === 'next_billing';

  const body: SubscriptionProductMigrationRequest = {
    migration: {
      productId: newPlanId,
      // Common defaults that keep behavior predictable for tests.
      includeTrial: false,
      includeInitialCharge: false,
      includeCoupons: true,
      preservePeriod,
    },
  };

  try {
    const response = await subscriptionProductsController.migrateSubscriptionProduct(
      subscriptionId,
      body,
    );
    return response.result?.subscription ?? null;
  } catch (error) {
    if (error instanceof ApiError) {
      // eslint-disable-next-line no-console
      console.error('Maxio migrateSubscriptionProduct error', error.statusCode, error.body);
    }
    throw error;
  }
}

export interface CancelSubscriptionOptions {
  immediate: boolean;
  reason?: string;
}

/**
 * Cancel a subscription immediately or at period end, optionally attaching a note.
 */
export async function cancelSubscription(
  subscriptionId: number,
  options: CancelSubscriptionOptions,
) {
  try {
    let cancelResponse;
    if (options.immediate) {
      cancelResponse = await subscriptionStatusController.cancelSubscription(
        subscriptionId,
      );
    } else {
      cancelResponse =
        await subscriptionStatusController.initiateDelayedCancellation(
          subscriptionId,
        );
    }

    if (options.reason) {
      const noteBody: UpdateSubscriptionNoteRequest = {
        note: {
          body: options.reason,
          sticky: true,
        },
      };

      await subscriptionNotesController.createSubscriptionNote(
        subscriptionId,
        noteBody,
      );
    }

    return cancelResponse.result?.subscription ?? null;
  } catch (error) {
    if (error instanceof ApiError) {
      // eslint-disable-next-line no-console
      console.error('Maxio cancelSubscription error', error.statusCode, error.body);
    }
    throw error;
  }
}

// ----- Test-facing aliases and helpers -----

// Types expected by tests
export type UiSubscriptionStatusFilter = SubscriptionStatusFilterLabel;
export type ChangeSubscriptionWhen = PlanChangeTiming;
export type CancelSubscriptionWhen = 'immediately' | 'period_end';

// Function aliases expected by tests
export const getSubscriptionDetails = viewSubscriptionDetails;

export async function cancelSubscriptionCore(
  subscriptionId: number,
  when: CancelSubscriptionWhen,
  reason?: string,
) {
  const immediate = when === 'immediately';
  return cancelSubscription(subscriptionId, { immediate, reason });
}

// Minimal HTTP server instance that tests can import.
export const server = http.createServer();
