import express, { type Request, type Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import {
  ApiError,
  Client,
  Environment,
  PaymentProfile,
  PaymentProfilesController,
  SubscriptionStatusController,
  SubscriptionsController,
  SubscriptionStateFilter,
} from '@maxio-com/advanced-billing-sdk';

dotenv.config();

type SubscriptionStatusFilter = 'active' | 'canceled' | 'past_due' | 'trial';

export interface SubscriptionListItem {
  id: number | null;
  customerName: string;
  customerEmail: string | null;
  planName: string | null;
  status: string | null;
  nextBillingAt: string | null;
  monthlyAmountCents: number | null;
}

export interface PaymentMethodSummary {
  type: 'credit_card' | 'bank_account' | 'unknown';
  display: string;
  cardBrand?: string | undefined;
  last4?: string | undefined;
  expirationMonth?: number | undefined;
  expirationYear?: number | undefined;
  bankName?: string | undefined;
  bankAccountType?: string | undefined;
}

export interface SubscriptionDetails {
  id: number | null;
  customerName: string;
  customerEmail: string | null;
  currentPlanName: string | null;
  currentPriceCents: number | null;
  status: string | null;
  billingCycleEndsAt: string | null;
  nextBillingAt: string | null;
  paymentMethod: PaymentMethodSummary | null;
}

export type PlanChangeTiming = 'immediately' | 'next_billing';

export interface ChangePlanOptions {
  timing?: PlanChangeTiming;
}

export type CancelTiming = 'immediately' | 'period_end';

export interface CancelSubscriptionOptions {
  timing?: CancelTiming;
  reason?: string;
}

interface MaxioConfig {
  site: string;
  username: string;
  password: string;
}

let cachedClient: Client | null = null;
let cachedSubscriptionsController: SubscriptionsController | null = null;
let cachedPaymentProfilesController: PaymentProfilesController | null = null;
let cachedSubscriptionStatusController: SubscriptionStatusController | null = null;

function loadMaxioConfig(): MaxioConfig {
  const { MAXIO_SITE, MAXIO_BASIC_AUTH_USERNAME, MAXIO_BASIC_AUTH_PASSWORD } = process.env;

  if (!MAXIO_SITE || !MAXIO_BASIC_AUTH_USERNAME || !MAXIO_BASIC_AUTH_PASSWORD) {
    throw new Error(
      'Missing Maxio configuration. Ensure MAXIO_SITE, MAXIO_BASIC_AUTH_USERNAME and MAXIO_BASIC_AUTH_PASSWORD are set.',
    );
  }

  return {
    site: MAXIO_SITE,
    username: MAXIO_BASIC_AUTH_USERNAME,
    password: MAXIO_BASIC_AUTH_PASSWORD,
  };
}

function getClient(): Client {
  if (!cachedClient) {
    const config = loadMaxioConfig();
    cachedClient = new Client({
      basicAuthCredentials: {
        username: config.username,
        password: config.password,
      },
      timeout: 120_000,
      environment: Environment.US,
      site: config.site,
    });
  }

  return cachedClient;
}

function getSubscriptionsController(): SubscriptionsController {
  if (!cachedSubscriptionsController) {
    cachedSubscriptionsController = new SubscriptionsController(getClient());
  }

  return cachedSubscriptionsController;
}

function getPaymentProfilesController(): PaymentProfilesController {
  if (!cachedPaymentProfilesController) {
    cachedPaymentProfilesController = new PaymentProfilesController(getClient());
  }

  return cachedPaymentProfilesController;
}

function getSubscriptionStatusController(): SubscriptionStatusController {
  if (!cachedSubscriptionStatusController) {
    cachedSubscriptionStatusController = new SubscriptionStatusController(getClient());
  }

  return cachedSubscriptionStatusController;
}

function mapStatusFilter(status?: SubscriptionStatusFilter): SubscriptionStateFilter | undefined {
  switch (status) {
    case 'active':
      return SubscriptionStateFilter.Active;
    case 'canceled':
      return SubscriptionStateFilter.Canceled;
    case 'past_due':
      return SubscriptionStateFilter.PastDue;
    case 'trial':
      return SubscriptionStateFilter.Trialing;
    default:
      return undefined;
  }
}

function normaliseStatusQuery(value: string | undefined): SubscriptionStatusFilter | undefined {
  if (!value) return undefined;

  const normalised = value.toLowerCase();

  if (normalised === 'active') return 'active';
  if (normalised === 'canceled' || normalised === 'cancelled') return 'canceled';
  if (normalised === 'past_due' || normalised === 'past-due' || normalised === 'pastdue') return 'past_due';
  if (normalised === 'trial' || normalised === 'trialing' || normalised === 'trialling') return 'trial';

  return undefined;
}

function buildCustomerName(subscription: any): string {
  const firstName = subscription?.customer?.firstName ?? '';
  const lastName = subscription?.customer?.lastName ?? '';
  const fullName = `${firstName} ${lastName}`.trim();

  if (fullName.length > 0) {
    return fullName;
  }

  return subscription?.customer?.organization ?? 'Unknown customer';
}

function mapToListItem(subscription: any): SubscriptionListItem {
  return {
    id: subscription?.id ?? null,
    customerName: buildCustomerName(subscription),
    customerEmail: subscription?.customer?.email ?? null,
    planName: subscription?.product?.name ?? null,
    status: subscription?.state ?? null,
    nextBillingAt: subscription?.nextAssessmentAt ?? null,
    monthlyAmountCents: subscription?.productPriceInCents ?? null,
  };
}

async function getPaymentMethodSummary(subscription: any): Promise<PaymentMethodSummary | null> {
  const paymentProfileId = subscription?.paymentProfileId as number | undefined;

  if (!paymentProfileId) {
    const paymentType = subscription?.paymentType as string | undefined;
    if (!paymentType) return null;

    return {
      type: 'unknown',
      display: paymentType,
    };
  }

  const controller = getPaymentProfilesController();
  const response = await controller.readPaymentProfile(paymentProfileId);
  const profile = (response.result as any)?.paymentProfile;

  if (!profile) {
    return null;
  }

  if (PaymentProfile.isCreditCardPaymentProfile(profile)) {
    return {
      type: 'credit_card',
      display: 'Credit card',
      cardBrand: profile.cardType ?? undefined,
      last4: profile.maskedCardNumber ?? undefined,
      expirationMonth: profile.expirationMonth ?? undefined,
      expirationYear: profile.expirationYear ?? undefined,
    };
  }

  if (PaymentProfile.isBankAccountPaymentProfile(profile)) {
    return {
      type: 'bank_account',
      display: 'Bank account',
      bankName: profile.bankName ?? undefined,
      bankAccountType: profile.bankAccountType ?? undefined,
    };
  }

  return {
    type: 'unknown',
    display: subscription?.paymentType ?? 'Unknown',
  };
}

export interface ViewAllSubscriptionsOptions {
  status?: SubscriptionStatusFilter;
  search?: string;
  page?: number;
  perPage?: number;
}

export async function viewAllSubscriptions(options: ViewAllSubscriptionsOptions = {}): Promise<SubscriptionListItem[]> {
  const controller = getSubscriptionsController();

  const params: Record<string, unknown> = {
    page: options.page ?? 1,
    perPage: options.perPage ?? 50,
  };

  const stateFilter = mapStatusFilter(options.status);
  if (stateFilter !== undefined) {
    params.state = stateFilter;
  }

  const response = await controller.listSubscriptions(params as never);

  const items = (response.result as any[]) ?? [];

  const mapped = items
    .map((item) => mapToListItem((item as any).subscription))
    .filter((item) => item !== null && item !== undefined);

  if (!options.search) {
    return mapped;
  }

  const search = options.search.toLowerCase();

  return mapped.filter((item) => {
    const nameMatch = item.customerName.toLowerCase().includes(search);
    const emailMatch = item.customerEmail?.toLowerCase().includes(search) ?? false;
    return nameMatch || emailMatch;
  });
}

export async function viewSubscriptionDetails(subscriptionId: number): Promise<SubscriptionDetails> {
  const controller = getSubscriptionsController();
  const response = await controller.readSubscription(subscriptionId);
  const subscription = (response.result as any)?.subscription;

  if (!subscription) {
    throw new Error(`Subscription ${subscriptionId} not found`);
  }

  const paymentMethod = await getPaymentMethodSummary(subscription);

  return {
    id: subscription.id ?? null,
    customerName: buildCustomerName(subscription),
    customerEmail: subscription.customer?.email ?? null,
    currentPlanName: subscription.product?.name ?? null,
    currentPriceCents: subscription.productPriceInCents ?? null,
    status: subscription.state ?? null,
    billingCycleEndsAt: subscription.currentPeriodEndsAt ?? null,
    nextBillingAt: subscription.nextAssessmentAt ?? null,
    paymentMethod,
  };
}

export async function changeSubscriptionPlan(
  subscriptionId: number,
  newProductId: number,
  options: ChangePlanOptions = {},
): Promise<unknown> {
  const controller = getSubscriptionsController();
  const timing = options.timing ?? 'immediately';

  const response = await controller.updateSubscription(subscriptionId, {
    productId: newProductId,
    changeImmediately: timing === 'immediately',
  } as any);

  return response.result;
}

export async function cancelSubscription(
  subscriptionId: number,
  options: CancelSubscriptionOptions = {},
): Promise<unknown> {
  const controller = getSubscriptionStatusController();
  const timing = options.timing ?? 'immediately';

  if (timing === 'period_end') {
    const response = await controller.initiateDelayedCancellation(subscriptionId);
    return response.result;
  }

  const cancellationRequest = {
    subscription: {
      cancellationMessage: options.reason,
    },
  } as const;

  const response = await controller.cancelSubscription(subscriptionId, cancellationRequest as never);
  return response.result;
}

function handleHttpError(err: unknown, res: Response): void {
  if (err instanceof ApiError) {
    res.status(err.statusCode ?? 502).json({
      error: 'Maxio API error',
      details: err.body,
    });
    return;
  }

  if (err instanceof Error) {
    res.status(500).json({ error: err.message });
    return;
  }

  res.status(500).json({ error: 'Unknown error' });
}

export const app = express();

app.use(cors());
app.use(express.json());

app.get('/', (_req: Request, res: Response) => {
  res.send('Maxio Subscriptions Administration API');
});

app.get('/subscriptions', async (req: Request, res: Response) => {
  try {
    const status = normaliseStatusQuery(typeof req.query.status === 'string' ? req.query.status : undefined);
    const search = typeof req.query.search === 'string' ? req.query.search : undefined;

    const page =
      typeof req.query.page === 'string' && !Number.isNaN(Number(req.query.page)) ? Number(req.query.page) : undefined;
    const perPage =
      typeof req.query.perPage === 'string' && !Number.isNaN(Number(req.query.perPage))
        ? Number(req.query.perPage)
        : undefined;

    const viewOptions: ViewAllSubscriptionsOptions = {};
    if (status !== undefined) {
      viewOptions.status = status;
    }
    if (search !== undefined) {
      viewOptions.search = search;
    }
    if (page !== undefined) {
      viewOptions.page = page;
    }
    if (perPage !== undefined) {
      viewOptions.perPage = perPage;
    }

    const subscriptions = await viewAllSubscriptions(viewOptions);

    res.json(subscriptions);
  } catch (err) {
    handleHttpError(err, res);
  }
});

app.get('/subscriptions/:id', async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) {
      res.status(400).json({ error: 'Invalid subscription id' });
      return;
    }

    const details = await viewSubscriptionDetails(id);
    res.json(details);
  } catch (err) {
    handleHttpError(err, res);
  }
});

app.post('/subscriptions/:id/change-plan', async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) {
      res.status(400).json({ error: 'Invalid subscription id' });
      return;
    }

    const { newPlanId, timing } = req.body as {
      newPlanId?: number;
      timing?: PlanChangeTiming;
    };

    if (!newPlanId || Number.isNaN(Number(newPlanId))) {
      res.status(400).json({ error: 'newPlanId is required and must be a number' });
      return;
    }

    const changeOptions: ChangePlanOptions = {};
    if (timing !== undefined) {
      changeOptions.timing = timing;
    }

    const result = await changeSubscriptionPlan(id, Number(newPlanId), changeOptions);

    res.json(result);
  } catch (err) {
    handleHttpError(err, res);
  }
});

app.post('/subscriptions/:id/cancel', async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) {
      res.status(400).json({ error: 'Invalid subscription id' });
      return;
    }

    const { timing, reason } = req.body as CancelSubscriptionOptions;

    const cancelOptions: CancelSubscriptionOptions = {};
    if (timing !== undefined) {
      cancelOptions.timing = timing;
    }
    if (reason !== undefined) {
      cancelOptions.reason = reason;
    }

    const result = await cancelSubscription(id, cancelOptions);

    res.json(result);
  } catch (err) {
    handleHttpError(err, res);
  }
});

const port = process.env.PORT ? Number(process.env.PORT) : 3000;

if (process.env.NODE_ENV !== 'test') {
  app.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`Subscriptions admin app listening on port ${port}`);
  });
}

