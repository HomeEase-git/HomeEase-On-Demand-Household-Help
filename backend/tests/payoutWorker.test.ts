jest.mock('@queues/payoutQueue', () => ({
  PAYOUT_QUEUE_NAME: 'worker-payout',
  PAYOUT_JOB_NAMES: { SEND_PAYOUT: 'send-payout' },
}));

jest.mock('@services/paymongoDisbursementService', () => ({
  createTransfer: jest.fn(),
  paymongoDestinationBicFor: jest.fn(),
}));

import type { Job } from 'bullmq';
import prisma from '@config/database';
import { processSendPayout } from '@workers/payoutWorker';
import { createTestUser, deleteTestUser, createTestBooking, deleteTestBooking } from './helpers';

const { createTransfer, paymongoDestinationBicFor } = require('@services/paymongoDisbursementService');

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
    (createTransfer as jest.Mock).mockReset();
    (paymongoDestinationBicFor as jest.Mock).mockReset();
  });

  async function seedPendingPayout(channel: 'GCASH' | 'MAYA' | 'BANK_TRANSFER' = 'GCASH') {
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

  it('fails immediately without retrying for an unsupported payout channel', async () => {
    const payout = await seedPendingPayout('BANK_TRANSFER');
    (paymongoDestinationBicFor as jest.Mock).mockResolvedValueOnce(null);

    await processSendPayout(fakeJob(0, 5), { payoutId: payout.id });

    expect(createTransfer).not.toHaveBeenCalled();
    const updated = await prisma.payout.findUnique({ where: { id: payout.id } });
    expect(updated?.status).toBe('FAILED');
    expect(updated?.failureReason).toContain('Unsupported payout channel');
  });

  it('marks the payout PAID when PayMongo returns succeeded immediately', async () => {
    const payout = await seedPendingPayout('GCASH');
    (paymongoDestinationBicFor as jest.Mock).mockResolvedValueOnce('PH_GCASH_BIC');
    (createTransfer as jest.Mock).mockResolvedValueOnce({ id: 'tr_immediate', status: 'succeeded' });

    await processSendPayout(fakeJob(0, 5), { payoutId: payout.id });

    const updated = await prisma.payout.findUnique({ where: { id: payout.id } });
    expect(updated?.status).toBe('PAID');
    expect(updated?.paymongoTransferId).toBe('tr_immediate');
    expect(updated?.paidAt).not.toBeNull();
  });

  it('leaves the payout PROCESSING when PayMongo returns pending', async () => {
    const payout = await seedPendingPayout('GCASH');
    (paymongoDestinationBicFor as jest.Mock).mockResolvedValueOnce('PH_GCASH_BIC');
    (createTransfer as jest.Mock).mockResolvedValueOnce({ id: 'tr_pending', status: 'pending' });

    await processSendPayout(fakeJob(0, 5), { payoutId: payout.id });

    const updated = await prisma.payout.findUnique({ where: { id: payout.id } });
    expect(updated?.status).toBe('PROCESSING');
    expect(updated?.paymongoTransferId).toBe('tr_pending');
  });

  it('resets to PENDING and rethrows on a non-final failed attempt', async () => {
    const payout = await seedPendingPayout('GCASH');
    (paymongoDestinationBicFor as jest.Mock).mockResolvedValueOnce('PH_GCASH_BIC');
    (createTransfer as jest.Mock).mockRejectedValueOnce(new Error('network blip'));

    await expect(processSendPayout(fakeJob(0, 5), { payoutId: payout.id })).rejects.toThrow('network blip');

    const updated = await prisma.payout.findUnique({ where: { id: payout.id } });
    expect(updated?.status).toBe('PENDING');
    expect(updated?.failureReason).toBe('network blip');
  });

  it('marks FAILED and does not rethrow past what BullMQ expects on the final attempt', async () => {
    const payout = await seedPendingPayout('GCASH');
    (paymongoDestinationBicFor as jest.Mock).mockResolvedValueOnce('PH_GCASH_BIC');
    (createTransfer as jest.Mock).mockRejectedValueOnce(new Error('destination rejected'));

    await expect(processSendPayout(fakeJob(4, 5), { payoutId: payout.id })).rejects.toThrow('destination rejected');

    const updated = await prisma.payout.findUnique({ where: { id: payout.id } });
    expect(updated?.status).toBe('FAILED');
    expect(updated?.failedAt).not.toBeNull();
  });

  it('is a no-op for an already-PROCESSING payout (duplicate job guard)', async () => {
    const payout = await seedPendingPayout('GCASH');
    await prisma.payout.update({ where: { id: payout.id }, data: { status: 'PROCESSING' } });

    await processSendPayout(fakeJob(0, 5), { payoutId: payout.id });

    expect(createTransfer).not.toHaveBeenCalled();
  });
});
