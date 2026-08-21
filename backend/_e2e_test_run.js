require('dotenv').config();
const axios = require('axios');
const { Client } = require('pg');

const BASE = 'http://localhost:3000/api';
const WEBHOOK_TOKEN = process.env.XENDIT_WEBHOOK_TOKEN;
const STAMP = Date.now();

// Neon suspends/kills idle direct connections — a single long-lived Client
// crashes the process on that (unhandled 'error' event) if it sits idle for
// a while between queries (which happens a lot here, between HTTP calls).
// Open a fresh connection per query instead.
const db = {
  async query(sql, params) {
    const c = new Client({ connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL });
    c.on('error', (err) => console.error('   (db connection error, ignored):', err.message));
    await c.connect();
    try {
      return await c.query(sql, params);
    } finally {
      await c.end().catch(() => {});
    }
  },
  async connect() {},
  async end() {},
};

function log(step, msg) {
  console.log(`\n=== [${step}] ${msg} ===`);
}
function info(msg) {
  console.log('   ' + msg);
}

async function api(method, path, data, token) {
  try {
    const res = await axios({
      method,
      url: `${BASE}${path}`,
      data,
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      validateStatus: () => true,
    });
    return res;
  } catch (err) {
    return { status: 0, data: { error: err.message } };
  }
}

async function webhook(path, body) {
  try {
    const res = await axios({
      method: 'post',
      url: `${BASE}${path}`,
      data: body,
      headers: { 'x-callback-token': WEBHOOK_TOKEN },
      validateStatus: () => true,
    });
    return res;
  } catch (err) {
    return { status: 0, data: { error: err.message } };
  }
}

async function getOtp(userId) {
  const r = await db.query(
    `SELECT token FROM "AuthToken" WHERE "userId"=$1 AND type='EMAIL_VERIFICATION' ORDER BY "createdAt" DESC LIMIT 1`,
    [userId]
  );
  return r.rows[0]?.token;
}

async function main() {
  await db.connect();
  const results = {}; // running record of what happened, for the final report

  // ---------------------------------------------------------------
  log('0', 'Admin login');
  let r = await api('post', '/auth/login', { email: 'admin@homeease.dev', password: 'Password123!' });
  if (r.status !== 200) throw new Error(`Admin login failed: ${r.status} ${JSON.stringify(r.data)}`);
  const adminToken = r.data.data.token;
  info('admin logged in');

  // ---------------------------------------------------------------
  log('1', 'Register client + worker accounts');
  const clientEmail = `e2e.client.${STAMP}@example.com`;
  const workerEmail = `e2e.worker.${STAMP}@example.com`;
  const PASSWORD = 'TestPass123';

  r = await api('post', '/auth/signup', {
    fullName: 'E2E Test Client',
    email: clientEmail,
    phone: '09171234567',
    password: PASSWORD,
    role: 'CLIENT',
  });
  if (r.status !== 201) throw new Error(`Client signup failed: ${r.status} ${JSON.stringify(r.data)}`);
  const clientId = r.data.data.id;
  let clientToken = r.data.data.token;
  info(`client created: ${clientEmail} (${clientId})`);

  r = await api('post', '/auth/signup', {
    fullName: 'E2E Test Worker',
    email: workerEmail,
    phone: '09179876543',
    password: PASSWORD,
    role: 'WORKER',
  });
  if (r.status !== 201) throw new Error(`Worker signup failed: ${r.status} ${JSON.stringify(r.data)}`);
  const workerId = r.data.data.id;
  let workerToken = r.data.data.token;
  info(`worker created: ${workerEmail} (${workerId})`);

  // ---------------------------------------------------------------
  log('2', 'Verify OTP for both accounts (fetched from AuthToken table — no real inbox access)');
  const clientOtp = await getOtp(clientId);
  const workerOtp = await getOtp(workerId);
  info(`client OTP: ${clientOtp}, worker OTP: ${workerOtp}`);

  r = await api('post', '/auth/verify-otp', { email: clientEmail, otp: clientOtp });
  if (r.status !== 200) throw new Error(`Client OTP verify failed: ${r.status} ${JSON.stringify(r.data)}`);
  clientToken = r.data.data.token;
  info('client email verified');

  r = await api('post', '/auth/verify-otp', { email: workerEmail, otp: workerOtp });
  if (r.status !== 200) throw new Error(`Worker OTP verify failed: ${r.status} ${JSON.stringify(r.data)}`);
  workerToken = r.data.data.token;
  info('worker email verified');

  // ---------------------------------------------------------------
  log('3', 'Worker profile setup: hourly rate, service type, availability slot, address, payout method');

  r = await api('patch', '/workers/me/rate', { hourlyRate: 80 }, workerToken);
  info(`set hourly rate -> ${r.status} ${r.status !== 200 ? JSON.stringify(r.data) : ''}`);

  r = await api('get', '/services', null, workerToken);
  const cleaning = (r.data?.data || []).find((s) => s.name === 'Cleaning') || null;
  if (!cleaning) throw new Error(`Could not find "Cleaning" service type via /api/services: ${JSON.stringify(r.data)}`);
  info(`using service type: Cleaning (${cleaning.id})`);

  r = await api('post', '/workers/me/service-types', { serviceTypeIds: [cleaning.id] }, workerToken);
  info(`add service type -> ${r.status} ${JSON.stringify(r.data?.data || r.data)}`);

  r = await api(
    'patch',
    '/workers/me/profile',
    {
      bio: 'E2E test worker',
      address: '123 Rizal St',
      city: 'Manila',
      addressLat: 14.5995,
      addressLng: 120.9842,
    },
    workerToken
  );
  info(`update profile/address -> ${r.status}`);

  // Booking date: tomorrow, MORNING slot
  const bookingDate = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  r = await api(
    'patch',
    '/workers/me/availability-slots',
    { slots: [{ date: bookingDate, timeSlot: 'MORNING' }] },
    workerToken
  );
  if (r.status !== 200) throw new Error(`Open availability slot failed: ${r.status} ${JSON.stringify(r.data)}`);
  info(`opened availability slot for ${bookingDate} MORNING`);

  r = await api(
    'patch',
    '/workers/me/payout',
    { payoutMethod: 'GCASH', payoutAccountName: 'E2E Test Worker', payoutAccountNumber: '09179876543' },
    workerToken
  );
  if (r.status !== 200) throw new Error(`Set payout method failed: ${r.status} ${JSON.stringify(r.data)}`);
  info('payout method set (GCASH)');

  // ---------------------------------------------------------------
  log('4', 'Admin credits worker wallet (covers the flat per-job admin fee needed to accept a booking)');
  r = await api(
    'patch',
    `/admin/users/workers/${workerId}/wallet/adjust`,
    { amount: 100, reason: 'E2E test run — fund wallet for admin fee' },
    adminToken
  );
  if (r.status !== 200) throw new Error(`Wallet credit failed: ${r.status} ${JSON.stringify(r.data)}`);
  info(`worker wallet balance now: ${r.data.data.balance}`);

  // ---------------------------------------------------------------
  log('5', 'Worker KYC: upload Tier-1 document(s), admin verifies via the admin-verification API (the same action the web Verification/VerificationDetail admin pages call)');
  const fakeImage = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64'
  );
  const FormData = require('form-data');
  const form = new FormData();
  form.append('documentType', 'GOVERNMENT_ID_FRONT');
  form.append('documents', fakeImage, { filename: 'gov-id-front.png', contentType: 'image/png' });
  let uploadRes;
  try {
    uploadRes = await axios.post(`${BASE}/verification/upload`, form, {
      headers: { ...form.getHeaders(), Authorization: `Bearer ${workerToken}` },
      validateStatus: () => true,
      timeout: 30000,
    });
  } catch (err) {
    uploadRes = { status: 0, data: { error: err.message } };
  }
  info(`upload documents -> ${uploadRes.status} (may be slow/500 because BullMQ's verification queue has no Redis to enqueue to locally — that's expected; the VerificationRequest row is still created beforehand)`);

  const vr = await db.query(
    `SELECT id FROM "VerificationRequest" WHERE "userId"=$1 ORDER BY "submittedAt" DESC LIMIT 1`,
    [workerId]
  );
  const verificationId = vr.rows[0]?.id;
  if (!verificationId) throw new Error('No VerificationRequest found for worker after upload');
  info(`verification request id: ${verificationId}`);

  r = await api(
    'patch',
    `/admin/verifications/${verificationId}/approve`,
    { adminOverrideReason: 'E2E test run — single Tier-1 doc uploaded (upload endpoint only accepts one documentType per call, see note in report), manually verifying rest out of band' },
    adminToken
  );
  if (r.status !== 200) throw new Error(`Admin approve failed: ${r.status} ${JSON.stringify(r.data)}`);
  info('worker KYC APPROVED by admin');

  // ---------------------------------------------------------------
  log('6', 'Client creates a booking for the worker\'s Cleaning service');
  r = await api(
    'post',
    '/bookings',
    {
      workerId,
      serviceType: 'Cleaning',
      rooms: ['LIVING_ROOM'],
      condition: 'NORMAL',
      description: 'E2E test booking — living room cleaning',
      address: '456 Mabini St, Manila',
      city: '',
      lat: 14.5995,
      lng: 120.9842,
      date: bookingDate,
      timeSlot: 'MORNING',
      paymentMethodType: 'GCASH',
      tip: 0,
    },
    clientToken
  );
  if (r.status !== 201) throw new Error(`Create booking failed: ${r.status} ${JSON.stringify(r.data)}`);
  const bookingId = r.data.data.id;
  const estimatedPrice = r.data.data.estimatedPrice;
  info(`booking created: ${bookingId}, status=${r.data.data.status}, estimatedPrice=₱${estimatedPrice}`);
  results.bookingId = bookingId;
  results.estimatedPrice = estimatedPrice;

  // ---------------------------------------------------------------
  log('7', 'Worker accepts');
  r = await api('patch', `/bookings/${bookingId}/accept`, {}, workerToken);
  if (r.status !== 200) throw new Error(`Accept failed: ${r.status} ${JSON.stringify(r.data)}`);
  info(`status -> ${r.data.data.status}`);

  log('8', 'Worker arrives (GPS = booking address, inside geofence)');
  r = await api('patch', `/bookings/${bookingId}/arrive`, { lat: 14.5995, lng: 120.9842 }, workerToken);
  if (r.status !== 200) throw new Error(`Arrive failed: ${r.status} ${JSON.stringify(r.data)}`);
  info(`arrived, distance=${r.data.data.arrivalVerification.distanceMeters}m`);

  log('9', 'Worker starts job');
  r = await api('patch', `/bookings/${bookingId}/start`, {}, workerToken);
  if (r.status !== 200) throw new Error(`Start failed: ${r.status} ${JSON.stringify(r.data)}`);
  info(`status -> ${r.data.data.status}`);

  log('10', 'Worker submits quote (adds materials cost)');
  r = await api('post', `/bookings/${bookingId}/quote`, { materialsCost: 150, notes: 'Extra cleaning supplies needed' }, workerToken);
  if (r.status !== 201) throw new Error(`Quote submit failed: ${r.status} ${JSON.stringify(r.data)}`);
  info(`quote: labor=₱${r.data.data.laborCost} + materials=₱${r.data.data.materialsCost} = ₱${r.data.data.totalCost}`);

  log('11', 'Client approves quote');
  r = await api('patch', `/bookings/${bookingId}/quote/approve`, {}, clientToken);
  if (r.status !== 200) throw new Error(`Quote approve failed: ${r.status} ${JSON.stringify(r.data)}`);
  info(`status -> ${r.data.data.status}, finalPrice=₱${r.data.data.finalPrice}`);

  // ---------------------------------------------------------------
  log('12', 'Client starts Xendit checkout (real Xendit sandbox Invoice API call)');
  r = await api('post', `/payments/${bookingId}/xendit/checkout`, {}, clientToken);
  if (r.status !== 200) throw new Error(`Xendit checkout failed: ${r.status} ${JSON.stringify(r.data)}`);
  const { checkoutUrl, invoiceId } = r.data.data;
  info(`xendit invoice created: ${invoiceId}`);
  info(`checkout URL: ${checkoutUrl}`);
  results.invoiceId = invoiceId;
  results.checkoutUrl = checkoutUrl;

  const paymentBefore = await db.query(`SELECT "totalAmount" FROM "Payment" WHERE "bookingId"=$1`, [bookingId]);
  const totalAmount = paymentBefore.rows[0].totalAmount;

  log('13', 'Simulate Xendit "invoice.paid" webhook (Xendit cannot reach our localhost, so we POST the callback ourselves with the correct shared-secret token — same code path a real webhook hits)');
  r = await webhook('/payments/xendit/invoice-webhook', {
    id: invoiceId,
    status: 'PAID',
    payment_id: `test_xnd_pay_${STAMP}`,
    paid_amount: totalAmount,
    paid_at: new Date().toISOString(),
  });
  if (r.status !== 200) throw new Error(`Invoice webhook failed: ${r.status} ${JSON.stringify(r.data)}`);
  info('invoice marked PAID (escrow still HELD until job completion is confirmed)');

  // ---------------------------------------------------------------
  log('14', 'Worker submits completion photo');
  r = await api(
    'patch',
    `/bookings/${bookingId}/complete`,
    { completionPhotoUrl: 'https://example.com/e2e-test-completion-photo.jpg' },
    workerToken
  );
  if (r.status !== 200) throw new Error(`Complete failed: ${r.status} ${JSON.stringify(r.data)}`);
  info(`status -> ${r.data.data.status}`);

  log('15', 'Client confirms completion — this captures escrow, releases payment, and (in production) queues the payout via BullMQ');
  r = await api('patch', `/bookings/${bookingId}/confirm-completion`, {}, clientToken);
  if (r.status !== 200) throw new Error(`Confirm completion failed: ${r.status} ${JSON.stringify(r.data)}`);
  info(`status -> ${r.data.data.status}`);

  // Give the (failing, redis-less) schedulePayout call time to time out and
  // get caught inside captureAndReleasePayment, so the Payout row it created
  // beforehand is stable before we read it.
  await new Promise((res) => setTimeout(res, 12000));

  const payoutRow = await db.query(
    `SELECT id, amount, channel, "accountNumber", status FROM "Payout" WHERE "bookingId"=$1`,
    [bookingId]
  );
  if (payoutRow.rows.length === 0) throw new Error('No Payout row was created — worker payout method may not have been picked up');
  const payout = payoutRow.rows[0];
  info(`payout row created: id=${payout.id} amount=₱${payout.amount} channel=${payout.channel} status=${payout.status}`);
  results.payout = payout;

  // ---------------------------------------------------------------
  log('16', 'Send the real payout to Xendit sandbox (replicating xenditDisbursementService.createPayout — the BullMQ worker that would normally do this has no Redis to consume from locally)');
  const secretClient = axios.create({
    baseURL: 'https://api.xendit.co',
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${process.env.XENDIT_SECRET_KEY}:`).toString('base64'),
      'Content-Type': 'application/json',
    },
  });

  let xenditPayout;
  try {
    const payoutRes = await secretClient.post(
      '/v2/payouts',
      {
        reference_id: payout.id,
        channel_code: 'PH_GCASH',
        channel_properties: { account_holder_name: 'E2E Test Worker', account_number: payout.accountNumber },
        amount: payout.amount,
        currency: 'PHP',
        description: `HomeEase payout for booking ${bookingId}`,
      },
      { headers: { 'Idempotency-key': payout.id } }
    );
    xenditPayout = payoutRes.data;
    info(`Xendit payout created: id=${xenditPayout.id} status=${xenditPayout.status}`);
  } catch (err) {
    info(`Xendit payout API call FAILED: ${err.response?.status} ${JSON.stringify(err.response?.data || err.message)}`);
  }

  if (xenditPayout) {
    await db.query(
      `UPDATE "Payout" SET status='PROCESSING', "processingAt"=now(), "xenditDisbursementId"=$1, "xenditStatus"=$2, attempts=1 WHERE id=$3`,
      [xenditPayout.id, xenditPayout.status, payout.id]
    );
    info('Payout row updated to PROCESSING with real Xendit disbursement id');

    log('17', 'Simulate Xendit payout-completed webhook to finalize the payout as PAID');
    r = await webhook('/payments/xendit/payout-webhook', {
      id: xenditPayout.id,
      reference_id: payout.id,
      status: 'COMPLETED',
    });
    if (r.status !== 200) throw new Error(`Payout webhook failed: ${r.status} ${JSON.stringify(r.data)}`);
    info('payout webhook processed');
  }

  const finalPayout = await db.query(`SELECT status, "xenditStatus", "xenditDisbursementId" FROM "Payout" WHERE id=$1`, [payout.id]);
  info(`final payout status: ${JSON.stringify(finalPayout.rows[0])}`);

  // ---------------------------------------------------------------
  log('18', 'Verify commission / platform fee bookkeeping');

  r = await api('get', `/payments/${bookingId}`, null, clientToken);
  info('Client-side payment breakdown (GET /api/payments/:bookingId):');
  console.log(JSON.stringify(r.data.data.priceBreakdown, null, 2));

  const walletAfter = await db.query(
    `SELECT balance FROM "WorkerWallet" ww JOIN "WorkerProfile" wp ON ww."workerProfileId"=wp.id WHERE wp."userId"=$1`,
    [workerId]
  );
  info(`Worker admin-fee wallet balance after accept-fee deduction: ₱${walletAfter.rows[0]?.balance}`);

  const paymentRow = await db.query(
    `SELECT subtotal, "commissionRate", "commissionAmount", "withholdingTaxRate", "withholdingTaxAmount", "workerPayout", "totalAmount", status, "escrowStatus" FROM "Payment" WHERE "bookingId"=$1`,
    [bookingId]
  );
  info('Raw Payment row (developer/platform commission = commissionAmount):');
  console.log(JSON.stringify(paymentRow.rows[0], null, 2));

  console.log('\n\n================ E2E RUN COMPLETE ================');
  console.log(JSON.stringify({ clientEmail, workerEmail, bookingId, invoiceId, payoutId: payout.id }, null, 2));
}

main()
  .catch((err) => {
    console.error('\n\nFATAL:', err.message);
    process.exitCode = 1;
  })
  .finally(() => db.end());
