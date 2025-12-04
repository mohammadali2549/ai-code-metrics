import "dotenv/config";
import { strict as assert } from "node:assert";
import { test } from "node:test";

// IMPORTANT:
// This file is compiled by TypeScript into dist/tests/app.test.js.
// The relative import below is resolved at runtime from dist/tests to dist/src.
import { createOrder, getOrder } from "../src/app.js";

// Silence noisy HTTP/app logs during tests to avoid Jest's
// "Cannot log after tests are done" errors from async loggers.
// We still exercise the real PayPal calls; we just drop their logs.
// eslint-disable-next-line @typescript-eslint/no-empty-function
console.log = (..._args: unknown[]) => {};
// eslint-disable-next-line @typescript-eslint/no-empty-function
console.dir = (..._args: unknown[]) => {};

const hasPayPalCredentials =
  Boolean(
    process.env.PAYPAL_CLIENT_ID ||
      process.env.OAUTH_CLIENT_ID ||
      process.env.CLIENT_ID
  ) &&
  Boolean(
    process.env.PAYPAL_CLIENT_SECRET ||
      process.env.OAUTH_CLIENT_SECRET ||
      process.env.CLIENT_SECRET
  );

test("getOrder returns undefined when orderId is empty", async () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = await getOrder("" as any);
  assert.equal(
    result,
    undefined,
    "Expected getOrder to resolve to undefined for an empty id"
  );
});

test("createOrder fails with missing PayPal credentials", async () => {
  const originalPaypalClientId = process.env.PAYPAL_CLIENT_ID;
  const originalPaypalClientSecret = process.env.PAYPAL_CLIENT_SECRET;
  const originalOauthClientId = process.env.OAUTH_CLIENT_ID;
  const originalOauthClientSecret = process.env.OAUTH_CLIENT_SECRET;
  const originalClientId = process.env.CLIENT_ID;
  const originalClientSecret = process.env.CLIENT_SECRET;

  delete process.env.PAYPAL_CLIENT_ID;
  delete process.env.PAYPAL_CLIENT_SECRET;
  delete process.env.OAUTH_CLIENT_ID;
  delete process.env.OAUTH_CLIENT_SECRET;
  delete process.env.CLIENT_ID;
  delete process.env.CLIENT_SECRET;

  try {
    await assert.rejects(
      async () => {
        await createOrder();
      },
      (err: unknown) => {
        assert.ok(err instanceof Error);
        const message = (err as Error).message;
        assert.ok(
          message.startsWith("Missing PayPal credentials"),
          `Unexpected error message: ${message}`
        );
        return true;
      }
    );
  } finally {
    if (originalPaypalClientId !== undefined) {
      process.env.PAYPAL_CLIENT_ID = originalPaypalClientId;
    }
    if (originalPaypalClientSecret !== undefined) {
      process.env.PAYPAL_CLIENT_SECRET = originalPaypalClientSecret;
    }
    if (originalOauthClientId !== undefined) {
      process.env.OAUTH_CLIENT_ID = originalOauthClientId;
    }
    if (originalOauthClientSecret !== undefined) {
      process.env.OAUTH_CLIENT_SECRET = originalOauthClientSecret;
    }
    if (originalClientId !== undefined) {
      process.env.CLIENT_ID = originalClientId;
    }
    if (originalClientSecret !== undefined) {
      process.env.CLIENT_SECRET = originalClientSecret;
    }
  }
});

if (!hasPayPalCredentials) {
  test.skip(
    "createOrder then getOrder using returned id (skipped: missing PAYPAL/OAUTH/CLIENT credentials)",
    () => {}
  );
} else {
  test("createOrder then getOrder using returned id", async () => {
    const createdOrder = await createOrder();

    const createdOrderId =
      typeof createdOrder === "string" && createdOrder.length > 0
        ? createdOrder
        : createdOrder && typeof createdOrder === "object"
          ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (createdOrder as any).id
          : undefined;

    assert.ok(createdOrderId, "Expected created order to provide an id");

    const fetchedOrder = await getOrder(createdOrderId as string);

    const fetchedOrderId =
      fetchedOrder && typeof fetchedOrder === "object"
        ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (fetchedOrder as any).id
        : undefined;

    assert.equal(
      fetchedOrderId,
      createdOrderId,
      "Fetched order should have the same id as the created order"
    );
  });
}

