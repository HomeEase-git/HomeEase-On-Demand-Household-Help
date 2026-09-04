// Registered via jest.config.js's `setupFilesAfterEnv` (not `setupFiles` —
// that runs too early for `afterAll` to be available). Every test file gets
// its own `@config/database` Prisma singleton (Jest isolates modules per
// file), and none of them ever closed it — leaving the underlying pg pool
// open and Jest warning "did not exit one second after the test run has
// completed" on every run. Close it once each file's tests are done.
import prisma from '@config/database';

afterAll(async () => {
  await prisma.$disconnect();
});
