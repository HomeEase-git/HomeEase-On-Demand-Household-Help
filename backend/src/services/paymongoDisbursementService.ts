import axios from 'axios';

const PAYMONGO_TRANSFER_API_BASE = 'https://api.paymongo.com/v2';

function secretClient() {
  const key = process.env.PAYMONGO_SECRET_KEY;
  if (!key) throw new Error('PAYMONGO_SECRET_KEY is not configured');

  return axios.create({
    baseURL: PAYMONGO_TRANSFER_API_BASE,
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${key}:`).toString('base64'),
      'Content-Type': 'application/json',
    },
  });
}

// InstaPay is near-real-time but caps a single transfer at PHP 50,000;
// PESONet has no such cap but settles next business day instead.
const INSTAPAY_MAX_PESOS = 50_000;

type TransferProvider = 'instapay' | 'pesonet';

function providerFor(amountPesos: number): TransferProvider {
  return amountPesos > INSTAPAY_MAX_PESOS ? 'pesonet' : 'instapay';
}

interface ReceivingInstitution {
  name: string;
  bic: string;
}

// PayMongo doesn't publish static bank/e-wallet codes — the destination
// `bic` must be looked up by name via GET /transfers/receiving_institutions
// and matched against the worker's payout channel. Cached per-process per
// provider since this list changes rarely.
const institutionCache = new Map<TransferProvider, ReceivingInstitution[]>();

async function fetchReceivingInstitutions(provider: TransferProvider): Promise<ReceivingInstitution[]> {
  const cached = institutionCache.get(provider);
  if (cached) return cached;

  const res = await secretClient().get('/transfers/receiving_institutions', { params: { provider } });
  const raw = res.data?.data ?? res.data ?? [];
  const institutions: ReceivingInstitution[] = raw.map((entry: any) => ({
    name: entry.name ?? entry.attributes?.name,
    bic: entry.bic ?? entry.provider_code ?? entry.attributes?.bic,
  }));

  institutionCache.set(provider, institutions);
  return institutions;
}

// GCash/Maya are the only supported payout channels.
const INSTITUTION_NAME_FRAGMENT_BY_METHOD: Record<string, string> = {
  GCASH: 'gcash',
  MAYA: 'maya', // matches both "Maya" and legacy "PayMaya" naming
};

/**
 * Resolves a worker's payout channel to the destination `bic` PayMongo's
 * Transfers API expects, by matching against the live receiving-institutions
 * list for the rail this amount will use — PayMongo doesn't expose a fixed
 * code, and guessing one risks misrouting a real transfer.
 */
export async function paymongoDestinationBicFor(methodType: string, amountPesos: number): Promise<string | null> {
  const fragment = INSTITUTION_NAME_FRAGMENT_BY_METHOD[methodType];
  if (!fragment) return null;

  const institutions = await fetchReceivingInstitutions(providerFor(amountPesos));
  const match = institutions.find((i) => i.name?.toLowerCase().includes(fragment));
  return match?.bic ?? null;
}

interface CreateTransferParams {
  referenceNumber: string; // Payout.id — used as the Idempotency-Key so a retried job doesn't create a duplicate transfer
  amountPesos: number;
  destinationBic: string;
  accountNumber: string;
  accountHolderName: string;
  description: string;
  callbackUrl: string;
}

interface PaymongoTransfer {
  id: string;
  status: string;
}

// PayMongo's own wallet BIC, per their Send Money docs — constant across all transfers.
const PAYMONGO_WALLET_BIC = 'PAEYPHM2XXX';

/**
 * Sends money to a worker's GCash/Maya account via PayMongo's Disbursements
 * product (Wallet -> InstaPay/PESONet). Paired with paymongoService for the
 * collection leg (client -> platform); this is the disbursement leg
 * (platform -> worker). `referenceNumber` is Payout.id, reused as the
 * Idempotency-Key so a retried BullMQ job or admin manual retry doesn't
 * create a duplicate transfer.
 */
export async function createTransfer(params: CreateTransferParams): Promise<PaymongoTransfer> {
  const walletAccountNumber = process.env.PAYMONGO_WALLET_ACCOUNT_NUMBER;
  const walletAccountName = process.env.PAYMONGO_WALLET_ACCOUNT_NAME;
  if (!walletAccountNumber || !walletAccountName) {
    throw new Error('PAYMONGO_WALLET_ACCOUNT_NUMBER / PAYMONGO_WALLET_ACCOUNT_NAME is not configured');
  }

  const res = await secretClient().post(
    '/batch_transfers',
    {
      transfers: [
        {
          source_account: {
            number: walletAccountNumber,
            name: walletAccountName,
            bic: PAYMONGO_WALLET_BIC,
          },
          destination_account: {
            number: params.accountNumber,
            name: params.accountHolderName,
            bic: params.destinationBic,
          },
          amount: Math.round(params.amountPesos * 100),
          currency: 'PHP',
          provider: providerFor(params.amountPesos),
          description: params.description,
          reference_number: params.referenceNumber,
          callback_url: params.callbackUrl,
        },
      ],
    },
    { headers: { 'Idempotency-Key': params.referenceNumber } }
  );

  const transfer = res.data?.transfers?.[0];
  return { id: transfer.id, status: transfer.status };
}

export async function retrieveTransfer(transferId: string): Promise<PaymongoTransfer> {
  const res = await secretClient().get(`/transfers/${transferId}`);
  const data = res.data?.data ?? res.data;
  return { id: data.id, status: data.status };
}
