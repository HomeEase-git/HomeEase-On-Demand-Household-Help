jest.mock('@services/xenditService', () => ({
  ...jest.requireActual('@services/xenditService'),
  createInvoice: jest.fn(),
  retrieveInvoice: jest.fn(),
}));

import prisma from '@config/database';
import {
  createDebtPaymentInvoice,
  finalizeDebtPayment,
  resolveAmount,
  DebtPaymentError,
} from '@services/debtPaymentService';
import { createTestUser, deleteTestUser } from './helpers';
import { ownerDb } from './ownerDb';

const { createInvoice, retrieveInvoice } = require('@services/xenditService');

describe('Worker pays platform dues through Xendit', () => {
  let userId: string;
  let workerProfileId: string;

  beforeAll(async () => {
    const { user } = await createTestUser('dues-pay-worker', { role: 'WORKER' });
    userId = user.id;
    workerProfileId = (await prisma.workerProfile.findUniqueOrThrow({ where: { userId } })).id;
  });

  afterAll(async () => {
    await ownerDb.debtPayment.deleteMany({ where: { workerProfileId } });
    await ownerDb.debtLedgerEntry.deleteMany({ where: { workerProfileId } });
    await deleteTestUser(userId);
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    (createInvoice as jest.Mock).mockReset();
    (retrieveInvoice as jest.Mock).mockReset();
    let n = 0;
    (createInvoice as jest.Mock).mockImplementation(async () => ({
      id: `inv_${Date.now()}_${n++}`,
      status: 'PENDING',
      invoiceUrl: 'https://checkout.xendit.co/web/abc',
    }));
    await ownerDb.debtPayment.deleteMany({ where: { workerProfileId } });
    await ownerDb.debtLedgerEntry.deleteMany({ where: { workerProfileId } });
    await prisma.workerProfile.update({
      where: { id: workerProfileId },
      data: { commissionOwed: 0, compensationCredit: 0, debtHoldAt: null, debtHoldNote: null },
    });
  });

  const setOwed = (commissionOwed: number, extra: Record<string, unknown> = {}) =>
    prisma.workerProfile.update({ where: { id: workerProfileId }, data: { commissionOwed, ...extra } });
  const profile = () => prisma.workerProfile.findUniqueOrThrow({ where: { id: workerProfileId } });

  describe('amount rules', () => {
    it('defaults to the full balance and rounds to the centavo', () => {
      expect(resolveAmount(undefined, 150.5)).toBe(150.5);
      expect(resolveAmount(100.004, 150)).toBe(100);
      expect(resolveAmount(75, 150)).toBe(75); // exactly half is allowed
    });

    it('rejects nothing owed, over-balance and below-minimum amounts', () => {
      expect(() => resolveAmount(undefined, 0)).toThrow(DebtPaymentError);
      expect(() => resolveAmount(200, 150)).toThrow(/only owe/);
      expect(() => resolveAmount(74, 150)).toThrow(/at least ₱75\.00/);
      expect(() => resolveAmount(1, 150)).toThrow(/at least/);
      expect(() => resolveAmount(Number.NaN, 150)).toThrow(DebtPaymentError);
    });

    it('lets a debt smaller than the Xendit minimum be paid in full', () => {
      expect(resolveAmount(undefined, 5)).toBe(5);
      expect(resolveAmount(5, 5)).toBe(5);
    });
  });

  describe('creating the invoice', () => {
    it('invoices the requested partial amount', async () => {
      await setOwed(300);
      const result = await createDebtPaymentInvoice(userId, 150);
      expect(result).toMatchObject({ amount: 150, checkoutUrl: 'https://checkout.xendit.co/web/abc' });
      expect(createInvoice).toHaveBeenCalledWith(expect.objectContaining({ amountPesos: 150 }));
    });

    it('invoices the full balance when no amount is given', async () => {
      await setOwed(300);
      expect(await createDebtPaymentInvoice(userId)).toMatchObject({ amount: 300 });
    });

    it('refuses a partial payment below half of the debt', async () => {
      await setOwed(300);
      await expect(createDebtPaymentInvoice(userId, 100)).rejects.toThrow(/at least ₱150\.00/);
    });

    it('refuses when nothing is owed or the amount is over the balance', async () => {
      await expect(createDebtPaymentInvoice(userId)).rejects.toThrow(DebtPaymentError);
      await setOwed(100);
      await expect(createDebtPaymentInvoice(userId, 500)).rejects.toThrow(DebtPaymentError);
      expect(createInvoice).not.toHaveBeenCalled();
    });

    it('reuses a live pending invoice instead of creating a second', async () => {
      await setOwed(300);
      const first = await createDebtPaymentInvoice(userId, 150);
      (retrieveInvoice as jest.Mock).mockResolvedValue({ status: 'PENDING', invoice_url: 'https://checkout.xendit.co/web/abc' });
      const second = await createDebtPaymentInvoice(userId, 200);
      expect(second).toMatchObject({ debtPaymentId: (first as any).debtPaymentId, amount: 150 });
      expect(createInvoice).toHaveBeenCalledTimes(1);
    });

    it('starts a fresh invoice once the old one expired', async () => {
      await setOwed(300);
      await createDebtPaymentInvoice(userId, 150);
      (retrieveInvoice as jest.Mock).mockResolvedValue({ status: 'EXPIRED' });
      await createDebtPaymentInvoice(userId, 150);
      expect(createInvoice).toHaveBeenCalledTimes(2);
    });
  });

  describe('when Xendit confirms payment', () => {
    async function openInvoice(owed: number, amount: number) {
      await setOwed(owed);
      const result = (await createDebtPaymentInvoice(userId, amount)) as { debtPaymentId: string };
      return result.debtPaymentId;
    }

    it('lowers the debt by a partial payment and keeps the hold', async () => {
      const id = await openInvoice(300, 150);
      await setOwed(300, { debtHoldAt: new Date() });
      expect(await finalizeDebtPayment(id, 150, new Date())).toBe(true);
      const p = await profile();
      expect(p.commissionOwed).toBe(150);
      expect(p.debtHoldAt).not.toBeNull();
      const entry = await prisma.debtLedgerEntry.findFirstOrThrow({ where: { workerProfileId, type: 'DEBT_PAYMENT' } });
      expect(entry.amount).toBe(-150);
      expect((await prisma.debtPayment.findUniqueOrThrow({ where: { id } })).status).toBe('PAID');
    });

    it('clears the hold only when the debt reaches zero', async () => {
      const id = await openInvoice(300, 300);
      await setOwed(300, { debtHoldAt: new Date() });
      await finalizeDebtPayment(id, 300, new Date());
      const p = await profile();
      expect(p.commissionOwed).toBe(0);
      expect(p.debtHoldAt).toBeNull();
    });

    it('does not double-apply a replayed webhook', async () => {
      const id = await openInvoice(300, 150);
      expect(await finalizeDebtPayment(id, 150, new Date())).toBe(true);
      expect(await finalizeDebtPayment(id, 150, new Date())).toBe(false);
      expect((await profile()).commissionOwed).toBe(150);
      expect(await prisma.debtLedgerEntry.count({ where: { workerProfileId, type: 'DEBT_PAYMENT' } })).toBe(1);
    });

    it('turns the excess into payout credit if a payout netted the debt during checkout', async () => {
      const id = await openInvoice(300, 300);
      await setOwed(50); // a payout recovered 250 while the worker was paying
      await finalizeDebtPayment(id, 300, new Date());
      const p = await profile();
      expect(p.commissionOwed).toBe(0);
      expect(p.compensationCredit).toBe(250);
    });
  });
});
