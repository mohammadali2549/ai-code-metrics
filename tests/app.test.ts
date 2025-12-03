// Minimal Node global so this test file can compile without @types/node
declare const process: {
  env: Record<string, string | undefined>;
};
// @ts-ignore: dotenv/config is a runtime-only helper to load .env
import "dotenv/config";
// @ts-ignore: node:assert is a Node built-in provided at runtime
import { strict as assert } from "node:assert";
// @ts-ignore: node:test is a Node built-in provided at runtime
import test from "node:test";

// IMPORTANT:
// This file is compiled by TypeScript into dist/tests/app.test.js.
// The relative import below is resolved at runtime from dist/tests to dist/src.
import { createOrder, getOrder } from "../src/app.js";
import type { CreateOrderInput } from "../src/app.js";

const hasPayPalCredentials =
  Boolean(process.env.PAYPAL_CLIENT_ID) &&
  Boolean(process.env.PAYPAL_CLIENT_SECRET);

const sampleOrderInput: CreateOrderInput = {
  purchase_units: [
    {
      amount: {
        currency_code: "USD",
        value: "1.00",
      },
    },
  ],
};

test("getOrder throws when orderId is empty", async () => {
  await assert.rejects(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async () => getOrder("" as any),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.equal(
        (err as Error).message,
        "getOrder requires a non-empty orderId."
      );
      return true;
    }
  );
});

test("createOrder fails with missing PayPal credentials", async () => {
  const originalClientId = process.env.PAYPAL_CLIENT_ID;
  const originalClientSecret = process.env.PAYPAL_CLIENT_SECRET;

  delete process.env.PAYPAL_CLIENT_ID;
  delete process.env.PAYPAL_CLIENT_SECRET;

  try {
    await assert.rejects(
      async () => {
        await createOrder(sampleOrderInput);
      },
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.equal(
          (err as Error).message,
          "Missing PAYPAL_CLIENT_ID or PAYPAL_CLIENT_SECRET environment variables."
        );
        return true;
      }
    );
  } finally {
    if (originalClientId !== undefined) {
      process.env.PAYPAL_CLIENT_ID = originalClientId;
    }
    if (originalClientSecret !== undefined) {
      process.env.PAYPAL_CLIENT_SECRET = originalClientSecret;
    }
  }
});

if (!hasPayPalCredentials) {
  test.skip(
    "createOrder then getOrder using returned id (skipped: missing PAYPAL credentials)",
    () => {}
  );
} else {
  test("createOrder then getOrder using returned id", async () => {
    const createdOrder = await createOrder(sampleOrderInput);

    const createdOrderId =
      createdOrder && typeof createdOrder === "object"
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
