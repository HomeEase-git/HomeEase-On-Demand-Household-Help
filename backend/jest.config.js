/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  rootDir: '.',
  testMatch: ['<rootDir>/tests/**/*.test.ts'],
  // tests/integration/** needs a real Redis and deliberately does NOT want
  // the bookingQueue/verificationQueue mocks below — it's its own suite,
  // run via `npm run test:queues` / jest.integration.config.js.
  testPathIgnorePatterns: ['<rootDir>/node_modules/', '<rootDir>/tests/integration/'],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.test.json' }],
  },
  moduleNameMapper: {
    // Real verificationQueue/bookingQueue need a running Redis; tests don't have one.
    '^@queues/verificationQueue$': '<rootDir>/tests/mocks/verificationQueue.ts',
    '^@queues/bookingQueue$': '<rootDir>/tests/mocks/bookingQueue.ts',
    '^@/(.*)$': '<rootDir>/src/$1',
    '^@controllers/(.*)$': '<rootDir>/src/controllers/$1',
    '^@routes/(.*)$': '<rootDir>/src/routes/$1',
    '^@middleware/(.*)$': '<rootDir>/src/middleware/$1',
    '^@utils/(.*)$': '<rootDir>/src/utils/$1',
    '^@types/(.*)$': '<rootDir>/src/types/$1',
    '^@config/(.*)$': '<rootDir>/src/config/$1',
    '^@queues/(.*)$': '<rootDir>/src/queues/$1',
    '^@workers/(.*)$': '<rootDir>/src/workers/$1',
    '^@services/(.*)$': '<rootDir>/src/services/$1',
  },
  setupFiles: ['<rootDir>/tests/setupEnv.ts'],
  setupFilesAfterEnv: ['<rootDir>/tests/jestSetupAfterEnv.ts'],
  testTimeout: 20000,
  verbose: true,
};