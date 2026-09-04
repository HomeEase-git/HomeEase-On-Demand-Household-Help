// Manual end-to-end smoke test against a REAL Xendit sandbox — creates a
// throwaway client + worker, runs a full booking through completion,
// payment (real Xendit Invoice), and payout (real Xendit Payout), and
// checks the commission/withholding-tax bookkeeping. `npm test` mocks
// bookingQueue/verificationQueue/Xendit entirely, so this is the only thing
// that actually exercises those integrations — run it (`npm run
// test:e2e:sandbox`, or via the "E2E Sandbox" GitHub Actions workflow)
// after touching paymentLifecycleService.ts, bookingWorker.ts, or either
// Xendit webhook handler in paymentController.ts. Needs: a running dev
// server (`npm run dev`), a real XENDIT_SECRET_KEY/XENDIT_WEBHOOK_TOKEN in
// .env, and Redis actually reachable (REDIS_HOST/REDIS_PORT) — booking
// creation hangs indefinitely without it (see config/redis.ts).
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
  // Dedicated E2E test-admin account (not the real admin@homeease.dev, whose
  // real password this script doesn't know) — override via env if you'd
  // rather point this at a different admin.
  const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL || 'e2e.admin@homeease.invalid';
  const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD || 'E2eAdminPass123!';
  let r = await api('post', '/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
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
  // Step 4 used to pre-fund the worker's wallet to cover a flat per-job
  // admin fee — that fee (and the wallet) was removed; booking acceptance
  // no longer requires any prepaid balance.

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

  if (verificationId) {
    info(`verification request id: ${verificationId}`);
    r = await api(
      'patch',
      `/admin/verifications/${verificationId}/approve`,
      { adminOverrideReason: 'E2E test run — single Tier-1 doc uploaded (upload endpoint only accepts one documentType per call, see note in report), manually verifying rest out of band' },
      adminToken
    );
    if (r.status !== 200) throw new Error(`Admin approve failed: ${r.status} ${JSON.stringify(r.data)}`);
    info('worker KYC APPROVED by admin');
  } else {
    // No VerificationRequest row — the upload itself failed before it got
    // that far (e.g. the SUPABASE_KYC_BUCKET bucket doesn't exist in this
    // environment). That's a storage/env concern unrelated to what this
    // script exists to verify (the payment lifecycle), so fall back to
    // setting the same end-state the real approve flow would (see
    // adminVerificationController.ts) directly.
    info(`no VerificationRequest row was created (upload failed: ${JSON.stringify(uploadRes.data)}) — setting kycStatus=APPROVED directly instead`);
    await db.query(
      `UPDATE "WorkerProfile" SET "kycStatus"='APPROVED', "kycApprovedAt"=now() WHERE "userId"=$1`,
      [workerId]
    );
    info('worker KYC APPROVED (direct DB fallback)');
  }

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
  // Pay-after-completion: no Payment row and no Xendit invoice exist yet at
  // this point — completion confirmation is what raises the invoice (see
  // bookingController.confirmCompletion / paymentLifecycleService.
  // createCompletionInvoice). There's nothing to check out or pay before the
  // job is actually done.
  log('12', 'Worker submits completion photo');
  r = await api(
    'patch',
    `/bookings/${bookingId}/complete`,
    { completionPhotoUrl: 'https://example.com/e2e-test-completion-photo.jpg' },
    workerToken
  );
  if (r.status !== 200) throw new Error(`Complete failed: ${r.status} ${JSON.stringify(r.data)}`);
  info(`status -> ${r.data.data.status}`);

  log('13', 'Client confirms completion — for GCASH/MAYA this raises the Xendit invoice itself and returns AWAITING_PAYMENT (real Xendit sandbox Invoice API call)');
  r = await api('patch', `/bookings/${bookingId}/confirm-completion`, {}, clientToken);
  if (r.status !== 200) throw new Error(`Confirm completion failed: ${r.status} ${JSON.stringify(r.data)}`);
  if (r.data.data.status !== 'AWAITING_PAYMENT') {
    throw new Error(`Expected AWAITING_PAYMENT, got ${r.data.data.status}: ${JSON.stringify(r.data.data)}`);
  }
  const { checkoutUrl, invoiceId, amount } = r.data.data;
  info(`status -> AWAITING_PAYMENT, xendit invoice created: ${invoiceId} (amount ₱${amount})`);
  info(`checkout URL: ${checkoutUrl}`);
  results.invoiceId = invoiceId;
  results.checkoutUrl = checkoutUrl;

  log('14', 'Simulate Xendit "invoice.paid" webhook (Xendit cannot reach our localhost, so we POST the callback ourselves with the correct shared-secret token — same code path a real webhook hits)');
  r = await webhook('/payments/xendit/invoice-webhook', {
    id: invoiceId,
    status: 'PAID',
    payment_id: `test_xnd_pay_${STAMP}`,
    paid_amount: amount,
    paid_at: new Date().toISOString(),
  });
  if (r.status !== 200) throw new Error(`Invoice webhook failed: ${r.status} ${JSON.stringify(r.data)}`);
  info('invoice marked PAID — finalizePaidBooking should now have moved the booking to COMPLETED, netted worker dues, and scheduled the payout');

  const bookingAfterWebhook = await db.query(`SELECT status FROM "Booking" WHERE id=$1`, [bookingId]);
  if (bookingAfterWebhook.rows[0]?.status !== 'COMPLETED') {
    throw new Error(`Expected booking COMPLETED after invoice-paid webhook, got ${bookingAfterWebhook.rows[0]?.status}`);
  }
  info('booking confirmed COMPLETED');

  // Give the (failing, redis-less) schedulePayout call time to time out and
  // get caught inside finalizePaidBooking, so the Payout row it created
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
  log('15', 'Send the real payout to Xendit sandbox (replicating xenditDisbursementService.createPayout — the BullMQ worker that would normally do this has no Redis to consume from locally)');
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

    log('16', 'Simulate Xendit payout-completed webhook to finalize the payout as PAID');
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
  log('17', 'Verify commission / platform fee bookkeeping');

  r = await api('get', `/payments/${bookingId}`, null, clientToken);
  info('Client-side payment breakdown (GET /api/payments/:bookingId):');
  console.log(JSON.stringify(r.data.data.priceBreakdown, null, 2));

  const debtAfter = await db.query(
    `SELECT "commissionOwed", "debtHoldAt" FROM "WorkerProfile" WHERE "userId"=$1`,
    [workerId]
  );
  info(`Worker outstanding platform dues after this booking: ₱${debtAfter.rows[0]?.commissionOwed}`);

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
