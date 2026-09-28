import axios from 'axios';

const XENDIT_API_BASE = 'https://api.xendit.co';

function secretClient() {
  const key = process.env.XENDIT_SECRET_KEY;
  if (!key) throw new Error('XENDIT_SECRET_KEY is not configured');
  return axios.create({
    baseURL: XENDIT_API_BASE,
    headers: { Authorization: 'Basic ' + Buffer.from(`${key}:`).toString('base64') },
    timeout: 20_000,
  });
}

/**
 * One movement on the Xendit account, as its Transactions API reports it.
 * Confirmed against the sandbox 2026-09-28: a ₱100 GCash payment has
 * net_amount 87.68 (fee ₱11 + ₱1.32 VAT taken out), a ₱100 payout has
 * net_amount 129.12 (₱26 + ₱3.12 VAT added), and reference_id is our own
 * Payment.id (invoice external_id, also on its refunds) or Payout.id.
 */
export interface XenditTransaction {
  id: string;
  type: string; // PAYMENT, DISBURSEMENT, REFUND, PROCESSING_FEE_DEDUCTION, ...
  status: string; // SUCCESSFUL, PENDING, FAILED, ...
  referenceId: string;
  cashflow: 'MONEY_IN' | 'MONEY_OUT';
  amount: number;
  netAmount: number;
  created: Date;
}

/** What a transaction moved on the balance, in centavos (in +, out −). */
export function balanceEffectCentavos(t: XenditTransaction): number {
  const net = Math.round(t.netAmount * 100);
  return t.cashflow === 'MONEY_IN' ? net : -net;
}

/** Xendit's fee on a transaction, in centavos: what the net differs from the amount by. */
export function feeCentavos(t: XenditTransaction): number {
  return Math.abs(Math.round(t.netAmount * 100) - Math.round(t.amount * 100));
}

/** All transactions created in [from, to), oldest first. Follows pagination. */
export async function listXenditTransactions(from: Date, to: Date, maxPages = 40): Promise<XenditTransaction[]> {
  const client = secretClient();
  const out: XenditTransaction[] = [];
  let afterId: string | undefined;
  for (let page = 0; page < maxPages; page++) {
    const res = await client.get('/transactions', {
      params: {
        limit: 50,
        'created[gte]': from.toISOString(),
        'created[lt]': to.toISOString(),
        ...(afterId ? { after_id: afterId } : {}),
      },
    });
    const rows: any[] = res.data?.data ?? [];
    for (const t of rows) {
      out.push({
        id: t.id,
        type: t.type,
        status: t.status,
        referenceId: t.reference_id,
        cashflow: t.cashflow,
        amount: Number(t.amount),
        netAmount: Number(t.net_amount),
        created: new Date(t.created),
      });
    }
    if (!res.data?.has_more || rows.length === 0) break;
    afterId = rows[rows.length - 1].id;
  }
  return out.sort((a, b) => a.created.getTime() - b.created.getTime());
}

/** Current Xendit cash balance in centavos. */
export async function getXenditBalanceCentavos(): Promise<number> {
  const res = await secretClient().get('/balance');
  return Math.round(Number(res.data?.balance ?? 0) * 100);
}
