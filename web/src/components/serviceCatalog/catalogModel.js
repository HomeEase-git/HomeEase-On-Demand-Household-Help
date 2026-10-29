// Converts between the admin API's service-type shape and the job order
// editor's draft. See backend/src/controllers/adminCatalogController.ts for
// the save endpoint this feeds. Booking questions are retired: a per-piece
// job asks the client only how many, within the job's own limits.

let seq = 0
export const newKey = (prefix) => `${prefix}-${Date.now().toString(36)}-${++seq}`

// Prices are set here only; workers can't change them. Two ways to price a
// job. (The old "worker price steps" model is retired — a saved one opens as
// price per piece; custom quotes are gone, extras go on the worker's invoice.)
export const PRICING_MODELS = {
  FIXED: { label: 'Flat price', hint: 'One price for the whole job or visit.' },
  PER_UNIT: { label: 'Price per piece', hint: 'The client enters how many, e.g. outlets, rooms, kilos.' },
}

export const COMMON_UNITS = ['job', 'visit', 'unit', 'piece', 'item', 'room', 'door', 'basket', 'set', 'sq.m.', 'house', 'area', 'line', 'trip', 'kilo']

export const usesCount = (model) => model === 'PER_UNIT'

export function formatPeso(amount) {
  const num = Number(amount)
  if (!Number.isFinite(num)) return '—'
  return `₱${num.toLocaleString('en-PH', { maximumFractionDigits: 2 })}`
}

const blankToNull = (v) => (v === '' || v == null ? null : Number(v))

/** "1 to 5", "at least 10", or "" — the count a client can book. */
export function countRange(job) {
  const min = blankToNull(job.minQty)
  const max = blankToNull(job.maxQty)
  if (max != null) return `${min ?? 1} to ${max}`
  if (min != null && min > 1) return `at least ${min}`
  return ''
}

export function emptyDraft() {
  return {
    details: { name: '', description: '', basePrice: '', icon: null, backgroundImageUrl: null, requiresCertification: false },
    jobs: [],
  }
}

export function serviceToDraft(service) {
  const jobs = (service.tasks || []).map((t) => ({
    ref: t.id,
    id: t.id,
    name: t.name,
    description: t.description || '',
    unit: t.unitLabel || '',
    price: t.basePrice,
    // TIERED opens as per piece; a leftover custom quote (switched off, no price) as flat.
    model: t.pricingModel === 'TIERED' ? 'PER_UNIT' : t.pricingModel === 'CUSTOM_QUOTE' ? 'FIXED' : t.pricingModel,
    minQty: t.minQuantity ?? '',
    maxQty: t.maxQuantity ?? '',
    durationHours: t.durationHours ?? '',
    allowsFollowUp: Boolean(t.allowsFollowUp),
    isActive: t.isActive,
    overrideReason: '',
  }))

  return {
    details: {
      name: service.name,
      description: service.description || '',
      basePrice: String(service.basePrice ?? ''),
      icon: service.icon || null,
      backgroundImageUrl: service.backgroundImageUrl || null,
      requiresCertification: !!service.requiresCertification,
    },
    jobs,
  }
}

export function draftToPayload(draft) {
  const { details } = draft
  return {
    name: details.name.trim(),
    description: details.description.trim() || null,
    basePrice: Number(details.basePrice),
    icon: details.icon,
    backgroundImageUrl: details.backgroundImageUrl || null,
    requiresCertification: details.requiresCertification,
    tasks: draft.jobs.map((j) => ({
      ...(j.id ? { id: j.id } : { key: j.ref }),
      name: j.name.trim(),
      description: j.description.trim() || null,
      basePrice: Number(j.price) || 0,
      pricingModel: j.model,
      // A flat price has no unit.
      unitLabel: usesCount(j.model) ? j.unit.trim() || null : null,
      minQuantity: usesCount(j.model) ? blankToNull(j.minQty) : null,
      maxQuantity: usesCount(j.model) ? blankToNull(j.maxQty) : null,
      durationHours: j.durationHours === '' || j.durationHours == null ? null : Number(j.durationHours),
      isActive: j.isActive,
      allowsFollowUp: Boolean(j.allowsFollowUp),
      overrideReason: j.overrideReason.trim() || undefined,
    })),
  }
}

/** First problem with a per-piece job's count limits, or null. */
export function countLimitsProblem(job) {
  if (!usesCount(job.model)) return null
  const min = blankToNull(job.minQty)
  const max = blankToNull(job.maxQty)
  if ((min != null && !(min >= 1)) || (max != null && !(max >= 1))) return 'The fewest and most a client can book must be at least 1.'
  if (min != null && max != null && min > max) return 'The fewest a client can book is more than the most.'
  return null
}

/** First problem that would stop a save, in the admin's words, or null. */
export function validateDraft(draft, doleFloor) {
  const d = draft.details
  if (!d.name.trim()) return 'Give the category a name.'
  if (d.basePrice === '' || !(Number(d.basePrice) >= 0)) return 'Set a starting price for the category (₱0 or more).'

  for (const j of draft.jobs) {
    const name = j.name.trim() || 'Untitled job'
    if (!j.name.trim()) return 'A job has no name.'
    // A switched-off job may have no price yet (a former custom-quote job).
    if (j.isActive) {
      if (!(Number(j.price) > 0)) return `“${name}” needs a price above ₱0 before it can be switched on.`
      if (doleFloor && Number(j.price) < doleFloor && !j.overrideReason.trim()) {
        return `“${name}”: the price is under the DOLE hourly wage reference (₱${doleFloor.toFixed(2)}). Edit the job and give a reason to keep it.`
      }
    }
    if (usesCount(j.model)) {
      if (!j.unit.trim()) return `“${name}” is priced per piece, so it needs a unit (e.g. outlet, room, kilo).`
      const limits = countLimitsProblem(j)
      if (limits) return `“${name}”: ${limits}`
    }
  }
  return null
}
