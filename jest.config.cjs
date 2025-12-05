/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  // Run tests against the compiled JavaScript in "dist" so Jest doesn't need
  // to transform TypeScript itself.
  testMatch: ['**/dist/tests/**/*.test.js'],
  testPathIgnorePatterns: ['/node_modules/', '/tests/'],
  transform: {},
};