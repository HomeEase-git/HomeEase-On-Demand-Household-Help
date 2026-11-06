import axios from 'axios';

const XENDIT_API_BASE = 'https://api.xendit.co';

function secretClient() {
  const key = process.env.XENDIT_SECRET_KEY;
  if (!key) throw new Error('XENDIT_SECRET_KEY is not configured');

  return axios.create({
    baseURL: XENDIT_API_BASE,
    timeout: 30_000,
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${key}:`).toString('base64'),
      'Content-Type': 'application/json',
    },
  });
}

const CHANNEL_CODE_BY_METHOD: Record<string, string> = {
  GCASH: 'PH_GCASH',
  MAYA: 'PH_PAYMAYA',
};

export function xenditChannelCodeFor(methodType: string): string | null {
  return CHANNEL_CODE_BY_METHOD[methodType] ?? null;
}

interface CreatePayoutParams {
  referenceId: string;
  idempotencyKey: string;
  amountPesos: number; // decimal PHP pesos, not centavos
  channelCode: string; // e.g. 'PH_GCASH' — from xenditChannelCodeFor
  accountNumber: string;
  accountHolderName: string;
  description: string;
}

interface XenditPayout {
  id: string; // e.g. "disb-..."
  status: string;
  estimatedArrivalTime: string | null;
}

export async function createPayout(params: CreatePayoutParams): Promise<XenditPayout> {
  const res = await secretClient().post(
    '/v2/payouts',
    {
      reference_id: params.referenceId,
      channel_code: params.channelCode,
      channel_properties: {
        account_holder_name: params.accountHolderName,
        account_number: params.accountNumber,
      },
      amount: params.amountPesos,
      currency: 'PHP',
      description: params.description,
    },
    { headers: { 'Idempotency-key': params.idempotencyKey } }
  );

  return {
    id: res.data.id,
    status: res.data.status,
    estimatedArrivalTime: res.data.estimated_arrival_time ?? null,
  };
}

const LIVE_PAYOUT_STATUSES = new Set(['ACCEPTED', 'REQUESTED', 'SUCCEEDED', 'COMPLETED']);

export async function findLivePayoutByReference(referenceId: string): Promise<XenditPayout | null> {
  const res = await secretClient().get('/v2/payouts', { params: { reference_id: referenceId } });
  const list: any[] = Array.isArray(res.data) ? res.data : Array.isArray(res.data?.data) ? res.data.data : [];
  const live = list.find((p) => LIVE_PAYOUT_STATUSES.has(String(p?.status).toUpperCase()));
  return live ? { id: live.id, status: live.status, estimatedArrivalTime: live.estimated_arrival_time ?? null } : null;
}

export async function retrievePayout(payoutId: string): Promise<XenditPayout> {
  const res = await secretClient().get(`/v2/payouts/${payoutId}`);
  return {
    id: res.data.id,
    status: res.data.status,
    estimatedArrivalTime: res.data.estimated_arrival_time ?? null,
  };
}

export async function cancelPayout(payoutId: string): Promise<XenditPayout> {
  const res = await secretClient().post(`/v2/payouts/${payoutId}/cancel`);
  return {
    id: res.data.id,
    status: res.data.status,
    estimatedArrivalTime: res.data.estimated_arrival_time ?? null,
  };
}
