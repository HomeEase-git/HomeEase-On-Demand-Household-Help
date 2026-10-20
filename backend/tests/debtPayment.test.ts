jest.mock('@services/xenditService', () => ({
  ...jest.requireActual('@services/xenditService'),
  createInvoice: jest.fn(),
  retrieveInvoice: jest.fn(),
  findInvoiceByExternalId: jest.fn(),
}));

import prisma from '@config/database';
import {
  createDebtPaymentInvoice,
  finalizeDebtPayment,
  reconcilePendingDebtPayment,
  reconcileStalePendingDebtPayments,
  resolveAmount,
  DebtPaymentError,
} from '@services/debtPaymentService';
import { createTestUser, deleteTestUser } from './helpers';
import { ownerDb } from './ownerDb';

const { createInvoice, retrieveInvoice, findInvoiceByExternalId } = require('@services/xenditService');

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
    // Unless a test says otherwise, Xendit can't be asked, so nothing is retired by accident.
    (findInvoiceByExternalId as jest.Mock).mockReset().mockRejectedValue(new Error('xendit unreachable'));
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

  describe('an interrupted checkout (row saved, invoice id never saved)', () => {
    const MIN = 60 * 1000;
    /** A PENDING row with no invoice id, as left behind by a server that stopped mid-checkout. */
    const stuckRow = (ageMinutes: number, amount = 150) =>
      ownerDb.debtPayment.create({
        data: { workerProfileId, amount, createdAt: new Date(Date.now() - ageMinutes * MIN) },
      });

    it('leaves a recent row alone because another request may still be talking to Xendit', async () => {
      await setOwed(300);
      await stuckRow(1);
      await expect(createDebtPaymentInvoice(userId, 150)).rejects.toThrow(/already being set up/);
      expect(findInvoiceByExternalId).not.toHaveBeenCalled();
      expect(createInvoice).not.toHaveBeenCalled();
    });

    it('attaches the invoice Xendit already created, so it is paid once and credited', async () => {
      await setOwed(300);
      const row = await stuckRow(10);
      (findInvoiceByExternalId as jest.Mock).mockResolvedValue({
        id: 'inv_orphan_1',
        status: 'PENDING',
        invoice_url: 'https://checkout.xendit.co/web/orphan',
      });
      (retrieveInvoice as jest.Mock).mockResolvedValue({ status: 'PENDING', invoice_url: 'https://checkout.xendit.co/web/orphan' });

      const result = await createDebtPaymentInvoice(userId, 150);

      expect(result).toMatchObject({ debtPaymentId: row.id, checkoutUrl: 'https://checkout.xendit.co/web/orphan' });
      expect(createInvoice).not.toHaveBeenCalled();
      expect((await prisma.debtPayment.findUniqueOrThrow({ where: { id: row.id } })).xenditInvoiceId).toBe('inv_orphan_1');
    });

    it('retires the row when Xendit has no invoice for it, then starts a fresh one', async () => {
      await setOwed(300);
      const row = await stuckRow(10);
      (findInvoiceByExternalId as jest.Mock).mockResolvedValue(null);

      const result = (await createDebtPaymentInvoice(userId, 150)) as { debtPaymentId: string };

      const old = await prisma.debtPayment.findUniqueOrThrow({ where: { id: row.id } });
      expect(old.status).toBe('FAILED');
      expect(old.failureReason).toMatch(/interrupted/);
      expect(result.debtPaymentId).not.toBe(row.id);
      expect(createInvoice).toHaveBeenCalledTimes(1);
    });

    it('does not retire the row when Xendit cannot be asked', async () => {
      await setOwed(300);
      const row = await stuckRow(10);
      // beforeEach already makes the lookup reject.
      await expect(createDebtPaymentInvoice(userId, 150)).rejects.toThrow(/unreachable/);
      expect((await prisma.debtPayment.findUniqueOrThrow({ where: { id: row.id } })).status).toBe('PENDING');
      expect(createInvoice).not.toHaveBeenCalled();
    });
  });

  describe('a missed Xendit webhook', () => {
    async function openInvoice(owed: number, amount: number) {
      await setOwed(owed);
      return ((await createDebtPaymentInvoice(userId, amount)) as { debtPaymentId: string }).debtPaymentId;
    }
    const paidNow = (amount: number) => ({ status: 'PAID', paid_amount: amount, paid_at: new Date().toISOString() });

    it('books a payment Xendit says is paid, once', async () => {
      const id = await openInvoice(300, 150);
      (retrieveInvoice as jest.Mock).mockResolvedValue(paidNow(150));

      expect(await reconcilePendingDebtPayment(id)).toBe('paid');
      expect((await profile()).commissionOwed).toBe(150);
      expect((await prisma.debtPayment.findUniqueOrThrow({ where: { id } })).status).toBe('PAID');

      // Running it again changes nothing.
      expect(await reconcilePendingDebtPayment(id)).toBe('pending');
      expect((await profile()).commissionOwed).toBe(150);
      expect(await prisma.debtLedgerEntry.count({ where: { workerProfileId, type: 'DEBT_PAYMENT' } })).toBe(1);
    });

    it('retires an invoice that expired, so a new one can be started', async () => {
      const id = await openInvoice(300, 150);
      (retrieveInvoice as jest.Mock).mockResolvedValue({ status: 'EXPIRED' });

      expect(await reconcilePendingDebtPayment(id)).toBe('failed');
      expect((await prisma.debtPayment.findUniqueOrThrow({ where: { id } })).status).toBe('EXPIRED');
      expect((await profile()).commissionOwed).toBe(300);
    });

    it('leaves a still-open invoice alone', async () => {
      const id = await openInvoice(300, 150);
      (retrieveInvoice as jest.Mock).mockResolvedValue({ status: 'PENDING' });

      expect(await reconcilePendingDebtPayment(id)).toBe('pending');
      expect((await prisma.debtPayment.findUniqueOrThrow({ where: { id } })).status).toBe('PENDING');
    });

    it('credits a payment made on an invoice whose id was never saved', async () => {
      await setOwed(300);
      const row = await ownerDb.debtPayment.create({
        data: { workerProfileId, amount: 150, createdAt: new Date(Date.now() - 10 * 60 * 1000) },
      });
      (findInvoiceByExternalId as jest.Mock).mockResolvedValue({ id: 'inv_orphan_paid', status: 'PAID' });
      (retrieveInvoice as jest.Mock).mockResolvedValue(paidNow(150));

      expect(await reconcilePendingDebtPayment(row.id)).toBe('paid');
      expect((await profile()).commissionOwed).toBe(150);
    });

    it('the sweep step reconciles only payments older than the cutoff', async () => {
      const oldId = await openInvoice(300, 150);
      await ownerDb.debtPayment.update({ where: { id: oldId }, data: { createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000) } });
      (retrieveInvoice as jest.Mock).mockResolvedValue(paidNow(150));
      const cutoff = () => new Date(Date.now() - 60 * 60 * 1000);

      expect(await reconcileStalePendingDebtPayments(cutoff())).toContainEqual({ debtPaymentId: oldId, result: 'paid' });

      // A fresh row is newer than the cutoff and is not touched.
      const freshId = await openInvoice(300, 150);
      const again = await reconcileStalePendingDebtPayments(cutoff());
      expect(again.find((c) => c.debtPaymentId === freshId)).toBeUndefined();
      expect((await prisma.debtPayment.findUniqueOrThrow({ where: { id: freshId } })).status).toBe('PENDING');
    });
  });
});
