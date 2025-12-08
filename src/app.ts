// src/app.ts
//
// Web-style subscription management module with:
// - Environment loading from `.env` (when present) or process env (e.g. GitHub Actions)
// - Business logic for viewing and managing subscriptions
// - A basic HTML UI renderer that could be served by any HTTP server

import * as fs from 'fs';
import * as dotenv from 'dotenv';

/**
 * Tracks whether `.env` was actually used so tests can assert behaviour.
 */
let usedDotEnv = false;

if (fs.existsSync('.env')) {
  dotenv.config();
  usedDotEnv = true;
}

export type SubscriptionStatus = 'active' | 'canceled' | 'past_due' | 'trial';

export interface Plan {
  id: string;
  name: string;
  monthlyAmount: number;
}

export interface Customer {
  id: string;
  name: string;
  email: string;
}

export interface Subscription {
  id: string;
  customerId: string;
  planId: string;
  status: SubscriptionStatus;
  billingCycle: 'monthly' | 'yearly';
  nextBillingDate: string; // ISO date
  paymentMethod: string;
  cancelAtPeriodEnd?: boolean | undefined;
  cancellationReason?: string | undefined;
}

export interface SubscriptionListItem {
  id: string;
  customerName: string;
  customerEmail: string;
  planName: string;
  status: SubscriptionStatus;
  nextBillingDate: string;
  monthlyAmount: number;
}

export interface SubscriptionDetails {
  id: string;
  customer: Customer;
  plan: Plan;
  status: SubscriptionStatus;
  billingCycle: 'monthly' | 'yearly';
  nextBillingDate: string;
  paymentMethod: string;
  cancelAtPeriodEnd?: boolean | undefined;
  cancellationReason?: string | undefined;
}

export interface ChangePlanOptions {
  /**
   * When the change should take effect.
   * - 'immediately' – take effect now; proration is simulated.
   * - 'next_billing' – take effect on the next billing date.
   */
  effective: 'immediately' | 'next_billing';
}

export interface ChangePlanResult {
  subscription: SubscriptionDetails;
  /**
   * Simple representation of proration behaviour. For this demo we just
   * expose the price difference as a "proratedAmount" when changing
   * immediately.
   */
  proratedAmount: number | null;
}

export interface CancelSubscriptionOptions {
  /**
   * If true, subscription remains active until the end of the current
   * billing period.
   */
  cancelAtPeriodEnd: boolean;
  /** Optional admin-provided note explaining the cancellation. */
  reason?: string | undefined;
}

export interface EnvConfig {
  maxioSite: string | undefined;
  maxioUsername: string | undefined;
  maxioPassword: string | undefined;
  /**
   * 'dotenv' if values were loaded from a `.env` file,
   * 'process' if we only relied on process environment (e.g. GitHub Actions).
   */
  source: 'dotenv' | 'process';
}

function normalizeMaxioSite(raw: string | undefined): string | undefined {
  if (!raw) {
    return undefined;
  }

  let site = raw.trim();
  if (!site) {
    return undefined;
  }

  // Strip protocol if present.
  if (site.startsWith('http://')) {
    site = site.substring('http://'.length);
  } else if (site.startsWith('https://')) {
    site = site.substring('https://'.length);
  }

  // Remove any path / query part; we only want the host.
  const slashIndex = site.indexOf('/');
  if (slashIndex !== -1) {
    site = site.substring(0, slashIndex);
  }

  // If there is no dot, assume it's a short site name and expand it
  // to a full domain using the expected Chargify-style host.
  if (!site.includes('.')) {
    site = `${site}.chargify`;
  }

  return site;
}

/**
 * Read environment configuration. This function assumes the side-effectful
 * dotenv loading above has already occurred (if `.env` exists).
 */
export function getEnvConfig(): EnvConfig {
  const { MAXIO_SITE, MAXIO_BASIC_AUTH_USERNAME, MAXIO_BASIC_AUTH_PASSWORD } = process.env;

  return {
    maxioSite: normalizeMaxioSite(MAXIO_SITE),
    maxioUsername: MAXIO_BASIC_AUTH_USERNAME,
    maxioPassword: MAXIO_BASIC_AUTH_PASSWORD,
    source: usedDotEnv ? 'dotenv' : 'process',
  };
}

// ---------------------------------------------------------------------------
// In-memory demo data
// ---------------------------------------------------------------------------

const plans: Plan[] = [
  { id: 'basic', name: 'Basic', monthlyAmount: 10 },
  { id: 'pro', name: 'Pro', monthlyAmount: 25 },
  { id: 'enterprise', name: 'Enterprise', monthlyAmount: 60 },
];

const customers: Customer[] = [
  { id: 'c1', name: 'Alice Johnson', email: 'alice@example.com' },
  { id: 'c2', name: 'Bob Smith', email: 'bob@example.com' },
  { id: 'c3', name: 'Charlie Doe', email: 'charlie@example.com' },
];

const subscriptions: Subscription[] = [
  {
    id: 's1',
    customerId: 'c1',
    planId: 'basic',
    status: 'active',
    billingCycle: 'monthly',
    nextBillingDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    paymentMethod: 'Visa •••• 1111',
  },
  {
    id: 's2',
    customerId: 'c2',
    planId: 'pro',
    status: 'past_due',
    billingCycle: 'monthly',
    nextBillingDate: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
    paymentMethod: 'Mastercard •••• 2222',
  },
  {
    id: 's3',
    customerId: 'c3',
    planId: 'enterprise',
    status: 'trial',
    billingCycle: 'yearly',
    nextBillingDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    paymentMethod: 'Amex •••• 3333',
  },
];

function findPlan(planId: string): Plan | undefined {
  return plans.find((p) => p.id === planId);
}

function findCustomer(customerId: string): Customer | undefined {
  return customers.find((c) => c.id === customerId);
}

function toDetails(subscription: Subscription): SubscriptionDetails {
  const customer = findCustomer(subscription.customerId);
  const plan = findPlan(subscription.planId);

  if (!customer || !plan) {
    // For this simple demo we throw; real code might handle this more gracefully.
    throw new Error('Subscription data is inconsistent');
  }

  return {
    id: subscription.id,
    customer,
    plan,
    status: subscription.status,
    billingCycle: subscription.billingCycle,
    nextBillingDate: subscription.nextBillingDate,
    paymentMethod: subscription.paymentMethod,
    cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
    cancellationReason: subscription.cancellationReason,
  };
}

// ---------------------------------------------------------------------------
// Exported business functions for tests and UI
// ---------------------------------------------------------------------------

/**
 * View all subscriptions with optional status filter and search query.
 *
 * @param statusFilter - Filter by subscription status; if omitted, all are returned.
 * @param searchQuery - Case-insensitive search by customer name or email.
 */
export function viewAllSubscriptions(
  statusFilter?: SubscriptionStatus,
  searchQuery?: string,
): SubscriptionListItem[] {
  const search = (searchQuery ?? '').trim().toLowerCase();

  return subscriptions
    .filter((sub) => {
      if (statusFilter && sub.status !== statusFilter) {
        return false;
      }

      if (!search) {
        return true;
      }

      const customer = findCustomer(sub.customerId);
      if (!customer) {
        return false;
      }

      const haystack = `${customer.name} ${customer.email}`.toLowerCase();
      return haystack.includes(search);
    })
    .map((sub) => {
      const customer = findCustomer(sub.customerId);
      const plan = findPlan(sub.planId);

      if (!customer || !plan) {
        throw new Error('Subscription data is inconsistent');
      }

      return {
        id: sub.id,
        customerName: customer.name,
        customerEmail: customer.email,
        planName: plan.name,
        status: sub.status,
        nextBillingDate: sub.nextBillingDate,
        monthlyAmount: plan.monthlyAmount,
      };
    });
}

/**
 * View a single subscription's full details.
 *
 * @param subscriptionId - The subscription identifier.
 */
export function viewSubscriptionDetails(subscriptionId: string): SubscriptionDetails | null {
  const sub = subscriptions.find((s) => s.id === subscriptionId);
  if (!sub) {
    return null;
  }
  return toDetails(sub);
}

/**
 * Change a customer's subscription plan.
 *
 * @param subscriptionId - The subscription identifier.
 * @param newPlanId - Identifier of the new plan.
 * @param options - Controls when the change takes effect.
 */
export function changeSubscriptionPlan(
  subscriptionId: string,
  newPlanId: string,
  options: ChangePlanOptions,
): ChangePlanResult {
  const subscription = subscriptions.find((s) => s.id === subscriptionId);
  if (!subscription) {
    throw new Error(`Subscription ${subscriptionId} not found`);
  }

  const currentPlan = findPlan(subscription.planId);
  const newPlan = findPlan(newPlanId);
  if (!currentPlan || !newPlan) {
    throw new Error('Plan not found');
  }

  let proratedAmount: number | null = null;

  if (options.effective === 'immediately') {
    // Immediate change: apply now and compute a simple prorated difference.
    // This is a simplified representation of proration logic.
    proratedAmount = newPlan.monthlyAmount - currentPlan.monthlyAmount;
    subscription.planId = newPlan.id;
  } else {
    // Next billing: we simulate by leaving the subscription as-is but could
    // attach metadata in a real system. For simplicity we do not track
    // pending changes here.
    proratedAmount = null;
  }

  const details = toDetails(subscription);
  return { subscription: details, proratedAmount };
}

/**
 * Cancel a customer's subscription.
 *
 * @param subscriptionId - The subscription identifier.
 * @param options - Cancellation options including timing and reason.
 */
export function cancelSubscription(
  subscriptionId: string,
  options: CancelSubscriptionOptions,
): SubscriptionDetails {
  const subscription = subscriptions.find((s) => s.id === subscriptionId);
  if (!subscription) {
    throw new Error(`Subscription ${subscriptionId} not found`);
  }

  subscription.cancellationReason = options.reason;
  subscription.cancelAtPeriodEnd = options.cancelAtPeriodEnd;

  if (!options.cancelAtPeriodEnd) {
    subscription.status = 'canceled';
  }

  return toDetails(subscription);
}

// ---------------------------------------------------------------------------
// Simple UI renderer
// ---------------------------------------------------------------------------

/**
 * Render a basic HTML interface for the admin to manage subscriptions.
 *
 * This function does not start an HTTP server; callers can take the returned
 * HTML string and serve it however they like.
 */
export function renderAppHtml(): string {
  const allSubscriptions = viewAllSubscriptions();

  const rows = allSubscriptions
    .map(
      (s) => `
        <tr data-subscription-id="${s.id}">
          <td>${s.customerName}</td>
          <td>${s.customerEmail}</td>
          <td>${s.planName}</td>
          <td>${s.status}</td>
          <td>${new Date(s.nextBillingDate).toLocaleDateString()}</td>
          <td>$${s.monthlyAmount.toFixed(2)}</td>
        </tr>
      `,
    )
    .join('');

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Subscription Management</title>
    <style>
      body { font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; margin: 0; background-color: #f5f5f7; color: #111827; }
      header { background: #111827; color: white; padding: 1rem 1.5rem; }
      main { padding: 1.5rem; max-width: 1200px; margin: 0 auto; }
      h1 { margin: 0; font-size: 1.5rem; }
      .controls { display: flex; gap: 0.75rem; margin-bottom: 1rem; flex-wrap: wrap; }
      .controls select, .controls input { padding: 0.5rem 0.75rem; border-radius: 0.5rem; border: 1px solid #d1d5db; font-size: 0.9rem; }
      table { width: 100%; border-collapse: collapse; background: white; box-shadow: 0 1px 2px rgba(0,0,0,0.05); border-radius: 0.75rem; overflow: hidden; }
      th, td { padding: 0.75rem 0.9rem; font-size: 0.9rem; text-align: left; }
      th { background: #f9fafb; border-bottom: 1px solid #e5e7eb; }
      tr:nth-child(even) { background: #f9fafb; }
      tr:hover { background: #e5f0ff; cursor: pointer; }
      .layout { display: grid; grid-template-columns: 2fr 1.3fr; gap: 1.5rem; align-items: flex-start; }
      .panel { background: white; padding: 1rem 1.25rem; border-radius: 0.75rem; box-shadow: 0 1px 2px rgba(0,0,0,0.05); }
      .panel h2 { margin-top: 0; font-size: 1.1rem; }
      .field { margin-bottom: 0.75rem; font-size: 0.9rem; }
      .field label { display: block; font-weight: 600; margin-bottom: 0.2rem; }
      .field input, .field select, .field textarea { width: 100%; padding: 0.4rem 0.6rem; border-radius: 0.5rem; border: 1px solid #d1d5db; font-size: 0.9rem; }
      .actions { display: flex; gap: 0.5rem; margin-top: 0.75rem; }
      button { border: none; border-radius: 9999px; padding: 0.4rem 0.9rem; font-size: 0.85rem; cursor: pointer; }
      button.primary { background: #2563eb; color: white; }
      button.secondary { background: #e5e7eb; color: #111827; }
      small { color: #6b7280; }
      @media (max-width: 900px) {
        .layout { grid-template-columns: 1fr; }
      }
    </style>
  </head>
  <body>
    <header>
      <h1>Subscription Management</h1>
    </header>
    <main>
      <div class="layout">
        <section class="panel">
          <h2>All Subscriptions</h2>
          <div class="controls">
            <select id="statusFilter">
              <option value="">All statuses</option>
              <option value="active">Active</option>
              <option value="canceled">Canceled</option>
              <option value="past_due">Past Due</option>
              <option value="trial">Trial</option>
            </select>
            <input id="searchBox" type="search" placeholder="Search by name or email" />
          </div>
          <table id="subscriptionsTable">
            <thead>
              <tr>
                <th>Customer</th>
                <th>Email</th>
                <th>Plan</th>
                <th>Status</th>
                <th>Next Billing</th>
                <th>Amount (Monthly)</th>
              </tr>
            </thead>
            <tbody>
              ${rows}
            </tbody>
          </table>
          <small>Click a row to view details, change plan, or cancel subscription.</small>
        </section>
        <section class="panel" id="detailsPanel">
          <h2>Subscription Details</h2>
          <div id="detailsContent">
            <p>Select a subscription from the table to view details.</p>
          </div>
        </section>
      </div>
    </main>
    <script>
      (function () {
        const rows = Array.from(document.querySelectorAll('#subscriptionsTable tbody tr'));
        const statusFilter = document.getElementById('statusFilter');
        const searchBox = document.getElementById('searchBox');
        const detailsContent = document.getElementById('detailsContent');
        let selectedSubscriptionId = null;

        function applyFilters() {
          const status = statusFilter.value;
          const search = searchBox.value.toLowerCase();

          rows.forEach(row => {
            const rowStatus = row.children[3].textContent.toLowerCase();
            const text = row.textContent.toLowerCase();

            const matchesStatus = !status || rowStatus === status;
            const matchesSearch = !search || text.includes(search);

            row.style.display = matchesStatus && matchesSearch ? '' : 'none';
          });
        }

        function renderDetails(row, subscriptionId) {
          const cells = row.children;
          const customer = cells[0].textContent;
          const email = cells[1].textContent;
          const plan = cells[2].textContent;
          const status = cells[3].textContent;
          const nextBilling = cells[4].textContent;
          const amount = cells[5].textContent;

          detailsContent.innerHTML = \`
            <div class="field">
              <label>Customer</label>
              <div>\${customer} (\${email})</div>
            </div>
            <div class="field">
              <label>Current Plan</label>
              <div id="currentPlanText">\${plan} – \${amount} / month</div>
            </div>
            <div class="field">
              <label>Status</label>
              <div id="currentStatusText">\${status}</div>
            </div>
            <div class="field">
              <label>Next Billing Date</label>
              <div id="currentNextBillingText">\${nextBilling}</div>
            </div>
            <hr />
            <div class="field">
              <label>Change Plan</label>
              <select id="planSelect">
                <option value="basic">Basic</option>
                <option value="pro">Pro</option>
                <option value="enterprise">Enterprise</option>
              </select>
              <select id="planEffective">
                <option value="immediately">Effective immediately (prorated)</option>
                <option value="next_billing">On next billing date</option>
              </select>
            </div>
            <div class="actions">
              <button class="primary" type="button" id="changePlanButton">Change Plan</button>
            </div>
            <hr />
            <div class="field">
              <label>Cancel Subscription</label>
              <select id="cancelTiming">
                <option value="now">Cancel immediately</option>
                <option value="period_end">Cancel at period end</option>
              </select>
              <textarea id="cancelReason" rows="3" placeholder="Optional reason or note"></textarea>
            </div>
            <div class="actions">
              <button class="secondary" type="button" id="cancelSubscriptionButton">Cancel Subscription</button>
            </div>
            <small id="detailsMessage" style="display:block;margin-top:0.5rem;color:#6b7280;">Changes will be applied via the API.</small>
          \`;

          const changeButton = document.getElementById('changePlanButton');
          const cancelButton = document.getElementById('cancelSubscriptionButton');
          const planSelect = document.getElementById('planSelect');
          const planEffective = document.getElementById('planEffective');
          const cancelTiming = document.getElementById('cancelTiming');
          const cancelReason = document.getElementById('cancelReason');
          const detailsMessage = document.getElementById('detailsMessage');

          function setMessage(text, isError) {
            if (!detailsMessage) return;
            detailsMessage.textContent = text;
            detailsMessage.style.color = isError ? '#b91c1c' : '#047857';
          }

          if (changeButton && planSelect && planEffective) {
            changeButton.addEventListener('click', async () => {
              try {
                setMessage('Applying plan change...', false);
                const response = await fetch(\`/subscriptions/\${subscriptionId}/change-plan\`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    planId: planSelect.value,
                    effective: planEffective.value,
                  }),
                });

                if (!response.ok) {
                  const errorData = await response.json().catch(() => null);
                  const msg = errorData && errorData.error ? errorData.error : 'Failed to change plan';
                  setMessage(msg, true);
                  return;
                }

                const data = await response.json();
                const newPlanName = data.subscription?.plan?.name;
                const newAmount = data.subscription?.plan?.monthlyAmount;

                const currentPlanText = document.getElementById('currentPlanText');
                if (currentPlanText && newPlanName && typeof newAmount === 'number') {
                  currentPlanText.textContent = \`\${newPlanName} – $\${newAmount.toFixed(2)} / month\`;
                }

                setMessage('Plan updated successfully.', false);
              } catch (e) {
                setMessage('Network error while changing plan.', true);
              }
            });
          }

          if (cancelButton && cancelTiming) {
            cancelButton.addEventListener('click', async () => {
              const atPeriodEnd = cancelTiming.value === 'period_end';

              try {
                setMessage('Submitting cancellation...', false);
                const response = await fetch(\`/subscriptions/\${subscriptionId}/cancel\`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    cancelAtPeriodEnd: atPeriodEnd,
                    reason: cancelReason ? cancelReason.value : undefined,
                  }),
                });

                if (!response.ok) {
                  const errorData = await response.json().catch(() => null);
                  const msg = errorData && errorData.error ? errorData.error : 'Failed to cancel subscription';
                  setMessage(msg, true);
                  return;
                }

                const data = await response.json();
                const newStatus = data.status;
                const currentStatusText = document.getElementById('currentStatusText');
                if (currentStatusText && newStatus) {
                  currentStatusText.textContent = newStatus;
                }

                setMessage('Subscription cancellation updated successfully.', false);
              } catch (e) {
                setMessage('Network error while cancelling subscription.', true);
              }
            });
          }
        }

        rows.forEach(row => {
          row.addEventListener('click', () => {
            const id = row.getAttribute('data-subscription-id');
            selectedSubscriptionId = id;
            renderDetails(row, id);
          });
        });

        statusFilter.addEventListener('change', applyFilters);
        searchBox.addEventListener('input', applyFilters);
      })();
    </script>
  </body>
</html>`;
}

 