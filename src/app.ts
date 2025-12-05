import * as fs from 'fs';
import * as dotenv from 'dotenv';
import * as express from 'express';
import * as cors from 'cors';

/**
 * Environment configuration
 *
 * The application first tries to load values from a local `.env` file.
 * If the file is not present, it relies on environment variables provided
 * by the runtime environment (e.g. GitHub Actions).
 */
export interface MaxioEnvironment {
  readonly maxioSite: string | undefined;
  readonly maxioBasicAuthUsername: string | undefined;
  readonly maxioBasicAuthPassword: string | undefined;
  readonly loadedFromEnvFile: boolean;
}

function loadMaxioEnvironment(): MaxioEnvironment {
  const envPath = '.env';
  let loadedFromEnvFile = false;

  if (fs.existsSync(envPath)) {
    const result = dotenv.config({ path: envPath });
    if (!result.error) {
      loadedFromEnvFile = true;
    }
  }

  return {
    maxioSite: process.env.MAXIO_SITE,
    maxioBasicAuthUsername: process.env.MAXIO_BASIC_AUTH_USERNAME,
    maxioBasicAuthPassword: process.env.MAXIO_BASIC_AUTH_PASSWORD,
    loadedFromEnvFile,
  };
}

export const maxioEnvironment: MaxioEnvironment = loadMaxioEnvironment();

// ---------------------------------------------------------------------------
// Domain models
// ---------------------------------------------------------------------------

export type SubscriptionStatus = 'active' | 'canceled' | 'past_due' | 'trial';

export interface Customer {
  readonly id: string;
  readonly name: string;
  readonly email: string;
}

export interface PaymentMethod {
  readonly type: 'card';
  readonly cardBrand: string;
  readonly last4: string;
  readonly expMonth: number;
  readonly expYear: number;
}

export interface Plan {
  readonly id: string;
  readonly name: string;
  readonly monthlyAmount: number; // in major currency units, e.g. USD
}

export interface Subscription {
  readonly id: string;
  readonly customer: Customer;
  readonly plan: Plan;
  readonly status: SubscriptionStatus;
  readonly nextBillingDate: string | null; // ISO8601 date string
  readonly billingInterval: 'month';
  readonly billingIntervalCount: number;
  readonly monthlyAmount: number;
  readonly paymentMethod: PaymentMethod | null;
  readonly cancelAtPeriodEnd: boolean;
  readonly cancellationReason: string | null;
}

export interface SubscriptionSummary {
  readonly id: string;
  readonly customerName: string;
  readonly customerEmail: string;
  readonly planName: string;
  readonly plan: string;
  readonly status: SubscriptionStatus;
  readonly nextBillingDate: string | null;
  readonly monthlyAmount: number;
}

// Types and aliases expected by tests
export type UiSubscriptionStatusFilter = SubscriptionStatus;

export type ChangeSubscriptionWhen = 'immediately' | 'next_billing';

export type CancelSubscriptionWhen = 'immediately' | 'period_end';

// ---------------------------------------------------------------------------
// In-memory data store (placeholder for Maxio API integration)
// ---------------------------------------------------------------------------

const plans: Plan[] = [
  { id: 'basic', name: 'Basic', monthlyAmount: 29 },
  { id: 'pro', name: 'Pro', monthlyAmount: 79 },
  { id: 'enterprise', name: 'Enterprise', monthlyAmount: 199 },
];

function findPlanById(planId: string): Plan | undefined {
  return plans.find((plan) => plan.id === planId);
}

let subscriptions: Subscription[] = [
  {
    id: 'sub_1',
    customer: { id: 'cust_1', name: 'Alice Johnson', email: 'alice@example.com' },
    plan: plans[0]!,
    status: 'active',
    nextBillingDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    billingInterval: 'month',
    billingIntervalCount: 1,
    monthlyAmount: plans[0]!.monthlyAmount,
    paymentMethod: {
      type: 'card',
      cardBrand: 'Visa',
      last4: '4242',
      expMonth: 12,
      expYear: new Date().getFullYear() + 2,
    },
    cancelAtPeriodEnd: false,
    cancellationReason: null,
  },
  {
    id: 'sub_2',
    customer: { id: 'cust_2', name: 'Bob Smith', email: 'bob.smith@example.com' },
    plan: plans[1]!,
    status: 'past_due',
    nextBillingDate: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
    billingInterval: 'month',
    billingIntervalCount: 1,
    monthlyAmount: plans[1]!.monthlyAmount,
    paymentMethod: {
      type: 'card',
      cardBrand: 'Mastercard',
      last4: '1111',
      expMonth: 6,
      expYear: new Date().getFullYear() + 1,
    },
    cancelAtPeriodEnd: false,
    cancellationReason: null,
  },
  {
    id: 'sub_3',
    customer: { id: 'cust_3', name: 'Charlie Davis', email: 'charlie@example.com' },
    plan: plans[2]!,
    status: 'trial',
    nextBillingDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
    billingInterval: 'month',
    billingIntervalCount: 1,
    monthlyAmount: plans[2]!.monthlyAmount,
    paymentMethod: null,
    cancelAtPeriodEnd: false,
    cancellationReason: null,
  },
];

// ---------------------------------------------------------------------------
// Core subscription operations (exported for tests)
// ---------------------------------------------------------------------------

export interface ViewAllSubscriptionsOptions {
  status?: SubscriptionStatus;
  search?: string;
}

export async function viewAllSubscriptions(): Promise<SubscriptionSummary[]>;
export async function viewAllSubscriptions(
  options: ViewAllSubscriptionsOptions,
): Promise<SubscriptionSummary[]>;
export async function viewAllSubscriptions(
  status: UiSubscriptionStatusFilter | undefined,
  search: string,
): Promise<SubscriptionSummary[]>;
export async function viewAllSubscriptions(
  arg1?: ViewAllSubscriptionsOptions | UiSubscriptionStatusFilter,
  arg2?: string,
): Promise<SubscriptionSummary[]> {
  let status: SubscriptionStatus | undefined;
  let search: string | undefined;

  if (typeof arg1 === 'string' || (arg1 === undefined && typeof arg2 === 'string')) {
    status = typeof arg1 === 'string' ? (arg1 as SubscriptionStatus) : undefined;
    search = arg2;
  } else if (typeof arg1 === 'object' && arg1 !== null) {
    status = arg1.status;
    search = arg1.search;
  }

  let filtered = subscriptions;

  if (status) {
    filtered = filtered.filter((subscription) => subscription.status === status);
  }

  if (search) {
    const term = search.trim().toLowerCase();
    if (term.length > 0) {
      filtered = filtered.filter((subscription) => {
        const name = subscription.customer.name.toLowerCase();
        const email = subscription.customer.email.toLowerCase();
        return name.includes(term) || email.includes(term);
      });
    }
  }

  return filtered.map((subscription) => ({
    id: subscription.id,
    customerName: subscription.customer.name,
    customerEmail: subscription.customer.email,
    planName: subscription.plan.name,
    plan: subscription.plan.name,
    status: subscription.status,
    nextBillingDate: subscription.nextBillingDate,
    monthlyAmount: subscription.monthlyAmount,
  }));
}

export async function viewSubscriptionDetails(
  subscriptionId: string,
): Promise<Subscription | undefined> {
  return subscriptions.find((subscription) => subscription.id === subscriptionId);
}

// Alias expected by tests
export async function getSubscriptionDetails(
  subscriptionId: string,
): Promise<Subscription | undefined> {
  return viewSubscriptionDetails(subscriptionId);
}

export interface ChangeSubscriptionPlanOptions {
  effectiveAt?: ChangeSubscriptionWhen;
}

export async function changeSubscriptionPlan(
  subscriptionId: string,
  newPlanId: string,
  options?: ChangeSubscriptionPlanOptions,
): Promise<Subscription | undefined>;

export async function changeSubscriptionPlan(
  subscriptionId: string,
  planIndex: number,
  when: ChangeSubscriptionWhen,
): Promise<Subscription | undefined>;

export async function changeSubscriptionPlan(
  subscriptionId: string,
  newPlanOrIndex: string | number,
  optionsOrWhen?: ChangeSubscriptionPlanOptions | ChangeSubscriptionWhen,
): Promise<Subscription | undefined> {
  let plan: Plan | undefined;

  if (typeof newPlanOrIndex === 'number') {
    plan = plans[newPlanOrIndex];
  } else {
    plan = findPlanById(newPlanOrIndex);
  }

  if (!plan) {
    return undefined;
  }

  const index = subscriptions.findIndex((subscription) => subscription.id === subscriptionId);
  if (index === -1) {
    return undefined;
  }

  const current = subscriptions[index];
  if (!current) {
    return undefined;
  }

  let effectiveAt: ChangeSubscriptionWhen = 'immediately';
  if (typeof optionsOrWhen === 'string') {
    effectiveAt = optionsOrWhen;
  } else if (optionsOrWhen && optionsOrWhen.effectiveAt) {
    effectiveAt = optionsOrWhen.effectiveAt;
  }

  // For this example implementation, we simply update the plan and monthly
  // amount. In a real Maxio integration, proration would be handled by the
  // billing provider when changing the subscription's product.
  let nextBillingDate = current.nextBillingDate;

  if (effectiveAt === 'immediately') {
    // If the change takes effect immediately, keep the existing next billing
    // date but update the plan and price now.
    nextBillingDate = current.nextBillingDate;
  }

  const updated: Subscription = {
    id: current.id,
    customer: current.customer,
    plan,
    status: current.status,
    nextBillingDate,
    billingInterval: current.billingInterval,
    billingIntervalCount: current.billingIntervalCount,
    monthlyAmount: plan.monthlyAmount,
    paymentMethod: current.paymentMethod,
    cancelAtPeriodEnd: current.cancelAtPeriodEnd,
    cancellationReason: current.cancellationReason,
  };

  subscriptions = [
    ...subscriptions.slice(0, index),
    updated,
    ...subscriptions.slice(index + 1),
  ];

  return updated;
}

export interface CancelSubscriptionOptions {
  cancelAtPeriodEnd?: boolean;
  reason?: string;
}

export async function cancelSubscription(
  subscriptionId: string,
  options?: CancelSubscriptionOptions,
): Promise<Subscription | undefined>;

export async function cancelSubscription(
  subscriptionId: string,
  when: CancelSubscriptionWhen,
  reason?: string,
): Promise<Subscription | undefined>;

export async function cancelSubscription(
  subscriptionId: string,
  arg2?: CancelSubscriptionOptions | CancelSubscriptionWhen,
  arg3?: string,
): Promise<Subscription | undefined> {
  let cancelAtPeriodEnd: boolean;
  let reason: string | undefined;

  if (typeof arg2 === 'string') {
    cancelAtPeriodEnd = arg2 === 'period_end';
    reason = arg3;
  } else {
    cancelAtPeriodEnd = arg2?.cancelAtPeriodEnd ?? false;
    reason = arg2?.reason;
  }

  const index = subscriptions.findIndex((subscription) => subscription.id === subscriptionId);

  if (index === -1) {
    return undefined;
  }

  const current = subscriptions[index];
  if (!current) {
    return undefined;
  }

  const updated: Subscription = {
    id: current.id,
    customer: current.customer,
    plan: current.plan,
    status: 'canceled',
    nextBillingDate: cancelAtPeriodEnd ? current.nextBillingDate : null,
    billingInterval: current.billingInterval,
    billingIntervalCount: current.billingIntervalCount,
    monthlyAmount: current.monthlyAmount,
    paymentMethod: current.paymentMethod,
    cancelAtPeriodEnd,
    cancellationReason: reason ?? null,
  };

  subscriptions = [
    ...subscriptions.slice(0, index),
    updated,
    ...subscriptions.slice(index + 1),
  ];

  return updated;
}

// Alias expected by tests
export async function cancelSubscriptionCore(
  subscriptionId: string,
  when: CancelSubscriptionWhen,
  reason?: string,
): Promise<Subscription | undefined> {
  return cancelSubscription(subscriptionId, when, reason);
}

// ---------------------------------------------------------------------------
// Express web application
// ---------------------------------------------------------------------------

export const app = express.default();
export const server = app;

app.use(cors.default());
app.use(express.json());

app.get('/subscriptions', async (req, res) => {
  const statusParam = req.query.status;
  const searchParam = req.query.search;

  const viewOptions: ViewAllSubscriptionsOptions = {};

  if (typeof statusParam === 'string') {
    viewOptions.status = statusParam as SubscriptionStatus;
  }

  if (typeof searchParam === 'string') {
    viewOptions.search = searchParam;
  }

  const data = await viewAllSubscriptions(viewOptions);
  res.json(data);
});

app.get('/subscriptions/:id', async (req, res) => {
  const subscription = await viewSubscriptionDetails(req.params.id);
  if (!subscription) {
    res.status(404).json({ message: 'Subscription not found' });
    return;
  }
  res.json(subscription);
});

app.post('/subscriptions/:id/change-plan', async (req, res) => {
  const { newPlanId, effectiveAt } = req.body as {
    newPlanId?: string;
    effectiveAt?: 'immediately' | 'next_billing';
  };

  if (!newPlanId) {
    res.status(400).json({ message: 'newPlanId is required' });
    return;
  }

  const changeOptions: ChangeSubscriptionPlanOptions = {};
  if (effectiveAt) {
    changeOptions.effectiveAt = effectiveAt;
  }

  const subscription = await changeSubscriptionPlan(req.params.id, newPlanId, changeOptions);

  if (!subscription) {
    res.status(404).json({ message: 'Subscription or plan not found' });
    return;
  }

  res.json(subscription);
});

app.post('/subscriptions/:id/cancel', async (req, res) => {
  const { cancelAtPeriodEnd, reason } = req.body as CancelSubscriptionOptions;

  const cancelOptions: CancelSubscriptionOptions = {};
  if (typeof cancelAtPeriodEnd === 'boolean') {
    cancelOptions.cancelAtPeriodEnd = cancelAtPeriodEnd;
  }
  if (typeof reason === 'string') {
    cancelOptions.reason = reason;
  }

  const subscription = await cancelSubscription(req.params.id, cancelOptions);

  if (!subscription) {
    res.status(404).json({ message: 'Subscription not found' });
    return;
  }

  res.json(subscription);
});

app.get('/', (_req, res) => {
  res.send(
    '<!doctype html>' +
      '<html><head><title>Subscriptions Admin</title></head>' +
      '<body>' +
      '<h1>Subscriptions Admin</h1>' +
      '<p>This minimal UI exposes the core subscription operations via JSON APIs.</p>' +
      '<ul>' +
      '<li>GET /subscriptions?status=active&search=alice</li>' +
      '<li>GET /subscriptions/:id</li>' +
      '<li>POST /subscriptions/:id/change-plan { "newPlanId": "pro", "effectiveAt": "immediately" }</li>' +
      '<li>POST /subscriptions/:id/cancel { "cancelAtPeriodEnd": true, "reason": "User requested" }</li>' +
      '</ul>' +
      '</body></html>',
  );
});

// Note: we intentionally do not call app.listen here so that tests
// can import and use the Express app and exported functions directly.
