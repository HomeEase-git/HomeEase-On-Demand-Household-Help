// const prisma = new PrismaClient({ adapter });

// export default prisma;

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({
  adapter,
  transactionOptions: { timeout: 15000 },
});

export default prisma;