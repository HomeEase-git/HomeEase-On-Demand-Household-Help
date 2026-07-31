// import { PrismaClient } from '@prisma/client';
// import { PrismaPg } from '@prisma/adapter-pg';

// const adapter = new PrismaPg({
//   connectionString: process.env.DATABASE_URL,
// });

// const prisma = new PrismaClient({ adapter });

// export default prisma;

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({
  adapter,
  // Default interactive-transaction timeout is 5000ms — too tight for this
  // network path to the (remote, serverless) DB, where round-trips inside a
  // transaction occasionally push past it under latency spikes.
  transactionOptions: { timeout: 15000 },
});

export default prisma;