import request from 'supertest';
import app from '@/app';
import prisma from '@config/database';
import { createTestUser, deleteTestUser, createTestBooking, deleteTestBooking } from './helpers';

const WEBHOOK_PATH = '/api/payments/xendit/payout-webhook';

function xenditHeaders() {
  return { 'x-callback-token': process.env.XENDIT_WEBHOOK_TOKEN as string };
}

describe('Xendit payout webhook — token verification and status handling', () => {
  const createdUserIds: string[] = [];
  const createdBookingIds: string[] = [];
  let clientId: string;
  let workerId: string;

  beforeAll(async () => {
    const { user: client } = await createTestUser('transfer-webhook-client', { role: 'CLIENT' });
    const { user: worker } = await createTestUser('transfer-webhook-worker', { role: 'WORKER' });
    createdUserIds.push(client.id, worker.id);
    clientId = client.id;
    workerId = worker.id;
  });

  afterAll(async () => {
    for (const id of createdBookingIds) {
      await deleteTestBooking(id);
    }
    for (const id of createdUserIds) {
      await deleteTestUser(id);
    }
    await prisma.$disconnect();
  });

  async function seedProcessingPayout() {
    const booking = await createTestBooking({ clientId, workerId, status: 'COMPLETED' });
    createdBookingIds.push(booking.id);
    const payment = await prisma.payment.create({
      data: {
        bookingId: booking.id,
        subtotal: 1000,
        commissionAmount: 100,
        withholdingTaxAmount: 50,
        workerPayout: 850,
        totalAmount: 1000,
        status: 'COMPLETED',
        escrowStatus: 'RELEASED',
        methodType: 'GCASH',
      },
    });
    const payout = await prisma.payout.create({
      data: {
        paymentId: payment.id,
        bookingId: booking.id,
        workerId,
        amount: 850,
        channel: 'GCASH',
        accountNumber: '09171234567',
        status: 'PROCESSING',
      },
    });
    return { booking, payment, payout };
  }

  it('rejects a webhook with a missing callback token', async () => {
    const payload = { id: 'disb_missing', status: 'COMPLETED' };

    const res = await request(app).post(WEBHOOK_PATH).send(payload);

    expect(res.status).toBe(401);
  });

  it('rejects a webhook with an incorrect callback token', async () => {
    const payload = { id: 'disb_bad', status: 'COMPLETED' };

    const res = await request(app)
      .post(WEBHOOK_PATH)
      .set('x-callback-token', 'wrong-token')
      .send(payload);

    expect(res.status).toBe(401);
  });

  it('marks a PROCESSING payout PAID on a token-verified COMPLETED status', async () => {
    const { payout } = await seedProcessingPayout();
    const payoutId = `disb_test_${Date.now()}`;

    await prisma.payout.update({ where: { id: payout.id }, data: { xenditDisbursementId: payoutId } });

    const payload = { id: payoutId, status: 'COMPLETED' };

    const res = await request(app).post(WEBHOOK_PATH).set(xenditHeaders()).send(payload);

    expect(res.status).toBe(200);

    const updated = await prisma.payout.findUnique({ where: { id: payout.id } });
    expect(updated?.status).toBe('PAID');
    expect(updated?.xenditStatus).toBe('COMPLETED');
    expect(updated?.paidAt).not.toBeNull();
  });

  it('falls back to matching by reference_id when the payout id is not yet stored', async () => {
    const { payout } = await seedProcessingPayout();
    const payoutId = `disb_test_ref_${Date.now()}`;

    const payload = { id: payoutId, reference_id: payout.id, status: 'COMPLETED' };

    const res = await request(app).post(WEBHOOK_PATH).set(xenditHeaders()).send(payload);

    expect(res.status).toBe(200);

    const updated = await prisma.payout.findUnique({ where: { id: payout.id } });
    expect(updated?.status).toBe('PAID');
    expect(updated?.xenditDisbursementId).toBe(payoutId);
  });

  it('marks a payout FAILED with the reported failure_code on a token-verified FAILED status', async () => {
    const { payout } = await seedProcessingPayout();
    const payoutId = `disb_test_failed_${Date.now()}`;
    await prisma.payout.update({ where: { id: payout.id }, data: { xenditDisbursementId: payoutId } });

    const payload = { id: payoutId, status: 'FAILED', failure_code: 'DESTINATION_ACCOUNT_INVALID' };

    const res = await request(app).post(WEBHOOK_PATH).set(xenditHeaders()).send(payload);

    expect(res.status).toBe(200);

    const updated = await prisma.payout.findUnique({ where: { id: payout.id } });
    expect(updated?.status).toBe('FAILED');
    expect(updated?.failureReason).toBe('DESTINATION_ACCOUNT_INVALID');
  });

  it('returns 200 without error when no matching payout exists', async () => {
    const payload = { id: 'disb_no_match', status: 'COMPLETED' };

    const res = await request(app).post(WEBHOOK_PATH).set(xenditHeaders()).send(payload);

    expect(res.status).toBe(200);
  });
});
