// src/server.ts
//
// Minimal Express server that exposes the subscription management UI and
// JSON endpoints. This file is separate from `app.ts` so importing the
// business logic in tests does not start an HTTP server.

import express from 'express';
import cors from 'cors';

import {
  renderAppHtml,
  viewAllSubscriptions,
  viewSubscriptionDetails,
  changeSubscriptionPlan,
  cancelSubscription,
  getEnvConfig,
} from './app.js';
import type { SubscriptionStatus } from './app.js';

const app = express();
app.use(cors());
app.use(express.json());

// Simple health check.
app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

// Serve the HTML UI.
app.get('/', (_req, res) => {
  res.type('html').send(renderAppHtml());
});

// List subscriptions, with optional status filter & search.
app.get('/subscriptions', (req, res) => {
  const statusFilterRaw = (req.query.status as string | undefined)?.toLowerCase() ?? undefined;
  const search = (req.query.search as string | undefined) ?? undefined;

  const allowedStatuses: SubscriptionStatus[] = ['active', 'canceled', 'past_due', 'trial'];
  const statusFilter = allowedStatuses.includes(statusFilterRaw as SubscriptionStatus)
    ? (statusFilterRaw as SubscriptionStatus)
    : undefined;

  const list = viewAllSubscriptions(statusFilter, search);
  res.json(list);
});

// Single subscription details.
app.get('/subscriptions/:id', (req, res) => {
  const details = viewSubscriptionDetails(req.params.id);
  if (!details) {
    res.status(404).json({ error: 'Subscription not found' });
    return;
  }
  res.json(details);
});

// Change plan for a subscription.
app.post('/subscriptions/:id/change-plan', (req, res) => {
  const { planId, effective } = req.body as { planId?: string; effective?: 'immediately' | 'next_billing' };

  if (!planId || (effective !== 'immediately' && effective !== 'next_billing')) {
    res.status(400).json({ error: 'Invalid payload' });
    return;
  }

  try {
    const result = changeSubscriptionPlan(req.params.id, planId, { effective });
    res.json(result);
  } catch (error) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const message = (error as any)?.message ?? 'Unknown error';
    res.status(400).json({ error: message });
  }
});

// Cancel a subscription.
app.post('/subscriptions/:id/cancel', (req, res) => {
  const { cancelAtPeriodEnd, reason } = req.body as { cancelAtPeriodEnd?: boolean; reason?: string };

  if (typeof cancelAtPeriodEnd !== 'boolean') {
    res.status(400).json({ error: 'cancelAtPeriodEnd must be a boolean' });
    return;
  }

  try {
    const details = cancelSubscription(req.params.id, {
      cancelAtPeriodEnd,
      reason,
    });
    res.json(details);
  } catch (error) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const message = (error as any)?.message ?? 'Unknown error';
    res.status(400).json({ error: message });
  }
});

// Expose environment config for debugging (no secrets).
app.get('/env-info', (_req, res) => {
  const env = getEnvConfig();
  res.json({
    maxioSite: env.maxioSite,
    source: env.source,
    hasUsername: Boolean(env.maxioUsername),
    hasPassword: Boolean(env.maxioPassword),
  });
});

const port = Number(process.env.PORT ?? 3000);

app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`Subscription management app listening on http://localhost:${port}`);
});


