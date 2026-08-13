import axios from 'axios';

const PAYMONGO_API_BASE = 'https://api.paymongo.com/v1';

function secretClient() {
  const key = process.env.PAYMONGO_SECRET_KEY;
  if (!key) throw new Error('PAYMONGO_SECRET_KEY is not configured');

  return axios.create({
    baseURL: PAYMONGO_API_BASE,
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${key}:`).toString('base64'),
      'Content-Type': 'application/json',
    },
  });
}

export type PaymongoSourceType = 'gcash' | 'paymaya';

interface CreateSourceParams {
  amountPesos: number;
  type: PaymongoSourceType;
  description: string;
  successRedirect: string;
  failedRedirect: string;
}

interface PaymongoSource {
  id: string;
  status: string;
  checkoutUrl: string;
}

/**
 * Creates a PayMongo Source (GCash/Maya) and returns its hosted checkout URL.
 * Amounts are in centavos on PayMongo's side, so pesos are multiplied by 100.
 */
export async function createSource(params: CreateSourceParams): Promise<PaymongoSource> {
  const res = await secretClient().post('/sources', {
    data: {
      attributes: {
        amount: Math.round(params.amountPesos * 100),
        currency: 'PHP',
        type: params.type,
        description: params.description,
        redirect: {
          success: params.successRedirect,
          failed: params.failedRedirect,
        },
      },
    },
  });

  const data = res.data.data;
  return {
    id: data.id,
    status: data.attributes.status,
    checkoutUrl: data.attributes.redirect.checkout_url,
  };
}

export async function retrieveSource(sourceId: string) {
  const res = await secretClient().get(`/sources/${sourceId}`);
  return res.data.data;
}

interface CreateSourcePaymentParams {
  amountPesos: number;
  sourceId: string;
  description: string;
}

/**
 * Charges a chargeable Source, i.e. actually captures the money. Called from
 * the webhook once PayMongo reports the source as `chargeable`.
 */
export async function createSourcePayment(params: CreateSourcePaymentParams) {
  const res = await secretClient().post('/payments', {
    data: {
      attributes: {
        amount: Math.round(params.amountPesos * 100),
        currency: 'PHP',
        description: params.description,
        source: {
          id: params.sourceId,
          type: 'source',
        },
      },
    },
  });

  return res.data.data;
}

interface CreateRefundParams {
  paymongoPaymentId: string;
  amountPesos: number;
  notes?: string;
}

/**
 * Refunds a previously-charged PayMongo Payment (the resource created by
 * createSourcePayment for GCash/Maya) — used when escrow needs to be
 * released back to the client after money has already actually moved, as
 * opposed to voiding an authorization that was never captured/charged.
 */
export async function createRefund(params: CreateRefundParams) {
  const res = await secretClient().post('/refunds', {
    data: {
      attributes: {
        amount: Math.round(params.amountPesos * 100),
        payment_id: params.paymongoPaymentId,
        reason: 'others',
        notes: params.notes,
      },
    },
  });

  return res.data.data;
}
