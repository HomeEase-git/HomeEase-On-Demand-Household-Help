require('dotenv').config();
const { Client } = require('pg');
(async () => {
  const c = new Client({ connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL });
  await c.connect();

  const now = await c.query(`SELECT NOW() as now`);
  console.log('DB now:', now.rows[0].now);

  const range = await c.query(`SELECT MIN(date) as min_date, MAX(date) as max_date, COUNT(*) as total FROM "WorkerAvailability"`);
  console.log('WorkerAvailability date range:', range.rows[0]);

  const future = await c.query(`SELECT COUNT(*) as total FROM "WorkerAvailability" WHERE date >= NOW() AND "isBlocked"=false AND "isBooked"=false`);
  console.log('Open future slots (unblocked, unbooked):', future.rows[0]);

  const sample = await c.query(`SELECT date, "timeSlot", "isBlocked", "isBooked" FROM "WorkerAvailability" ORDER BY date DESC LIMIT 10`);
  console.log('Most recent 10 rows:', sample.rows);

  const workerCount = await c.query(`SELECT COUNT(*) as total FROM "WorkerProfile" WHERE "isAvailable"=true AND "kycStatus"='APPROVED'`);
  console.log('Available+approved workers:', workerCount.rows[0]);

  await c.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
