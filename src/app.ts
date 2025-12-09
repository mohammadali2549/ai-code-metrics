import { config as loadEnv } from 'dotenv';
import {
  ApiError,
  Client,
  Environment,
  SubscriptionsController,
  SubscriptionStatusController,
} from '@maxio-com/advanced-billing-sdk';

// Load environment variables from .env when available.
// In GitHub Actions (or any CI), values should already be present in process.env.
loadEnv();

const MAXIO_SITE = process.env.MAXIO_SITE;
const MAXIO_BASIC_AUTH_USERNAME = process.env.MAXIO_BASIC_AUTH_USERNAME;
const MAXIO_BASIC_AUTH_PASSWORD = process.env.MAXIO_BASIC_AUTH_PASSWORD;

function assertEnvConfigured(): void {
  if (!MAXIO_SITE || !MAXIO_BASIC_AUTH_USERNAME || !MAXIO_BASIC_AUTH_PASSWORD) {
    throw new Error(
      'Maxio configuration missing. Please set MAXIO_SITE, MAXIO_BASIC_AUTH_USERNAME and MAXIO_BASIC_AUTH_PASSWORD environment variables.',
    );
  }
}

function createMaxioClient(): Client {
  assertEnvConfigured();

  return new Client({
    basicAuthCredentials: {
      username: MAXIO_BASIC_AUTH_USERNAME as string,
      password: MAXIO_BASIC_AUTH_PASSWORD as string,
    },
    timeout: 120000,
    // Adjust environment via additional env var if you need EU or other regions.
    environment: Environment.US,
    site: MAXIO_SITE as string,
  });
}

// Lazily created singleton client and controllers so tests and runtime code
// can reuse the same underlying configuration.
let cachedClient: Client | null = null;
let cachedSubscriptionsController: SubscriptionsController | null = null;
let cachedSubscriptionStatusController: SubscriptionStatusController | null = null;

function getClient(): Client {
  if (!cachedClient) {
    cachedClient = createMaxioClient();
  }
  return cachedClient;
}

function getSubscriptionsController(): SubscriptionsController {
  if (!cachedSubscriptionsController) {
    cachedSubscriptionsController = new SubscriptionsController(getClient());
  }
  return cachedSubscriptionsController;
}

function getSubscriptionStatusController(): SubscriptionStatusController {
  if (!cachedSubscriptionStatusController) {
    cachedSubscriptionStatusController = new SubscriptionStatusController(getClient());
  }
  return cachedSubscriptionStatusController;
}

function handleApiError(error: unknown): never {
  if (error instanceof ApiError) {
    // Log a concise error; details can be inspected in logs when debugging.
    // eslint-disable-next-line no-console
    console.error('Maxio API Error:', error.statusCode, error.body);
    throw new Error(`Maxio API Error: ${error.statusCode}`);
  }

  if (error instanceof Error) {
    throw error;
  }

  throw new Error('Unknown error while calling Maxio API');
}

function normalizeId(value: unknown): number | string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value === 'bigint') {
    return value.toString();
  }
  return value as number | string;
}

function normalizeNullableNumber(value: unknown): number | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value === 'bigint') {
    return Number(value);
  }
  if (typeof value === 'number') {
    return value;
  }
  const parsed = Number(value);
  return Number.isNaN(parsed) ? null : parsed;
}

export type SubscriptionStatusFilter = 'active' | 'canceled' | 'past_due' | 'trialing';

export interface SubscriptionListItem {
  id: number | string | undefined;
  customerName: string;
  customerEmail?: string;
  plan?: string;
  status?: string;
  nextBillingDate?: string | null;
  monthlyAmountInCents?: number | null;
}

export interface SubscriptionDetails {
  id: number | string | undefined;
  customerName: string;
  customerEmail?: string;
  customerInfo: {
    name: string;
    email?: string;
  };
  currentPlan?: string;
  currentPriceCents?: number | null;
  status?: string;
  billingCycle?: {
    currentPeriodStartedAt?: string | null;
    currentPeriodEndsAt?: string | null;
    nextBillingAt?: string | null;
  };
  nextBillingDate?: string | null;
  paymentMethod?: string | null;
}

export interface ChangeSubscriptionPlanResult {
  id: number | string | undefined;
  currentPlan?: string;
  status?: string;
}

export interface CancelSubscriptionResult {
  id?: number | string;
  status?: string;
  message?: string;
}

export async function viewAllSubscriptions(
  status?: SubscriptionStatusFilter,
  searchQuery?: string,
): Promise<SubscriptionListItem[]> {
  try {
    const controller = getSubscriptionsController();

    const params: any = {
      page: 1,
      perPage: 50,
    };

    if (status) {
      params.state = status;
    }

    if (searchQuery && searchQuery.trim().length > 0) {
      params.q = searchQuery.trim();
    }

    const response = await controller.listSubscriptions(params as any);
    const items = (response as any).result as any[];

    if (!Array.isArray(items)) {
      return [];
    }

    return items.map((item) => {
      const subscription = item.subscription ?? {};
      const customer = subscription.customer ?? {};
      const product = subscription.product ?? {};

      const customerName = [customer.firstName, customer.lastName].filter(Boolean).join(' ').trim();

      return {
        id: normalizeId(subscription.id),
        customerName,
        customerEmail: customer.email,
        plan: product.name,
        status: subscription.state,
        nextBillingDate: subscription.nextAssessmentAt ?? subscription.currentPeriodEndsAt ?? null,
        monthlyAmountInCents: normalizeNullableNumber(subscription.productPriceInCents),
      };
    });
  } catch (error) {
    handleApiError(error);
  }
}

export async function viewSubscriptionDetails(subscriptionId: number): Promise<SubscriptionDetails> {
  try {
    const controller = getSubscriptionsController();
    const response = await controller.readSubscription(subscriptionId);
    const subscription = (response as any).result?.subscription ?? {};
    const customer = subscription.customer ?? {};
    const product = subscription.product ?? {};

    const customerName = [customer.firstName, customer.lastName].filter(Boolean).join(' ').trim();

    return {
      id: normalizeId(subscription.id),
      customerName,
      customerEmail: customer.email,
      customerInfo: {
        name: customerName,
        email: customer.email,
      },
      currentPlan: product.name,
      currentPriceCents: normalizeNullableNumber(subscription.productPriceInCents),
      status: subscription.state,
      billingCycle: {
        currentPeriodStartedAt: subscription.currentPeriodStartedAt ?? null,
        currentPeriodEndsAt: subscription.currentPeriodEndsAt ?? null,
        nextBillingAt: subscription.nextAssessmentAt ?? null,
      },
      nextBillingDate: subscription.nextAssessmentAt ?? null,
      paymentMethod: subscription.paymentType ?? null,
    };
  } catch (error) {
    handleApiError(error);
  }
}

export async function changeSubscriptionPlan(
  subscriptionId: number,
  targetProductId: number,
  when: boolean | ChangeSubscriptionWhen,
): Promise<ChangeSubscriptionPlanResult> {
  try {
    const controller = getSubscriptionsController();

    const immediate = typeof when === 'boolean' ? when : when === 'immediately';

    const body: any = {
      subscription: {
        productId: targetProductId,
        // When false, the change takes effect immediately.
        // When true, the change is delayed until next billing.
        productChangeDelayed: !immediate,
      },
    };

    const response = await controller.updateSubscription(subscriptionId, body as any);
    const subscription = (response as any).result?.subscription ?? {};
    const product = subscription.product ?? {};

    return {
      id: normalizeId(subscription.id),
      currentPlan: product.name,
      status: subscription.state,
    };
  } catch (error) {
    handleApiError(error);
  }
}

export async function cancelSubscription(
  subscriptionId: number,
  when: boolean | CancelSubscriptionWhen,
  cancellationReason?: string,
): Promise<CancelSubscriptionResult> {
  try {
    const controller = getSubscriptionStatusController();

    const immediate = typeof when === 'boolean' ? when : when === 'immediately';

    if (immediate) {
      const body: any = {
        subscription: {
          cancellationMessage: cancellationReason,
        },
      };

      const response = await controller.cancelSubscription(subscriptionId, body as any);
      const subscription = (response as any).result?.subscription ?? {};

      return {
        id: normalizeId(subscription.id),
        status: subscription.state,
      };
    }

    const response = await controller.initiateDelayedCancellation(subscriptionId);
    const result = (response as any).result ?? {};

    return {
      message: result.message ?? 'Cancellation scheduled at period end',
    };
  } catch (error) {
    handleApiError(error);
  }
}

// ---------------------------------------------------------------------------
// Exports used by app.test.ts
// ---------------------------------------------------------------------------

// UI-focused filter type that tests can import. Includes a potential "all"
// option alongside the Maxio-backed status filters.
export type UiSubscriptionStatusFilter = 'all' | SubscriptionStatusFilter;

export type ChangeSubscriptionWhen = 'immediately' | 'next_billing';

export type CancelSubscriptionWhen = 'immediately' | 'period_end';

// Backwards-compatible aliases for test imports.
export const getSubscriptionDetails = viewSubscriptionDetails;

export const cancelSubscriptionCore = cancelSubscription;

// Placeholder export for server so tests that import it can compile without
// requiring a running HTTP server instance.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const server: any = undefined;


