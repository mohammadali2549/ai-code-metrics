import cors from 'cors';
import dotenv from 'dotenv';
import express, { Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import {
  ApiError,
  Client,
  CustomersController,
  Environment,
  PaymentProfilesController,
  SubscriptionProductMigrationRequest,
  SubscriptionProductsController,
  SubscriptionSort,
  SubscriptionStatusController,
  SubscriptionsController,
} from '@maxio-com/advanced-billing-sdk';

// Load environment variables from .env if it exists. If not, rely on
// environment variables provided by the host environment (e.g. GitHub Actions).
const envPath = path.join(process.cwd(), '.env');
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
}

function getEnv(name: string): string {
  const value = process.env[name];
  return typeof value === 'string' ? value : '';
}

// --- Maxio client & controllers ------------------------------------------------

let cachedClient: Client | null = null;

function getMaxioClient(): Client {
  if (!cachedClient) {
    cachedClient = new Client({
      basicAuthCredentials: {
        username: getEnv('MAXIO_BASIC_AUTH_USERNAME'),
        password: getEnv('MAXIO_BASIC_AUTH_PASSWORD'),
      },
      site: getEnv('MAXIO_SITE'),
      timeout: 120000,
      environment: Environment.US,
    });
  }

  return cachedClient;
}

function getControllers() {
  const client = getMaxioClient();

  return {
    subscriptions: new SubscriptionsController(client),
    subscriptionProducts: new SubscriptionProductsController(client),
    subscriptionStatus: new SubscriptionStatusController(client),
    customers: new CustomersController(client),
    paymentProfiles: new PaymentProfilesController(client),
  };
}

// --- Types for exported functions ---------------------------------------------

export type SubscriptionStatusFilter =
  | 'all'
  | 'active'
  | 'canceled'
  | 'past_due'
  | 'trial'
  | 'trialing';

export interface SubscriptionSummary {
  id: number;
  customerName: string;
  customerEmail: string | null;
  planName: string | null;
  status: string;
  nextBillingDate: string | null;
  monthlyAmount: number | null; // major currency units
  currency: string | null;
}

export interface ViewAllSubscriptionsOptions {
  status?: SubscriptionStatusFilter | undefined;
  search?: string | undefined;
  page?: number | undefined;
  perPage?: number | undefined;
}

export interface PaymentMethodSummary {
  type: string;
  brand?: string | undefined;
  last4?: string | undefined;
}

export interface SubscriptionDetails {
  id: number;
  customerName: string;
  customerEmail: string | null;
  planName: string | null;
  status: string;
  billingCycle: string | null;
  nextBillingDate: string | null;
  monthlyAmount: number | null;
  currency: string | null;
  paymentMethod: PaymentMethodSummary | null;
}

export interface ChangeSubscriptionPlanOptions {
  subscriptionId: number;
  newProductId: number;
  effectiveAt: 'immediately' | 'next_billing';
}

export interface CancelSubscriptionOptions {
  subscriptionId: number;
  cancelAt: 'immediately' | 'period_end';
  reason?: string | undefined;
}

function normaliseStatusFilter(status?: SubscriptionStatusFilter): string | undefined {
  if (!status || status === 'all') {
    return undefined;
  }

  if (status === 'trial') {
    return 'trialing';
  }

  return status;
}

function buildCustomerName(customer: any | undefined): string {
  if (!customer) {
    return 'Unknown customer';
  }

  const parts: string[] = [];

  if (customer.firstName) {
    parts.push(String(customer.firstName));
  }
  if (customer.lastName) {
    parts.push(String(customer.lastName));
  }

  if (parts.length === 0 && customer.email) {
    return String(customer.email);
  }

  return parts.join(' ') || 'Unknown customer';
}

function toSubscriptionSummary(rawSubscription: any): SubscriptionSummary {
  const customer = rawSubscription.customer as any | undefined;

  const product = rawSubscription.product as any | undefined;
  const nextBillingDate: string | null = rawSubscription.currentPeriodEndsAt
    ? String(rawSubscription.currentPeriodEndsAt)
    : null;

  const priceInCents: number | null =
    typeof rawSubscription.productPriceInCents === 'number'
      ? rawSubscription.productPriceInCents
      : null;

  const monthlyAmount = priceInCents !== null ? priceInCents / 100 : null;

  return {
    id: Number(rawSubscription.id),
    customerName: buildCustomerName(customer),
    customerEmail: customer?.email ?? null,
    planName: product?.name ?? null,
    status: String(rawSubscription.state ?? ''),
    nextBillingDate,
    monthlyAmount,
    currency: rawSubscription.currency ?? null,
  };
}

function toSubscriptionDetails(rawSubscription: any, paymentMethod: PaymentMethodSummary | null): SubscriptionDetails {
  const customer = rawSubscription.customer as any | undefined;
  const product = rawSubscription.product as any | undefined;

  const priceInCents: number | null =
    typeof rawSubscription.productPriceInCents === 'number'
      ? rawSubscription.productPriceInCents
      : null;
  const monthlyAmount = priceInCents !== null ? priceInCents / 100 : null;

  const billingInterval = rawSubscription.productIntervalUnit;
  const billingIntervalCount = rawSubscription.productInterval;
  const billingCycle =
    billingInterval && billingIntervalCount
      ? `${billingIntervalCount} ${billingInterval}`
      : null;

  const nextBillingDate: string | null = rawSubscription.currentPeriodEndsAt
    ? String(rawSubscription.currentPeriodEndsAt)
    : null;

  return {
    id: Number(rawSubscription.id),
    customerName: buildCustomerName(customer),
    customerEmail: customer?.email ?? null,
    planName: product?.name ?? null,
    status: String(rawSubscription.state ?? ''),
    billingCycle,
    nextBillingDate,
    monthlyAmount,
    currency: rawSubscription.currency ?? null,
    paymentMethod,
  };
}

// --- Exported business logic functions ---------------------------------------

/**
 * View all subscriptions with optional status filter and search by customer name/email.
 */
export async function viewAllSubscriptions(
  options: ViewAllSubscriptionsOptions = {},
): Promise<SubscriptionSummary[]> {
  const { subscriptions } = getControllers();

  const page = options.page ?? 1;
  const perPage = options.perPage ?? 50;
  const state = normaliseStatusFilter(options.status);

  const apiParams: any = {
    page,
    perPage,
    sort: SubscriptionSort.SignupDate,
  };

  if (state) {
    apiParams.state = state;
  }

  const response = await subscriptions.listSubscriptions(apiParams);
  const list = (response.result as any[]) ?? [];

  let summaries = list
    .map((item) => item?.subscription)
    .filter((sub) => Boolean(sub))
    .map((sub) => toSubscriptionSummary(sub));

  const search = options.search?.trim().toLowerCase();
  if (search) {
    summaries = summaries.filter((summary) => {
      const name = summary.customerName.toLowerCase();
      const email = (summary.customerEmail ?? '').toLowerCase();
      return name.includes(search) || email.includes(search);
    });
  }

  return summaries;
}

/**
 * View single subscription details including payment method summary.
 */
export async function viewSubscriptionDetails(subscriptionId: number): Promise<SubscriptionDetails> {
  const { subscriptions, paymentProfiles } = getControllers();

  const subscriptionResponse = await subscriptions.readSubscription(subscriptionId);
  const rawSubscription = (subscriptionResponse.result as any).subscription;

  if (!rawSubscription) {
    throw new Error(`Subscription ${subscriptionId} not found`);
  }

  let paymentMethod: PaymentMethodSummary | null = null;

  const customer = rawSubscription.customer as any | undefined;
  const customerId = customer?.id as number | undefined;

  if (typeof customerId === 'number') {
    const profilesResponse = await paymentProfiles.listPaymentProfiles({ customerId });
    const profiles = (profilesResponse.result as any[]) ?? [];
    const firstProfile = profiles[0]?.paymentProfile as any | undefined;

    if (firstProfile) {
      if (firstProfile.paymentType === 'credit_card') {
        const masked = String(firstProfile.maskedCardNumber ?? '');
        paymentMethod = {
          type: 'credit_card',
          brand: firstProfile.cardType ?? undefined,
          last4: masked ? masked.slice(-4) : undefined,
        };
      } else {
        paymentMethod = {
          type: String(firstProfile.paymentType ?? 'unknown'),
        };
      }
    }
  }

  return toSubscriptionDetails(rawSubscription, paymentMethod);
}

/**
 * Change a subscription's plan (product) with optional immediate or next-billing effect.
 * Proration is handled automatically by Maxio during the migration.
 */
export async function changeSubscriptionPlan(
  options: ChangeSubscriptionPlanOptions,
): Promise<SubscriptionDetails> {
  const { subscriptionProducts, subscriptions, paymentProfiles } = getControllers();

  const preservePeriod = options.effectiveAt === 'next_billing';

  const body: SubscriptionProductMigrationRequest = {
    migration: {
      productId: options.newProductId,
      includeTrial: false,
      includeInitialCharge: false,
      includeCoupons: true,
      preservePeriod,
    },
  };

  await subscriptionProducts.migrateSubscriptionProduct(options.subscriptionId, body);

  // Re-fetch subscription (and payment method) to return up-to-date details
  const subscriptionResponse = await subscriptions.readSubscription(options.subscriptionId);
  const rawSubscription = (subscriptionResponse.result as any).subscription;

  if (!rawSubscription) {
    throw new Error(`Subscription ${options.subscriptionId} not found after migration`);
  }

  let paymentMethod: PaymentMethodSummary | null = null;

  const customer = rawSubscription.customer as any | undefined;
  const customerId = customer?.id as number | undefined;

  if (typeof customerId === 'number') {
    const profilesResponse = await paymentProfiles.listPaymentProfiles({ customerId });
    const profiles = (profilesResponse.result as any[]) ?? [];
    const firstProfile = profiles[0]?.paymentProfile as any | undefined;

    if (firstProfile) {
      if (firstProfile.paymentType === 'credit_card') {
        const masked = String(firstProfile.maskedCardNumber ?? '');
        paymentMethod = {
          type: 'credit_card',
          brand: firstProfile.cardType ?? undefined,
          last4: masked ? masked.slice(-4) : undefined,
        };
      } else {
        paymentMethod = {
          type: String(firstProfile.paymentType ?? 'unknown'),
        };
      }
    }
  }

  return toSubscriptionDetails(rawSubscription, paymentMethod);
}

/**
 * Cancel a subscription immediately or at period end.
 * A reason/note can be supplied for audit / display purposes.
 */
export async function cancelSubscription(
  options: CancelSubscriptionOptions,
): Promise<SubscriptionDetails & { cancellationReason?: string | undefined }> {
  const { subscriptionStatus, subscriptions, paymentProfiles } = getControllers();

  if (options.cancelAt === 'period_end') {
    await subscriptionStatus.initiateDelayedCancellation(options.subscriptionId);
  } else {
    await subscriptionStatus.cancelSubscription(options.subscriptionId);
  }

  const subscriptionResponse = await subscriptions.readSubscription(options.subscriptionId);
  const rawSubscription = (subscriptionResponse.result as any).subscription;

  if (!rawSubscription) {
    throw new Error(`Subscription ${options.subscriptionId} not found after cancellation`);
  }

  let paymentMethod: PaymentMethodSummary | null = null;

  const customer = rawSubscription.customer as any | undefined;
  const customerId = customer?.id as number | undefined;

  if (typeof customerId === 'number') {
    const profilesResponse = await paymentProfiles.listPaymentProfiles({ customerId });
    const profiles = (profilesResponse.result as any[]) ?? [];
    const firstProfile = profiles[0]?.paymentProfile as any | undefined;

    if (firstProfile) {
      if (firstProfile.paymentType === 'credit_card') {
        const masked = String(firstProfile.maskedCardNumber ?? '');
        paymentMethod = {
          type: 'credit_card',
          brand: firstProfile.cardType ?? undefined,
          last4: masked ? masked.slice(-4) : undefined,
        };
      } else {
        paymentMethod = {
          type: String(firstProfile.paymentType ?? 'unknown'),
        };
      }
    }
  }

  const details = toSubscriptionDetails(rawSubscription, paymentMethod);

  if (options.reason) {
    return { ...details, cancellationReason: options.reason };
  }

  return details;
}

// --- Express application (simple admin UI API) -------------------------------

export const app = express();

app.use(cors());
app.use(express.json());

function handleError(res: Response, error: any): void {
  if (error instanceof ApiError) {
    res.status((error as ApiError).statusCode ?? 500).json({
      error: 'Maxio API error',
      message: error.message,
      details: error.body,
    });
    return;
  }

  if (error instanceof Error) {
    res.status(500).json({
      error: 'Internal error',
      message: error.message,
    });
    return;
  }

  res.status(500).json({
    error: 'Unknown error',
  });
}

app.get('/subscriptions', async (req: Request, res: Response) => {
  try {
    const status = (req.query.status as SubscriptionStatusFilter | undefined) ?? 'all';
    const search = (req.query.search as string | undefined) ?? undefined;

    const page = req.query.page ? Number(req.query.page) : undefined;
    const perPage = req.query.perPage ? Number(req.query.perPage) : undefined;

    const data = await viewAllSubscriptions({
      status,
      search,
      page,
      perPage,
    });

    res.json({ data });
  } catch (error) {
    handleError(res, error);
  }
});

app.get('/subscriptions/:id', async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);

    if (Number.isNaN(id)) {
      res.status(400).json({ error: 'Invalid subscription id' });
      return;
    }

    const data = await viewSubscriptionDetails(id);
    res.json({ data });
  } catch (error) {
    handleError(res, error);
  }
});

app.post('/subscriptions/:id/change-plan', async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);

    if (Number.isNaN(id)) {
      res.status(400).json({ error: 'Invalid subscription id' });
      return;
    }

    const { newProductId, effectiveAt } = req.body as Partial<ChangeSubscriptionPlanOptions>;

    if (typeof newProductId !== 'number' || (effectiveAt !== 'immediately' && effectiveAt !== 'next_billing')) {
      res.status(400).json({ error: 'newProductId (number) and effectiveAt ("immediately" | "next_billing") are required' });
      return;
    }

    const data = await changeSubscriptionPlan({
      subscriptionId: id,
      newProductId,
      effectiveAt,
    });

    res.json({ data });
  } catch (error) {
    handleError(res, error);
  }
});

app.post('/subscriptions/:id/cancel', async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);

    if (Number.isNaN(id)) {
      res.status(400).json({ error: 'Invalid subscription id' });
      return;
    }

    const { cancelAt, reason } = req.body as Partial<CancelSubscriptionOptions>;

    if (cancelAt !== 'immediately' && cancelAt !== 'period_end') {
      res.status(400).json({ error: 'cancelAt ("immediately" | "period_end") is required' });
      return;
    }

    const data = await cancelSubscription({
      subscriptionId: id,
      cancelAt,
      reason,
    });

    res.json({ data });
  } catch (error) {
    handleError(res, error);
  }
});

const port = Number(process.env.PORT ?? 3000);

if (process.env.NODE_ENV !== 'test') {
  app.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`Admin subscription app listening on port ${port}`);
  });
}
