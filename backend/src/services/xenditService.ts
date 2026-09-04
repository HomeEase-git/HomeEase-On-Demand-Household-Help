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
  externalId: string; // Payment.id — echoed back on the webhook as external_id
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

// Xendit's fixed reason enum for the Refunds API — arbitrary client-supplied
// text (e.g. a client's free-text cancellation reason) does not fit here and
// must be mapped to 'OTHERS'; the free text itself still belongs in our own
// Payment.refundReason column, not in this API call.
export type XenditRefundReason = 'FRAUDULENT' | 'DUPLICATE' | 'REQUESTED_BY_CUSTOMER' | 'CANCELLATION' | 'OTHERS';

interface CreateRefundParams {
  xenditInvoiceId: string;
  amountPesos: number;
  reason?: XenditRefundReason;
}

export interface XenditRefund {
  id: string;
  invoice_id: string;
  amount: number;
  currency: string;
  status: 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED';
  failure_code: string | null;
}

/**
 * Request/response shape confirmed 2026-08-22 against Xendit's public API
 * reference and official Node SDK docs (POST /refunds, keyed by invoice_id,
 * fixed `reason` enum, `currency` required alongside `amount`). Not yet
 * exercised against a live sandbox call — do one real test-mode refund with
 * real API keys before fully trusting this in production.
 */
export async function createRefund(params: CreateRefundParams): Promise<XenditRefund> {
  const res = await secretClient().post('/refunds', {
    invoice_id: params.xenditInvoiceId,
    amount: params.amountPesos,
    currency: 'PHP',
    reason: params.reason ?? 'REQUESTED_BY_CUSTOMER',
  });

  return res.data;
}
