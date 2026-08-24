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
  referenceId: string; // Payout.id — used as reference_id AND the Idempotency-key, so a retried BullMQ job or admin retry can't create a duplicate payout
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
    { headers: { 'Idempotency-key': params.referenceId } }
  );

  return {
    id: res.data.id,
    status: res.data.status,
    estimatedArrivalTime: res.data.estimated_arrival_time ?? null,
  };
}

export async function retrievePayout(payoutId: string): Promise<XenditPayout> {
  const res = await secretClient().get(`/v2/payouts/${payoutId}`);
  return {
    id: res.data.id,
    status: res.data.status,
    estimatedArrivalTime: res.data.estimated_arrival_time ?? null,
  };
}
