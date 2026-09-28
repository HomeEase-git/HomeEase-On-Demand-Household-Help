import prisma from '@config/database';
import {
  platformRevenue,
  workerPayoutsPaid,
  platformFundedCost,
  paymentBreakdown,
} from '@services/financeReportService';
import { createTestUser, deleteTestUser, createTestBooking, deleteTestBooking } from './helpers';

// Every row lives in 2030 so these windows only ever see this file's data.
const d = (iso: string) => new Date(`${iso}T04:00:00.000Z`);
const JAN = { gte: d('2030-01-01'), lt: d('2030-02-01') };
const FEB = { gte: d('2030-02-01'), lt: d('2030-03-01') };
const JAN_FEB = { gte: d('2030-01-01'), lt: d('2030-03-01') };

describe('Finance report definitions', () => {
  const createdUserIds: string[] = [];
  const bookingIds: string[] = [];

  async function payment(data: {
    methodType: 'GCASH' | 'CASH';
    status: 'COMPLETED' | 'REFUNDED' | 'PENDING';
    capturedAt?: Date;
    refundedAt?: Date;
    platformFunded?: boolean;
    createdAt?: Date;
  }) {
    const booking = await createTestBooking({ clientId: createdUserIds[0], workerId: createdUserIds[1], status: 'COMPLETED' });
    bookingIds.push(booking.id);
    return prisma.payment.create({
      data: {
        bookingId: booking.id,
        subtotal: 1000,
        tip: 50,
        commissionRate: 0.1,
        commissionAmount: 100,
        withholdingTaxRate: 0.02,
        withholdingTaxAmount: 18,
        vatAmount: 0,
        workerPayout: 932, // 1000 - 100 - 18 + 50 tip
        totalAmount: 1050,
        escrowStatus: 'RELEASED',
        ...data,
      },
    });
  }

  beforeAll(async () => {
    const { user: client } = await createTestUser('finrep-client', { role: 'CLIENT' });
    const { user: worker } = await createTestUser('finrep-worker', { role: 'WORKER' });
    createdUserIds.push(client.id, worker.id);

    const online = await payment({ methodType: 'GCASH', status: 'COMPLETED', capturedAt: d('2030-01-05') });
    await payment({ methodType: 'CASH', status: 'COMPLETED', capturedAt: d('2030-01-06') });
    // Invoice created in December, paid in January: counts in January.
    await payment({ methodType: 'GCASH', status: 'COMPLETED', createdAt: d('2029-12-30'), capturedAt: d('2030-01-02') });
    // Earned in January, refunded in February.
    await payment({ methodType: 'GCASH', status: 'REFUNDED', capturedAt: d('2030-01-03'), refundedAt: d('2030-02-10') });
    // Platform paid the worker itself — not revenue.
    await payment({ methodType: 'GCASH', status: 'COMPLETED', capturedAt: d('2030-01-08'), platformFunded: true });
    // Never paid.
    await payment({ methodType: 'GCASH', status: 'PENDING', createdAt: d('2030-01-09') });

    await prisma.payout.create({
      data: { paymentId: online.id, bookingId: online.bookingId, workerId: createdUserIds[1], amount: 932, channel: 'GCASH', accountNumber: 'x', status: 'PAID', paidAt: d('2030-01-07') },
    });
  });

  afterAll(async () => {
    for (const id of bookingIds) await deleteTestBooking(id);
    for (const id of createdUserIds) await deleteTestUser(id);
    await prisma.$disconnect();
  });

  it('counts commission (not what clients paid) in the month the money was captured', async () => {
    const jan = await platformRevenue(JAN);
    // online 100 + cash 100 + paid-in-January 100 + later-refunded 100; not the platform-funded one.
    expect(jan.commissionEarned).toBe(400);
    expect(jan.fromCashJobs).toBe(100);
    expect(jan.fromOnlineJobs).toBe(300);
    expect(jan.commissionRefunded).toBe(0);
    expect(jan.revenue).toBe(400);
  });

  it('takes a refund back out in the month of the refund, leaving January unchanged', async () => {
    const feb = await platformRevenue(FEB);
    expect(feb.commissionEarned).toBe(0);
    expect(feb.commissionRefunded).toBe(100);
    expect(feb.revenue).toBe(-100);

    expect((await platformRevenue(JAN_FEB)).revenue).toBe(300);
  });

  it('counts only payouts actually sent, in the month they were sent', async () => {
    expect(await workerPayoutsPaid(JAN)).toBe(932);
    expect(await workerPayoutsPaid(FEB)).toBe(0);
  });

  it('reports platform-funded payments as a cost', async () => {
    expect(await platformFundedCost(JAN)).toBe(932);
  });

  it('splits what clients paid into worker, platform, BIR and tips', async () => {
    const b = await paymentBreakdown({ bookingId: { in: bookingIds } });
    // Three completed client-funded payments (refunded, unpaid and platform-funded excluded).
    expect(b.clientPaid).toBe(3150);
    expect(b.workerEarnings).toBe(2796);
    expect(b.platformCommission).toBe(300);
    expect(b.withholdingTax).toBe(54);
    expect(b.tips).toBe(150);
    expect(b.commissionRatePercent).toBe(10);
    // Every peso is accounted for: worker + platform + withholding tax (+ VAT, 0 here).
    expect(b.workerEarnings + b.platformCommission + b.withholdingTax + b.vatCollected).toBe(b.clientPaid);
  });
});
