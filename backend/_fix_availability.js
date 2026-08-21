require('dotenv').config();
const { Client } = require('pg');
const crypto = require('crypto');

const DAYS_AHEAD = 21;
const SLOTS = ['MORNING', 'AFTERNOON', 'EVENING'];

(async () => {
  const c = new Client({ connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL });
  await c.connect();

  const workers = await c.query(
    `SELECT id FROM "WorkerProfile" WHERE "isAvailable" = true AND "kycStatus" = 'APPROVED'`
  );
  console.log(`Opening ${DAYS_AHEAD} days x ${SLOTS.length} slots for ${workers.rows.length} workers...`);

  let inserted = 0;
  for (const worker of workers.rows) {
    for (let d = 1; d <= DAYS_AHEAD; d++) {
      const date = new Date();
      date.setUTCDate(date.getUTCDate() + d);
      date.setUTCHours(0, 0, 0, 0);
      for (const slot of SLOTS) {
        const res = await c.query(
          `INSERT INTO "WorkerAvailability" (id, "workerProfileId", date, "timeSlot", "isBlocked", "isBooked", "createdAt", "updatedAt")
           VALUES ($1, $2, $3, $4, false, false, NOW(), NOW())
           ON CONFLICT ("workerProfileId", date, "timeSlot") DO NOTHING`,
          [crypto.randomUUID(), worker.id, date.toISOString(), slot]
        );
        inserted += res.rowCount;
      }
    }
  }

  console.log(`Inserted ${inserted} new availability rows.`);
  await c.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
