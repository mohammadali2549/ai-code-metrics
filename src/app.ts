import dotenv from 'dotenv';
import express from 'express';
import cors from 'cors';
import http from 'http';
import {
  ApiError,
  Client,
  Environment,
  SubscriptionsController,
  SubscriptionProductsController,
  SubscriptionStatusController,
  PaymentProfilesController,
  SubscriptionSort,
} from '@maxio-com/advanced-billing-sdk';
import type {
  SubscriptionProductMigrationRequest,
  CancellationRequest,
} from '@maxio-com/advanced-billing-sdk';

// Load environment variables from .env when present. In GitHub Actions, variables
// are expected to already be available on process.env.
dotenv.config();

export type UiSubscriptionStatusFilter =
  | 'active'
  | 'canceled'
  | 'past_due'
  | 'trialing'
  | 'all';

export type SubscriptionFilterStatus = UiSubscriptionStatusFilter;

export type ChangeSubscriptionWhen = 'immediately' | 'next_billing';
export type ChangeTiming = ChangeSubscriptionWhen;

export type CancelSubscriptionWhen = 'immediately' | 'end_of_period';
export type CancelTiming = CancelSubscriptionWhen;

export interface SubscriptionSummary {
  id: number;
  customerName: string | null;
  customerEmail: string | null;
  planName: string | null;
  plan: string | null;
  status: string;
  nextBillingDate: string | null;
  monthlyAmount: number | null;
}

export interface PaymentMethodSummary {
  type: 'credit_card' | 'bank_account' | 'other' | 'none';
  display: string;
}

export interface SubscriptionDetails {
  id: number;
  customerName: string | null;
  customerEmail: string | null;
  planName: string | null;
  monthlyAmount: number | null;
  status: string;
  billingPeriodUnit: string | null;
  billingPeriodValue: number | null;
  nextBillingDate: string | null;
  paymentMethod: PaymentMethodSummary | null;
  customerInfo: {
    name: string | null;
    email: string | null;
  };
  currentPlan: {
    name: string | null;
    priceCents: number | null;
  };
  billingCycle: {
    interval: number | null;
    intervalUnit: string | null;
    nextBillingDate: string | null;
  };
}

export interface CancelSubscriptionResult {
  id: number;
  status: string;
  timing: CancelTiming;
  message?: string;
}

let client: Client | null = null;
let subscriptionsController: SubscriptionsController | null = null;
let subscriptionProductsController: SubscriptionProductsController | null = null;
let subscriptionStatusController: SubscriptionStatusController | null = null;
let paymentProfilesController: PaymentProfilesController | null = null;

function requireEnv(
  name: 'MAXIO_SITE' | 'MAXIO_BASIC_AUTH_USERNAME' | 'MAXIO_BASIC_AUTH_PASSWORD',
): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Environment variable ${name} must be set for Maxio Advanced Billing integration.`,
    );
  }
  return value;
}

function getControllers() {
  if (
    !client ||
    !subscriptionsController ||
    !subscriptionProductsController ||
    !subscriptionStatusController ||
    !paymentProfilesController
  ) {
    const site = requireEnv('MAXIO_SITE');
    const username = requireEnv('MAXIO_BASIC_AUTH_USERNAME');
    const password = requireEnv('MAXIO_BASIC_AUTH_PASSWORD');

    client = new Client({
      basicAuthCredentials: {
        username,
        password,
      },
      timeout: 120000,
      environment: Environment.US,
      site,
    });

    subscriptionsController = new SubscriptionsController(client);
    subscriptionProductsController = new SubscriptionProductsController(client);
    subscriptionStatusController = new SubscriptionStatusController(client);
    paymentProfilesController = new PaymentProfilesController(client);
  }

  return {
    client: client as Client,
    subscriptionsController: subscriptionsController as SubscriptionsController,
    subscriptionProductsController: subscriptionProductsController as SubscriptionProductsController,
    subscriptionStatusController: subscriptionStatusController as SubscriptionStatusController,
    paymentProfilesController: paymentProfilesController as PaymentProfilesController,
  };
}

function handleApiError(error: unknown): void {
  if (error instanceof ApiError) {
    // In a real app you might hook this into structured logging.
    // For this implementation, log to stderr so tests can still assert on
    // return values without being affected by logs.
    // eslint-disable-next-line no-console
    console.error('Maxio API error', error.statusCode, error.body);
  } else {
    // eslint-disable-next-line no-console
    console.error('Unexpected Maxio API error', error);
  }
}

function normalizeStatusFilter(filter?: UiSubscriptionStatusFilter): string[] | undefined {
  if (!filter || filter === 'all') {
    return undefined;
  }
  return [filter];
}

function matchesSearch(subscription: unknown, search?: string | null): boolean {
  if (!search) return true;
  const sub: any = subscription;
  const query = search.toLowerCase();
  const firstName: string = sub.customer?.firstName ?? '';
  const lastName: string = sub.customer?.lastName ?? '';
  const email: string = sub.customer?.email ?? '';
  const fullName = `${firstName} ${lastName}`.trim();

  return (
    fullName.toLowerCase().includes(query) ||
    email.toLowerCase().includes(query)
  );
}

function mapSubscriptionToSummary(subscription: unknown): SubscriptionSummary {
  const sub: any = subscription;
  const firstName: string = sub.customer?.firstName ?? '';
  const lastName: string = sub.customer?.lastName ?? '';
  const name = `${firstName} ${lastName}`.trim() || null;
  const planName: string | null = (sub.product?.name as string | undefined) ?? null;

  const cents: number | null =
    typeof sub.product?.priceInCents === 'number' ? sub.product.priceInCents : null;

  return {
    id: sub.id as number,
    customerName: name,
    customerEmail: (sub.customer?.email as string | undefined) ?? null,
    planName,
    plan: planName,
    status: (sub.state as string | undefined) ?? 'unknown',
    nextBillingDate: (sub.currentPeriodEndsAt as string | undefined) ?? null,
    monthlyAmount: cents !== null ? cents / 100 : null,
  };
}

async function getPaymentMethodSummary(
  paymentProfileId: number | null | undefined,
): Promise<PaymentMethodSummary | null> {
  if (!paymentProfileId) {
    return null;
  }

  const { paymentProfilesController } = getControllers();

  try {
    const response = await paymentProfilesController.readPaymentProfile(paymentProfileId);
    const paymentProfile: any = response.result.paymentProfile;
    if (!paymentProfile) return null;

    if (paymentProfile.paymentType === 'credit_card') {
      const cardLabel = paymentProfile.cardType ?? 'Card';
      const last4 = paymentProfile.maskedCardNumber ?? '';
      return {
        type: 'credit_card',
        display: `${cardLabel} ending ${last4}`.trim(),
      };
    }

    if (paymentProfile.paymentType === 'bank_account') {
      const bankName = paymentProfile.bankName ?? 'Bank account';
      const masked = paymentProfile.maskedBankAccountNumber ?? '';
      return {
        type: 'bank_account',
        display: `${bankName} ${masked}`.trim(),
      };
    }

    return {
      type: 'other',
      display: 'Payment method on file',
    };
  } catch (error) {
    handleApiError(error);
    return null;
  }
}

export async function viewAllSubscriptions(
  filterStatus?: UiSubscriptionStatusFilter,
  search?: string,
): Promise<SubscriptionSummary[]> {
  const { subscriptionsController } = getControllers();

  const page = 1;
  const perPage = 100;

  try {
    const response = await subscriptionsController.listSubscriptions({
      page,
      perPage,
      sort: SubscriptionSort.SignupDate,
    });

    const items: any[] = response.result ?? [];
    const statesFilter = normalizeStatusFilter(filterStatus);

    const filtered = items
      .map((item: any) => item.subscription)
      .filter((sub: any) => Boolean(sub))
      .filter((sub: any) => {
        if (!sub) return false;
        if (statesFilter && !statesFilter.includes(sub.state)) {
          return false;
        }
        return matchesSearch(sub, search ?? null);
      });

    return filtered.map(mapSubscriptionToSummary);
  } catch (error) {
    handleApiError(error);
    throw error;
  }
}

export async function viewSubscriptionDetails(
  subscriptionId: number,
): Promise<SubscriptionDetails> {
  const { subscriptionsController } = getControllers();

  try {
    const response = await subscriptionsController.readSubscription(subscriptionId);
    const subscription: any = response.result.subscription;
    if (!subscription) {
      throw new Error('Subscription not found');
    }

    const paymentMethod = await getPaymentMethodSummary(subscription.paymentProfileId);

    const firstName: string = subscription.customer?.firstName ?? '';
    const lastName: string = subscription.customer?.lastName ?? '';
    const customerName = `${firstName} ${lastName}`.trim() || null;

    const customerEmail: string | null =
      (subscription.customer?.email as string | undefined) ?? null;

    const planName: string | null =
      (subscription.product?.name as string | undefined) ?? null;

    const cents: number | null =
      typeof subscription.product?.priceInCents === 'number'
        ? subscription.product.priceInCents
        : null;

    const billingPeriodUnit: string | null = subscription.product?.intervalUnit ?? null;
    const billingPeriodValue: number | null = subscription.product?.interval ?? null;
    const nextBillingDate: string | null =
      (subscription.currentPeriodEndsAt as string | undefined) ?? null;

    return {
      id: subscription.id as number,
      customerName,
      customerEmail,
      planName,
      monthlyAmount: cents !== null ? cents / 100 : null,
      status: (subscription.state as string | undefined) ?? 'unknown',
      billingPeriodUnit,
      billingPeriodValue,
      nextBillingDate,
      paymentMethod,
      customerInfo: {
        name: customerName,
        email: customerEmail,
      },
      currentPlan: {
        name: planName,
        priceCents: cents,
      },
      billingCycle: {
        interval: billingPeriodValue,
        intervalUnit: billingPeriodUnit,
        nextBillingDate,
      },
    };
  } catch (error) {
    handleApiError(error);
    throw error;
  }
}

export async function changeSubscriptionPlan(
  subscriptionId: number,
  newPlanId: number,
  changeTiming: ChangeTiming,
): Promise<SubscriptionDetails | null> {
  const { subscriptionProductsController } = getControllers();

  const body: SubscriptionProductMigrationRequest = {
    migration: {
      productId: newPlanId,
      preservePeriod: changeTiming === 'next_billing',
    },
  };

  try {
    const response = await subscriptionProductsController.migrateSubscriptionProduct(
      subscriptionId,
      body,
    );

    const migratedSubscription: any = response.result.subscription;
    if (!migratedSubscription) {
      return null;
    }

    // Reuse the details mapper so that callers have a consistent shape.
    return viewSubscriptionDetails(migratedSubscription.id as number);
  } catch (error) {
    handleApiError(error);
    throw error;
  }
}

export async function cancelSubscription(
  subscriptionId: number,
  timing: CancelTiming,
  reason?: string,
): Promise<CancelSubscriptionResult | null> {
  const { subscriptionStatusController } = getControllers();

  const subscriptionForCancel: { cancellationMessage?: string } = {};
  if (reason !== undefined) {
    subscriptionForCancel.cancellationMessage = reason;
  }
  const cancellationRequest: any = {
    subscription: subscriptionForCancel,
  } satisfies CancellationRequest;

  try {
    if (timing === 'immediately') {
      const response = await subscriptionStatusController.cancelSubscription(
        subscriptionId,
        cancellationRequest,
      );
      const subscription: any = response.result.subscription;
      return {
        id: (subscription?.id as number | undefined) ?? subscriptionId,
        status: (subscription?.state as string | undefined) ?? 'canceled',
        timing,
        message: (response.result as any).message ?? reason,
      };
    }

    const response = await subscriptionStatusController.initiateDelayedCancellation(
      subscriptionId,
      cancellationRequest,
    );
    const subscription: any = (response.result as any).subscription;

    return {
      id: (subscription?.id as number | undefined) ?? subscriptionId,
      status: (subscription?.state as string | undefined) ?? 'cancellation_pending',
      timing,
      message: (response.result as any).message ?? reason,
    };
  } catch (error) {
    handleApiError(error);
    throw error;
  }
}

// Minimal Express web application wiring these functions into HTTP endpoints.

export const app = express();

app.use(cors());
app.use(express.json());

app.get('/subscriptions', async (req, res) => {
  try {
    const filterStatusRaw = typeof req.query.status === 'string' ? req.query.status : undefined;
    const filterStatus = filterStatusRaw as UiSubscriptionStatusFilter | undefined;
    const search = typeof req.query.search === 'string' ? req.query.search : undefined;

    const subscriptions = await viewAllSubscriptions(filterStatus, search);

    res.json(subscriptions);
  } catch (error) {
    handleApiError(error);
    res.status(500).json({ error: 'Failed to load subscriptions' });
  }
});

app.get('/subscriptions/:id', async (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  if (Number.isNaN(id)) {
    res.status(400).json({ error: 'Invalid subscription id' });
    return;
  }

  try {
    const details = await viewSubscriptionDetails(id);
    if (!details) {
      res.status(404).json({ error: 'Subscription not found' });
      return;
    }

    res.json(details);
  } catch (error) {
    handleApiError(error);
    res.status(500).json({ error: 'Failed to load subscription details' });
  }
});

app.post('/subscriptions/:id/change-plan', async (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  const { newPlanId, changeTiming } = req.body as {
    newPlanId?: number;
    changeTiming?: ChangeTiming;
  };

  if (Number.isNaN(id) || typeof newPlanId !== 'number') {
    res.status(400).json({ error: 'Invalid subscription id or newPlanId' });
    return;
  }

  const timing: ChangeTiming = changeTiming === 'next_billing' ? 'next_billing' : 'immediately';

  try {
    const details = await changeSubscriptionPlan(id, newPlanId, timing);
    if (!details) {
      res.status(404).json({ error: 'Subscription not found' });
      return;
    }

    res.json(details);
  } catch (error) {
    handleApiError(error);
    res.status(500).json({ error: 'Failed to change subscription plan' });
  }
});

app.post('/subscriptions/:id/cancel', async (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  const { timing, reason } = req.body as {
    timing?: CancelTiming;
    reason?: string;
  };

  if (Number.isNaN(id)) {
    res.status(400).json({ error: 'Invalid subscription id' });
    return;
  }

  const effectiveTiming: CancelTiming = timing === 'end_of_period' ? 'end_of_period' : 'immediately';

  try {
    const result = await cancelSubscription(id, effectiveTiming, reason);
    if (!result) {
      res.status(404).json({ error: 'Subscription not found' });
      return;
    }

    res.json(result);
  } catch (error) {
    handleApiError(error);
    res.status(500).json({ error: 'Failed to cancel subscription' });
  }
});

// Additional exports expected by tests

export const getSubscriptionDetails = viewSubscriptionDetails;

export async function cancelSubscriptionCore(
  subscriptionId: number,
  timing: CancelTiming,
  reason?: string,
): Promise<CancelSubscriptionResult | null> {
  return cancelSubscription(subscriptionId, timing, reason);
}

export const server = http.createServer(app);
