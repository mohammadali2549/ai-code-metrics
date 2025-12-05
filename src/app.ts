import 'dotenv/config';
import express from 'express';
import type { Request, Response } from 'express';
import cors from 'cors';

import {
  ApiError,
  Client,
  CustomersController,
  Environment,
  SubscriptionStateFilter,
  SubscriptionsController,
  SubscriptionProductsController,
  SubscriptionStatusController,
} from '@maxio-com/advanced-billing-sdk';
import type { SubscriptionProductMigrationRequest } from '@maxio-com/advanced-billing-sdk';

// -------------------------------
// Configuration
// -------------------------------

const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;

function getRequiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required environment variable "${name}". Configure it in your .env file or CI/CD environment (e.g. GitHub Actions secrets).`,
    );
  }
  return value;
}

const MAXIO_SITE = getRequiredEnv('MAXIO_SITE');
const MAXIO_ENVIRONMENT =
  ((process.env.MAXIO_ENVIRONMENT as Environment | undefined) ??
    Environment.US);
const MAXIO_BASIC_AUTH_USERNAME = getRequiredEnv('MAXIO_BASIC_AUTH_USERNAME');
const MAXIO_BASIC_AUTH_PASSWORD = getRequiredEnv('MAXIO_BASIC_AUTH_PASSWORD');

// -------------------------------
// Maxio SDK Client & Controllers
// -------------------------------

const client = new Client({
  basicAuthCredentials: {
    username: MAXIO_BASIC_AUTH_USERNAME,
    password: MAXIO_BASIC_AUTH_PASSWORD,
  },
  timeout: 120_000,
  environment: MAXIO_ENVIRONMENT,
  site: MAXIO_SITE,
});

const subscriptionsController = new SubscriptionsController(client);
const subscriptionProductsController = new SubscriptionProductsController(
  client,
);
const subscriptionStatusController = new SubscriptionStatusController(client);
// CustomersController imported for possible future extension (e.g., dedicated customer search).
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const customersController = new CustomersController(client);

// -------------------------------
// Express App Setup
// -------------------------------

const app = express();

app.use(cors());
app.use(express.json());

// -------------------------------
// Helpers
// -------------------------------

export type UiSubscriptionStatusFilter =
  | 'active'
  | 'canceled'
  | 'past_due'
  | 'trial';

function mapUiStatusToMaxioState(
  status?: UiSubscriptionStatusFilter,
): SubscriptionStateFilter | undefined {
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

function handleApiError(error: unknown, res: Response): void {
  if (error instanceof ApiError) {
    sendJson(
      res,
      {
        statusCode: error.statusCode,
        headers: error.headers,
        body: error.body,
      },
      error.statusCode ?? 500,
    );
  } else {
    // eslint-disable-next-line no-console
    console.error('Unexpected error', error);
    sendJson(res, { message: 'Internal Server Error' }, 500);
  }
}

function sendJson(res: Response, body: unknown, statusCode = 200): void {
  const json = JSON.stringify(
    body,
    (_key, value) => (typeof value === 'bigint' ? value.toString() : value),
  );
  res.status(statusCode);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.send(json);
}

// -------------------------------
// Core Operations (Reusable in Tests)
// -------------------------------

/**
 * View all subscriptions (optionally filtered by status & search term).
 *
 * This contains the core logic used by the `/api/subscriptions` route and can
 * be imported directly in tests.
 */
export async function viewAllSubscriptions(
  status?: UiSubscriptionStatusFilter,
  search?: string,
): Promise<
  Array<{
    id: unknown;
    customerName: string;
    customerEmail: string;
    plan: string;
    status: unknown;
    nextBillingDate: unknown;
    monthlyAmountCents: unknown;
  }>
> {
  const stateFilter = mapUiStatusToMaxioState(status);

  const options: Parameters<
    (typeof subscriptionsController)['listSubscriptions']
  >[0] = {
    page: 1,
    perPage: 100,
    include: [],
  };

  if (stateFilter !== undefined) {
    options.state = stateFilter;
  }

  const response = await subscriptionsController.listSubscriptions(options);

  const searchLower = search?.toLowerCase();

  const items =
    response.result?.map((item) => {
      const subscription = item.subscription;
      if (!subscription) return null;

      const customer = subscription.customer;
      const customerName = customer
        ? `${customer.firstName ?? ''} ${customer.lastName ?? ''}`.trim()
        : 'Unknown';

      if (searchLower && customer) {
        const matchesName =
          (customer.firstName ?? '').toLowerCase().includes(searchLower) ||
          (customer.lastName ?? '').toLowerCase().includes(searchLower);
        const matchesEmail =
          (customer.email ?? '').toLowerCase().includes(searchLower);

        if (!matchesName && !matchesEmail) {
          return null;
        }
      } else if (searchLower && !customer) {
        return null;
      }

      return {
        id: subscription.id,
        customerName,
        customerEmail: customer?.email ?? '',
        plan: subscription.product?.name ?? '',
        status: subscription.state,
        nextBillingDate: subscription.currentPeriodEndsAt,
        monthlyAmountCents: subscription.productPriceInCents,
      };
    }) ?? [];

  const filtered = items.filter(
    (item): item is NonNullable<(typeof items)[number]> => item !== null,
  );

  return filtered;
}

/**
 * View a single subscription's details.
 *
 * Shared by the `/api/subscriptions/:id` route and tests.
 */
export async function getSubscriptionDetails(
  subscriptionId: number,
): Promise<{
  id: unknown;
  customerInfo: { name: string; email: string };
  currentPlan: string;
  currentPriceCents: unknown;
  status: unknown;
  billingCycle: {
    currentPeriodStartedAt: unknown;
    currentPeriodEndsAt: unknown;
  };
  nextBillingDate: unknown;
  paymentMethod: unknown;
}> {
  const response =
    await subscriptionsController.readSubscription(subscriptionId);

  const subscription = response.result.subscription;

  if (!subscription) {
    throw new Error('Subscription not found');
  }

  const customer = subscription.customer;

  const customerName = customer
    ? `${customer.firstName ?? ''} ${customer.lastName ?? ''}`.trim()
    : 'Unknown';

  return {
    id: subscription.id,
    customerInfo: {
      name: customerName,
      email: customer?.email ?? '',
    },
    currentPlan: subscription.product?.name ?? '',
    currentPriceCents: subscription.productPriceInCents,
    status: subscription.state,
    billingCycle: {
      currentPeriodStartedAt: subscription.currentPeriodStartedAt,
      currentPeriodEndsAt: subscription.currentPeriodEndsAt,
    },
    nextBillingDate: subscription.currentPeriodEndsAt,
    paymentMethod: subscription.paymentType,
  };
}

export type ChangeSubscriptionWhen = 'immediately' | 'next_billing';

/**
 * Change a subscription's plan.
 *
 * Shared by the `/api/subscriptions/:id/change-plan` route and tests.
 */
export async function changeSubscriptionPlan(
  subscriptionId: number,
  productId: number,
  when: ChangeSubscriptionWhen,
) {
  const preservePeriod = when === 'next_billing';

  const body: SubscriptionProductMigrationRequest = {
    migration: {
      productId,
      preservePeriod,
    },
  };

  const response =
    await subscriptionProductsController.migrateSubscriptionProduct(
      subscriptionId,
      body,
    );

  return response.result.subscription;
}

export type CancelSubscriptionWhen = 'immediately' | 'period_end';

/**
 * Cancel a subscription.
 *
 * Shared by the `/api/subscriptions/:id/cancel` route and tests.
 */
export async function cancelSubscriptionCore(
  subscriptionId: number,
  when: CancelSubscriptionWhen,
  reason?: string,
): Promise<
  | {
      message: unknown;
      cancellationType: 'period_end';
      reason: string | null;
    }
  | {
      subscription: unknown;
      cancellationType: 'immediately';
      reason: string | null;
    }
> {
  if (when === 'period_end') {
    const response =
      await subscriptionStatusController.initiateDelayedCancellation(
        subscriptionId,
      );

    return {
      message: response.result.message,
      cancellationType: 'period_end',
      reason: reason ?? null,
    };
  }

  const response = await subscriptionStatusController.cancelSubscription(
    subscriptionId,
  );

  return {
    subscription: response.result.subscription,
    cancellationType: 'immediately',
    reason: reason ?? null,
  };
}

// -------------------------------
// API Routes
// -------------------------------

/**
 * 1. View All Subscriptions
 *
 * Query params:
 * - status: 'active' | 'canceled' | 'past_due' | 'trial'
 * - search: string (matches customer first name, last name, or email; case-insensitive substring)
 *
 * Response: array of subscriptions with
 * - customerName, customerEmail, plan, status, nextBillingDate, monthlyAmount
 */
app.get(
  '/api/subscriptions',
  async (
    req: Request<
      never,
      unknown,
      unknown,
      { status?: UiSubscriptionStatusFilter; search?: string }
    >,
    res: Response,
  ) => {
    try {
      const { status, search } = req.query;
      const result = await viewAllSubscriptions(status, search);
      sendJson(res, result);
    } catch (error) {
      handleApiError(error, res);
    }
  },
);

/**
 * 2. View Single Subscription Details
 *
 * Path param: :id (subscription id)
 *
 * Response:
 * - customerInfo (name, email)
 * - current plan and price
 * - status
 * - billing cycle & next billing date
 * - payment method on file (high-level)
 */
app.get(
  '/api/subscriptions/:id',
  async (req: Request<{ id: string }>, res: Response) => {
    const subscriptionId = Number.parseInt(req.params.id, 10);

    if (Number.isNaN(subscriptionId)) {
      sendJson(res, { message: 'Invalid subscription id' }, 400);
      return;
    }

    try {
      const details = await getSubscriptionDetails(subscriptionId);
      sendJson(res, details);
    } catch (error) {
      if (error instanceof Error && error.message === 'Subscription not found') {
        sendJson(res, { message: 'Subscription not found' }, 404);
        return;
      }
      handleApiError(error, res);
    }
  },
);

/**
 * 3. Change Subscription Plan
 *
 * Path param: :id (subscription id)
 *
 * Body:
 * - productId: number (target plan/product id)
 * - when: 'immediately' | 'next_billing'
 *
 * Behaviour:
 * - Uses migrateSubscriptionProduct; proration handled by Maxio.
 */
app.post(
  '/api/subscriptions/:id/change-plan',
  async (
    req: Request<
      { id: string },
      unknown,
      { productId: number; when: 'immediately' | 'next_billing' }
    >,
    res: Response,
  ) => {
    const subscriptionId = Number.parseInt(req.params.id, 10);

    if (Number.isNaN(subscriptionId)) {
      sendJson(res, { message: 'Invalid subscription id' }, 400);
      return;
    }

    const { productId, when } = req.body;

    if (!productId || (when !== 'immediately' && when !== 'next_billing')) {
      sendJson(
        res,
        {
          message:
            "Invalid body. Expected { productId: number, when: 'immediately' | 'next_billing' }",
        },
        400,
      );
      return;
    }

    try {
      const updated = await changeSubscriptionPlan(
        subscriptionId,
        productId,
        when,
      );
      sendJson(res, updated);
    } catch (error) {
      handleApiError(error, res);
    }
  },
);

/**
 * 4. Cancel Subscription
 *
 * Path param: :id (subscription id)
 *
 * Body:
 * - when: 'immediately' | 'period_end'
 * - reason?: string
 */
app.post(
  '/api/subscriptions/:id/cancel',
  async (
    req: Request<
      { id: string },
      unknown,
      { when: 'immediately' | 'period_end'; reason?: string }
    >,
    res: Response,
  ) => {
    const subscriptionId = Number.parseInt(req.params.id, 10);

    if (Number.isNaN(subscriptionId)) {
      sendJson(res, { message: 'Invalid subscription id' }, 400);
      return;
    }

    const { when, reason } = req.body;

    if (when !== 'immediately' && when !== 'period_end') {
      sendJson(
        res,
        {
          message:
            "Invalid body. Expected { when: 'immediately' | 'period_end' }",
        },
        400,
      );
      return;
    }

    try {
      const result = await cancelSubscriptionCore(subscriptionId, when, reason);
      sendJson(res, result);
    } catch (error) {
      handleApiError(error, res);
    }
  },
);

// -------------------------------
// Simple Web UI (Single Page)
// -------------------------------

app.get('/', (_req: Request, res: Response) => {
  res.type('html').send(`<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Subscription Admin</title>
    <style>
      body {
        font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI',
          sans-serif;
        margin: 0;
        background: #0f172a;
        color: #e5e7eb;
      }
      header {
        padding: 1rem 2rem;
        background: #020617;
        border-bottom: 1px solid #1f2937;
      }
      main {
        display: grid;
        grid-template-columns: 2fr 3fr;
        gap: 1rem;
        padding: 1rem 2rem 2rem;
      }
      h1 {
        margin: 0;
        font-size: 1.5rem;
      }
      .toolbar {
        display: flex;
        gap: 0.5rem;
        margin-top: 0.5rem;
      }
      input,
      select,
      button {
        font: inherit;
        padding: 0.4rem 0.6rem;
        border-radius: 0.375rem;
        border: 1px solid #4b5563;
        background: #020617;
        color: #e5e7eb;
      }
      button {
        cursor: pointer;
        background: #4f46e5;
        border-color: #4f46e5;
      }
      button.secondary {
        background: #111827;
        border-color: #4b5563;
      }
      button.danger {
        background: #b91c1c;
        border-color: #b91c1c;
      }
      button:disabled {
        opacity: 0.5;
        cursor: default;
      }
      table {
        width: 100%;
        border-collapse: collapse;
        margin-top: 0.75rem;
        background: #020617;
        border-radius: 0.5rem;
        overflow: hidden;
        font-size: 0.9rem;
      }
      th,
      td {
        padding: 0.5rem 0.75rem;
        border-bottom: 1px solid #111827;
      }
      th {
        text-align: left;
        background: #020617;
      }
      tr:hover {
        background: #111827;
      }
      tr.selected {
        background: #1d4ed8;
      }
      .badge {
        display: inline-flex;
        align-items: center;
        padding: 0.15rem 0.4rem;
        border-radius: 999px;
        font-size: 0.75rem;
        text-transform: uppercase;
        letter-spacing: 0.04em;
      }
      .badge.active {
        background: rgba(16, 185, 129, 0.15);
        color: #6ee7b7;
      }
      .badge.canceled {
        background: rgba(156, 163, 175, 0.15);
        color: #d1d5db;
      }
      .badge.past_due {
        background: rgba(248, 113, 113, 0.15);
        color: #fecaca;
      }
      .badge.trial {
        background: rgba(59, 130, 246, 0.15);
        color: #bfdbfe;
      }
      .panel {
        background: #020617;
        border-radius: 0.75rem;
        padding: 1rem;
        border: 1px solid #1f2937;
      }
      .panel h2 {
        font-size: 1.05rem;
        margin-top: 0;
      }
      .grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 0.4rem 1.5rem;
        margin-top: 0.5rem;
        font-size: 0.9rem;
      }
      .label {
        color: #9ca3af;
        font-size: 0.8rem;
        text-transform: uppercase;
        letter-spacing: 0.06em;
      }
      .value {
        color: #e5e7eb;
      }
      .stack {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
        margin-top: 0.75rem;
      }
      .row {
        display: flex;
        gap: 0.5rem;
        align-items: center;
      }
      .muted {
        color: #9ca3af;
        font-size: 0.85rem;
      }
      textarea {
        width: 100%;
        min-height: 60px;
        resize: vertical;
        font: inherit;
        border-radius: 0.375rem;
        border: 1px solid #4b5563;
        background: #020617;
        color: #e5e7eb;
        padding: 0.5rem 0.6rem;
      }
    </style>
  </head>
  <body>
    <header>
      <h1>Maxio Subscription Admin</h1>
      <div class="toolbar">
        <select id="statusFilter">
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="trial">Trial</option>
          <option value="past_due">Past Due</option>
          <option value="canceled">Canceled</option>
        </select>
        <input
          id="searchInput"
          type="search"
          placeholder="Search by name or email"
        />
        <button id="refreshBtn">Refresh</button>
        <span id="statusText" class="muted"></span>
      </div>
    </header>
    <main>
      <section class="panel">
        <h2>Subscriptions</h2>
        <table>
          <thead>
            <tr>
              <th>Customer</th>
              <th>Plan</th>
              <th>Status</th>
              <th>Next Billing</th>
              <th>Monthly</th>
            </tr>
          </thead>
          <tbody id="subscriptionsTbody"></tbody>
        </table>
      </section>

      <section class="panel">
        <h2>Subscription Details</h2>
        <div id="detailEmpty" class="muted">
          Select a subscription to view details and manage the plan.
        </div>
        <div id="detailContent" style="display:none;">
          <div class="grid">
            <div>
              <div class="label">Customer</div>
              <div class="value" id="detailCustomer"></div>
            </div>
            <div>
              <div class="label">Email</div>
              <div class="value" id="detailEmail"></div>
            </div>
            <div>
              <div class="label">Plan</div>
              <div class="value" id="detailPlan"></div>
            </div>
            <div>
              <div class="label">Price (cents)</div>
              <div class="value" id="detailPrice"></div>
            </div>
            <div>
              <div class="label">Status</div>
              <div class="value" id="detailStatus"></div>
            </div>
            <div>
              <div class="label">Payment Method</div>
              <div class="value" id="detailPayment"></div>
            </div>
            <div>
              <div class="label">Current Period</div>
              <div class="value" id="detailPeriod"></div>
            </div>
            <div>
              <div class="label">Next Billing</div>
              <div class="value" id="detailNextBilling"></div>
            </div>
          </div>

          <div class="stack">
            <div class="row">
              <strong>Change plan</strong>
            </div>
            <div class="row">
              <input
                id="changePlanProductId"
                type="number"
                placeholder="Target productId"
              />
              <select id="changePlanWhen">
                <option value="immediately">Immediately</option>
                <option value="next_billing">Next billing</option>
              </select>
              <button id="changePlanBtn">Apply change</button>
            </div>
          </div>

          <div class="stack">
            <div class="row">
              <strong>Cancel subscription</strong>
            </div>
            <div class="row">
              <select id="cancelWhen">
                <option value="immediately">Immediately</option>
                <option value="period_end">At period end</option>
              </select>
              <button class="danger" id="cancelBtn">Cancel subscription</button>
            </div>
            <textarea
              id="cancelReason"
              placeholder="Optional cancellation reason / note"
            ></textarea>
          </div>
        </div>
      </section>
    </main>

    <script>
      const statusFilterEl = document.getElementById('statusFilter');
      const searchInputEl = document.getElementById('searchInput');
      const refreshBtn = document.getElementById('refreshBtn');
      const statusTextEl = document.getElementById('statusText');
      const tbody = document.getElementById('subscriptionsTbody');

      const detailEmptyEl = document.getElementById('detailEmpty');
      const detailContentEl = document.getElementById('detailContent');
      const detailCustomerEl = document.getElementById('detailCustomer');
      const detailEmailEl = document.getElementById('detailEmail');
      const detailPlanEl = document.getElementById('detailPlan');
      const detailPriceEl = document.getElementById('detailPrice');
      const detailStatusEl = document.getElementById('detailStatus');
      const detailPaymentEl = document.getElementById('detailPayment');
      const detailPeriodEl = document.getElementById('detailPeriod');
      const detailNextBillingEl = document.getElementById('detailNextBilling');

      const changePlanProductIdEl = document.getElementById(
        'changePlanProductId',
      );
      const changePlanWhenEl = document.getElementById('changePlanWhen');
      const changePlanBtn = document.getElementById('changePlanBtn');
      const cancelWhenEl = document.getElementById('cancelWhen');
      const cancelBtn = document.getElementById('cancelBtn');
      const cancelReasonEl = document.getElementById('cancelReason');

      let currentSubscriptionId = null;
      let subscriptions = [];

      function formatDate(value) {
        if (!value) return '—';
        const d = new Date(value);
        if (Number.isNaN(d.getTime())) return String(value);
        return d.toLocaleString();
      }

      function formatMoneyCents(value) {
        if (value == null) return '—';
        const dollars = value / 100;
        return '$' + dollars.toFixed(2);
      }

      function statusToBadgeClass(status) {
        if (!status) return '';
        const normalized = String(status).toLowerCase();
        if (normalized.includes('trial')) return 'trial';
        if (normalized.includes('past')) return 'past_due';
        if (normalized.includes('cancel')) return 'canceled';
        return 'active';
      }

      async function loadSubscriptions() {
        tbody.innerHTML = '';
        statusTextEl.textContent = 'Loading...';

        const params = new URLSearchParams();
        const status = statusFilterEl.value;
        const search = searchInputEl.value.trim();

        if (status) params.set('status', status);
        if (search) params.set('search', search);

        try {
          const res = await fetch('/api/subscriptions?' + params.toString());
          if (!res.ok) {
            throw new Error('Failed to load subscriptions');
          }
          subscriptions = await res.json();
          renderSubscriptions();
          statusTextEl.textContent =
            subscriptions.length + ' subscription(s) loaded';
        } catch (err) {
          console.error(err);
          statusTextEl.textContent = 'Error loading subscriptions';
        }
      }

      function renderSubscriptions() {
        tbody.innerHTML = '';
        for (const sub of subscriptions) {
          const tr = document.createElement('tr');
          tr.dataset.id = sub.id;
          if (String(sub.id) === String(currentSubscriptionId)) {
            tr.classList.add('selected');
          }
          tr.innerHTML = \`
            <td>\${sub.customerName || 'Unknown'}<br/><span class="muted">\${sub.customerEmail || ''}</span></td>
            <td>\${sub.plan || '—'}</td>
            <td><span class="badge \${statusToBadgeClass(
              sub.status,
            )}">\${sub.status}</span></td>
            <td>\${formatDate(sub.nextBillingDate)}</td>
            <td>\${formatMoneyCents(sub.monthlyAmountCents)}</td>
          \`;
          tr.addEventListener('click', () => {
            selectSubscription(sub.id);
          });
          tbody.appendChild(tr);
        }
      }

      async function selectSubscription(id) {
        currentSubscriptionId = id;
        renderSubscriptions();

        detailEmptyEl.style.display = 'none';
        detailContentEl.style.display = 'block';

        detailCustomerEl.textContent = 'Loading...';
        detailEmailEl.textContent = '';
        detailPlanEl.textContent = '';
        detailPriceEl.textContent = '';
        detailStatusEl.textContent = '';
        detailPaymentEl.textContent = '';
        detailPeriodEl.textContent = '';
        detailNextBillingEl.textContent = '';

        try {
          const res = await fetch('/api/subscriptions/' + id);
          if (!res.ok) {
            throw new Error('Failed to load subscription details');
          }
          const data = await res.json();

          detailCustomerEl.textContent = data.customerInfo?.name || 'Unknown';
          detailEmailEl.textContent = data.customerInfo?.email || '';
          detailPlanEl.textContent = data.currentPlan || '—';
          detailPriceEl.textContent =
            data.currentPriceCents != null
              ? data.currentPriceCents + ' cents'
              : '—';
          detailStatusEl.textContent = data.status || '—';
          detailPaymentEl.textContent = data.paymentMethod || '—';
          const period =
            formatDate(data.billingCycle?.currentPeriodStartedAt) +
            ' → ' +
            formatDate(data.billingCycle?.currentPeriodEndsAt);
          detailPeriodEl.textContent = period;
          detailNextBillingEl.textContent = formatDate(data.nextBillingDate);
        } catch (err) {
          console.error(err);
          detailCustomerEl.textContent = 'Error loading subscription';
        }
      }

      async function changePlan() {
        if (!currentSubscriptionId) return;
        const productId = Number(changePlanProductIdEl.value);
        const when = changePlanWhenEl.value;
        if (!productId || !when) return;

        changePlanBtn.disabled = true;
        try {
          const res = await fetch(
            '/api/subscriptions/' + currentSubscriptionId + '/change-plan',
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ productId, when }),
            },
          );
          if (!res.ok) {
            throw new Error('Failed to change plan');
          }
          await res.json();
          await loadSubscriptions();
          await selectSubscription(currentSubscriptionId);
          alert('Plan change requested successfully.');
        } catch (err) {
          console.error(err);
          alert('Error changing plan.');
        } finally {
          changePlanBtn.disabled = false;
        }
      }

      async function cancelSubscription() {
        if (!currentSubscriptionId) return;
        const when = cancelWhenEl.value;
        const reason = cancelReasonEl.value.trim() || undefined;

        const confirmText =
          when === 'period_end'
            ? 'Cancel at period end for this subscription?'
            : 'Cancel immediately for this subscription?';
        if (!confirm(confirmText)) return;

        cancelBtn.disabled = true;
        try {
          const res = await fetch(
            '/api/subscriptions/' + currentSubscriptionId + '/cancel',
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ when, reason }),
            },
          );
          if (!res.ok) {
            throw new Error('Failed to cancel subscription');
          }
          await res.json();
          await loadSubscriptions();
          detailEmptyEl.style.display = 'block';
          detailContentEl.style.display = 'none';
          currentSubscriptionId = null;
          alert('Subscription cancellation requested.');
        } catch (err) {
          console.error(err);
          alert('Error canceling subscription.');
        } finally {
          cancelBtn.disabled = false;
        }
      }

      refreshBtn.addEventListener('click', loadSubscriptions);
      statusFilterEl.addEventListener('change', loadSubscriptions);
      searchInputEl.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') loadSubscriptions();
      });
      changePlanBtn.addEventListener('click', changePlan);
      cancelBtn.addEventListener('click', cancelSubscription);

      loadSubscriptions();
    </script>
  </body>
</html>`);
});

// -------------------------------
// Start Server
// -------------------------------

// Start the HTTP server. If you need to disable this during tests, set
// NODE_ENV=test before importing / running this module.
// eslint-disable-next-line no-console
const server = app.listen(PORT, () => {
  console.log(`Subscription admin listening on http://localhost:${PORT}`);
});

export default app;
export { server };

// Legacy exports expected by existing tests. These are placeholders and can be
// adapted or removed if no longer needed by the codebase.
export async function createOrder(..._args: unknown[]): Promise<never> {
  throw new Error('createOrder is not implemented in this project context.');
}

export async function getOrder(..._args: unknown[]): Promise<never> {
  throw new Error('getOrder is not implemented in this project context.');
}



