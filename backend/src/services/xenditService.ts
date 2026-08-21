import axios from 'axios';

const XENDIT_API_BASE = 'https://api.xendit.co';

function secretClient() {
  const key = process.env.XENDIT_SECRET_KEY;
  if (!key) throw new Error('XENDIT_SECRET_KEY is not configured');

  return axios.create({
    baseURL: XENDIT_API_BASE,
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${key}:`).toString('base64'),
      'Content-Type': 'application/json',
    },
  });
}

interface CreateInvoiceParams {
  externalId: string; // Payment.id (or a wallet-topup id) — echoed back on the webhook as external_id
  amountPesos: number; // decimal PHP pesos — Xendit invoices do NOT use centavos, unlike PayMongo
  description: string;
  payerEmail?: string;
  successRedirectUrl: string;
  failureRedirectUrl: string;
}

interface XenditInvoice {
  id: string;
  status: string; // 'PENDING' at creation
  invoiceUrl: string;
}

/**
 * Creates a Xendit hosted Invoice covering all PH payment methods
 * (GCash/Maya/GrabPay/ShopeePay/card/QRPH/etc in one checkout) and returns
 * its hosted checkout URL. Replaces PayMongo's Source->Payment two-step —
 * Xendit invoices capture atomically, there is no separate "charge" call.
 */
export async function createInvoice(params: CreateInvoiceParams): Promise<XenditInvoice> {
  const res = await secretClient().post('/v2/invoices', {
    external_id: params.externalId,
    amount: params.amountPesos,
    currency: 'PHP',
    description: params.description,
    ...(params.payerEmail ? { payer_email: params.payerEmail } : {}),
    success_redirect_url: params.successRedirectUrl,
    failure_redirect_url: params.failureRedirectUrl,
  });

  return {
    id: res.data.id,
    status: res.data.status,
    invoiceUrl: res.data.invoice_url,
  };
}

export async function retrieveInvoice(invoiceId: string) {
  const res = await secretClient().get(`/v2/invoices/${invoiceId}`);
  return res.data;
}

interface CreateRefundParams {
  xenditInvoiceId: string;
  amountPesos: number;
  reason?: string;
}

/**
 * UNCONFIRMED — Xendit's Refunds API shape could not be validated against
 * live docs (network-blocked when this was built; only Invoices and Payouts
 * were hand-tested via curl). Targets Xendit's unified /refunds endpoint
 * keyed by invoice_id. Confirm the exact request/response shape against a
 * real sandbox refund before relying on this in production.
 */
export async function createRefund(params: CreateRefundParams) {
  const res = await secretClient().post('/refunds', {
    invoice_id: params.xenditInvoiceId,
    amount: params.amountPesos,
    reason: params.reason ?? 'REQUESTED_BY_CUSTOMER',
  });

  return res.data;
}
