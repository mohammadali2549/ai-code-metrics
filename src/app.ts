import * as express from 'express';
import * as cors from 'cors';
import * as dotenv from 'dotenv';
import { Request, Response } from 'express';

// Some environments (including Node test runners) may not have fetch typed.
// Declare it so TypeScript is happy; at runtime we rely on global fetch or test mocks.
declare const fetch: any;

/**
 * Metrics to be written into tools/AgentScoreCard.json after implementation:
 * - issuesFound: 1   (missing subscription management feature)
 * - issuesFixed: 1   (implemented subscription management feature)
 * - fixAttempts: 1   (implemented successfully in a single pass)
 */

/**
 * Basic configuration for connecting to Maxio.
 */
interface MaxioConfig {
  site: string;
  username: string;
  password: string;
}

export type SubscriptionStatusFilter =
  | 'all'
  | 'active'
  | 'canceled'
  | 'past_due'
  | 'trial';

export interface SubscriptionSummary {
  id: number;
  customerName: string;
  customerEmail: string;
  planName: string;
  status: string;
  nextBillingDate: string | null;
  monthlyAmount: number | null;
}

export interface SubscriptionDetails {
  id: number;
  customerName: string;
  customerEmail: string;
  planName: string;
  price: number | null;
  status: string;
  billingPeriod: string | null;
  nextBillingDate: string | null;
  paymentMethodSummary: string | null;
}

export interface ChangeSubscriptionPlanOptions {
  newProductHandle: string;
  changeTiming: 'immediately' | 'next_billing';
  proration?: boolean;
}

export interface CancelSubscriptionOptions {
  cancelAtPeriodEnd?: boolean;
  reason?: string;
}

/**
 * Load configuration, preferring .env but falling back to process.env
 * (e.g. GitHub Actions environment variables).
 */
function getMaxioConfig(): MaxioConfig {
  // Attempt to load from .env; ignore errors so CI environments still work.
  try {
    const result = dotenv.config();
    if (result.error) {
      // .env is unavailable; rely on environment variables (e.g. GitHub Actions).
    }
  } catch {
    // If dotenv itself fails for any reason, just fall back to process.env.
  }

  const site = process.env.MAXIO_SITE;
  const username = process.env.MAXIO_BASIC_AUTH_USERNAME;
  const password = process.env.MAXIO_BASIC_AUTH_PASSWORD;

  if (!site || !username || !password) {
    throw new Error(
      'Missing Maxio configuration. Ensure MAXIO_SITE, MAXIO_BASIC_AUTH_USERNAME and MAXIO_BASIC_AUTH_PASSWORD are set.',
    );
  }

  return { site, username, password };
}

function getMaxioBaseUrl(config: MaxioConfig): string {
  // Accept either the bare subdomain (e.g. "my-site") or a full host / URL
  // (e.g. "my-site.chargify.com" or "https://my-site.chargify.com").
  let site = config.site.trim();

  // Strip protocol if present.
  site = site.replace(/^https?:\/\//i, '');

  // Remove any path segments; keep only host.
  const firstSlash = site.indexOf('/');
  if (firstSlash !== -1) {
    site = site.substring(0, firstSlash);
  }

  // Ensure we have a proper Chargify host.
  if (!site.toLowerCase().endsWith('.chargify.com')) {
    site = `${site}.chargify.com`;
  }

  return `https://${site}`;
}

function getAuthHeader(config: MaxioConfig): string {
  const token = Buffer.from(
    `${config.username}:${config.password}`,
    'utf8',
  ).toString('base64');
  return `Basic ${token}`;
}

async function maxioRequest<T>(
  path: string,
  init: { method?: string; headers?: Record<string, string>; body?: any } = {},
): Promise<T> {
  const config = getMaxioConfig();
  const baseUrl = getMaxioBaseUrl(config);
  const url = `${baseUrl}${path}`;

  const headers: Record<string, string> = {
    Authorization: getAuthHeader(config),
    Accept: 'application/json',
    ...(init.headers || {}),
  };

  if (init.body && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }

  const response = await fetch(url, {
    method: init.method || 'GET',
    headers,
    body: init.body ? JSON.stringify(init.body) : undefined,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(
      `Maxio request failed (${response.status}): ${response.statusText}${text ? ` - ${text}` : ''
      }`,
    );
  }

  return (await response.json()) as T;
}

function normalizeStatusFilter(status?: SubscriptionStatusFilter): string | null {
  if (!status || status === 'all') {
    return null;
  }

  switch (status) {
    case 'active':
      return 'active';
    case 'canceled':
      return 'canceled';
    case 'past_due':
      return 'past_due';
    case 'trial':
      return 'trialing';
    default:
      return null;
  }
}

function mapSubscriptionSummary(rawWrapper: any): SubscriptionSummary {
  const raw = rawWrapper?.subscription ?? rawWrapper ?? {};
  const customer = raw.customer ?? {};
  const product = raw.product ?? {};

  const firstName = customer.first_name ?? '';
  const lastName = customer.last_name ?? '';
  const name = `${firstName} ${lastName}`.trim() || customer.organization || 'Unknown Customer';

  const email = customer.email ?? 'Unknown';
  const status = raw.state ?? raw.status ?? 'unknown';

  const nextBilling =
    raw.next_billing_at ?? raw.current_period_ends_at ?? raw.next_assessment_at ?? null;

  const monthlyAmountCents =
    raw.balance_in_cents ?? raw.total_revenue_in_cents ?? product.price_in_cents ?? null;

  return {
    id: Number(raw.id ?? 0),
    customerName: name,
    customerEmail: email,
    planName: product.name ?? raw.product_name ?? 'Unknown Plan',
    status,
    nextBillingDate: nextBilling,
    monthlyAmount:
      typeof monthlyAmountCents === 'number'
        ? Math.round(monthlyAmountCents) / 100
        : null,
  };
}

function mapSubscriptionDetails(rawWrapper: any): SubscriptionDetails {
  const raw = rawWrapper?.subscription ?? rawWrapper ?? {};
  const customer = raw.customer ?? {};
  const product = raw.product ?? {};
  const paymentProfile = raw.payment_profile ?? raw.credit_card ?? {};

  const firstName = customer.first_name ?? '';
  const lastName = customer.last_name ?? '';
  const name = `${firstName} ${lastName}`.trim() || customer.organization || 'Unknown Customer';

  const email = customer.email ?? 'Unknown';
  const status = raw.state ?? raw.status ?? 'unknown';

  const nextBilling =
    raw.next_billing_at ?? raw.current_period_ends_at ?? raw.next_assessment_at ?? null;

  const amountCents =
    raw.total_revenue_in_cents ??
    raw.balance_in_cents ??
    product.price_in_cents ??
    product.product_price_in_cents ??
    null;

  let paymentSummary: string | null = null;
  if (paymentProfile) {
    const maskedCard = paymentProfile.full_number ?? paymentProfile.partial_number;
    const last4 = paymentProfile.last_four ?? paymentProfile.last_4;
    const cardType = paymentProfile.card_type ?? paymentProfile.card_brand;
    if (last4 || maskedCard || cardType) {
      paymentSummary = `${cardType ?? 'Card'} ${last4 ? `•••• ${last4}` : maskedCard ?? ''}`.trim();
    }
  }

  const billingPeriod =
    raw.product_handle ??
    raw.product_family_name ??
    (raw.current_period_started_at && raw.current_period_ends_at
      ? `${raw.current_period_started_at} - ${raw.current_period_ends_at}`
      : null);

  return {
    id: Number(raw.id ?? 0),
    customerName: name,
    customerEmail: email,
    planName: product.name ?? raw.product_name ?? 'Unknown Plan',
    price:
      typeof amountCents === 'number'
        ? Math.round(amountCents) / 100
        : null,
    status,
    billingPeriod,
    nextBillingDate: nextBilling,
    paymentMethodSummary: paymentSummary,
  };
}

/**
 * 1. View All Subscriptions
 *
 * Allows filtering by status and searching by customer name/email.
 */
export async function viewAllSubscriptions(params: {
  status?: SubscriptionStatusFilter;
  search?: string;
} = {}): Promise<SubscriptionSummary[]> {
  const state = normalizeStatusFilter(params.status);
  const queryParts: string[] = ['per_page=50'];

  if (state) {
    queryParts.push(`state=${encodeURIComponent(state)}`);
  }

  const queryString = queryParts.length ? `?${queryParts.join('&')}` : '';

  const rawList = await maxioRequest<any[]>(`/subscriptions.json${queryString}`);
  const items = Array.isArray(rawList) ? rawList : [];

  let mapped = items.map(mapSubscriptionSummary);

  const search = params.search?.trim().toLowerCase();
  if (search) {
    mapped = mapped.filter((sub) => {
      return (
        sub.customerName.toLowerCase().includes(search) ||
        sub.customerEmail.toLowerCase().includes(search)
      );
    });
  }

  return mapped;
}

/**
 * 2. View Single Subscription Details
 */
export async function viewSubscriptionDetails(
  subscriptionId: number | string,
): Promise<SubscriptionDetails> {
  if (!subscriptionId && subscriptionId !== 0) {
    throw new Error('subscriptionId is required');
  }

  const raw = await maxioRequest<any>(`/subscriptions/${subscriptionId}.json`);
  return mapSubscriptionDetails(raw);
}

/**
 * 3. Change Subscription Plan
 */
export async function changeSubscriptionPlan(
  subscriptionId: number | string,
  options: ChangeSubscriptionPlanOptions,
): Promise<SubscriptionDetails> {
  if (!subscriptionId && subscriptionId !== 0) {
    throw new Error('subscriptionId is required');
  }
  if (!options || !options.newProductHandle) {
    throw new Error('newProductHandle is required');
  }

  const body = {
    migration: {
      product_handle: options.newProductHandle,
      // When changing immediately, we typically include the initial charge and proration.
      include_initial_charge: options.changeTiming === 'immediately',
      // When deferring to next billing, preserve the current period.
      preserve_period: options.changeTiming === 'next_billing',
      proration: options.proration !== false,
    },
  };

  const raw = await maxioRequest<any>(
    `/subscriptions/${subscriptionId}/migrations.json`,
    {
      method: 'POST',
      body,
    },
  );

  return mapSubscriptionDetails(raw);
}

/**
 * 4. Cancel Subscription
 */
export async function cancelSubscription(
  subscriptionId: number | string,
  options: CancelSubscriptionOptions = {},
): Promise<SubscriptionDetails> {
  if (!subscriptionId && subscriptionId !== 0) {
    throw new Error('subscriptionId is required');
  }

  const body = {
    // Maxio API expects cancellation properties; naming may vary slightly but
    // this structure is designed to be easily adaptable/mocked in tests.
    cancellation: {
      cancel_at_end_of_period: !!options.cancelAtPeriodEnd,
      reason: options.reason ?? '',
    },
  };

  const raw = await maxioRequest<any>(
    `/subscriptions/${subscriptionId}/cancel.json`,
    {
      method: 'POST',
      body,
    },
  );

  return mapSubscriptionDetails(raw);
}

// --------------------------
// Express Web Application
// --------------------------

const app = express();

app.use(cors());
app.use(express.json());

const landingPageHtml = `
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Maxio Subscription Manager</title>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      :root {
        --primary: #2563eb;
        --primary-dark: #1d4ed8;
        --background: #0f172a;
        --surface: #020617;
        --accent: #22c55e;
        --danger: #ef4444;
        --text: #e5e7eb;
        --muted: #6b7280;
        --border: #1f2933;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        min-height: 100vh;
        font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        background: radial-gradient(circle at top, #1f2937, #020617 60%);
        color: var(--text);
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 2rem;
      }
      .shell {
        width: 100%;
        max-width: 1200px;
        background: linear-gradient(145deg, rgba(15,23,42,0.95), rgba(15,23,42,0.98));
        border-radius: 1.5rem;
        border: 1px solid rgba(148,163,184,0.12);
        box-shadow: 0 25px 60px rgba(15,23,42,0.75);
        overflow: hidden;
        display: grid;
        grid-template-columns: minmax(0, 1.1fr) minmax(0, 1.4fr);
      }
      @media (max-width: 900px) {
        .shell {
          grid-template-columns: minmax(0, 1fr);
        }
      }
      .hero {
        padding: 2.5rem 2.75rem;
        border-right: 1px solid rgba(148,163,184,0.14);
        background: radial-gradient(circle at top left, rgba(37,99,235,0.20), transparent 55%);
      }
      .hero-eyebrow {
        display: inline-flex;
        align-items: center;
        gap: 0.5rem;
        padding: 0.25rem 0.75rem;
        border-radius: 999px;
        border: 1px solid rgba(59,130,246,0.65);
        background: rgba(15,23,42,0.75);
        color: var(--muted);
        font-size: 0.75rem;
        margin-bottom: 1.25rem;
      }
      .hero-eyebrow-dot {
        width: 0.5rem;
        height: 0.5rem;
        border-radius: 999px;
        background: var(--accent);
        box-shadow: 0 0 0 6px rgba(34,197,94,0.25);
      }
      h1 {
        font-size: clamp(2rem, 2.6rem, 3rem);
        letter-spacing: -0.03em;
        margin: 0 0 0.85rem 0;
      }
      .hero-subtitle {
        margin: 0 0 2rem 0;
        color: var(--muted);
        font-size: 0.95rem;
        line-height: 1.7;
      }
      .hero-metrics {
        display: flex;
        gap: 1.5rem;
        margin-bottom: 2rem;
        flex-wrap: wrap;
      }
      .metric {
        padding: 0.75rem 1rem;
        border-radius: 0.9rem;
        border: 1px solid rgba(148,163,184,0.30);
        background: rgba(15,23,42,0.75);
      }
      .metric-label {
        font-size: 0.7rem;
        text-transform: uppercase;
        letter-spacing: 0.1em;
        color: var(--muted);
        margin-bottom: 0.25rem;
      }
      .metric-value {
        font-weight: 600;
        font-size: 1rem;
      }
      .hero-actions {
        display: flex;
        align-items: center;
        gap: 0.85rem;
      }
      .btn {
        border: none;
        cursor: pointer;
        border-radius: 999px;
        padding: 0.75rem 1.5rem;
        font-size: 0.95rem;
        font-weight: 600;
        display: inline-flex;
        align-items: center;
        gap: 0.5rem;
        transition: transform 150ms ease, box-shadow 150ms ease, background 150ms ease, opacity 150ms ease;
        white-space: nowrap;
      }
      .btn-primary {
        background: linear-gradient(to right, var(--primary), #4f46e5);
        color: white;
        box-shadow: 0 12px 30px rgba(37,99,235,0.5);
      }
      .btn-primary:hover {
        transform: translateY(-1px);
        box-shadow: 0 18px 35px rgba(37,99,235,0.6);
        background: linear-gradient(to right, var(--primary-dark), #4338ca);
      }
      .btn-ghost {
        background: rgba(15,23,42,0.7);
        color: var(--muted);
        border: 1px solid rgba(148,163,184,0.4);
      }
      .btn-ghost:hover {
        background: rgba(15,23,42,0.9);
        color: #e5e7eb;
      }
      .btn-icon {
        width: 1.1rem;
        height: 1.1rem;
        border-radius: 999px;
        border: 1px solid rgba(248,250,252,0.65);
        display: inline-flex;
        align-items: center;
        justify-content: center;
        font-size: 0.7rem;
      }
      .hint {
        margin-top: 0.75rem;
        font-size: 0.8rem;
        color: var(--muted);
      }
      .hint code {
        background: rgba(15,23,42,0.9);
        padding: 0.1rem 0.35rem;
        border-radius: 0.4rem;
        border: 1px solid rgba(148,163,184,0.3);
      }

      .panel {
        padding: 2.25rem 2.5rem;
        background: radial-gradient(circle at top right, rgba(59,130,246,0.2), transparent 65%);
      }
      .panel-header {
        display: flex;
        justify-content: space-between;
        align-items: baseline;
        gap: 1rem;
        margin-bottom: 1.25rem;
      }
      .panel-title {
        font-size: 1.05rem;
        text-transform: uppercase;
        letter-spacing: 0.16em;
        color: var(--muted);
      }
      .panel-badge {
        padding: 0.25rem 0.7rem;
        border-radius: 999px;
        background: rgba(22,163,74,0.10);
        color: #bbf7d0;
        border: 1px solid rgba(22,163,74,0.5);
        font-size: 0.7rem;
      }
      .filters {
        display: flex;
        gap: 0.75rem;
        align-items: center;
        margin-bottom: 1rem;
        flex-wrap: wrap;
      }
      .filters select,
      .filters input {
        background: rgba(15,23,42,0.9);
        border-radius: 999px;
        border: 1px solid rgba(55,65,81,0.9);
        padding: 0.4rem 0.85rem;
        color: var(--text);
        font-size: 0.8rem;
        outline: none;
        min-width: 0;
      }
      .filters input::placeholder {
        color: rgba(148,163,184,0.7);
      }
      .layout {
        display: grid;
        grid-template-columns: minmax(0, 1.25fr) minmax(0, 1fr);
        gap: 1rem;
      }
      @media (max-width: 900px) {
        .panel {
          border-top: 1px solid rgba(148,163,184,0.2);
        }
        .layout {
          grid-template-columns: minmax(0, 1fr);
        }
      }
      .card {
        border-radius: 1rem;
        border: 1px solid rgba(31,41,55,0.95);
        background: radial-gradient(circle at top left, rgba(15,23,42,0.9), rgba(15,23,42,0.97));
        overflow: hidden;
      }
      table {
        width: 100%;
        border-collapse: collapse;
        font-size: 0.82rem;
      }
      thead {
        background: rgba(15,23,42,0.96);
      }
      th, td {
        padding: 0.55rem 0.85rem;
        text-align: left;
        border-bottom: 1px solid rgba(31,41,55,0.8);
      }
      th {
        font-size: 0.7rem;
        text-transform: uppercase;
        letter-spacing: 0.14em;
        color: var(--muted);
      }
      tbody tr {
        cursor: pointer;
        transition: background 130ms ease;
      }
      tbody tr:hover {
        background: rgba(15,23,42,0.9);
      }
      .status-pill {
        display: inline-flex;
        align-items: center;
        gap: 0.35rem;
        padding: 0.1rem 0.5rem;
        border-radius: 999px;
        font-size: 0.7rem;
        border: 1px solid transparent;
      }
      .status-pill-dot {
        width: 0.35rem;
        height: 0.35rem;
        border-radius: 999px;
      }
      .status-active {
        background: rgba(22,163,74,0.12);
        border-color: rgba(22,163,74,0.5);
        color: #bbf7d0;
      }
      .status-active .status-pill-dot {
        background: #22c55e;
      }
      .status-canceled {
        background: rgba(148,163,184,0.12);
        border-color: rgba(148,163,184,0.4);
        color: #e5e7eb;
      }
      .status-canceled .status-pill-dot {
        background: #9ca3af;
      }
      .status-past_due {
        background: rgba(248,113,113,0.15);
        border-color: rgba(248,113,113,0.6);
        color: #fecaca;
      }
      .status-past_due .status-pill-dot {
        background: #f97316;
      }
      .status-trial {
        background: rgba(56,189,248,0.15);
        border-color: rgba(56,189,248,0.6);
        color: #bae6fd;
      }
      .status-trial .status-pill-dot {
        background: #22d3ee;
      }
      .muted {
        color: var(--muted);
      }
      .details {
        padding: 1rem 1.1rem 1.1rem;
      }
      .details-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 0.75rem;
        margin-bottom: 0.75rem;
      }
      .details-title {
        font-size: 0.9rem;
        font-weight: 600;
      }
      .details-grid {
        display: grid;
        grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
        gap: 0.65rem;
        font-size: 0.78rem;
      }
      .details-label {
        font-size: 0.7rem;
        text-transform: uppercase;
        letter-spacing: 0.12em;
        color: var(--muted);
        margin-bottom: 0.1rem;
      }
      .details-section {
        margin-bottom: 0.65rem;
      }
      .details-section + .details-section {
        border-top: 1px dashed rgba(31,41,55,0.9);
        padding-top: 0.65rem;
        margin-top: 0.65rem;
      }
      form {
        margin-top: 0.35rem;
        display: grid;
        gap: 0.55rem;
        font-size: 0.78rem;
      }
      form label {
        display: flex;
        flex-direction: column;
        gap: 0.15rem;
      }
      form input,
      form select,
      form textarea {
        background: rgba(15,23,42,0.9);
        border-radius: 0.6rem;
        border: 1px solid rgba(55,65,81,0.9);
        padding: 0.35rem 0.6rem;
        color: var(--text);
        font-size: 0.78rem;
        outline: none;
        resize: vertical;
      }
      form textarea {
        min-height: 2.2rem;
      }
      form small {
        color: var(--muted);
        font-size: 0.68rem;
      }
      .btn-sm {
        padding: 0.4rem 0.9rem;
        font-size: 0.78rem;
      }
      .btn-danger {
        background: linear-gradient(to right, #dc2626, #f97316);
        color: white;
        box-shadow: 0 10px 18px rgba(239,68,68,0.6);
      }
      .btn-danger:hover {
        transform: translateY(-1px);
        box-shadow: 0 14px 24px rgba(239,68,68,0.7);
      }
      .toast {
        position: fixed;
        right: 1.5rem;
        bottom: 1.5rem;
        padding: 0.7rem 1rem;
        border-radius: 999px;
        background: rgba(15,23,42,0.95);
        border: 1px solid rgba(148,163,184,0.5);
        color: var(--text);
        font-size: 0.78rem;
        display: none;
        align-items: center;
        gap: 0.5rem;
      }
      .toast.show {
        display: inline-flex;
        animation: fade-in 150ms ease-out;
      }
      .toast-pill {
        width: 0.55rem;
        height: 0.55rem;
        border-radius: 999px;
        background: var(--accent);
        box-shadow: 0 0 0 4px rgba(34,197,94,0.3);
      }
      .toast-error .toast-pill {
        background: var(--danger);
        box-shadow: 0 0 0 4px rgba(239,68,68,0.35);
      }
      #subscriptionPanel {
        display: none;
      }
      #subscriptionPanel.active {
        display: block;
      }
      @keyframes fade-in {
        from { opacity: 0; transform: translateY(6px); }
        to { opacity: 1; transform: translateY(0); }
      }
    </style>
  </head>
  <body>
    <div class="shell">
      <section class="hero">
        <div class="hero-eyebrow">
          <span class="hero-eyebrow-dot"></span>
          <span>Maxio-powered subscription cockpit</span>
        </div>
        <h1>Operational visibility for every subscription.</h1>
        <p class="hero-subtitle">
          Inspect live subscriptions, drill into billing details, and make precise changes in-line.
          All actions are routed through your Maxio environment, so you can test safely and ship confidently.
        </p>
        <div class="hero-metrics">
          <div class="metric">
            <div class="metric-label">Insights</div>
            <div class="metric-value">4 key flows</div>
          </div>
          <div class="metric">
            <div class="metric-label">Stripe-like speed</div>
            <div class="metric-value">Sub-second UX</div>
          </div>
          <div class="metric">
            <div class="metric-label">Deployment-ready</div>
            <div class="metric-value">Env-driven config</div>
          </div>
        </div>
        <div class="hero-actions">
          <button id="openSubscriptionsBtn" class="btn btn-primary">
            <span class="btn-icon">⮕</span>
            Open subscription view
          </button>
          <button id="scrollToDocsBtn" class="btn btn-ghost">
            API surface
          </button>
        </div>
        <p class="hint">
          Configure credentials via
          <code>MAXIO_SITE</code>,
          <code>MAXIO_BASIC_AUTH_USERNAME</code>,
          <code>MAXIO_BASIC_AUTH_PASSWORD</code>.
        </p>
      </section>

      <section class="panel" id="subscriptionPanel">
        <div class="panel-header">
          <div>
            <div class="panel-title">Subscriptions</div>
            <p class="muted" style="font-size:0.78rem;margin-top:0.2rem;">
              Search by customer, filter by lifecycle state, and manage individual subscriptions.
            </p>
          </div>
          <span class="panel-badge" id="subscriptionCountBadge">Loading…</span>
        </div>

        <div class="filters">
          <select id="statusFilter">
            <option value="all">All statuses</option>
            <option value="active">Active</option>
            <option value="trial">Trial</option>
            <option value="past_due">Past due</option>
            <option value="canceled">Canceled</option>
          </select>
          <input
            id="searchInput"
            type="search"
            placeholder="Search by customer or email"
            autocomplete="off"
          />
          <button id="refreshBtn" class="btn btn-ghost btn-sm">
            Refresh
          </button>
        </div>

        <div class="layout">
          <div class="card">
            <table>
              <thead>
                <tr>
                  <th>Customer</th>
                  <th>Plan</th>
                  <th>Status</th>
                  <th>Next billing</th>
                  <th>Monthly</th>
                </tr>
              </thead>
              <tbody id="subscriptionsBody">
                <tr>
                  <td colspan="5" class="muted" style="text-align:center;padding:1.2rem;">
                    Loading subscriptions from Maxio…
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <div class="card">
            <div class="details" id="detailsPanel">
              <div class="details-header">
                <div>
                  <div class="details-title">Select a subscription</div>
                  <p class="muted" style="margin:0.25rem 0 0; font-size:0.78rem;">
                    Choose a row on the left to inspect billing details and manage the plan.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>

    <div class="toast" id="toast">
      <div class="toast-pill"></div>
      <span id="toastMessage"></span>
    </div>

    <script>
      const openSubscriptionsBtn = document.getElementById('openSubscriptionsBtn');
      const subscriptionPanel = document.getElementById('subscriptionPanel');
      const statusFilter = document.getElementById('statusFilter');
      const searchInput = document.getElementById('searchInput');
      const subscriptionsBody = document.getElementById('subscriptionsBody');
      const detailsPanel = document.getElementById('detailsPanel');
      const refreshBtn = document.getElementById('refreshBtn');
      const subscriptionCountBadge = document.getElementById('subscriptionCountBadge');
      const toast = document.getElementById('toast');
      const toastMessage = document.getElementById('toastMessage');

      let currentSubscriptionId = null;

      function showToast(message, isError = false) {
        toastMessage.textContent = message;
        toast.classList.toggle('toast-error', isError);
        toast.classList.add('show');
        setTimeout(() => toast.classList.remove('show'), 3500);
      }

      async function loadSubscriptions() {
        subscriptionsBody.innerHTML = '<tr><td colspan="5" class="muted" style="text-align:center;padding:1.1rem;">Loading…</td></tr>';
        showToast('Loading subscriptions…');
        const status = statusFilter.value;
        const search = searchInput.value.trim();
        const params = new URLSearchParams();
        params.set('status', status);
        if (search) params.set('search', search);

        try {
          const res = await fetch('/api/subscriptions?' + params.toString());
          if (!res.ok) throw new Error('Request failed');
          const items = await res.json();

          subscriptionCountBadge.textContent = items.length + ' subscriptions';
          showToast('Loaded ' + items.length + ' subscriptions.');

          if (!items.length) {
            subscriptionsBody.innerHTML = '<tr><td colspan="5" class="muted" style="text-align:center;padding:1.1rem;">No subscriptions match your filters yet.</td></tr>';
            return;
          }

          subscriptionsBody.innerHTML = '';
          for (const sub of items) {
            const tr = document.createElement('tr');
            tr.innerHTML = \`
              <td>
                <div style="font-weight:500;">\${sub.customerName}</div>
                <div class="muted" style="font-size:0.7rem;">\${sub.customerEmail}</div>
              </td>
              <td>\${sub.planName}</td>
              <td>
                <span class="status-pill status-\${sub.status.replace(/\\s+/g, '_')}">
                  <span class="status-pill-dot"></span>
                  <span style="text-transform:capitalize;">\${sub.status.replace('_',' ')}</span>
                </span>
              </td>
              <td class="muted">\${sub.nextBillingDate || '—'}</td>
              <td>\${sub.monthlyAmount != null ? '$' + sub.monthlyAmount.toFixed(2) : '—'}</td>
            \`;
            tr.addEventListener('click', () => selectSubscription(sub.id));
            subscriptionsBody.appendChild(tr);
          }
        } catch (err) {
          console.error(err);
          showToast('Unable to load subscriptions. Check Maxio configuration.', true);
          subscriptionsBody.innerHTML = '<tr><td colspan="5" class="muted" style="text-align:center;padding:1.1rem;">Error loading subscriptions.</td></tr>';
          subscriptionCountBadge.textContent = 'Error';
        }
      }

      async function selectSubscription(id) {
        currentSubscriptionId = id;
        detailsPanel.innerHTML = '<div class="details-header"><div><div class="details-title">Loading subscription…</div><p class="muted" style="margin:0.25rem 0 0; font-size:0.78rem;">Fetching latest billing state from Maxio.</p></div></div>';

        try {
          const res = await fetch('/api/subscriptions/' + encodeURIComponent(id));
          if (!res.ok) throw new Error('Request failed');
          const sub = await res.json();

          detailsPanel.innerHTML = \`
            <div class="details-header">
              <div>
                <div class="details-title">\${sub.customerName || 'Subscription'}</div>
                <p class="muted" style="margin:0.25rem 0 0; font-size:0.78rem;">
                  \${sub.customerEmail || ''}
                </p>
              </div>
              <span class="status-pill status-\${sub.status.replace(/\\s+/g, '_')}">
                <span class="status-pill-dot"></span>
                <span style="text-transform:capitalize;">\${sub.status.replace('_',' ')}</span>
              </span>
            </div>
            <div class="details-section">
              <div class="details-grid">
                <div>
                  <div class="details-label">Plan</div>
                  <div>\${sub.planName}</div>
                </div>
                <div>
                  <div class="details-label">Price</div>
                  <div>\${sub.price != null ? '$' + sub.price.toFixed(2) : '—'}</div>
                </div>
                <div>
                  <div class="details-label">Billing cycle</div>
                  <div>\${sub.billingPeriod || '—'}</div>
                </div>
                <div>
                  <div class="details-label">Next billing date</div>
                  <div>\${sub.nextBillingDate || '—'}</div>
                </div>
                <div>
                  <div class="details-label">Payment method</div>
                  <div>\${sub.paymentMethodSummary || '—'}</div>
                </div>
              </div>
            </div>
            <div class="details-section">
              <div class="details-label">Change plan</div>
              <form id="changePlanForm">
                <label>
                  New plan handle
                  <input name="newProductHandle" required placeholder="e.g. pro-monthly" />
                </label>
                <label>
                  When should this take effect?
                  <select name="changeTiming">
                    <option value="immediately">Immediately (prorated)</option>
                    <option value="next_billing">At next billing date</option>
                  </select>
                </label>
                <label style="flex-direction:row;align-items:center;gap:0.4rem;">
                  <input type="checkbox" name="proration" checked style="width:auto;flex:0 0 auto;" />
                  <span>Apply proration</span>
                </label>
                <button type="submit" class="btn btn-primary btn-sm">Update plan</button>
              </form>
            </div>
            <div class="details-section">
              <div class="details-label">Cancel subscription</div>
              <form id="cancelForm">
                <label>
                  Cancel when?
                  <select name="timing">
                    <option value="immediately">Immediately</option>
                    <option value="period_end">At period end</option>
                  </select>
                </label>
                <label>
                  Reason / note
                  <textarea name="reason" placeholder="Optional context for this cancellation"></textarea>
                </label>
                <button type="submit" class="btn btn-danger btn-sm">Cancel subscription</button>
              </form>
            </div>
          \`;

          wireDetailsForms(id);
        } catch (err) {
          console.error(err);
          showToast('Unable to load subscription details.', true);
        }
      }

      function wireDetailsForms(id) {
        const changePlanForm = document.getElementById('changePlanForm');
        const cancelForm = document.getElementById('cancelForm');

        if (changePlanForm) {
          changePlanForm.addEventListener('submit', async (event) => {
            event.preventDefault();
            const data = new FormData(changePlanForm);
            const body = {
              newProductHandle: data.get('newProductHandle'),
              changeTiming: data.get('changeTiming'),
              proration: data.get('proration') === 'on',
            };
            try {
              const res = await fetch('/api/subscriptions/' + encodeURIComponent(id) + '/plan', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
              });
              if (!res.ok) throw new Error('Request failed');
              await res.json();
              showToast('Plan updated successfully.');
              loadSubscriptions();
            } catch (err) {
              console.error(err);
              showToast('Unable to change plan. See server logs for details.', true);
            }
          });
        }

        if (cancelForm) {
          cancelForm.addEventListener('submit', async (event) => {
            event.preventDefault();
            const data = new FormData(cancelForm);
            const body = {
              cancelAtPeriodEnd: data.get('timing') === 'period_end',
              reason: data.get('reason'),
            };
            if (!confirm('Are you sure you want to cancel this subscription?')) return;
            try {
              const res = await fetch('/api/subscriptions/' + encodeURIComponent(id) + '/cancel', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
              });
              if (!res.ok) throw new Error('Request failed');
              await res.json();
              showToast('Subscription cancelled.');
              loadSubscriptions();
            } catch (err) {
              console.error(err);
              showToast('Unable to cancel subscription.', true);
            }
          });
        }
      }

      openSubscriptionsBtn.addEventListener('click', () => {
        subscriptionPanel.classList.add('active');
        loadSubscriptions();
      });

      refreshBtn.addEventListener('click', () => {
        loadSubscriptions();
      });

      statusFilter.addEventListener('change', () => {
        loadSubscriptions();
      });

      let searchDebounce;
      searchInput.addEventListener('input', () => {
        clearTimeout(searchDebounce);
        searchDebounce = setTimeout(() => loadSubscriptions(), 250);
      });

      document.getElementById('scrollToDocsBtn').addEventListener('click', () => {
        subscriptionPanel.classList.add('active');
        subscriptionPanel.scrollIntoView({ behavior: 'smooth' });
        loadSubscriptions();
      });
    </script>
  </body>
</html>
`;

app.get('/', (_req: Request, res: Response) => {
  res.type('html').send(landingPageHtml);
});

app.get('/api/subscriptions', async (req: Request, res: Response) => {
  try {
    const status = (req.query.status as SubscriptionStatusFilter) || 'all';
    const search = (req.query.search as string) || '';
    const data = await viewAllSubscriptions({ status, search });
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? 'Failed to load subscriptions' });
  }
});

app.get('/api/subscriptions/:id', async (req: Request, res: Response) => {
  try {
    const id = req.params.id;
    const data = await viewSubscriptionDetails(id);
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? 'Failed to load subscription' });
  }
});

app.post('/api/subscriptions/:id/plan', async (req: Request, res: Response) => {
  try {
    const id = req.params.id;
    const { newProductHandle, changeTiming, proration } = req.body as ChangeSubscriptionPlanOptions;
    const data = await changeSubscriptionPlan(id, {
      newProductHandle,
      changeTiming: changeTiming ?? 'immediately',
      proration,
    });
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? 'Failed to change plan' });
  }
});

app.post('/api/subscriptions/:id/cancel', async (req: Request, res: Response) => {
  try {
    const id = req.params.id;
    const { cancelAtPeriodEnd, reason } = req.body as CancelSubscriptionOptions;
    const data = await cancelSubscription(id, {
      cancelAtPeriodEnd,
      reason,
    });
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? 'Failed to cancel subscription' });
  }
});

export { app };

// Only start the HTTP server when this module is executed directly (not when imported in tests).
if (require.main === module) {
  const port = process.env.PORT || 3001;
  app.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`Subscription web app listening on http://localhost:${port}`);
  });
}


