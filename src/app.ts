import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import * as express from 'express';

/**
 * Configuration required to talk to Maxio.
 */
interface MaxioConfig {
  site: string;
  username: string;
  password: string;
}

let cachedConfig: MaxioConfig | null = null;

/**
 * Load environment variables either from a local .env file (when present)
 * or from the process environment (e.g. GitHub Actions).
 *
 * This satisfies the requirement to read MAXIO_* variables from both .env
 * and the GitHub Actions environment.
 */
function loadMaxioConfig(): MaxioConfig {
  if (cachedConfig) {
    return cachedConfig;
  }

  const envPath = path.resolve(process.cwd(), '.env');
  if (fs.existsSync(envPath)) {
    // Local development: hydrate process.env from .env
    dotenv.config({ path: envPath });
  } else {
    // CI (e.g. GitHub Actions): rely solely on process.env values that
    // are already populated by the workflow environment.
  }

  const site = process.env.MAXIO_SITE;
  const username = process.env.MAXIO_BASIC_AUTH_USERNAME;
  const password = process.env.MAXIO_BASIC_AUTH_PASSWORD;

  if (!site || !username || !password) {
    throw new Error(
      'Missing Maxio configuration. Ensure MAXIO_SITE, MAXIO_BASIC_AUTH_USERNAME and MAXIO_BASIC_AUTH_PASSWORD are set.',
    );
  }

  cachedConfig = {
    site,
    username,
    password,
  };

  return cachedConfig;
}

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

interface MaxioRequestOptions {
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
}

function buildBaseUrl(config: MaxioConfig): string {
  // If the site already includes protocol, respect it; otherwise assume that
  // the value is the Maxio site subdomain and construct the Chargify URL.
  if (config.site.startsWith('http://') || config.site.startsWith('https://')) {
    return config.site.replace(/\/+$/, '');
  }

  return `https://${config.site}.chargify.com`;
}

/**
 * Low-level helper that performs an HTTP request against the Maxio API.
 */
async function maxioRequest<T>(
  method: HttpMethod,
  path: string,
  options: MaxioRequestOptions = {},
): Promise<T> {
  const config = loadMaxioConfig();
  const baseUrl = buildBaseUrl(config);
  const url = new URL(path, baseUrl);

  if (options.query) {
    for (const [key, value] of Object.entries(options.query)) {
      if (value === undefined || value === null || value === '') {
        continue;
      }
      url.searchParams.append(key, String(value));
    }
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Basic ${Buffer.from(
      `${config.username}:${config.password}`,
    ).toString('base64')}`,
  };

  // Use the global fetch implementation available in modern Node versions.
  const fetchFn: typeof fetch | undefined = (globalThis as any).fetch;
  if (!fetchFn) {
    throw new Error('Global fetch is not available in this Node environment.');
  }

  const response = await fetchFn(url.toString(), {
    method,
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => '');
    throw new Error(
      `Maxio request failed with status ${response.status}: ${errorBody}`,
    );
  }

  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    // Some destructive actions may not respond with JSON, so surface an
    // undefined payload rather than failing to parse.
    return (undefined as unknown) as T;
  }

  return (await response.json()) as T;
}

// Data structures returned to callers / unit tests.

export interface SubscriptionSummary {
  id: number;
  customerName: string;
  customerEmail: string;
  plan: string;
  status: string;
  nextBillingDate: string | null;
  monthlyAmount: number;
  monthlyAmountCents: number;
}

export interface SubscriptionBillingCycle {
  currentPeriodStartedAt: string | null;
  currentPeriodEndsAt: string | null;
}

export interface SubscriptionDetails {
  id: number;
  customerInfo: {
    name: string;
    email: string;
  };
  currentPlan: string;
  price: number;
  status: string;
  billingCycle: SubscriptionBillingCycle;
  nextBillingDate: string | null;
  paymentMethod: string | null;
}

// Types that tests can import for status filtering and timing options.

export type UiSubscriptionStatusFilter =
  | 'active'
  | 'canceled'
  | 'past_due'
  | 'trialing';

export type ChangeSubscriptionWhen = 'immediate' | 'delayed';

export type CancelSubscriptionWhen = 'immediate' | 'delayed';

/**
 * View all subscriptions with optional status filter and search.
 *
 * - status: 'active' | 'canceled' | 'past_due' | 'trialing'
 * - search: free-text query for customer name or email.
 */
export async function listSubscriptions(
  status?: UiSubscriptionStatusFilter,
  search?: string,
): Promise<SubscriptionSummary[]> {
  type RawSubscription = {
    subscription: {
      id: number;
      state: string;
      next_billing_at: string | null;
      product_price_in_cents: number;
      product: { name: string };
      customer: {
        first_name: string;
        last_name: string;
        email: string;
      };
    };
  };

  const data = await maxioRequest<RawSubscription[]>('GET', '/subscriptions.json', {
    query: {
      status,
      q: search,
    },
  });

  return data.map((wrapper) => {
    const sub = wrapper.subscription;
    const name = `${sub.customer.first_name || ''} ${
      sub.customer.last_name || ''
    }`.trim();

    return {
      id: sub.id,
      customerName: name,
      customerEmail: sub.customer.email,
      plan: sub.product?.name,
      status: sub.state,
      nextBillingDate: sub.next_billing_at,
      monthlyAmount: sub.product_price_in_cents / 100,
      monthlyAmountCents: sub.product_price_in_cents,
    };
  });
}

/**
 * Convenience wrapper expected by tests to "view all subscriptions" from a
 * UI-style filter.
 */
export async function viewAllSubscriptions(
  status?: UiSubscriptionStatusFilter,
  search?: string,
): Promise<SubscriptionSummary[]> {
  return listSubscriptions(status, search);
}

/**
 * View a single subscription's detailed information.
 */
export async function getSubscriptionDetails(
  subscriptionId: number,
): Promise<SubscriptionDetails> {
  type RawDetailsResponse = {
    subscription: {
      id: number;
      state: string;
      next_billing_at: string | null;
      current_period_started_at: string | null;
      current_period_ends_at: string | null;
      product_price_in_cents: number;
      payment_collection_method?: string | null;
      product: { name: string };
      customer: {
        first_name: string;
        last_name: string;
        email: string;
      };
    };
  };

  const data = await maxioRequest<RawDetailsResponse>(
    'GET',
    `/subscriptions/${subscriptionId}.json`,
  );

  const sub = data.subscription;
  const name = `${sub.customer.first_name || ''} ${
    sub.customer.last_name || ''
  }`.trim();

  return {
    id: sub.id,
    customerInfo: {
      name,
      email: sub.customer.email,
    },
    currentPlan: sub.product?.name,
    price: sub.product_price_in_cents / 100,
    status: sub.state,
    billingCycle: {
      currentPeriodStartedAt: sub.current_period_started_at,
      currentPeriodEndsAt: sub.current_period_ends_at,
    },
    nextBillingDate: sub.next_billing_at,
    paymentMethod: sub.payment_collection_method ?? null,
  };
}

/**
 * Change a subscription's plan (upgrade or downgrade).
 *
 * changeTiming:
 *  - 'immediate' – apply change immediately, charging prorated amount.
 *  - 'delayed'   – schedule change for next billing period.
 */
export async function changeSubscriptionPlan(
  subscriptionId: number,
  newProductId: number,
  changeTiming: ChangeSubscriptionWhen,
): Promise<unknown> {
  const body = {
    migration: {
      product_id: newProductId,
      include_trial: false,
      include_initial_charge: changeTiming === 'immediate',
      preserve_period: changeTiming === 'delayed',
    },
  };

  return maxioRequest<unknown>(
    'POST',
    `/subscriptions/${subscriptionId}/migrations.json`,
    { body },
  );
}

/**
 * Cancel a subscription.
 *
 * cancelTiming:
 *  - 'immediate' – cancel right away.
 *  - 'delayed'   – cancel at the end of the current period.
 *
 * A cancellation message can be provided for audit or reporting purposes.
 */
export async function cancelSubscription(
  subscriptionId: number,
  cancelTiming: CancelSubscriptionWhen,
  cancellationMessage?: string,
): Promise<unknown> {
  const body = {
    subscription: {
      cancel_at_end_of_period: cancelTiming === 'delayed',
      cancellation_message: cancellationMessage,
    },
  };

  return maxioRequest<unknown>(
    'DELETE',
    `/subscriptions/${subscriptionId}.json`,
    { body },
  );
}

/**
 * Convenience wrapper expected by tests for cancelling a subscription from the
 * "core" logic layer.
 */
export async function cancelSubscriptionCore(
  subscriptionId: number,
  cancelTiming: CancelSubscriptionWhen,
  cancellationMessage?: string,
): Promise<unknown> {
  return cancelSubscription(subscriptionId, cancelTiming, cancellationMessage);
}

/**
 * Minimal Express server instance that tests can import. This represents the
 * landing page / subscription view entry point when used with a frontend.
 */
export const server = express();



