/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  rootDir: '.',
  testMatch: ['<rootDir>/tests/**/*.test.ts'],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.test.json' }],
  },
  moduleNameMapper: {
    // Real verificationQueue needs a running Redis; tests don't have one.
    '^@queues/verificationQueue$': '<rootDir>/tests/mocks/verificationQueue.ts',
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
  testTimeout: 20000,
  verbose: true,
};