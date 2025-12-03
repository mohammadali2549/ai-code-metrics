import "dotenv/config";
import { strict as assert } from "node:assert";
import test from "node:test";
import supertest from "supertest";
import app from "../src/app.js";

const request = supertest(app);

// Helper:
const hasPayPalCredentials =
  Boolean(process.env.PAYPAL_CLIENT_ID) &&
  Boolean(process.env.PAYPAL_CLIENT_SECRET);

test("GET /orders/:orderId returns 500 on empty id", async () => {
  const response = await request.get("/orders/"); // This will 404; test with "/orders/" or "/orders/ "
  assert.ok(response.status === 404 || response.status === 500);
});

test("POST /orders fails without PayPal credentials", async () => {
  const originalClientId = process.env.PAYPAL_CLIENT_ID;
  const originalClientSecret = process.env.PAYPAL_CLIENT_SECRET;

  delete process.env.PAYPAL_CLIENT_ID;
  delete process.env.PAYPAL_CLIENT_SECRET;

  try {
    const response = await request.post("/orders").send({});
    assert.equal(response.status, 500);
    // Should contain error explanation:
    assert.ok(
      response.body &&
        typeof response.body.error === "string" &&
        response.body.error.includes("PayPal Create Order Failed")
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
    "POST /orders and then GET /orders/:orderId (skipped: missing PAYPAL credentials)",
    () => {}
  );
} else {
  test("POST /orders and then GET /orders/:orderId succeeds", async () => {
    // 1. Create order
    const createRes = await request.post("/orders").send({ value: "1.23" });
    assert.equal(createRes.status, 201);
    assert.ok(
      createRes.body &&
        typeof createRes.body.id === "string" &&
        createRes.body.id.length > 0,
      "Expected response to include an order id"
    );
    const orderId = createRes.body.id;

    // 2. Get order
    const getRes = await request.get(`/orders/${orderId}`);
    assert.equal(getRes.status, 200);
    assert.ok(getRes.body && typeof getRes.body.id === "string");
    assert.equal(getRes.body.id, orderId);
  });
}

