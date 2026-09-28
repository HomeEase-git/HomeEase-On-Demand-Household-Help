jest.mock('@services/xenditService', () => ({
  ...jest.requireActual('@services/xenditService'),
  createRefund: jest.fn(),
  retrieveRefund: jest.fn(),
}));

jest.mock('@services/xenditDisbursementService', () => ({
  ...jest.requireActual('@services/xenditDisbursementService'),
  cancelPayout: jest.fn(),
  retrievePayout: jest.fn(),
}));

import request from 'supertest';
import app from '@/app';
import prisma from '@config/database';
import { reconcilePendingRefund } from '@services/paymentLifecycleService';
import { requestRefund, approveRefundRequest } from '@services/refundRequestService';
import { createTestUser, deleteTestUser, createTestBooking, deleteTestBooking } from './helpers';

const { createRefund, retrieveRefund } = require('@services/xenditService');

describe('Refunds need admin approval', () => {
  const createdUserIds: string[] = [];
  const createdBookingIds: string[] = [];
  let clientId: string;
  let workerId: string;
  let adminId: string;
  let adminToken: string;

  beforeAll(async () => {
    const { user: client } = await createTestUser('rr-client', { role: 'CLIENT' });
    const { user: worker } = await createTestUser('rr-worker', { role: 'WORKER' });
    const { user: admin, plainPassword } = await createTestUser('rr-admin', { role: 'ADMIN' });
    createdUserIds.push(client.id, worker.id, admin.id);
    clientId = client.id;
    workerId = worker.id;
    adminId = admin.id;
    const login = await request(app).post('/api/auth/login').send({ email: admin.email, password: plainPassword });
    adminToken = login.body.data.token;
  });

  afterAll(async () => {
    for (const id of createdBookingIds) await deleteTestBooking(id);
    for (const id of createdUserIds) await deleteTestUser(id);
    await prisma.$disconnect();
  });

  beforeEach(() => {
    (createRefund as jest.Mock).mockReset();
    (retrieveRefund as jest.Mock).mockReset();
  });

  async function seedPaid(opts: { status?: 'PENDING' | 'COMPLETED'; bookingStatus?: 'ACCEPTED' | 'IN_PROGRESS' | 'COMPLETED' } = {}) {
    const booking = await createTestBooking({ clientId, workerId, status: opts.bookingStatus ?? 'IN_PROGRESS' });
    createdBookingIds.push(booking.id);
    const payment = await prisma.payment.create({
      data: {
        bookingId: booking.id,
        subtotal: 1000,
        commissionAmount: 100,
        withholdingTaxAmount: 18,
        workerPayout: 882,
        totalAmount: 1000,
        capturedAmount: opts.status === 'PENDING' ? null : 1000,
        status: opts.status ?? 'COMPLETED',
        escrowStatus: opts.status === 'PENDING' ? 'HELD' : 'RELEASED',
        methodType: 'GCASH',
        xenditInvoiceId: `inv_rr_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      },
    });
    return { booking, payment };
  }

  const admin = (method: 'get' | 'post', path: string) =>
    request(app)[method](`/api/admin/payments/refund-requests${path}`).set('Authorization', `Bearer ${adminToken}`);

  it('admin force-cancel of a paid booking files a request instead of refunding', async () => {
    const { booking, payment } = await seedPaid();

    const res = await request(app)
      .patch(`/api/admin/bookings/${booking.id}/cancel`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reason: 'Worker unreachable' });

    expect(res.status).toBe(200);
    expect(createRefund).not.toHaveBeenCalled();
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe('COMPLETED');
    const pending = await prisma.refundRequest.findFirst({ where: { paymentId: payment.id } });
    expect(pending).toMatchObject({ status: 'PENDING', source: 'ADMIN_CANCEL', amount: 1000, requestedById: adminId });
  });

  it('voids an unpaid payment right away, with no request', async () => {
    const { booking, payment } = await seedPaid({ status: 'PENDING' });

    const outcome = await requestRefund({ bookingId: booking.id, reason: 'Client cancelled', source: 'BOOKING_CANCELLED' });

    expect(outcome.kind).toBe('voided');
    expect(await prisma.refundRequest.count({ where: { paymentId: payment.id } })).toBe(0);
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe('FAILED');
  });

  it('files only one request when a booking is cancelled twice at once', async () => {
    const { booking, payment } = await seedPaid();

    await Promise.all([
      requestRefund({ bookingId: booking.id, reason: 'A', source: 'BOOKING_CANCELLED' }),
      requestRefund({ bookingId: booking.id, reason: 'B', source: 'ADMIN_CANCEL' }),
    ]);

    expect(await prisma.refundRequest.count({ where: { paymentId: payment.id } })).toBe(1);
  });

  it('a dispute resolved with Cancel & Refund waits for approval, then follows the decision', async () => {
    const { booking, payment } = await seedPaid();
    const dispute = await prisma.dispute.create({
      data: { bookingId: booking.id, raisedById: clientId, reason: 'No-show', evidenceUrls: [] },
    });

    const outcome = await requestRefund({
      bookingId: booking.id,
      reason: 'Cancelled via dispute resolution',
      source: 'DISPUTE_RESOLUTION',
      disputeId: dispute.id,
    });
    expect(outcome.kind).toBe('requested');

    (createRefund as jest.Mock).mockResolvedValueOnce({ id: 'rfd_dispute', status: 'SUCCEEDED' });
    const res = await admin('post', `/${outcome.kind === 'requested' ? outcome.request.id : ''}/approve`).send({});

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('APPROVED');
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe('REFUNDED');
    expect(await prisma.dispute.findUniqueOrThrow({ where: { id: dispute.id } })).toMatchObject({
      refundStatus: 'SUCCEEDED',
      refundAmount: 1000,
    });
    const told = await prisma.notification.count({ where: { userId: clientId, type: 'REFUND_APPROVED', relatedId: booking.id } });
    expect(told).toBe(1);
  });

  it('two admins approving at once refund only once', async () => {
    const { booking } = await seedPaid();
    const outcome = await requestRefund({ bookingId: booking.id, reason: 'Duplicate click', source: 'ADMIN_CANCEL' });
    if (outcome.kind !== 'requested') throw new Error('expected a request');
    (createRefund as jest.Mock).mockResolvedValue({ id: 'rfd_once', status: 'SUCCEEDED' });

    const results = await Promise.allSettled([
      approveRefundRequest(outcome.request.id, adminId),
      approveRefundRequest(outcome.request.id, adminId),
    ]);

    expect(createRefund).toHaveBeenCalledTimes(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
  });

  it('marks the request FAILED when the worker was already paid, then records a manual refund', async () => {
    const { booking, payment } = await seedPaid();
    await prisma.payment.update({ where: { id: payment.id }, data: { workerSettledAt: new Date() } });
    await prisma.payout.create({
      data: { paymentId: payment.id, bookingId: booking.id, workerId, amount: 882, channel: 'GCASH', accountNumber: '09171234567', status: 'PAID' },
    });
    const outcome = await requestRefund({ bookingId: booking.id, reason: 'Poor work', source: 'ADMIN_CANCEL' });
    if (outcome.kind !== 'requested') throw new Error('expected a request');

    const approved = await admin('post', `/${outcome.request.id}/approve`).send({});
    expect(approved.body.data.status).toBe('FAILED');
    expect(approved.body.data.failureReason).toMatch(/manual clawback/);
    expect(createRefund).not.toHaveBeenCalled();

    const noNote = await admin('post', `/${outcome.request.id}/manual`).send({});
    expect(noNote.status).toBe(400);

    const manual = await admin('post', `/${outcome.request.id}/manual`).send({ note: 'Sent ₱1,000 via GCash; worker agreed to repay' });
    expect(manual.status).toBe(200);
    expect(manual.body.data.status).toBe('REFUNDED_MANUALLY');
    expect(createRefund).not.toHaveBeenCalled();
    const refunded = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(refunded.status).toBe('REFUNDED');
    expect(refunded.refundReason).toMatch(/Refunded manually by admin/);
  });

  it('a manual refund still stops a payout that has not gone out yet', async () => {
    const { booking, payment } = await seedPaid();
    await prisma.payment.update({ where: { id: payment.id }, data: { workerSettledAt: new Date() } });
    const payout = await prisma.payout.create({
      data: { paymentId: payment.id, bookingId: booking.id, workerId, amount: 882, channel: 'GCASH', accountNumber: '09171234567', status: 'PENDING' },
    });
    const outcome = await requestRefund({ bookingId: booking.id, reason: 'Poor work', source: 'ADMIN_CANCEL' });
    if (outcome.kind !== 'requested') throw new Error('expected a request');

    await admin('post', `/${outcome.request.id}/manual`).send({ note: 'Refunded in cash at the office' });

    expect((await prisma.payout.findUniqueOrThrow({ where: { id: payout.id } })).status).toBe('CANCELLED');
  });

  it('rejects with a required note and tells the client', async () => {
    const { booking, payment } = await seedPaid();
    const outcome = await requestRefund({ bookingId: booking.id, reason: 'Changed mind', source: 'BOOKING_CANCELLED' });
    if (outcome.kind !== 'requested') throw new Error('expected a request');

    expect((await admin('post', `/${outcome.request.id}/reject`).send({})).status).toBe(400);
    const res = await admin('post', `/${outcome.request.id}/reject`).send({ note: 'Job was completed as agreed' });

    expect(res.body.data.status).toBe('REJECTED');
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe('COMPLETED');
    expect(await prisma.notification.count({ where: { userId: clientId, type: 'REFUND_REJECTED', relatedId: booking.id } })).toBe(1);
    // A decided request can't be decided again.
    expect((await admin('post', `/${outcome.request.id}/approve`).send({})).status).toBe(409);
  });

  it('puts an approved request back to FAILED when Xendit later fails the refund', async () => {
    const { booking, payment } = await seedPaid();
    const outcome = await requestRefund({ bookingId: booking.id, reason: 'No-show', source: 'ADMIN_CANCEL' });
    if (outcome.kind !== 'requested') throw new Error('expected a request');
    (createRefund as jest.Mock).mockResolvedValueOnce({ id: 'rfd_later_fail', status: 'PENDING' });
    await approveRefundRequest(outcome.request.id, adminId);

    (retrieveRefund as jest.Mock).mockResolvedValueOnce({ id: 'rfd_later_fail', status: 'FAILED', failure_code: 'ACCOUNT_CLOSED' });
    await reconcilePendingRefund(payment.id);

    const after = await prisma.refundRequest.findUniqueOrThrow({ where: { id: outcome.request.id } });
    expect(after.status).toBe('FAILED');
    expect(after.failureReason).toMatch(/ACCOUNT_CLOSED/);
  });

  it('lists the queue with a count of requests awaiting a decision', async () => {
    const res = await admin('get', '?status=PENDING,FAILED&limit=50').send();

    expect(res.status).toBe(200);
    expect(res.body.meta.awaitingDecision).toBeGreaterThan(0);
    expect(res.body.data.every((r: { status: string }) => ['PENDING', 'FAILED'].includes(r.status))).toBe(true);
    expect(res.body.data[0]).toHaveProperty('client');
  });
});
