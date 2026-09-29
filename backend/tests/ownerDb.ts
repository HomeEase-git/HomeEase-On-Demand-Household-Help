import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

// CI runs the suite as the app's own database role (DATABASE_URL =
// homeease_app, as in production; scripts/db-roles.ts), which can't delete
// audit or ledger rows. Tests clean those up through the owner connection
// the migrations use. Locally both URLs are usually the same owner login.
export const ownerDb = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL }),
});
