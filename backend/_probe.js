require('dotenv').config();
const { Client } = require('pg');
(async () => {
  const c = new Client({ connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL });
  await c.connect();
  const st = await c.query(`SELECT id, name, "basePrice", "scopeType", "hasCondition", "isActive" FROM "ServiceType" WHERE "isActive"=true AND "scopeType"='ROOM_BASED' LIMIT 5`);
  console.log('ServiceTypes (ROOM_BASED, active):', st.rows);
  const admins = await c.query(`SELECT id, email, "fullName", role FROM "User" WHERE role='ADMIN' LIMIT 5`);
  console.log('Admins:', admins.rows);
  await c.end();
})().catch(e=>{console.error(e); process.exit(1)});
