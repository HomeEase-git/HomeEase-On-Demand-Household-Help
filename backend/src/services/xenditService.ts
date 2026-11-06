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
  externalId: string;
  amountPesos: number;
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

export async function expireInvoice(invoiceId: string) {
  const res = await secretClient().post(`/invoices/${invoiceId}/expire!`);
  return res.data;
}

export async function retrieveInvoice(invoiceId: string) {
  const res = await secretClient().get(`/v2/invoices/${invoiceId}`);
  return res.data;
}

export async function findInvoiceByExternalId(externalId: string): Promise<{ id: string; status?: string; invoice_url?: string } | null> {
  const res = await secretClient().get('/v2/invoices', { params: { external_id: externalId } });
  const list: Array<{ id?: string; external_id?: string; status?: string; invoice_url?: string }> = Array.isArray(res.data)
    ? res.data
    : Array.isArray(res.data?.data)
      ? res.data.data
      : [];
  const match = list.find((invoice) => invoice.id && (!invoice.external_id || invoice.external_id === externalId));
  return match ? { id: match.id as string, status: match.status, invoice_url: match.invoice_url } : null;
}

export type XenditRefundReason = 'FRAUDULENT' | 'DUPLICATE' | 'REQUESTED_BY_CUSTOMER' | 'CANCELLATION' | 'OTHERS';

interface CreateRefundParams {
  xenditInvoiceId: string;
  amountPesos: number;
  reason?: XenditRefundReason;
  idempotencyKey: string;
}

export interface XenditRefund {
  id: string;
  invoice_id: string;
  amount: number;
  currency: string;
  status: 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED';
  failure_code: string | null;
}

export async function createRefund(params: CreateRefundParams): Promise<XenditRefund> {
  const res = await secretClient().post(
    '/refunds',
    {
      invoice_id: params.xenditInvoiceId,
      amount: params.amountPesos,
      currency: 'PHP',
      reason: params.reason ?? 'REQUESTED_BY_CUSTOMER',
    },
    { headers: { 'Idempotency-key': params.idempotencyKey } }
  );

  return res.data;
}

export async function retrieveRefund(refundId: string): Promise<XenditRefund> {
  const res = await secretClient().get(`/refunds/${refundId}`);
  return res.data;
}
