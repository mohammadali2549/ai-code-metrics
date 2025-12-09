import 'dotenv/config';
import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import {
  viewAllSubscriptions,
  getSubscriptionDetails,
  changeSubscriptionPlan,
  cancelSubscriptionCore,
  type UiSubscriptionStatusFilter,
  type ChangeSubscriptionWhen,
  type CancelSubscriptionWhen,
  server,
} from '../src/app.js';

// These tests are integration-style and will invoke the real Maxio sandbox APIs.
// They assume valid credentials are provided via environment variables or a .env file.

test(
  'View All Subscriptions: list customers, filter, and search',
  { timeout: 120_000 },
  async (t) => {
    t.after(() => {
      // Ensure the HTTP server started by app.ts does not keep the test runner alive.
      server.close();
    });

    const all = await viewAllSubscriptions();

    assert.ok(Array.isArray(all), 'Expected an array of subscriptions');

    if (all.length === 0) {
      t.diagnostic(
        'No subscriptions found in the current Maxio environment; skipping field-level assertions.',
      );
      return;
    }

    const first = all[0]!;

    // Basic shape checks aligned with SubscriptionSummary from app.ts
    assert.ok(
      typeof first.customerName === 'string' || first.customerName === null,
      'customerName should be a string or null',
    );
    assert.ok(
      first.customerEmail === undefined ||
        first.customerEmail === null ||
        typeof first.customerEmail === 'string',
      'customerEmail should be string, null, or undefined',
    );
    assert.ok(
      first.plan === undefined ||
        first.plan === null ||
        typeof first.plan === 'string',
      'plan should be string, null, or undefined',
    );
    assert.ok(
      first.status === undefined ||
        first.status === null ||
        typeof first.status === 'string',
      'status should be present as a string when available',
    );
    assert.ok(
      'nextBillingDate' in first,
      'Expected nextBillingDate to be present',
    );
    assert.ok('monthlyAmount' in first, 'Expected monthlyAmount to be present');

    // Filter by a specific status (if any subscriptions exist with that status).
    const statusFilter: UiSubscriptionStatusFilter = 'active';
    const filtered = await viewAllSubscriptions(statusFilter);

    if (filtered.length > 0) {
      for (const sub of filtered) {
        assert.ok(
          sub.status !== undefined,
          'Filtered subscription should have a status',
        );
      }
    } else {
      t.diagnostic(
        'No subscriptions matched the "active" status filter in this environment.',
      );
    }

    // Search by part of the customer's name or email, reusing data from the first subscription.
    const searchable =
      first.customerName?.split(' ')[0] ||
      first.customerEmail?.split('@')[0] ||
      '';

    if (!searchable) {
      t.diagnostic(
        'First subscription does not have a search-friendly name or email; skipping search assertion.',
      );
      return;
    }

    const searchResults = await viewAllSubscriptions(undefined, searchable);

    assert.ok(
      Array.isArray(searchResults),
      'Expected search results to be an array',
    );

    assert.ok(
      searchResults.some(
        (sub) => String(sub.id) === String(first.id),
      ),
      'Expected search to return at least the first subscription when searching by part of its name or email',
    );
  },
);

test('View Single Subscription Details: basic fields are populated', { timeout: 120_000 }, async (t) => {
  const list = await viewAllSubscriptions();

  if (list.length === 0) {
    t.diagnostic(
      'No subscriptions found in the current Maxio environment; skipping detail assertions.',
    );
    return;
  }

  const first = list[0]!;
  const subscriptionId = Number(first.id);

  if (!Number.isFinite(subscriptionId)) {
    t.diagnostic(
      `First subscription id "${String(
        first.id,
      )}" is not a numeric identifier; skipping detail assertions.`,
    );
    return;
  }

  const details = await getSubscriptionDetails(subscriptionId);

  assert.equal(typeof details.id, 'number');
  assert.ok(details.customerInfo, 'Expected customerInfo');
  assert.ok(
    typeof details.customerInfo.name === 'string' ||
      details.customerInfo.name === null,
    'Expected customerInfo.name to be string or null',
  );
  assert.ok(
    details.customerInfo.email === undefined ||
      details.customerInfo.email === null ||
      typeof details.customerInfo.email === 'string',
    'Expected customerInfo.email to be string, null, or undefined',
  );
  assert.ok(
    details.currentPlan === undefined ||
      details.currentPlan === null ||
      typeof details.currentPlan === 'string',
    'Expected currentPlan to be string, null, or undefined',
  );
  assert.ok('price' in details, 'Expected price to be present');
  assert.ok(details.billingCycle, 'Expected billingCycle information');
  assert.ok(
    'currentPeriodStartedAt' in details.billingCycle,
    'Expected currentPeriodStartedAt in billingCycle',
  );
  assert.ok(
    'currentPeriodEndsAt' in details.billingCycle,
    'Expected currentPeriodEndsAt in billingCycle',
  );
  assert.ok(
    'nextBillingDate' in details,
    'Expected nextBillingDate to be present',
  );
  assert.ok(
    'paymentMethodOnFile' in details,
    'Expected paymentMethodOnFile to be present',
  );
});

test(
  'Change Subscription Plan: rejects an invalid product id (smoke test)',
  { timeout: 120_000 },
  async (t) => {
    const list = await viewAllSubscriptions();

    if (list.length === 0) {
      t.diagnostic(
        'No subscriptions found in the current Maxio environment; skipping change-plan test.',
      );
      return;
    }

    const first = list[0]!;
    const subscriptionId = Number(first.id);

    if (!Number.isFinite(subscriptionId)) {
      t.diagnostic(
        `First subscription id "${String(
          first.id,
        )}" is not numeric; skipping change-plan test.`,
      );
      return;
    }

    const when: ChangeSubscriptionWhen = 'immediately';

    await assert.rejects(
      () => changeSubscriptionPlan(subscriptionId, 0, when),
      (error: unknown) => {
        // We expect the Maxio API to reject an invalid productId.
        assert.ok(error instanceof Error);
        return true;
      },
    );
  },
);

test(
  'Cancel Subscription: rejects when using an obviously invalid subscription id',
  { timeout: 120_000 },
  async (t) => {
    const invalidSubscriptionId = 0;
    const when: CancelSubscriptionWhen = 'immediately';

    await assert.rejects(
      () => cancelSubscriptionCore(invalidSubscriptionId, when, 'Test cancel'),
      (error: unknown) => {
        // For an invalid id we expect the API to fail. This still exercises the
        // wiring to the Maxio SubscriptionStatusController without mutating any
        // real customer data.
        assert.ok(error instanceof Error);
        return true;
      },
    );
  },
);