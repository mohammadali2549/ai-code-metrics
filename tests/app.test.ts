import "dotenv/config";
import { strict as assert } from "node:assert";
import { test } from "node:test";

// IMPORTANT:
// This file is compiled by TypeScript into dist/tests/app.test.js.
// The relative import below is resolved at runtime from dist/tests to dist/src.
import { createOrder, getOrder } from "../src/app";

const hasPayPalCredentials =
  Boolean(process.env.PAYPAL_CLIENT_ID) &&
  Boolean(process.env.PAYPAL_CLIENT_SECRET);

test("getOrder is a callable function", () => {
  assert.equal(typeof getOrder, "function");
});

test("createOrder is a callable function", () => {
  assert.equal(typeof createOrder, "function");
});

if (!hasPayPalCredentials) {
  test.skip(
    "createOrder then getOrder using returned id (skipped: missing PAYPAL credentials)",
    () => {}
  );
} else {
  test("createOrder then getOrder using returned id", async () => {
    const createdOrder = await createOrder();

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


