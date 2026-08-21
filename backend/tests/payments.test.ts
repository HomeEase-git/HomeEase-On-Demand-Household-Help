import request from 'supertest';
import app from '@/app';
import prisma from '@config/database';
import { createTestUser, deleteTestUser, createTestBooking, deleteTestBooking } from './helpers';

const WEBHOOK_PATH = '/api/payments/xendit/invoice-webhook';

function xenditHeaders() {
  return { 'x-callback-token': process.env.XENDIT_WEBHOOK_TOKEN as string };
}

describe('Xendit invoice webhook — token verification and event handling', () => {
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

  async function seedPendingPayment(invoiceId: string) {
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
        xenditInvoiceId: invoiceId,
      },
    });
    return { booking, payment };
  }

  it('rejects a webhook with a missing callback token', async () => {
    const payload = { id: 'inv_missing', status: 'FAILED' };

    const res = await request(app).post(WEBHOOK_PATH).send(payload);

    expect(res.status).toBe(401);
  });

  it('rejects a webhook with an incorrect callback token', async () => {
    const payload = { id: 'inv_bad', status: 'FAILED' };

    const res = await request(app)
      .post(WEBHOOK_PATH)
      .set('x-callback-token', 'wrong-token')
      .send(payload);

    expect(res.status).toBe(401);
  });

  it('marks a pending payment FAILED on a token-verified EXPIRED status', async () => {
    const invoiceId = `inv_test_failed_${Date.now()}`;
    const { payment } = await seedPendingPayment(invoiceId);

    const payload = { id: invoiceId, status: 'EXPIRED' };

    const res = await request(app).post(WEBHOOK_PATH).set(xenditHeaders()).send(payload);

    expect(res.status).toBe(200);

    const updated = await prisma.payment.findUnique({ where: { id: payment.id } });
    expect(updated?.status).toBe('FAILED');
  });

  it('marks a pending payment COMPLETED on a token-verified PAID status', async () => {
    const invoiceId = `inv_test_paid_${Date.now()}`;
    const { payment } = await seedPendingPayment(invoiceId);

    // Capture is atomic on Xendit's side — no separate "charge" call to
    // mock, the webhook payload itself carries the paid amount/payment id.
    const payload = {
      id: invoiceId,
      status: 'PAID',
      payment_id: 'ewc_mock_123',
      paid_amount: payment.totalAmount,
      paid_at: new Date().toISOString(),
    };

    const res = await request(app).post(WEBHOOK_PATH).set(xenditHeaders()).send(payload);

    expect(res.status).toBe(200);

    const updated = await prisma.payment.findUnique({ where: { id: payment.id } });
    expect(updated?.status).toBe('COMPLETED');
    expect(updated?.xenditPaymentId).toBe('ewc_mock_123');
    expect(updated?.capturedAmount).toBe(payment.totalAmount);
  });

  it('does not re-complete a payment that is no longer PENDING', async () => {
    const invoiceId = `inv_test_already_${Date.now()}`;
    const { payment } = await seedPendingPayment(invoiceId);
    await prisma.payment.update({ where: { id: payment.id }, data: { status: 'COMPLETED' } });

    const payload = {
      id: invoiceId,
      status: 'PAID',
      payment_id: 'ewc_should_not_apply',
      paid_amount: payment.totalAmount,
    };

    const res = await request(app).post(WEBHOOK_PATH).set(xenditHeaders()).send(payload);

    expect(res.status).toBe(200);

    const updated = await prisma.payment.findUnique({ where: { id: payment.id } });
    expect(updated?.xenditPaymentId).not.toBe('ewc_should_not_apply');
  });
});
