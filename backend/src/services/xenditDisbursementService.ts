import axios from 'axios';

const XENDIT_API_BASE = 'https://api.xendit.co';

function secretClient() {
  const key = process.env.XENDIT_SECRET_KEY;
  if (!key) throw new Error('XENDIT_SECRET_KEY is not configured');

  return axios.create({
    baseURL: XENDIT_API_BASE,
    // Bounded: a hung request would otherwise hold a payout in PROCESSING
    // with no disbursement id until the process dies.
    timeout: 30_000,
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${key}:`).toString('base64'),
      'Content-Type': 'application/json',
    },
  });
}

// Static enum, unlike PayMongo which required a live receiving-institutions
// lookup (paymongoDestinationBicFor/fetchReceivingInstitutions/
// institutionCache) — Xendit publishes fixed channel codes.
const CHANNEL_CODE_BY_METHOD: Record<string, string> = {
  GCASH: 'PH_GCASH',
  MAYA: 'PH_PAYMAYA',
};

export function xenditChannelCodeFor(methodType: string): string | null {
  return CHANNEL_CODE_BY_METHOD[methodType] ?? null;
}

interface CreatePayoutParams {
  referenceId: string; // Payout.id — Xendit's reference_id, which the payout webhook matches on
  idempotencyKey: string; // Payout.id (+ retry generation) — so a retried BullMQ job can't create a duplicate payout
  amountPesos: number; // decimal PHP pesos, not centavos
  channelCode: string; // e.g. 'PH_GCASH' — from xenditChannelCodeFor
  accountNumber: string;
  accountHolderName: string;
  description: string;
}

interface XenditPayout {
  id: string; // e.g. "disb-..."
  status: string; // 'ACCEPTED' synchronously; final state ('COMPLETED'/'FAILED') arrives via the payout webhook
  estimatedArrivalTime: string | null;
}

/**
 * Sends money to a worker's GCash/Maya account via Xendit's Payouts API
 * (platform balance -> destination e-wallet). No source-account object is
 * needed (unlike PayMongo's wallet BIC/account-number/name) — Xendit payouts
 * draw from the account balance directly. No callback_url is passed either —
 * confirmed by a hand-validated manual test succeeding without one; Xendit's
 * payout webhook is configured once, account-wide, in the dashboard, not
 * per-request.
 */
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

// Xendit has accepted (or already paid) these — another send would pay twice.
const LIVE_PAYOUT_STATUSES = new Set(['ACCEPTED', 'REQUESTED', 'SUCCEEDED', 'COMPLETED']);

/**
 * The live Xendit payout for a reference_id (our Payout.id), if any. Used
 * before resending a payout whose earlier attempt may have reached Xendit
 * without us recording its id (crash or timeout mid-request).
 * Endpoint per Xendit's Payouts v2 reference (GET /v2/payouts?reference_id=)
 * — confirm in the sandbox.
 */
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

/**
 * Cancels a payout Xendit hasn't handed to the e-wallet yet. Xendit only
 * allows this while the payout is still ACCEPTED; once it's REQUESTED or
 * SUCCEEDED the call errors and the money can only come back by clawback.
 * Endpoint per Xendit's Payouts v2 reference — confirm in the sandbox.
 */
export async function cancelPayout(payoutId: string): Promise<XenditPayout> {
  const res = await secretClient().post(`/v2/payouts/${payoutId}/cancel`);
  return {
    id: res.data.id,
    status: res.data.status,
    estimatedArrivalTime: res.data.estimated_arrival_time ?? null,
  };
}
