import * as dotenv from 'dotenv';
import * as https from 'https';
import { URL } from 'url';

// Load environment variables from .env if available.
// If .env is missing (e.g. in GitHub Actions), process.env will still
// contain the injected environment variables and will be used instead.
let dotenvLoaded = false;

function loadDotenvOnce(): void {
  if (dotenvLoaded) return;
  dotenvLoaded = true;

  try {
    const result = dotenv.config();
    // Swallow the error when .env is absent; GitHub Actions will still
    // provide environment variables through process.env.
    if (result.error) {
      // Intentionally ignore – falling back to existing process.env only.
    }
  } catch {
    // If anything goes wrong, we still rely on process.env as-is.
  }
}

export interface MaxioConfig {
  MAXIO_SITE: string;
  MAXIO_BASIC_AUTH_USERNAME: string;
  MAXIO_BASIC_AUTH_PASSWORD: string;
}

function getMaxioConfig(): MaxioConfig {
  loadDotenvOnce();

  const {
    MAXIO_SITE,
    MAXIO_BASIC_AUTH_USERNAME,
    MAXIO_BASIC_AUTH_PASSWORD,
  } = process.env;

  if (!MAXIO_SITE || !MAXIO_BASIC_AUTH_USERNAME || !MAXIO_BASIC_AUTH_PASSWORD) {
    throw new Error(
      'Missing required Maxio environment variables (MAXIO_SITE, MAXIO_BASIC_AUTH_USERNAME, MAXIO_BASIC_AUTH_PASSWORD).',
    );
  }

  return {
    MAXIO_SITE,
    MAXIO_BASIC_AUTH_USERNAME,
    MAXIO_BASIC_AUTH_PASSWORD,
  };
}

type SubscriptionStatus = 'active' | 'canceled' | 'past_due' | 'trial';

export interface SubscriptionSummary {
  id: string;
  customerName: string;
  customerEmail: string;
  plan: string;
  status: SubscriptionStatus;
  nextBillingDate: string | null;
  monthlyAmount: number;
}

export interface PaymentMethod {
  brand: string;
  last4: string;
  expiryMonth: number;
  expiryYear: number;
}

export interface SubscriptionDetails {
  id: string;
  customerName: string;
  customerEmail: string;
  plan: string;
  price: number;
  status: SubscriptionStatus;
  billingCycle: string;
  nextBillingDate: string | null;
  paymentMethod: PaymentMethod | null;
}

export interface ChangePlanOptions {
  /**
   * When the plan change should take effect.
   * - "immediately": change the plan right away.
   * - "next_billing": schedule the change for the next billing date.
   */
  effectiveAt?: 'immediately' | 'next_billing';
}

export interface CancelSubscriptionOptions {
  /**
   * When the cancellation should happen.
   * - "immediately": cancel right away.
   * - "period_end": cancel at the end of the current billing period.
   */
  cancelAt?: 'immediately' | 'period_end';
  /**
   * Optional reason or note for the cancellation.
   */
  reason?: string;
}

interface MaxioRequestOptions {
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  path: string;
  body?: unknown;
}

async function maxioRequest<T>(options: MaxioRequestOptions): Promise<T> {
  const config = getMaxioConfig();
  const baseUrl = new URL(config.MAXIO_SITE);

  const path =
    baseUrl.pathname.replace(/\/$/, '') + (options.path.startsWith('/') ? options.path : `/${options.path}`);

  const authHeader = Buffer.from(
    `${config.MAXIO_BASIC_AUTH_USERNAME}:${config.MAXIO_BASIC_AUTH_PASSWORD}`,
  ).toString('base64');

  const requestOptions: https.RequestOptions = {
    protocol: baseUrl.protocol,
    hostname: baseUrl.hostname,
    port: baseUrl.port ? Number(baseUrl.port) : 443,
    path,
    method: options.method,
    headers: {
      Authorization: `Basic ${authHeader}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
  };

  const payload = options.body ? JSON.stringify(options.body) : undefined;
  if (payload && requestOptions.headers) {
    requestOptions.headers['Content-Length'] = Buffer.byteLength(payload);
  }

  return new Promise<T>((resolve, reject) => {
    const req = https.request(requestOptions, (res) => {
      const chunks: Buffer[] = [];

      res.on('data', (chunk: Buffer) => {
        chunks.push(chunk);
      });

      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');

        if (res.statusCode && res.statusCode >= 400) {
          reject(
            new Error(
              `Maxio API request failed with status ${res.statusCode}${
                raw ? ` and body: ${raw}` : ''
              }`,
            ),
          );
          return;
        }

        if (!raw) {
          // No content
          resolve(undefined as unknown as T);
          return;
        }

        try {
          const parsed = JSON.parse(raw);
          resolve(parsed as T);
        } catch (err) {
          reject(
            new Error(
              `Failed to parse Maxio API response as JSON: ${(err as Error).message}`,
            ),
          );
        }
      });
    });

    req.on('error', (err) => {
      reject(err);
    });

    if (payload) {
      req.write(payload);
    }

    req.end();
  });
}

export interface ViewAllSubscriptionsOptions {
  /**
   * Filter subscriptions by status: Active, Canceled, Past Due, Trial.
   */
  status?: SubscriptionStatus;
  /**
   * Search by customer name or email.
   */
  search?: string;
}

/**
 * View all subscriptions with optional filtering by status and search term.
 *
 * This function is designed to be invoked directly by tests in `tests/app.test.ts`.
 */
export async function viewAllSubscriptions(
  options: ViewAllSubscriptionsOptions = {},
): Promise<SubscriptionSummary[]> {
  const params = new URLSearchParams();

  if (options.status) {
    params.set('status', options.status);
  }

  if (options.search) {
    params.set('search', options.search);
  }

  const query = params.toString();
  const path = `/subscriptions${query ? `?${query}` : ''}`;

  const response = await maxioRequest<SubscriptionSummary[]>({
    method: 'GET',
    path,
  });

  return response;
}

/**
 * View detailed information about a single subscription.
 *
 * Returns customer info, current plan and price, subscription status,
 * billing cycle and next billing date, and the payment method on file.
 */
export async function viewSubscriptionDetails(
  subscriptionId: string,
): Promise<SubscriptionDetails> {
  if (!subscriptionId) {
    throw new Error('subscriptionId is required');
  }

  const path = `/subscriptions/${encodeURIComponent(subscriptionId)}`;

  const response = await maxioRequest<SubscriptionDetails>({
    method: 'GET',
    path,
  });

  return response;
}

/**
 * Change a customer's subscription plan.
 *
 * Supports upgrading or downgrading to a different plan and allows
 * the caller to specify whether the change should take effect
 * immediately or on the next billing date. Proration is delegated
 * to the Maxio billing platform and is always enabled.
 */
export async function changeSubscriptionPlan(
  subscriptionId: string,
  newPlanId: string,
  options: ChangePlanOptions = {},
): Promise<SubscriptionDetails> {
  if (!subscriptionId) {
    throw new Error('subscriptionId is required');
  }

  if (!newPlanId) {
    throw new Error('newPlanId is required');
  }

  const path = `/subscriptions/${encodeURIComponent(subscriptionId)}/plan`;

  const body = {
    planId: newPlanId,
    effectiveAt: options.effectiveAt ?? 'immediately',
    // Rely on Maxio to handle proration automatically when this flag is enabled.
    proration: true,
  };

  const response = await maxioRequest<SubscriptionDetails>({
    method: 'PATCH',
    path,
    body,
  });

  return response;
}

/**
 * Cancel a customer's subscription.
 *
 * Allows the admin to cancel immediately or at the end of the current
 * billing period, and to attach an optional cancellation reason/note.
 */
export async function cancelSubscription(
  subscriptionId: string,
  options: CancelSubscriptionOptions = {},
): Promise<SubscriptionDetails> {
  if (!subscriptionId) {
    throw new Error('subscriptionId is required');
  }

  const path = `/subscriptions/${encodeURIComponent(subscriptionId)}/cancel`;

  const body = {
    cancelAt: options.cancelAt ?? 'immediately',
    reason: options.reason,
  };

  const response = await maxioRequest<SubscriptionDetails>({
    method: 'POST',
    path,
    body,
  });

  return response;
}


