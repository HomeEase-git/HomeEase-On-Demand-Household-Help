import { roundToCentavo } from '@utils/money';

export type InvoiceItemKind = 'PART' | 'EXTRA_WORK';

export type InvoiceItemInput = {
  kind: InvoiceItemKind;
  name: string;
  price: number;
  photoUrls: string[];
};

const MAX_ITEMS = 20;
const MAX_PHOTOS = 5;
// Fat-finger backstop; the client still sees every line before paying.
const MAX_PRICE = 100_000;

// Each line is stored and shown to the centavo, so the lines add up to the
// total the client pays.
const isCentavos = (n: number) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-6;

type Result = { ok: true; items: InvoiceItemInput[] } | { ok: false; error: string };

/**
 * Shape and proof rules for the lines a worker adds to the invoice: parts need
 * a photo of the receipt, extra work a photo of the work. Ownership of the
 * photo URLs is checked separately (utils/storageUrls).
 */
export function validateInvoiceItems(raw: unknown): Result {
  if (raw === undefined || raw === null) return { ok: true, items: [] };
  if (!Array.isArray(raw)) return { ok: false, error: 'items must be a list' };
  if (raw.length > MAX_ITEMS) return { ok: false, error: `An invoice can have at most ${MAX_ITEMS} added lines` };

  const items: InvoiceItemInput[] = [];
  for (const entry of raw) {
    const e = (entry ?? {}) as Record<string, unknown>;
    if (e.kind !== 'PART' && e.kind !== 'EXTRA_WORK') return { ok: false, error: 'Each line must be a part or extra work' };
    const name = typeof e.name === 'string' ? e.name.trim() : '';
    if (!name || name.length > 120) return { ok: false, error: 'Each line needs a name (up to 120 characters)' };
    if (typeof e.price !== 'number' || !Number.isFinite(e.price) || e.price <= 0 || e.price > MAX_PRICE || !isCentavos(e.price)) {
      return { ok: false, error: `"${name}" needs a price between ₱0.01 and ₱${MAX_PRICE.toLocaleString('en-PH')}` };
    }
    const photoUrls = e.photoUrls ?? [];
    if (!Array.isArray(photoUrls) || photoUrls.length > MAX_PHOTOS || !photoUrls.every((u) => typeof u === 'string' && u.length > 0)) {
      return { ok: false, error: `"${name}" has invalid photos (up to ${MAX_PHOTOS})` };
    }
    if (photoUrls.length === 0) {
      return { ok: false, error: e.kind === 'PART' ? `"${name}" needs a photo of the receipt` : `"${name}" needs a photo of the work` };
    }
    items.push({ kind: e.kind, name, price: e.price, photoUrls: photoUrls as string[] });
  }
  return { ok: true, items };
}

export function sumInvoiceItems(items: { price: number }[]): number {
  return roundToCentavo(items.reduce((sum, i) => sum + i.price, 0));
}

export type InvoiceLine = { id: string | null; kind: string; name: string; price: number; photoUrls: string[] };

/**
 * The lines of a booking's invoice: the job, then every line that counts
 * toward the bill. A booking quoted before invoices existed shows its agreed
 * labor as the job and its quoted materials as parts.
 */
export function invoiceLines(booking: {
  serviceType: string;
  serviceTask: { name: string } | null;
  estimatedPrice: number;
  laborCost: number | null;
  materialsCost: number | null;
  quoteItems: { id: string; name: string; price: number; receiptUrls: string[] }[];
  addOns: { id: string; kind: string | null; name: string; price: number; photoUrls: string[]; clientApprovedAt: Date | null }[];
}): InvoiceLine[] {
  const hasQuote = booking.laborCost != null && booking.materialsCost != null;
  const lines: InvoiceLine[] = [
    {
      id: null,
      kind: 'JOB',
      name: booking.serviceTask?.name ?? booking.serviceType,
      price: hasQuote ? booking.laborCost! : booking.estimatedPrice,
      photoUrls: [],
    },
  ];
  if (hasQuote) {
    for (const item of booking.quoteItems) {
      lines.push({ id: item.id, kind: 'PART', name: item.name, price: item.price, photoUrls: item.receiptUrls });
    }
  }
  for (const addon of booking.addOns) {
    // Free job preferences aren't bill lines; unapproved or removed lines don't count.
    if (addon.clientApprovedAt == null || addon.price <= 0) continue;
    lines.push({
      id: addon.id,
      // Older rows have no kind: a priced one was a package or an approved extra.
      kind: addon.kind ?? 'EXTRA_WORK',
      name: addon.name,
      price: addon.price,
      photoUrls: addon.photoUrls,
    });
  }
  return lines;
}

/** Where the invoice stands, in the words the apps show. */
export function invoiceStatus(status: string, workerCompletedAt: Date | null): 'NOT_SENT' | 'DUE' | 'REPORTED' | 'PAID' | 'CANCELLED' {
  if (status === 'COMPLETED') return 'PAID';
  if (status === 'CANCELLED' || status === 'REJECTED') return 'CANCELLED';
  if (status === 'PENDING_COMPLETION' || status === 'AWAITING_PAYMENT') return 'DUE';
  if (status === 'DISPUTED' && workerCompletedAt) return 'REPORTED';
  return 'NOT_SENT';
}
