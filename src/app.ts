import 'dotenv/config';

import cors from 'cors';
import express, { type Request, type Response } from 'express';
import type { Server } from 'http';

import {
  ApiError,
  Client,
  Environment,
  SubscriptionListInclude,
  SubscriptionInclude,
  SubscriptionSort,
  SubscriptionsController,
  SubscriptionProductsController,
  SubscriptionProductMigrationRequest,
  SubscriptionStatusController,
  type SubscriptionState,
} from '@maxio-com/advanced-billing-sdk';

// -----------------------------------------------------------------------------
// Environment & Maxio client configuration
// -----------------------------------------------------------------------------

const {
  MAXIO_SITE,
  MAXIO_BASIC_AUTH_USERNAME,
  MAXIO_BASIC_AUTH_PASSWORD,
} = process.env;

if (!MAXIO_SITE || !MAXIO_BASIC_AUTH_USERNAME || !MAXIO_BASIC_AUTH_PASSWORD) {
  // Prefer an explicit error during development / tests rather than a vague
  // authentication failure from the SDK.
  // eslint-disable-next-line no-console
  console.warn(
    '[Maxio] Missing one or more required environment variables: MAXIO_SITE, MAXIO_BASIC_AUTH_USERNAME, MAXIO_BASIC_AUTH_PASSWORD',
  );
}

const maxioClient = new Client({
  site: MAXIO_SITE ?? '',
  environment: Environment.US,
  timeout: 120_000,
  basicAuthCredentials: {
    username: MAXIO_BASIC_AUTH_USERNAME ?? '',
    password: MAXIO_BASIC_AUTH_PASSWORD ?? '',
  },
});

const subscriptionsController = new SubscriptionsController(maxioClient);
const subscriptionProductsController = new SubscriptionProductsController(
  maxioClient,
);
const subscriptionStatusController = new SubscriptionStatusController(
  maxioClient,
);

// -----------------------------------------------------------------------------
// Public types used by tests and UI
// -----------------------------------------------------------------------------

export type UiSubscriptionStatusFilter =
  | 'active'
  | 'canceled'
  | 'past_due'
  | 'trial';

export type ChangeSubscriptionWhen = 'immediately' | 'next_billing';

export type CancelSubscriptionWhen = 'immediately' | 'period_end';

export interface UiSubscriptionSummary {
  id: number | string;
  customerName: string;
  customerEmail: string;
  plan: string;
  status: SubscriptionState | undefined;
  nextBillingDate: string | null;
  monthlyAmountCents: number | null;
}

export interface UiSubscriptionDetails {
  id: number;
  customerInfo: {
    name: string;
    email: string;
  };
  currentPlan: string;
  currentPriceCents: number | null;
  status: SubscriptionState | undefined;
  billingCycle: {
    currentPeriodStartedAt: string | null;
    currentPeriodEndsAt: string | null;
  };
  nextBillingDate: string | null;
  paymentMethod: string | null;
}

// -----------------------------------------------------------------------------
// Helper functions
// -----------------------------------------------------------------------------

function normalizeStatus(status: SubscriptionState | undefined): UiSubscriptionStatusFilter | undefined {
  if (!status) return undefined;
  const lower = String(status).toLowerCase();
  if (lower.startsWith('active')) return 'active';
  if (lower.startsWith('canceled')) return 'canceled';
  if (lower.includes('past_due') || lower.includes('past-due')) return 'past_due';
  if (lower.includes('trial')) return 'trial';
  return undefined;
}

function matchesFilter(
  statusFilter: UiSubscriptionStatusFilter | undefined,
  status: SubscriptionState | undefined,
): boolean {
  if (!statusFilter) return true;
  const normalized = normalizeStatus(status);
  return normalized === statusFilter;
}

function matchesSearch(
  search: string | undefined,
  customerName: string,
  customerEmail: string,
): boolean {
  if (!search) return true;
  const needle = search.toLowerCase();
  return (
    customerName.toLowerCase().includes(needle) ||
    customerEmail.toLowerCase().includes(needle)
  );
}

// -----------------------------------------------------------------------------
// Core exported functions used by tests and the UI
// -----------------------------------------------------------------------------

export async function viewAllSubscriptions(
  statusFilter?: UiSubscriptionStatusFilter,
  search?: string,
): Promise<UiSubscriptionSummary[]> {
  const response = await subscriptionsController.listSubscriptions({
    page: 1,
    perPage: 50,
    sort: SubscriptionSort.SignupDate,
    include: [SubscriptionListInclude.SelfServicePageToken],
  });

  const list = response.result ?? [];

  const mapped: UiSubscriptionSummary[] = [];

  for (const item of list) {
    const sub = item.subscription;
    if (!sub) continue;

    const customer = sub.customer;
    const product = sub.product;

    const customerName = `${customer?.firstName ?? ''} ${customer?.lastName ?? ''}`.trim();
    const customerEmail = customer?.email ?? '';

    if (
      !matchesFilter(statusFilter, sub.state) ||
      !matchesSearch(search, customerName, customerEmail)
    ) {
      continue;
    }

    mapped.push({
      id: sub.id ?? String(sub.subscriptionId ?? ''),
      customerName,
      customerEmail,
      plan: product?.name ?? '',
      status: sub.state,
      nextBillingDate: sub.nextAssessmentAt ?? null,
      monthlyAmountCents:
        sub.productPriceInCents != null
          ? Number(sub.productPriceInCents)
          : null,
    });
  }

  return mapped;
}

export async function getSubscriptionDetails(
  subscriptionId: number,
): Promise<UiSubscriptionDetails> {
  const response = await subscriptionsController.readSubscription(
    subscriptionId,
  );

  const sub = response.result.subscription;

  if (!sub || !sub.id) {
    throw new Error(`Subscription ${subscriptionId} not found`);
  }

  const customer = sub.customer;
  const product = sub.product;

  const name = `${customer?.firstName ?? ''} ${customer?.lastName ?? ''}`.trim();

  return {
    id: Number(sub.id),
    customerInfo: {
      name,
      email: customer?.email ?? '',
    },
    currentPlan: product?.name ?? '',
    currentPriceCents:
      sub.productPriceInCents != null
        ? Number(sub.productPriceInCents)
        : null,
    status: sub.state,
    billingCycle: {
      currentPeriodStartedAt: sub.currentPeriodStartedAt ?? null,
      currentPeriodEndsAt: sub.currentPeriodEndsAt ?? null,
    },
    nextBillingDate: sub.nextAssessmentAt ?? null,
    paymentMethod: (sub.paymentCollectionMethod as string | null) ?? null,
  };
}

export async function changeSubscriptionPlan(
  subscriptionId: number,
  productId: number,
  when: ChangeSubscriptionWhen,
): Promise<void> {
  const body: SubscriptionProductMigrationRequest = {
    migration: {
      productId,
      // When the change is scheduled for the next billing cycle we preserve
      // the current period; otherwise apply immediately.
      preservePeriod: when === 'next_billing',
    },
  };

  await subscriptionProductsController.migrateSubscriptionProduct(
    subscriptionId,
    body,
  );
}

export async function cancelSubscriptionCore(
  subscriptionId: number,
  when: CancelSubscriptionWhen,
  reason: string,
): Promise<void> {
  if (when === 'immediately') {
    await subscriptionStatusController.cancelSubscription(subscriptionId, {
      subscription: {
        cancellationMessage: reason,
      },
    });
    return;
  }

  await subscriptionStatusController.initiateDelayedCancellation(
    subscriptionId,
    {
      subscription: {
        cancellationMessage: reason,
      },
    },
  );
}

// -----------------------------------------------------------------------------
// Minimal Express-based UI
// -----------------------------------------------------------------------------

const app = express();

app.use(cors());
app.use(express.json());

app.get('/api/subscriptions', async (req: Request, res: Response) => {
  try {
    const status = req.query.status as UiSubscriptionStatusFilter | undefined;
    const search = req.query.search as string | undefined;
    const data = await viewAllSubscriptions(status, search);
    res.json({ data });
  } catch (error: unknown) {
    const err = error as ApiError | Error;
    res.status(500).json({
      message: 'Failed to fetch subscriptions',
      error: err instanceof ApiError ? err.body : err.message,
    });
  }
});

app.get('/api/subscriptions/:id', async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const details = await getSubscriptionDetails(id);
    res.json({ data: details });
  } catch (error: unknown) {
    const err = error as ApiError | Error;
    const statusCode = err instanceof ApiError && err.statusCode ? err.statusCode : 500;
    res.status(statusCode).json({
      message: 'Failed to fetch subscription details',
      error: err instanceof ApiError ? err.body : err.message,
    });
  }
});

app.post('/api/subscriptions/:id/change-plan', async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const { productId, when } = req.body as {
      productId: number;
      when: ChangeSubscriptionWhen;
    };

    await changeSubscriptionPlan(id, Number(productId), when);
    res.status(204).send();
  } catch (error: unknown) {
    const err = error as ApiError | Error;
    const statusCode = err instanceof ApiError && err.statusCode ? err.statusCode : 400;
    res.status(statusCode).json({
      message: 'Failed to change subscription plan',
      error: err instanceof ApiError ? err.body : err.message,
    });
  }
});

app.post('/api/subscriptions/:id/cancel', async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const { when, reason } = req.body as {
      when: CancelSubscriptionWhen;
      reason?: string;
    };

    await cancelSubscriptionCore(id, when, reason ?? '');
    res.status(204).send();
  } catch (error: unknown) {
    const err = error as ApiError | Error;
    const statusCode = err instanceof ApiError && err.statusCode ? err.statusCode : 400;
    res.status(statusCode).json({
      message: 'Failed to cancel subscription',
      error: err instanceof ApiError ? err.body : err.message,
    });
  }
});

app.get('/', (_req: Request, res: Response) => {
  res.type('html').send(`<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Maxio Subscription Admin</title>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      :root {
        color-scheme: light dark;
        --bg: #0f172a;
        --bg-alt: #020617;
        --card: #111827;
        --fg: #e5e7eb;
        --accent: #22c55e;
        --accent-soft: rgba(34, 197, 94, 0.12);
        --danger: #f97373;
        --border: rgba(148, 163, 184, 0.35);
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        min-height: 100vh;
        font-family: system-ui, -apple-system, BlinkMacSystemFont, 'SF Pro Text', sans-serif;
        background: radial-gradient(circle at top left, #1e293b, #020617 55%);
        color: var(--fg);
        display: flex;
        flex-direction: column;
        align-items: stretch;
      }
      header {
        padding: 1.5rem 2rem 0.75rem;
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 1rem;
      }
      .brand {
        font-weight: 600;
        letter-spacing: 0.04em;
        text-transform: uppercase;
        font-size: 0.8rem;
        opacity: 0.9;
      }
      .pill {
        padding: 0.2rem 0.6rem;
        border-radius: 999px;
        background: var(--accent-soft);
        color: var(--accent);
        font-size: 0.7rem;
        font-weight: 600;
      }
      main {
        padding: 0 2rem 2rem;
        display: grid;
        grid-template-columns: minmax(0, 3fr) minmax(0, 2.2fr);
        gap: 1.5rem;
      }
      @media (max-width: 900px) {
        main {
          grid-template-columns: minmax(0, 1fr);
          padding: 0 1rem 1.5rem;
        }
        header { padding: 1rem 1rem 0.5rem; }
      }
      .card {
        background: radial-gradient(circle at top left, rgba(148, 163, 184, 0.24), rgba(15, 23, 42, 0.96));
        border-radius: 1rem;
        border: 1px solid rgba(148, 163, 184, 0.55);
        backdrop-filter: blur(30px);
        box-shadow:
          0 40px 80px rgba(15, 23, 42, 0.8),
          0 0 0 1px rgba(15, 23, 42, 0.9);
        overflow: hidden;
        position: relative;
      }
      .card::before {
        content: '';
        position: absolute;
        inset: 0;
        background: radial-gradient(circle at top right, rgba(56, 189, 248, 0.2), transparent 55%);
        mix-blend-mode: screen;
        opacity: 0.6;
        pointer-events: none;
      }
      .card-header {
        padding: 1.1rem 1.25rem 0.4rem;
        display: flex;
        justify-content: space-between;
        align-items: center;
        position: relative;
        z-index: 1;
      }
      .card-title {
        font-size: 0.95rem;
        font-weight: 600;
        letter-spacing: 0.02em;
      }
      .card-subtitle {
        font-size: 0.8rem;
        opacity: 0.8;
        margin-top: 0.15rem;
      }
      .chip-row {
        display: flex;
        gap: 0.45rem;
        flex-wrap: wrap;
        margin-top: 0.35rem;
      }
      .chip {
        border-radius: 999px;
        padding: 0.2rem 0.55rem;
        border: 1px solid rgba(148, 163, 184, 0.4);
        font-size: 0.7rem;
        opacity: 0.85;
      }
      .chip strong {
        font-weight: 600;
      }
      .card-body {
        padding: 0.75rem 1.25rem 1.1rem;
        position: relative;
        z-index: 1;
      }
      .filters {
        display: flex;
        flex-wrap: wrap;
        gap: 0.45rem;
        margin-bottom: 0.75rem;
      }
      .filter-pill {
        padding: 0.35rem 0.9rem;
        border-radius: 999px;
        border: 1px solid rgba(148, 163, 184, 0.5);
        font-size: 0.75rem;
        cursor: pointer;
        background: rgba(15, 23, 42, 0.7);
        display: inline-flex;
        align-items: center;
        gap: 0.35rem;
      }
      .filter-pill[data-active=\"true\"] {
        border-color: rgba(34, 197, 94, 0.9);
        background: linear-gradient(135deg, rgba(34, 197, 94, 0.12), rgba(22, 163, 74, 0.5));
        box-shadow: 0 0 0 1px rgba(34, 197, 94, 0.3);
      }
      .filter-dot {
        width: 6px;
        height: 6px;
        border-radius: 999px;
        background: rgba(34, 197, 94, 1);
      }
      .filter-pill[data-kind=\"danger\"] .filter-dot {
        background: var(--danger);
      }
      .search-row {
        display: flex;
        gap: 0.4rem;
        align-items: center;
        margin-bottom: 0.4rem;
      }
      .search-input {
        flex: 1;
        padding: 0.45rem 0.75rem;
        border-radius: 0.6rem;
        border: 1px solid rgba(148, 163, 184, 0.55);
        background: rgba(15, 23, 42, 0.7);
        color: var(--fg);
        font-size: 0.8rem;
        outline: none;
      }
      .search-input:focus {
        border-color: rgba(34, 197, 94, 0.8);
        box-shadow: 0 0 0 1px rgba(34, 197, 94, 0.3);
      }
      .table-wrapper {
        max-height: 420px;
        overflow: auto;
        margin-top: 0.25rem;
        border-radius: 0.75rem;
        border: 1px solid rgba(15, 23, 42, 0.9);
        background: radial-gradient(circle at top left, rgba(15, 23, 42, 0.95), rgba(2, 6, 23, 1));
      }
      table {
        width: 100%;
        border-collapse: collapse;
        font-size: 0.78rem;
      }
      thead {
        position: sticky;
        top: 0;
        background: linear-gradient(to bottom, rgba(15, 23, 42, 0.98), rgba(15, 23, 42, 0.9));
        z-index: 1;
      }
      th, td {
        padding: 0.4rem 0.65rem;
        text-align: left;
        white-space: nowrap;
      }
      th {
        font-weight: 500;
        color: rgba(148, 163, 184, 0.95);
        border-bottom: 1px solid rgba(30, 64, 175, 0.8);
        position: relative;
      }
      th::after {
        content: '';
        position: absolute;
        inset: auto 0 -1px;
        height: 1px;
        background: linear-gradient(to right, transparent, rgba(56, 189, 248, 0.7), transparent);
        opacity: 0.7;
      }
      tbody tr {
        cursor: pointer;
        transition: background 0.12s ease-out, transform 0.06s ease-out;
      }
      tbody tr:nth-child(even) {
        background: rgba(15, 23, 42, 0.9);
      }
      tbody tr:nth-child(odd) {
        background: rgba(15, 23, 42, 0.98);
      }
      tbody tr:hover {
        background: radial-gradient(circle at left, rgba(34, 197, 94, 0.18), rgba(15, 23, 42, 0.98));
        transform: translateY(-1px);
      }
      .badge {
        padding: 0.18rem 0.55rem;
        border-radius: 999px;
        font-size: 0.7rem;
        border: 1px solid rgba(148, 163, 184, 0.6);
        text-transform: uppercase;
        letter-spacing: 0.06em;
      }
      .badge[data-kind=\"good\"] {
        border-color: rgba(34, 197, 94, 0.9);
        background: rgba(34, 197, 94, 0.16);
        color: rgba(187, 247, 208, 1);
      }
      .badge[data-kind=\"warn\"] {
        border-color: rgba(248, 250, 252, 0.6);
        background: rgba(248, 250, 252, 0.08);
      }
      .badge[data-kind=\"danger\"] {
        border-color: rgba(248, 113, 113, 0.9);
        background: rgba(248, 113, 113, 0.18);
        color: rgba(254, 242, 242, 1);
      }
      .pill-sm {
        padding: 0.18rem 0.45rem;
        border-radius: 999px;
        font-size: 0.7rem;
        border: 1px solid rgba(148, 163, 184, 0.5);
        opacity: 0.9;
      }
      .muted {
        opacity: 0.75;
      }
      .detail-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 0.6rem 1.1rem;
        font-size: 0.8rem;
      }
      .detail-label {
        font-size: 0.7rem;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        opacity: 0.8;
        margin-bottom: 0.12rem;
      }
      .detail-value {
        font-weight: 500;
      }
      .actions {
        margin-top: 1rem;
        display: grid;
        gap: 0.6rem;
      }
      .actions-row {
        display: flex;
        gap: 0.6rem;
        flex-wrap: wrap;
      }
      .field {
        display: flex;
        flex-direction: column;
        gap: 0.2rem;
        flex: 1;
        min-width: 0;
      }
      .field-label {
        font-size: 0.75rem;
        opacity: 0.85;
      }
      .select,
      .input {
        padding: 0.4rem 0.6rem;
        border-radius: 0.55rem;
        border: 1px solid rgba(148, 163, 184, 0.55);
        background: rgba(15, 23, 42, 0.85);
        color: var(--fg);
        font-size: 0.78rem;
        outline: none;
      }
      .select:focus,
      .input:focus {
        border-color: rgba(94, 234, 212, 0.9);
      }
      .button {
        padding: 0.45rem 0.9rem;
        border-radius: 999px;
        border: none;
        cursor: pointer;
        font-size: 0.78rem;
        font-weight: 500;
        display: inline-flex;
        align-items: center;
        gap: 0.4rem;
        background: radial-gradient(circle at top left, rgba(34, 197, 94, 0.7), rgba(22, 163, 74, 1));
        color: #ecfdf5;
        box-shadow:
          0 18px 30px rgba(22, 163, 74, 0.55),
          0 0 0 1px rgba(21, 128, 61, 0.7);
      }
      .button[disabled] {
        opacity: 0.6;
        cursor: not-allowed;
        box-shadow: none;
      }
      .button-ghost {
        background: transparent;
        border-radius: 999px;
        border: 1px solid rgba(148, 163, 184, 0.55);
        color: rgba(248, 250, 252, 0.9);
        box-shadow: none;
      }
      .tagline {
        font-size: 0.75rem;
        opacity: 0.7;
      }
      .status-dot {
        width: 8px;
        height: 8px;
        border-radius: 999px;
        margin-right: 0.4rem;
      }
      .status-dot[data-kind=\"good\"] { background: var(--accent); }
      .status-dot[data-kind=\"warn\"] { background: #facc15; }
      .status-dot[data-kind=\"danger\"] { background: var(--danger); }
      .pill-soft {
        padding: 0.16rem 0.45rem;
        border-radius: 999px;
        border: 1px solid rgba(148, 163, 184, 0.45);
        font-size: 0.7rem;
        opacity: 0.85;
      }
      .small {
        font-size: 0.72rem;
      }
      .error-banner {
        margin-top: 0.4rem;
        padding: 0.4rem 0.6rem;
        border-radius: 0.55rem;
        border: 1px solid rgba(248, 113, 113, 0.9);
        background: rgba(127, 29, 29, 0.85);
        font-size: 0.72rem;
      }
      .skeleton {
        background: linear-gradient(
          90deg,
          rgba(30, 64, 175, 0.5),
          rgba(30, 64, 175, 0.9),
          rgba(30, 64, 175, 0.5)
        );
        background-size: 200% 100%;
        animation: shimmer 1.2s infinite;
        border-radius: 0.4rem;
        height: 0.8rem;
      }
      @keyframes shimmer {
        0% { background-position: -120% 0; }
        100% { background-position: 120% 0; }
      }
    </style>
  </head>
  <body>
    <header>
      <div>
        <div class="brand">Maxio · Subscription Admin</div>
        <div class="tagline">Search, inspect, and manage customer subscriptions in real time.</div>
      </div>
      <div class="pill">AI-ready sandbox UI</div>
    </header>
    <main>
      <section class="card" aria-label="Subscriptions list">
        <div class="card-header">
          <div>
            <div class="card-title">Customer subscriptions</div>
            <div class="card-subtitle">Filter by status, search by name or email, then click any row to inspect details.</div>
          </div>
          <div class="chip-row">
            <div class="chip"><strong>Live</strong>&nbsp;Read-only against your Maxio environment</div>
          </div>
        </div>
        <div class="card-body">
          <div class="filters" id="filters">
            <button class="filter-pill" data-status="" data-active="true">
              <span class="filter-dot"></span>
              All
            </button>
            <button class="filter-pill" data-status="active">
              <span class="filter-dot"></span>
              Active
            </button>
            <button class="filter-pill" data-status="trial">
              <span class="filter-dot"></span>
              Trial
            </button>
            <button class="filter-pill" data-status="past_due" data-kind="danger">
              <span class="filter-dot"></span>
              Past due
            </button>
            <button class="filter-pill" data-status="canceled">
              <span class="filter-dot"></span>
              Canceled
            </button>
          </div>
          <div class="search-row">
            <input
              id="search"
              class="search-input"
              placeholder="Search by customer name or email…"
              autocomplete="off"
            />
            <button class="button-ghost" id="refreshBtn">Refresh</button>
          </div>
          <div class="small muted" id="summaryText">Loading subscriptions…</div>
          <div class="table-wrapper" aria-label="Subscriptions table">
            <table>
              <thead>
                <tr>
                  <th>Customer</th>
                  <th>Email</th>
                  <th>Plan</th>
                  <th>Status</th>
                  <th>Next billing</th>
                  <th>Amount</th>
                </tr>
              </thead>
              <tbody id="tableBody">
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section class="card" aria-label="Subscription details and actions">
        <div class="card-header">
          <div>
            <div class="card-title">Subscription details</div>
            <div class="card-subtitle" id="detailSubtitle">Select a subscription from the table to see its full context.</div>
          </div>
          <div class="chip-row">
            <div class="chip">Non-destructive sandbox actions only</div>
          </div>
        </div>
        <div class="card-body">
          <div id="detailContent" class="detail-grid">
            <div>
              <div class="detail-label">Customer</div>
              <div class="detail-value muted">—</div>
            </div>
            <div>
              <div class="detail-label">Email</div>
              <div class="detail-value muted">—</div>
            </div>
            <div>
              <div class="detail-label">Plan</div>
              <div class="detail-value muted">—</div>
            </div>
            <div>
              <div class="detail-label">Status</div>
              <div class="detail-value muted">—</div>
            </div>
            <div>
              <div class="detail-label">Current period</div>
              <div class="detail-value muted">—</div>
            </div>
            <div>
              <div class="detail-label">Next billing</div>
              <div class="detail-value muted">—</div>
            </div>
            <div>
              <div class="detail-label">Price</div>
              <div class="detail-value muted">—</div>
            </div>
            <div>
              <div class="detail-label">Payment method</div>
              <div class="detail-value muted">—</div>
            </div>
          </div>
          <div id="detailError" class="error-banner" style="display:none;"></div>
          <div class="actions">
            <div class="actions-row">
              <div class="field">
                <label class="field-label" for="planProductId">Change plan</label>
                <input id="planProductId" class="input" placeholder="New product id (from Maxio)" />
              </div>
              <div class="field">
                <label class="field-label" for="planWhen">When should the change apply?</label>
                <select id="planWhen" class="select">
                  <option value="immediately">Immediately (prorated)</option>
                  <option value="next_billing">On next billing</option>
                </select>
              </div>
            </div>
            <button class="button" id="applyPlanBtn" disabled>
              <span>Apply plan change</span>
            </button>
            <div class="actions-row">
              <div class="field">
                <label class="field-label" for="cancelReason">Cancel subscription</label>
                <input
                  id="cancelReason"
                  class="input"
                  placeholder="Optional reason or internal note"
                />
              </div>
              <div class="field">
                <label class="field-label" for="cancelWhen">When should cancellation occur?</label>
                <select id="cancelWhen" class="select">
                  <option value="immediately">Immediately</option>
                  <option value="period_end">At period end</option>
                </select>
              </div>
            </div>
            <button class="button-ghost" id="cancelBtn" disabled>
              <span>Schedule / apply cancellation</span>
            </button>
            <div class="small muted">
              All actions call the underlying Maxio Advanced Billing API. Use with a sandbox
              site or test data.
            </div>
          </div>
        </div>
      </section>
    </main>

    <script>
      const statusBadges = (status) => {
        if (!status) return { kind: 'warn', label: 'Unknown' };
        const s = String(status).toLowerCase();
        if (s.startsWith('active')) return { kind: 'good', label: 'Active' };
        if (s.includes('trial')) return { kind: 'good', label: 'Trial' };
        if (s.includes('past')) return { kind: 'danger', label: 'Past due' };
        if (s.startsWith('canceled')) return { kind: 'danger', label: 'Canceled' };
        return { kind: 'warn', label: status };
      };

      const formatDate = (value) => {
        if (!value) return '—';
        try {
          const d = new Date(value);
          if (Number.isNaN(d.getTime())) return value;
          return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
        } catch {
          return value;
        }
      };

      const formatMoney = (cents) => {
        if (cents == null) return '—';
        const v = Number(cents) / 100;
        if (!Number.isFinite(v)) return '—';
        return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(v);
      };

      let currentFilter = '';
      let currentSearch = '';
      let currentSelection = null;

      const tableBody = document.getElementById('tableBody');
      const summaryText = document.getElementById('summaryText');
      const detailContent = document.getElementById('detailContent');
      const detailSubtitle = document.getElementById('detailSubtitle');
      const detailError = document.getElementById('detailError');
      const filtersEl = document.getElementById('filters');
      const searchInput = document.getElementById('search');
      const refreshBtn = document.getElementById('refreshBtn');
      const planProductId = document.getElementById('planProductId');
      const planWhen = document.getElementById('planWhen');
      const applyPlanBtn = document.getElementById('applyPlanBtn');
      const cancelReason = document.getElementById('cancelReason');
      const cancelWhen = document.getElementById('cancelWhen');
      const cancelBtn = document.getElementById('cancelBtn');

      const setSelection = (subscription) => {
        currentSelection = subscription;
        applyPlanBtn.disabled = !subscription;
        cancelBtn.disabled = !subscription;
        if (!subscription) {
          detailSubtitle.textContent = 'Select a subscription from the table to see its full context.';
          detailContent.innerHTML = '<div class="muted small">No subscription selected.</div>';
          return;
        }
        detailSubtitle.textContent = 'Live view of the selected subscription, including billing cycle and payment method.';
        detailContent.innerHTML = '';
        const rows = [];
        const pushRow = (label, value) => {
          const wrapper = document.createElement('div');
          wrapper.innerHTML = '<div class="detail-label"></div><div class="detail-value"></div>';
          wrapper.querySelector('.detail-label').textContent = label;
          wrapper.querySelector('.detail-value').textContent = value || '—';
          detailContent.appendChild(wrapper);
        };
        pushRow('Customer', subscription.customerInfo?.name);
        pushRow('Email', subscription.customerInfo?.email);
        pushRow('Plan', subscription.currentPlan);
        pushRow('Status', subscription.status || '—');
        const period =
          formatDate(subscription.billingCycle?.currentPeriodStartedAt) +
          ' → ' +
          formatDate(subscription.billingCycle?.currentPeriodEndsAt);
        pushRow('Current period', period);
        pushRow('Next billing', formatDate(subscription.nextBillingDate));
        pushRow('Price', formatMoney(subscription.currentPriceCents));
        pushRow('Payment method', subscription.paymentMethod || '—');
      };

      const renderSkeleton = () => {
        tableBody.innerHTML = '';
        for (let i = 0; i < 4; i++) {
          const tr = document.createElement('tr');
          for (let j = 0; j < 6; j++) {
            const td = document.createElement('td');
            td.innerHTML = '<div class="skeleton"></div>';
            tr.appendChild(td);
          }
          tableBody.appendChild(tr);
        }
      };

      const loadList = async () => {
        detailError.style.display = 'none';
        renderSkeleton();
        const params = new URLSearchParams();
        if (currentFilter) params.set('status', currentFilter);
        if (currentSearch) params.set('search', currentSearch);
        try {
          const res = await fetch('/api/subscriptions?' + params.toString());
          if (!res.ok) throw new Error('Failed to load subscriptions');
          const json = await res.json();
          const data = json.data || [];
          summaryText.textContent = data.length
            ? \`\${data.length} subscription\${data.length === 1 ? '' : 's'} loaded\`
            : 'No subscriptions match the current filters.';
          tableBody.innerHTML = '';
          data.forEach((sub) => {
            const tr = document.createElement('tr');
            tr.dataset.id = sub.id;
            const { kind, label } = statusBadges(sub.status);
            tr.innerHTML = \`
              <td>\${sub.customerName || '—'}</td>
              <td class="muted">\${sub.customerEmail || '—'}</td>
              <td>\${sub.plan || '—'}</td>
              <td>
                <span class="badge" data-kind="\${kind}">
                  <span class="status-dot" data-kind="\${kind}"></span>\${label}
                </span>
              </td>
              <td>\${formatDate(sub.nextBillingDate)}</td>
              <td>\${formatMoney(sub.monthlyAmountCents)}</td>
            \`;
            tr.addEventListener('click', async () => {
              try {
                const detailRes = await fetch('/api/subscriptions/' + encodeURIComponent(sub.id));
                if (!detailRes.ok) throw new Error('Failed to load subscription details');
                const detailJson = await detailRes.json();
                setSelection(detailJson.data);
              } catch (err) {
                detailError.textContent = 'Unable to load subscription details. ' + (err?.message || '');
                detailError.style.display = 'block';
              }
            });
            tableBody.appendChild(tr);
          });
        } catch (err) {
          summaryText.textContent = 'We could not load subscriptions from Maxio. Check credentials and network.';
          tableBody.innerHTML = '';
        }
      };

      filtersEl.addEventListener('click', (event) => {
        const btn = event.target.closest('button[data-status]');
        if (!btn) return;
        const status = btn.getAttribute('data-status') || '';
        currentFilter = status;
        filtersEl.querySelectorAll('button[data-status]').forEach((el) => {
          el.setAttribute('data-active', el === btn ? 'true' : 'false');
        });
        loadList();
      });

      searchInput.addEventListener('input', () => {
        currentSearch = searchInput.value.trim();
        clearTimeout(searchInput.__timer);
        searchInput.__timer = setTimeout(loadList, 250);
      });

      refreshBtn.addEventListener('click', () => {
        loadList();
      });

      applyPlanBtn.addEventListener('click', async () => {
        if (!currentSelection) return;
        const productId = Number(planProductId.value);
        if (!Number.isFinite(productId) || productId <= 0) {
          alert('Please enter a valid numeric product id.');
          return;
        }
        applyPlanBtn.disabled = true;
        try {
          await fetch('/api/subscriptions/' + encodeURIComponent(currentSelection.id) + '/change-plan', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              productId,
              when: planWhen.value,
            }),
          }).then((r) => {
            if (!r.ok) throw new Error('Request failed');
          });
          await loadList();
        } catch (err) {
          detailError.textContent = 'Failed to change subscription plan. ' + (err?.message || '');
          detailError.style.display = 'block';
        } finally {
          applyPlanBtn.disabled = false;
        }
      });

      cancelBtn.addEventListener('click', async () => {
        if (!currentSelection) return;
        const when = cancelWhen.value;
        const reason = cancelReason.value;
        cancelBtn.disabled = true;
        try {
          await fetch('/api/subscriptions/' + encodeURIComponent(currentSelection.id) + '/cancel', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ when, reason }),
          }).then((r) => {
            if (!r.ok) throw new Error('Request failed');
          });
          await loadList();
        } catch (err) {
          detailError.textContent = 'Failed to cancel subscription. ' + (err?.message || '');
          detailError.style.display = 'block';
        } finally {
          cancelBtn.disabled = false;
        }
      });

      loadList();
    </script>
  </body>
</html>`);
});

const port = Number(process.env.PORT ?? '3000');

export const server: Server = app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`Maxio subscription admin listening on http://localhost:${port}`);
});

 