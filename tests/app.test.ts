import 'dotenv/config';
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  viewAllSubscriptions,
  viewSingleSubscriptionDetails,
  changeSubscriptionPlan,
  cancelSubscription,
  callMaxioApi,
} from '../src/app.js';

// These tests are integration-style and will invoke the real Maxio sandbox APIs.
// They assume valid credentials are provided via environment variables or a .env file.

function hasMaxioEnv(): boolean {
  return Boolean(
    process.env.MAXIO_SITE &&
      process.env.MAXIO_BASIC_AUTH_USERNAME &&
      process.env.MAXIO_BASIC_AUTH_PASSWORD,
  );
}

function isNetworkError(error: unknown): boolean {
  const err = error as NodeJS.ErrnoException;
  return (
    !!err &&
    typeof err === 'object' &&
    'code' in err &&
    typeof err.code === 'string' &&
    ['ENOTFOUND', 'ECONNREFUSED', 'EAI_AGAIN', 'ECONNRESET', 'ETIMEDOUT', 'EHOSTUNREACH'].includes(
      err.code,
    )
  );
}

test(
  'View All Subscriptions: list customers, filter, and search',
  { timeout: 120_000 },
  async (t) => {
    if (!hasMaxioEnv()) {
      t.diagnostic(
        'Missing MAXIO_* environment variables; skipping View All Subscriptions test.',
      );
      return;
    }

    let all;
    try {
      all = await viewAllSubscriptions();
    } catch (error) {
      if (isNetworkError(error)) {
        t.diagnostic(`Network error while fetching subscriptions: ${(error as Error).message}`);
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
    assert.ok('customerEmail' in first, 'Expected customerEmail to be present');
    assert.ok('plan' in first, 'Expected plan to be present');
    assert.ok('status' in first, 'Expected status to be present');
    assert.ok('nextBillingDate' in first, 'Expected nextBillingDate to be present');
    assert.ok('monthlyAmount' in first, 'Expected monthlyAmount to be present');

    // Filter by a specific status (if any subscriptions exist with that status).
    let filtered;
    try {
      filtered = await viewAllSubscriptions('Active');
    } catch (error) {
      if (isNetworkError(error)) {
        t.diagnostic(
          `Network error while fetching filtered subscriptions: ${(error as Error).message}`,
        );
        return;
      }
      throw error;
    }

    if (filtered.length > 0) {
      for (const sub of filtered) {
        assert.ok('status' in sub, 'Filtered subscription should have a status');
      }
    } else {
      t.diagnostic('No subscriptions matched the "Active" status filter in this environment.');
    }

    // Search by part of the customer's name or email, reusing data from the first subscription.
    const searchable =
      first.customerName?.split(' ')[0] || first.customerEmail?.split('@')[0] || '';

    if (!searchable) {
      t.diagnostic(
        'First subscription does not have a search-friendly name or email; skipping search assertion.',
      );
      return;
    }

    let searchResults;
    try {
      searchResults = await viewAllSubscriptions(undefined, searchable);
    } catch (error) {
      if (isNetworkError(error)) {
        t.diagnostic(
          `Network error while fetching search results: ${(error as Error).message}`,
        );
        return;
      }
      throw error;
    }

    assert.ok(Array.isArray(searchResults), 'Expected search results to be an array');
  },
);

test(
  'View Single Subscription Details: basic fields are populated',
  { timeout: 120_000 },
  async (t) => {
    if (!hasMaxioEnv()) {
      t.diagnostic(
        'Missing MAXIO_* environment variables; skipping View Single Subscription Details test.',
      );
      return;
    }

    let rawList: any;
    try {
      rawList = await callMaxioApi<any>('GET', '/subscriptions.json', {
        page: 1,
        per_page: 1,
      });
    } catch (error) {
      if (isNetworkError(error)) {
        t.diagnostic(
          `Network error while fetching subscriptions for details test: ${(error as Error).message}`,
        );
        return;
      }
      throw error;
    }

    const list = Array.isArray(rawList)
      ? rawList
      : rawList && Array.isArray(rawList.subscriptions)
        ? rawList.subscriptions
        : [];

    if (list.length === 0) {
      t.diagnostic(
        'No subscriptions found in the current Maxio environment; skipping detail assertions.',
      );
      return;
    }

    const entry = list[0] as any;
    const subscriptionId = String(entry.subscription?.id ?? entry.id ?? '').trim();

    if (!subscriptionId) {
      t.diagnostic(
        'First subscription entry does not expose a usable id; skipping detail assertions.',
      );
      return;
    }

    let details;
    try {
      details = await viewSingleSubscriptionDetails(subscriptionId);
    } catch (error) {
      if (isNetworkError(error)) {
        t.diagnostic(
          `Network error while fetching subscription details: ${(error as Error).message}`,
        );
        return;
      }
      throw error;
    }

    assert.ok(details.customerInfo, 'Expected customerInfo');
    assert.equal(typeof details.customerInfo.name, 'string');
    assert.ok('email' in details.customerInfo, 'Expected email field in customerInfo');
    assert.ok('currentPlan' in details, 'Expected currentPlan to be present');
    assert.ok('price' in details, 'Expected price to be present');
    assert.ok('status' in details, 'Expected status to be present');
    assert.ok('billingCycle' in details, 'Expected billingCycle to be present');
    assert.ok('nextBillingDate' in details, 'Expected nextBillingDate to be present');
    assert.ok('paymentMethod' in details, 'Expected paymentMethod to be present');
  },
);

test(
  'Change Subscription Plan: rejects for an obviously invalid subscription / product (smoke test)',
  { timeout: 120_000 },
  async () => {
    await assert.rejects(
      () => changeSubscriptionPlan('0', 'invalid-product', 'immediately'),
      (error: unknown) => {
        // We expect the Maxio API (or configuration) to reject an invalid request.
        assert.ok(error instanceof Error);
        return true;
      },
    );
  },
);

test(
  'Cancel Subscription: rejects when using an obviously invalid subscription id',
  { timeout: 120_000 },
  async () => {
    await assert.rejects(
      () => cancelSubscription('0', 'immediately', 'Test cancel'),
      (error: unknown) => {
        // For an invalid id we expect the API (or configuration) to fail. This still exercises the
        // wiring to the Maxio cancellation logic without mutating any real customer data.
        assert.ok(error instanceof Error);
        return true;
      },
    );
  },
);

