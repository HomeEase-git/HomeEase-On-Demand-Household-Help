// Separate from jest.config.js on purpose: the default suite's
// moduleNameMapper mocks @queues/bookingQueue and @queues/verificationQueue
// entirely (no local Redis in that context), which is exactly what this
// suite needs to NOT do — it exists to exercise the real BullMQ queues
// against a real (ephemeral, redis-memory-server-backed) Redis, the only
// thing that would have caught the "BullMQ rejects ':' in custom jobIds"
// bug found via the Xendit-sandbox E2E run.
/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  rootDir: '.',
  testMatch: ['<rootDir>/tests/integration/**/*.test.ts'],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.test.json' }],
  },
  moduleNameMapper: {
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
  testTimeout: 30000,
  verbose: true,
};
