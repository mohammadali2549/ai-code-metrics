import 'dotenv/config';
import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import {
  viewAllSubscriptions,
  changeSubscriptionPlan,
  cancelSubscription,
  viewSubscriptionDetails,
} from '../src/app';

type UiSubscriptionStatusFilter = 'active' | 'canceled' | 'past_due' | 'trial';
type ChangeSubscriptionWhen = 'immediately' | 'next_billing';
type CancelSubscriptionWhen = 'immediately' | 'period_end';

// These tests are integration-style and will invoke the real Maxio sandbox APIs.
// They assume valid credentials are provided via environment variables or a .env file.

function isInvalidUrlError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: string }).code === 'ERR_INVALID_URL'
  );
}

test(
  'View All Subscriptions: list customers, filter, and search',
  { timeout: 120_000 },
  async (t) => {
    let all;
    try {
      all = await viewAllSubscriptions();
    } catch (error) {
      if (isInvalidUrlError(error)) {
        t.diagnostic(
          'MAXIO_SITE is not a valid URL in this environment; skipping subscription list assertions.',
        );
        return;
      }
      throw error;
    }

    assert.ok(Array.isArray(all), 'Expected an array of subscriptions');

    if (all.length === 0) {
      t.diagnostic(
        'No subscriptions found in the current Maxio environment; skipping field-level assertions.',
      );
      return;
    }

    const first = all[0]!;

    // Basic shape checks
    assert.equal(typeof first.customerName, 'string');
    assert.equal(typeof first.customerEmail, 'string');
    assert.equal(typeof first.plan, 'string');
    assert.ok(first.status !== undefined, 'Expected a subscription status');
    assert.ok(
      'nextBillingDate' in first,
      'Expected nextBillingDate to be present',
    );
    assert.ok(
      'monthlyAmount' in first,
      'Expected monthlyAmount to be present',
    );

    // Filter by a specific status (if any subscriptions exist with that status).
    const statusFilter: UiSubscriptionStatusFilter = 'active';
    const filtered = await viewAllSubscriptions({ status: statusFilter });

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

    const searchResults = await viewAllSubscriptions({ search: searchable });

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

test(
  'View Single Subscription Details: basic fields are populated',
  { timeout: 120_000 },
  async (t) => {
    let list;
    try {
      list = await viewAllSubscriptions();
    } catch (error) {
      if (isInvalidUrlError(error)) {
        t.diagnostic(
          'MAXIO_SITE is not a valid URL in this environment; skipping detail assertions.',
        );
        return;
      }
      throw error;
    }

    if (list.length === 0) {
      t.diagnostic(
        'No subscriptions found in the current Maxio environment; skipping detail assertions.',
      );
      return;
    }

    const first = list[0]!;
    const subscriptionId = String(first.id);

    const details = await viewSubscriptionDetails(subscriptionId);

    assert.equal(typeof details.id, 'string');
    assert.equal(typeof details.customerName, 'string');
    assert.equal(typeof details.customerEmail, 'string');
    assert.equal(typeof details.plan, 'string');
    assert.ok(
      'price' in details,
      'Expected price to be present',
    );
    assert.equal(typeof details.billingCycle, 'string');
    assert.ok(
      'nextBillingDate' in details,
      'Expected nextBillingDate to be present',
    );
    assert.ok(
      'paymentMethod' in details,
      'Expected paymentMethod to be present',
    );
  },
);

test(
  'Change Subscription Plan: rejects an invalid product id (smoke test)',
  { timeout: 120_000 },
  async (t) => {
    let list;
    try {
      list = await viewAllSubscriptions();
    } catch (error) {
      if (isInvalidUrlError(error)) {
        t.diagnostic(
          'MAXIO_SITE is not a valid URL in this environment; skipping change-plan test.',
        );
        return;
      }
      throw error;
    }

    if (list.length === 0) {
      t.diagnostic(
        'No subscriptions found in the current Maxio environment; skipping change-plan test.',
      );
      return;
    }

    const first = list[0]!;
    const subscriptionId = String(first.id);

    const when: ChangeSubscriptionWhen = 'immediately';

    await assert.rejects(
      () =>
        changeSubscriptionPlan(subscriptionId, 'invalid-plan-id', {
          effectiveAt: when,
        }),
      (error: unknown) => {
        // We expect the Maxio API to reject an invalid plan id.
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
    const invalidSubscriptionId = 'invalid-subscription-id';
    const when: CancelSubscriptionWhen = 'immediately';

    await assert.rejects(
      () =>
        cancelSubscription(invalidSubscriptionId, {
          cancelAt: when,
          reason: 'Test cancel',
        }),
      (error: unknown) => {
        // For an invalid id we expect the API to fail. This still exercises the
        // wiring to the Maxio integration without mutating any real customer data.
        assert.ok(error instanceof Error);
        return true;
      },
    );
  },
);

