import { roundToCentavo } from '@utils/money';

export type QuoteItemInput = {
  name: string;
  price: number;
  receiptUrls: string[];
  proofOfUseUrls: string[];
};

const MAX_ITEMS = 20;
const MAX_PHOTOS = 5;
// Fat-finger backstop; the client still approves the total.
const MAX_PRICE = 500_000;

type Result = { ok: true; items: QuoteItemInput[] } | { ok: false; error: string };

const isUrlArray = (v: unknown): v is string[] =>
  Array.isArray(v) && v.length <= MAX_PHOTOS && v.every((u) => typeof u === 'string' && u.length > 0);

/** Shape + proof rules for worker quote items. Ownership of the URLs is checked separately. */
export function validateQuoteItems(raw: unknown): Result {
  if (!Array.isArray(raw)) return { ok: false, error: 'items must be an array' };
  if (raw.length > MAX_ITEMS) return { ok: false, error: `A quote can have at most ${MAX_ITEMS} items` };

  const items: QuoteItemInput[] = [];
  for (const entry of raw) {
    const e = (entry ?? {}) as Record<string, unknown>;
    const name = typeof e.name === 'string' ? e.name.trim() : '';
    if (!name || name.length > 120) return { ok: false, error: 'Each item needs a name (up to 120 characters)' };
    if (typeof e.price !== 'number' || !Number.isFinite(e.price) || e.price <= 0 || e.price > MAX_PRICE) {
      return { ok: false, error: `"${name}" needs a price between ₱0.01 and ₱${MAX_PRICE.toLocaleString('en-PH')}` };
    }
    const receiptUrls = e.receiptUrls ?? [];
    const proofOfUseUrls = e.proofOfUseUrls ?? [];
    if (!isUrlArray(receiptUrls) || !isUrlArray(proofOfUseUrls)) {
      return { ok: false, error: `"${name}" has invalid photos (up to ${MAX_PHOTOS} each)` };
    }
    if (receiptUrls.length === 0) return { ok: false, error: `"${name}" needs a photo of the receipt` };
    if (proofOfUseUrls.length === 0) return { ok: false, error: `"${name}" needs a photo of it in use on the job` };
    items.push({ name, price: e.price, receiptUrls, proofOfUseUrls });
  }
  return { ok: true, items };
}

export function sumQuoteItems(items: { price: number }[]): number {
  return roundToCentavo(items.reduce((sum, i) => sum + i.price, 0));
}
