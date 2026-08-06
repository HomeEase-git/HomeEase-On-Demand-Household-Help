import request from 'supertest';
import crypto from 'crypto';
import app from '@/app';
import prisma from '@config/database';
import { createTestUser, deleteTestUser, createTestBooking, deleteTestBooking } from './helpers';

jest.mock('@services/paymongoService', () => ({
  ...jest.requireActual('@services/paymongoService'),
  createSourcePayment: jest.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { createSourcePayment } = require('@services/paymongoService');

const WEBHOOK_PATH = '/api/payments/paymongo/webhook';

function signWebhook(payload: object) {
  const secret = process.env.PAYMONGO_WEBHOOK_SECRET as string;
  const rawBody = JSON.stringify(payload);
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = crypto.createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
  return { rawBody, header: `t=${timestamp},te=${signature}` };
}

describe('PayMongo webhook — signature verification and event handling', () => {
  const createdUserIds: string[] = [];
  const createdBookingIds: string[] = [];
  let clientId: string;
  let workerId: string;

  beforeAll(async () => {
    const { user: client } = await createTestUser('payments-webhook-client', { role: 'CLIENT' });
    const { user: worker } = await createTestUser('payments-webhook-worker', { role: 'WORKER' });
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

  async function seedPendingPayment(sourceId: string) {
    const booking = await createTestBooking({ clientId, workerId, status: 'ACCEPTED' });
    createdBookingIds.push(booking.id);
    const payment = await prisma.payment.create({
      data: {
        bookingId: booking.id,
        subtotal: 1000,
        commissionAmount: 100,
        withholdingTaxAmount: 50,
        workerPayout: 850,
        totalAmount: 1000,
        status: 'PENDING',
        methodType: 'GCASH',
        paymongoSourceId: sourceId,
      },
    });
    return { booking, payment };
  }

  it('rejects a webhook with a missing signature header', async () => {
    const payload = { data: { attributes: { type: 'payment.failed', data: { attributes: { source: { id: 'src_missing' } } } } } };

    const res = await request(app)
      .post(WEBHOOK_PATH)
      .set('Content-Type', 'application/json')
      .send(JSON.stringify(payload));

    expect(res.status).toBe(401);
  });

  it('rejects a webhook with an invalid signature', async () => {
    const payload = { data: { attributes: { type: 'payment.failed', data: { attributes: { source: { id: 'src_bad' } } } } } };

    const res = await request(app)
      .post(WEBHOOK_PATH)
      .set('Content-Type', 'application/json')
      .set('paymongo-signature', 't=1700000000,te=0000000000000000000000000000000000000000000000000000000000000000')
      .send(JSON.stringify(payload));

    expect(res.status).toBe(401);
  });

  it('marks a pending payment FAILED on a signed payment.failed event', async () => {
    const sourceId = `src_test_failed_${Date.now()}`;
    const { payment } = await seedPendingPayment(sourceId);

    const payload = {
      data: { attributes: { type: 'payment.failed', data: { attributes: { source: { id: sourceId } } } } },
    };
    const { rawBody, header } = signWebhook(payload);

    const res = await request(app)
      .post(WEBHOOK_PATH)
      .set('Content-Type', 'application/json')
      .set('paymongo-signature', header)
      .send(rawBody);

    expect(res.status).toBe(200);

    const updated = await prisma.payment.findUnique({ where: { id: payment.id } });
    expect(updated?.status).toBe('FAILED');
  });

  it('captures a chargeable source and marks the payment COMPLETED', async () => {
    const sourceId = `src_test_chargeable_${Date.now()}`;
    const { payment } = await seedPendingPayment(sourceId);

    (createSourcePayment as jest.Mock).mockReset().mockResolvedValueOnce({ id: 'pay_mock_123' });

    const payload = {
      data: { attributes: { type: 'source.chargeable', data: { id: sourceId } } },
    };
    const { rawBody, header } = signWebhook(payload);

    const res = await request(app)
      .post(WEBHOOK_PATH)
      .set('Content-Type', 'application/json')
      .set('paymongo-signature', header)
      .send(rawBody);

    expect(res.status).toBe(200);
    expect(createSourcePayment).toHaveBeenCalledWith(
      expect.objectContaining({ sourceId, amountPesos: payment.totalAmount })
    );

    const updated = await prisma.payment.findUnique({ where: { id: payment.id } });
    expect(updated?.status).toBe('COMPLETED');
    expect(updated?.paymongoPaymentId).toBe('pay_mock_123');
    expect(updated?.capturedAmount).toBe(payment.totalAmount);
  });

  it('does not re-charge a payment that is no longer PENDING', async () => {
    const sourceId = `src_test_already_${Date.now()}`;
    const { payment } = await seedPendingPayment(sourceId);
    await prisma.payment.update({ where: { id: payment.id }, data: { status: 'COMPLETED' } });

    (createSourcePayment as jest.Mock).mockReset();

    const payload = { data: { attributes: { type: 'source.chargeable', data: { id: sourceId } } } };
    const { rawBody, header } = signWebhook(payload);

    const res = await request(app)
      .post(WEBHOOK_PATH)
      .set('Content-Type', 'application/json')
      .set('paymongo-signature', header)
      .send(rawBody);

    expect(res.status).toBe(200);
    expect(createSourcePayment).not.toHaveBeenCalled();
  });
});
