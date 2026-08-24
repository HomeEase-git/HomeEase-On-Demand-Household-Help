jest.mock('@queues/payoutQueue', () => ({
  PAYOUT_QUEUE_NAME: 'worker-payout',
  PAYOUT_JOB_NAMES: { SEND_PAYOUT: 'send-payout' },
}));

jest.mock('@services/xenditDisbursementService', () => ({
  createPayout: jest.fn(),
  xenditChannelCodeFor: jest.fn(),
}));

import type { Job } from 'bullmq';
import prisma from '@config/database';
import { processSendPayout } from '@workers/payoutWorker';
import { createTestUser, deleteTestUser, createTestBooking, deleteTestBooking } from './helpers';

const { createPayout, xenditChannelCodeFor } = require('@services/xenditDisbursementService');

function fakeJob(attemptsMade: number, attempts: number): Job {
  return { attemptsMade, opts: { attempts } } as unknown as Job;
}

describe('payoutWorker.processSendPayout', () => {
  const createdUserIds: string[] = [];
  const createdBookingIds: string[] = [];
  let clientId: string;
  let workerId: string;

  beforeAll(async () => {
    const { user: client } = await createTestUser('payout-worker-client', { role: 'CLIENT' });
    const { user: worker } = await createTestUser('payout-worker-worker', { role: 'WORKER' });
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

  beforeEach(() => {
    (createPayout as jest.Mock).mockReset();
    (xenditChannelCodeFor as jest.Mock).mockReset();
  });

  async function seedPendingPayout(channel: 'GCASH' | 'MAYA' = 'GCASH') {
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
    return prisma.payout.create({
      data: {
        paymentId: payment.id,
        bookingId: booking.id,
        workerId,
        amount: 850,
        channel,
        accountNumber: '09171234567',
        status: 'PENDING',
      },
    });
  }

  it('marks the payout PAID when Xendit returns COMPLETED immediately', async () => {
    const payout = await seedPendingPayout('GCASH');
    (xenditChannelCodeFor as jest.Mock).mockReturnValueOnce('PH_GCASH');
    (createPayout as jest.Mock).mockResolvedValueOnce({ id: 'disb_immediate', status: 'COMPLETED' });

    await processSendPayout(fakeJob(0, 5), { payoutId: payout.id });

    const updated = await prisma.payout.findUnique({ where: { id: payout.id } });
    expect(updated?.status).toBe('PAID');
    expect(updated?.xenditDisbursementId).toBe('disb_immediate');
    expect(updated?.paidAt).not.toBeNull();
  });

  it('leaves the payout PROCESSING when Xendit returns ACCEPTED (the realistic synchronous response, hand-confirmed against the live sandbox)', async () => {
    const payout = await seedPendingPayout('GCASH');
    (xenditChannelCodeFor as jest.Mock).mockReturnValueOnce('PH_GCASH');
    (createPayout as jest.Mock).mockResolvedValueOnce({ id: 'disb_accepted', status: 'ACCEPTED' });

    await processSendPayout(fakeJob(0, 5), { payoutId: payout.id });

    const updated = await prisma.payout.findUnique({ where: { id: payout.id } });
    expect(updated?.status).toBe('PROCESSING');
    expect(updated?.xenditDisbursementId).toBe('disb_accepted');
  });

  it('marks the payout FAILED when Xendit returns FAILED immediately', async () => {
    const payout = await seedPendingPayout('GCASH');
    (xenditChannelCodeFor as jest.Mock).mockReturnValueOnce('PH_GCASH');
    (createPayout as jest.Mock).mockResolvedValueOnce({ id: 'disb_failed', status: 'FAILED' });

    await processSendPayout(fakeJob(0, 5), { payoutId: payout.id });

    const updated = await prisma.payout.findUnique({ where: { id: payout.id } });
    expect(updated?.status).toBe('FAILED');
    expect(updated?.xenditDisbursementId).toBe('disb_failed');
    expect(updated?.failureReason).toBeTruthy();
  });

  it('resets to PENDING and rethrows on a non-final failed attempt', async () => {
    const payout = await seedPendingPayout('GCASH');
    (xenditChannelCodeFor as jest.Mock).mockReturnValueOnce('PH_GCASH');
    (createPayout as jest.Mock).mockRejectedValueOnce(new Error('network blip'));

    await expect(processSendPayout(fakeJob(0, 5), { payoutId: payout.id })).rejects.toThrow('network blip');

    const updated = await prisma.payout.findUnique({ where: { id: payout.id } });
    expect(updated?.status).toBe('PENDING');
    expect(updated?.failureReason).toBe('network blip');
  });

  it('marks FAILED and does not rethrow past what BullMQ expects on the final attempt', async () => {
    const payout = await seedPendingPayout('GCASH');
    (xenditChannelCodeFor as jest.Mock).mockReturnValueOnce('PH_GCASH');
    (createPayout as jest.Mock).mockRejectedValueOnce(new Error('destination rejected'));

    await expect(processSendPayout(fakeJob(4, 5), { payoutId: payout.id })).rejects.toThrow('destination rejected');

    const updated = await prisma.payout.findUnique({ where: { id: payout.id } });
    expect(updated?.status).toBe('FAILED');
    expect(updated?.failedAt).not.toBeNull();
  });

  it('is a no-op for an already-PROCESSING payout (duplicate job guard)', async () => {
    const payout = await seedPendingPayout('GCASH');
    await prisma.payout.update({ where: { id: payout.id }, data: { status: 'PROCESSING' } });

    await processSendPayout(fakeJob(0, 5), { payoutId: payout.id });

    expect(createPayout).not.toHaveBeenCalled();
  });
});
