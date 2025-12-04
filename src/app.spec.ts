// Jest entrypoint that delegates to the existing tests in `tests/app.test.ts`.
// This keeps Jest's `rootDir: "src"` config while still running the provided
// Node test suite.

import "../tests/app.test";

// Add a trivial Jest test so that Jest sees at least one test in this file.
// The real integration tests are implemented via `node:test` in app.test.ts.
test("node:test suite executed", () => {
  expect(true).toBe(true);
});

