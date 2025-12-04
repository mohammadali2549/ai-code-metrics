import express from 'express';
import type { Request, Response } from 'express';
import {
  ApiError,
  Client,
  Environment,
  SubscriptionListInclude,
  SubscriptionStateFilter,
  SubscriptionInclude,
  SubscriptionSort,
  SubscriptionsController,
  SubscriptionProductsController,
  SubscriptionStatusController,
} from '@maxio-com/advanced-billing-sdk';
import type {
  SubscriptionProductMigrationRequest,
  CancellationRequest,
} from '@maxio-com/advanced-billing-sdk';

// Basic Express app setup
const app = express();
app.use(express.json());

// Initialize Maxio Advanced Billing client
const client = new Client({
  basicAuthCredentials: {
    username: process.env.BASIC_AUTH_USERNAME ?? '',
    password: process.env.BASIC_AUTH_PASSWORD ?? '',
  },
  timeout: 120_000,
  environment: Environment.US,
  site: process.env.SITE_SUBDOMAIN ?? '',
});

const subscriptionsController = new SubscriptionsController(client);
const subscriptionProductsController = new SubscriptionProductsController(client);
const subscriptionStatusController = new SubscriptionStatusController(client);

// Helper: recursively convert all BigInt values to strings so JSON serialization succeeds
const replaceBigInts = (value: unknown): unknown => {
  if (typeof value === 'bigint') {
    return value.toString();
  }

  if (Array.isArray(value)) {
    return value.map((item) => replaceBigInts(item));
  }

  if (value && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      result[key] = replaceBigInts(v);
    }
    return result;
  }

  return value;
};

const serializeSubscription = (subscription: unknown): unknown => {
  if (!subscription) {
    return subscription;
  }
  return replaceBigInts(subscription);
};

// Simple HTML admin page
app.get('/', (_req: Request, res: Response) => {
  res.type('html').send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Subscriptions Admin</title>
  <style>
    body { font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; margin: 0; padding: 0; background: #f5f5f7; color: #111827; }
    header { background: #111827; color: white; padding: 1rem 2rem; }
    main { padding: 1.5rem 2rem; display: grid; grid-template-columns: 2fr 1.4fr; gap: 1.5rem; }
    h1 { margin: 0; font-size: 1.4rem; }
    h2 { margin-top: 0; font-size: 1.1rem; }
    .card { background: white; border-radius: 0.75rem; padding: 1rem 1.25rem; box-shadow: 0 10px 25px rgba(15, 23, 42, 0.08); }
    .filters { display: flex; gap: 0.75rem; margin-bottom: 0.75rem; flex-wrap: wrap; align-items: center; }
    .filters label { font-size: 0.8rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; color: #6b7280; }
    select, input[type="text"] { padding: 0.45rem 0.6rem; border-radius: 0.5rem; border: 1px solid #d1d5db; font-size: 0.9rem; min-width: 7rem; }
    input[type="text"] { min-width: 10rem; flex: 1; }
    button { cursor: pointer; border-radius: 9999px; border: none; padding: 0.45rem 0.9rem; font-size: 0.85rem; font-weight: 600; letter-spacing: 0.03em; text-transform: uppercase; }
    button.primary { background: #111827; color: white; }
    button.secondary { background: #e5e7eb; color: #111827; }
    button.danger { background: #b91c1c; color: white; }
    button:disabled { opacity: 0.5; cursor: default; }
    table { width: 100%; border-collapse: collapse; font-size: 0.86rem; }
    th, td { padding: 0.4rem 0.3rem; text-align: left; }
    th { font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.05em; color: #6b7280; border-bottom: 1px solid #e5e7eb; }
    tr { cursor: pointer; }
    tbody tr:hover { background: #f3f4f6; }
    .status-pill { display: inline-flex; align-items: center; padding: 0.15rem 0.5rem; border-radius: 999px; font-size: 0.75rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; }
    .status-active { background: #dcfce7; color: #166534; }
    .status-canceled { background: #fee2e2; color: #b91c1c; }
    .status-past_due { background: #fef3c7; color: #92400e; }
    .status-trialing { background: #e0e7ff; color: #3730a3; }
    .muted { color: #6b7280; font-size: 0.8rem; }
    .detail-row { display: flex; justify-content: space-between; margin-bottom: 0.3rem; font-size: 0.9rem; }
    .detail-label { font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.06em; color: #6b7280; }
    .detail-value { font-weight: 500; }
    .section-title { margin-top: 0.8rem; margin-bottom: 0.3rem; font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.08em; color: #9ca3af; }
    form { display: grid; gap: 0.4rem; margin-top: 0.4rem; }
    form label { font-size: 0.8rem; color: #4b5563; }
    form input, form select, form textarea { margin-top: 0.1rem; width: 100%; padding: 0.4rem 0.5rem; border-radius: 0.5rem; border: 1px solid #d1d5db; font-size: 0.86rem; }
    form textarea { min-height: 60px; resize: vertical; }
    .form-actions { display: flex; justify-content: flex-end; gap: 0.5rem; margin-top: 0.3rem; }
    .badge { display: inline-flex; align-items: center; padding: 0.1rem 0.45rem; border-radius: 999px; background: #e5e7eb; color: #374151; font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.06em; font-weight: 600; }
    .error { color: #b91c1c; font-size: 0.8rem; margin-top: 0.3rem; }
    .success { color: #166534; font-size: 0.8rem; margin-top: 0.3rem; }
    @media (max-width: 900px) {
      main { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <header>
    <h1>Maxio Subscriptions Admin</h1>
  </header>
  <main>
    <section class="card">
      <h2>Subscriptions</h2>
      <div class="filters">
        <div>
          <label for="statusFilter">Status</label><br />
          <select id="statusFilter">
            <option value="">All</option>
            <option value="active">Active</option>
            <option value="canceled">Canceled</option>
            <option value="past_due">Past Due</option>
            <option value="trialing">Trial</option>
          </select>
        </div>
        <div style="flex:1; min-width: 10rem;">
          <label for="searchInput">Search</label><br />
          <input id="searchInput" type="text" placeholder="Customer name or email" />
        </div>
        <div>
          <label>&nbsp;</label><br />
          <button id="refreshBtn" class="secondary">Refresh</button>
        </div>
      </div>
      <div class="muted" id="listStatus">Loading subscriptions…</div>
      <table>
        <thead>
          <tr>
            <th>Customer</th>
            <th>Plan</th>
            <th>Status</th>
            <th>Next Billing</th>
            <th>Amount / mo</th>
          </tr>
        </thead>
        <tbody id="subscriptionsBody">
        </tbody>
      </table>
    </section>

    <section class="card">
      <h2>Subscription Details</h2>
      <div id="detailsPanel" class="muted">Select a subscription to view details.</div>
    </section>
  </main>
  <script>
    const statusFilter = document.getElementById('statusFilter');
    const searchInput = document.getElementById('searchInput');
    const refreshBtn = document.getElementById('refreshBtn');
    const listStatus = document.getElementById('listStatus');
    const tbody = document.getElementById('subscriptionsBody');
    const detailsPanel = document.getElementById('detailsPanel');

    let currentSubscription = null;

    function formatMoney(cents, currency) {
      if (cents == null) return '-';
      const amount = cents / 100;
      try {
        return new Intl.NumberFormat(undefined, { style: 'currency', currency: currency || 'USD' }).format(amount);
      } catch {
        return amount.toFixed(2) + ' ' + (currency || 'USD');
      }
    }

    function statusClass(status) {
      if (!status) return 'status-pill';
      const key = String(status).toLowerCase();
      if (key.includes('active')) return 'status-pill status-active';
      if (key.includes('cancel')) return 'status-pill status-canceled';
      if (key.includes('past')) return 'status-pill status-past_due';
      if (key.includes('trial')) return 'status-pill status-trialing';
      return 'status-pill';
    }

    function renderSubscriptions(subscriptions) {
      tbody.innerHTML = '';
      if (!Array.isArray(subscriptions) || !subscriptions.length) {
        listStatus.textContent = 'No subscriptions found for the current filters.';
        return;
      }
      listStatus.textContent = subscriptions.length + ' subscription(s) loaded.';
      for (const sub of subscriptions) {
        const tr = document.createElement('tr');
        tr.dataset.id = String(sub.id);
        const customerName = sub.customer ? (sub.customer.firstName || '') + ' ' + (sub.customer.lastName || '') : '—';
        const email = sub.customer ? sub.customer.email : '';
        const planName = sub.product ? sub.product.name : '—';
        const status = sub.state || sub.status;
        const nextBilling = sub.nextAssessmentAt ? new Date(sub.nextAssessmentAt).toLocaleDateString() : '—';
        const currency = (sub.currency || 'USD').toUpperCase();
        const amount = sub.productPriceInCents ?? sub.totalRevenueInCents ?? null;
        tr.innerHTML = '<td>' + customerName + '<div class="muted">' + (email || '') + '</div></td>' +
                       '<td>' + planName + '</td>' +
                       '<td><span class="' + statusClass(status) + '">' + (status || '').toString().toUpperCase() + '</span></td>' +
                       '<td>' + nextBilling + '</td>' +
                       '<td>' + formatMoney(amount, currency) + '</td>';
        tr.addEventListener('click', () => {
          loadSubscriptionDetails(sub.id);
        });
        tbody.appendChild(tr);
      }
    }

    async function loadSubscriptions() {
      listStatus.textContent = 'Loading subscriptions…';
      tbody.innerHTML = '';
      try {
        const state = statusFilter.value;
        const search = searchInput.value.trim();
        const params = new URLSearchParams();
        if (state) params.set('state', state);
        if (search) {
          // Send both; backend can use whichever is supported
          params.set('customerName', search);
          params.set('customerEmail', search);
        }
        const resp = await fetch('/subscriptions' + (params.toString() ? ('?' + params.toString()) : ''));
        if (!resp.ok) {
          const text = await resp.text();
          throw new Error(text || 'Failed to load');
        }
        const data = await resp.json();
        // Maxio SDK wraps in collection; prefer .subscriptions or .data if present
        const items = data.subscriptions || data.data || data;
        renderSubscriptions(items);
      } catch (err) {
        console.error(err);
        listStatus.textContent = 'Failed to load subscriptions.';
      }
    }

    async function loadSubscriptionDetails(id) {
      detailsPanel.innerHTML = '<span class="muted">Loading subscription #' + id + '…</span>';
      try {
        const resp = await fetch('/subscriptions/' + id);
        if (!resp.ok) {
          const text = await resp.text();
          throw new Error(text || 'Failed to load details');
        }
        const sub = await resp.json();
        currentSubscription = sub;

        const customer = sub.customer || {};
        const product = sub.product || {};
        const billingPeriod = (sub.productFamily && sub.productFamily.intervalUnit) || sub.productIntervalUnit || '';
        const billingMethod = sub.paymentMethod || {};
        const nextBilling = sub.nextAssessmentAt ? new Date(sub.nextAssessmentAt).toLocaleString() : '—';
        const currency = (sub.currency || 'USD').toUpperCase();
        const amount = sub.productPriceInCents ?? sub.totalRevenueInCents ?? null;

        detailsPanel.innerHTML =
          '<div class="detail-row"><div><div class="detail-label">Customer</div><div class="detail-value">' +
          (customer.firstName || '') + ' ' + (customer.lastName || '') +
          '</div><div class="muted">' + (customer.email || '') + '</div></div>' +
          '<div><span class="badge">ID ' + sub.id + '</span></div></div>' +

          '<div class="section-title">Plan & Status</div>' +
          '<div class="detail-row"><div><div class="detail-label">Plan</div><div class="detail-value">' + (product.name || '—') + '</div></div>' +
          '<div><div class="detail-label">Status</div><div class="detail-value"><span class="' + statusClass(sub.state || sub.status) + '">' +
          String(sub.state || sub.status || '').toUpperCase() +
          '</span></div></div></div>' +

          '<div class="detail-row"><div><div class="detail-label">Amount</div><div class="detail-value">' +
          formatMoney(amount, currency) +
          '</div></div><div><div class="detail-label">Billing Cycle</div><div class="detail-value">' +
          (billingPeriod || '—') +
          '</div></div></div>' +

          '<div class="detail-row"><div><div class="detail-label">Next Billing Date</div><div class="detail-value">' +
          nextBilling +
          '</div></div></div>' +

          '<div class="section-title">Payment Method</div>' +
          '<div class="detail-row"><div><div class="detail-label">Type</div><div class="detail-value">' +
          (billingMethod.paymentType || billingMethod.type || '—') +
          '</div></div><div><div class="detail-label">Last 4</div><div class="detail-value">' +
          (billingMethod.lastFour || billingMethod.last4 || '—') +
          '</div></div></div>' +

          '<div class="section-title">Change Plan</div>' +
          '<form id="planForm">' +
          '<label>New Product ID<input name="productId" type="number" required /></label>' +
          '<label>When should the change take effect?' +
          '<select name="timing"><option value="immediately">Immediately (prorated)</option>' +
          '<option value="next_billing">Next billing cycle</option></select></label>' +
          '<div class="form-actions"><button type="submit" class="primary">Update Plan</button></div>' +
          '<div id="planMessage" class="muted"></div>' +
          '</form>' +

          '<div class="section-title">Cancel Subscription</div>' +
          '<form id="cancelForm">' +
          '<label>Cancellation timing<select name="timing">' +
          '<option value="immediately">Cancel immediately</option>' +
          '<option value="period_end">Cancel at period end</option>' +
          '</select></label>' +
          '<label>Reason / Note<textarea name="reason" placeholder="Optional note for why this subscription is being canceled"></textarea></label>' +
          '<div class="form-actions"><button type="submit" class="danger">Cancel Subscription</button></div>' +
          '<div id="cancelMessage" class="muted"></div>' +
          '</form>';

        const planForm = document.getElementById('planForm');
        const cancelForm = document.getElementById('cancelForm');
        const planMessage = document.getElementById('planMessage');
        const cancelMessage = document.getElementById('cancelMessage');

        planForm.addEventListener('submit', async (e) => {
          e.preventDefault();
          planMessage.textContent = '';
          const formData = new FormData(planForm);
          const productId = formData.get('productId');
          const timing = formData.get('timing');
          if (!productId) {
            planMessage.textContent = 'Product ID is required.';
            planMessage.className = 'error';
            return;
          }
          try {
            const resp = await fetch('/subscriptions/' + id + '/plan', {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                productId: Number(productId),
                immediate: timing === 'immediately',
              }),
            });
            if (!resp.ok) {
              const text = await resp.text();
              throw new Error(text || 'Failed to update plan');
            }
            await resp.json();
            planMessage.textContent = 'Plan updated successfully.';
            planMessage.className = 'success';
            loadSubscriptions();
            loadSubscriptionDetails(id);
          } catch (err) {
            console.error(err);
            planMessage.textContent = 'Failed to update plan.';
            planMessage.className = 'error';
          }
        });

        cancelForm.addEventListener('submit', async (e) => {
          e.preventDefault();
          cancelMessage.textContent = '';
          const formData = new FormData(cancelForm);
          const timing = formData.get('timing');
          const reason = formData.get('reason');
          try {
            const resp = await fetch('/subscriptions/' + id, {
              method: 'DELETE',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                cancelAtPeriodEnd: timing === 'period_end',
                cancellationMessage: reason || undefined,
              }),
            });
            if (!resp.ok) {
              const text = await resp.text();
              throw new Error(text || 'Failed to cancel subscription');
            }
            await resp.json();
            cancelMessage.textContent = 'Subscription cancellation has been scheduled.';
            cancelMessage.className = 'success';
            loadSubscriptions();
            detailsPanel.innerHTML = '<span class="muted">Subscription canceled or scheduled for cancellation.</span>';
          } catch (err) {
            console.error(err);
            cancelMessage.textContent = 'Failed to cancel subscription.';
            cancelMessage.className = 'error';
          }
        });
      } catch (err) {
        console.error(err);
        detailsPanel.innerHTML = '<span class="error">Failed to load subscription details.</span>';
      }
    }

    refreshBtn.addEventListener('click', () => {
      loadSubscriptions();
    });

    statusFilter.addEventListener('change', () => {
      loadSubscriptions();
    });

    searchInput.addEventListener('keyup', (e) => {
      if (e.key === 'Enter') {
        loadSubscriptions();
      }
    });

    loadSubscriptions();
  </script>
</body>
</html>`);
});

// API: View all subscriptions with filters and search
app.get('/subscriptions', async (req: Request, res: Response) => {
  const { state, search } = req.query;

  const collect: {
    page: number;
    perPage: number;
    sort: SubscriptionSort;
    include?: SubscriptionListInclude[];
    state?: SubscriptionStateFilter;
    metadata?: Record<string, string>;
  } = {
    page: 1,
    perPage: 50,
    sort: SubscriptionSort.SignupDate,
    include: [SubscriptionListInclude.SelfServicePageToken],
  };

  if (typeof state === 'string' && state.length > 0) {
    collect.state = state as SubscriptionStateFilter;
  }

  if (typeof search === 'string' && search.trim().length > 0) {
    collect.metadata = { customer_name_or_email: search.trim() };
  }

  try {
    const response = await subscriptionsController.listSubscriptions(collect);
    const raw = response.result as any[];
    const subscriptions = Array.isArray(raw)
      ? raw
          .map((item) => ('subscription' in item ? (item as any).subscription : item))
          .filter((sub) => sub != null)
          .map((sub) => serializeSubscription(sub))
      : [];

    res.json(subscriptions);
  } catch (error: unknown) {
    if (error instanceof ApiError) {
      res.status(error.statusCode).json(error.body);
    } else {
      // eslint-disable-next-line no-console
      console.error('Unexpected error listing subscriptions', error);
      res.status(500).json({ message: 'Unexpected error listing subscriptions' });
    }
  }
});

// API: View a single subscription’s details
app.get('/subscriptions/:id', async (req: Request, res: Response) => {
  const rawId = req.params.id;

  if (typeof rawId !== 'string' || rawId.length === 0) {
    res.status(400).json({ message: 'Invalid subscription id' });
    return;
  }

  const subscriptionId = Number.parseInt(rawId, 10);

  if (Number.isNaN(subscriptionId)) {
    res.status(400).json({ message: 'Invalid subscription id' });
    return;
  }

  const include: SubscriptionInclude[] = [SubscriptionInclude.SelfServicePageToken];

  try {
    const response = await subscriptionsController.readSubscription(subscriptionId, include);
    res.json(serializeSubscription(response.result.subscription));
  } catch (error: unknown) {
    if (error instanceof ApiError) {
      res.status(error.statusCode).json(error.body);
    } else {
      res.status(500).json({ message: 'Unexpected error reading subscription' });
    }
  }
});

// API: Change a subscription’s plan (upgrade/downgrade)
app.put('/subscriptions/:id/plan', async (req: Request, res: Response) => {
  const rawId = req.params.id;

  if (typeof rawId !== 'string' || rawId.length === 0) {
    res.status(400).json({ message: 'Invalid subscription id' });
    return;
  }

  const subscriptionId = Number.parseInt(rawId, 10);

  if (Number.isNaN(subscriptionId)) {
    res.status(400).json({ message: 'Invalid subscription id' });
    return;
  }

  const { productId, immediate } = req.body as {
    productId?: number;
    immediate?: boolean;
  };

  if (typeof productId !== 'number' || Number.isNaN(productId)) {
    res.status(400).json({ message: 'productId is required and must be a number' });
    return;
  }

  const body: SubscriptionProductMigrationRequest = {
    migration: {
      productId,
      preservePeriod: !immediate,
    },
  };

  try {
    const response = await subscriptionProductsController.migrateSubscriptionProduct(subscriptionId, body);
    res.json(serializeSubscription(response.result.subscription));
  } catch (error: unknown) {
    if (error instanceof ApiError) {
      res.status(error.statusCode).json(error.body);
    } else {
      res.status(500).json({ message: 'Unexpected error updating subscription plan' });
    }
  }
});

// API: Cancel subscription (immediately or at period end)
app.delete('/subscriptions/:id', async (req: Request, res: Response) => {
  const rawId = req.params.id;

  if (typeof rawId !== 'string' || rawId.length === 0) {
    res.status(400).json({ message: 'Invalid subscription id' });
    return;
  }

  const subscriptionId = Number.parseInt(rawId, 10);

  if (Number.isNaN(subscriptionId)) {
    res.status(400).json({ message: 'Invalid subscription id' });
    return;
  }

  const { cancelAtPeriodEnd, cancellationMessage } = req.body as {
    cancelAtPeriodEnd?: boolean;
    cancellationMessage?: string;
  };

  try {
    if (cancelAtPeriodEnd) {
      const response = await subscriptionStatusController.initiateDelayedCancellation(subscriptionId);
      res.json(replaceBigInts(response.result));
    } else {
      const body: CancellationRequest = {
        subscription: {
          cancellationMessage: cancellationMessage ?? '',
        },
      };
      const response = await subscriptionStatusController.cancelSubscription(subscriptionId, body);
      res.json(serializeSubscription(response.result.subscription));
    }
  } catch (error: unknown) {
    if (error instanceof ApiError) {
      res.status(error.statusCode).json(error.body);
    } else {
      res.status(500).json({ message: 'Unexpected error cancelling subscription' });
    }
  }
});

const PORT = Number.parseInt(process.env.PORT ?? '3000', 10);

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Server is running on port ${PORT}`);
});

export { app };
