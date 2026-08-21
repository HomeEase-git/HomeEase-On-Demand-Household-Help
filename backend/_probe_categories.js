require('dotenv').config();
const { Client } = require('pg');
(async () => {
  const c = new Client({ connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL });
  await c.connect();
  const st = await c.query(`SELECT id, name, "isActive" FROM "ServiceType" ORDER BY name`);
  console.log('ServiceTypes:', st.rows);
  await c.end();
})().catch(e=>{console.error(e); process.exit(1)});
