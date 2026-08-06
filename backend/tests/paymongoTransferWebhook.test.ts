import request from 'supertest';
import crypto from 'crypto';
import app from '@/app';
import prisma from '@config/database';
import { createTestUser, deleteTestUser, createTestBooking, deleteTestBooking } from './helpers';

const WEBHOOK_PATH = '/api/payments/paymongo/transfers/callback';

function signWebhook(payload: object) {
  const secret = process.env.PAYMONGO_WEBHOOK_SECRET as string;
  const rawBody = JSON.stringify(payload);
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = crypto.createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
  return { rawBody, header: `t=${timestamp},te=${signature}` };
}

describe('PayMongo transfer webhook — signature verification and status handling', () => {
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

  it('rejects a webhook with a missing signature header', async () => {
    const payload = { data: { id: 'tr_missing', status: 'succeeded' } };

    const res = await request(app)
      .post(WEBHOOK_PATH)
      .set('Content-Type', 'application/json')
      .send(JSON.stringify(payload));

    expect(res.status).toBe(401);
  });

  it('rejects a webhook with an invalid signature', async () => {
    const payload = { data: { id: 'tr_bad', status: 'succeeded' } };

    const res = await request(app)
      .post(WEBHOOK_PATH)
      .set('Content-Type', 'application/json')
      .set('paymongo-signature', 't=1700000000,te=0000000000000000000000000000000000000000000000000000000000000000')
      .send(JSON.stringify(payload));

    expect(res.status).toBe(401);
  });

  it('marks a PROCESSING payout PAID on a signed succeeded status', async () => {
    const { payout } = await seedProcessingPayout();
    const transferId = `tr_test_${Date.now()}`;

    await prisma.payout.update({ where: { id: payout.id }, data: { paymongoTransferId: transferId } });

    const payload = { data: { id: transferId, status: 'succeeded' } };
    const { rawBody, header } = signWebhook(payload);

    const res = await request(app)
      .post(WEBHOOK_PATH)
      .set('Content-Type', 'application/json')
      .set('paymongo-signature', header)
      .send(rawBody);

    expect(res.status).toBe(200);

    const updated = await prisma.payout.findUnique({ where: { id: payout.id } });
    expect(updated?.status).toBe('PAID');
    expect(updated?.paymongoTransferStatus).toBe('succeeded');
    expect(updated?.paidAt).not.toBeNull();
  });

  it('falls back to matching by reference_number when the transfer id is not yet stored', async () => {
    const { payout } = await seedProcessingPayout();
    const transferId = `tr_test_ref_${Date.now()}`;

    const payload = { data: { id: transferId, reference_number: payout.id, status: 'succeeded' } };
    const { rawBody, header } = signWebhook(payload);

    const res = await request(app)
      .post(WEBHOOK_PATH)
      .set('Content-Type', 'application/json')
      .set('paymongo-signature', header)
      .send(rawBody);

    expect(res.status).toBe(200);

    const updated = await prisma.payout.findUnique({ where: { id: payout.id } });
    expect(updated?.status).toBe('PAID');
    expect(updated?.paymongoTransferId).toBe(transferId);
  });

  it('marks a payout FAILED with the reported failure_reason on a signed failed status', async () => {
    const { payout } = await seedProcessingPayout();
    const transferId = `tr_test_failed_${Date.now()}`;
    await prisma.payout.update({ where: { id: payout.id }, data: { paymongoTransferId: transferId } });

    const payload = { data: { id: transferId, status: 'failed', failure_reason: 'invalid_destination_account' } };
    const { rawBody, header } = signWebhook(payload);

    const res = await request(app)
      .post(WEBHOOK_PATH)
      .set('Content-Type', 'application/json')
      .set('paymongo-signature', header)
      .send(rawBody);

    expect(res.status).toBe(200);

    const updated = await prisma.payout.findUnique({ where: { id: payout.id } });
    expect(updated?.status).toBe('FAILED');
    expect(updated?.failureReason).toBe('invalid_destination_account');
  });

  it('returns 200 without error when no matching payout exists', async () => {
    const payload = { data: { id: 'tr_no_match', status: 'succeeded' } };
    const { rawBody, header } = signWebhook(payload);

    const res = await request(app)
      .post(WEBHOOK_PATH)
      .set('Content-Type', 'application/json')
      .set('paymongo-signature', header)
      .send(rawBody);

    expect(res.status).toBe(200);
  });
});
