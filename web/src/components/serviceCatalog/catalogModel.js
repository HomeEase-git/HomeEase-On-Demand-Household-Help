// Converts between the admin API's service-type shape (flat scopeFields with
// taskLinks) and the job order editor's draft, where every job carries its own
// question list and a category-wide "common" list holds questions asked for
// every job. See backend/src/controllers/adminCatalogController.ts for the
// save endpoint this feeds.

let seq = 0
export const newKey = (prefix) => `${prefix}-${Date.now().toString(36)}-${++seq}`

export const QUESTION_TYPES = {
  TEXT: { label: 'Short text', hint: 'Typed answer', example: 'e.g. Brand' },
  NUMBER: { label: 'Number', hint: 'A count or size', example: 'e.g. How many units?' },
  ONE: { label: 'Pick one', hint: 'One choice from a list', example: 'e.g. HP' },
  ANY: { label: 'Pick any', hint: 'Several choices', example: 'e.g. Problems seen' },
  YESNO: { label: 'Yes / No', hint: 'Quick toggle', example: 'e.g. Has pets?' },
}

export const PRICING_MODELS = {
  FIXED: { label: 'Flat price', hint: 'One price for the whole job or visit.' },
  PER_UNIT: { label: 'Price × count', hint: 'Multiplied by a number question, e.g. How many units?' },
  TIERED: { label: 'Worker price steps', hint: 'Each worker sets price steps against a number question, e.g. up to 10 sq.m.' },
  CUSTOM_QUOTE: { label: 'Custom quote', hint: 'The worker inspects, then sends a price for approval.' },
}

export const COMMON_UNITS = ['job', 'visit', 'unit', 'piece', 'item', 'room', 'door', 'basket', 'set', 'sq.m.', 'house', 'area', 'line', 'trip', 'kilo']

export const usesCount = (model) => model === 'PER_UNIT' || model === 'TIERED'
export const isChoiceType = (type) => type === 'ONE' || type === 'ANY'

// Default worker price range around the standard price (80%–150%).
export const defaultBounds = (price) => ({
  minPrice: Math.round(price * 0.8),
  maxPrice: Math.round(price * 1.5),
})

export function formatPeso(amount) {
  const num = Number(amount)
  if (!Number.isFinite(num)) return '—'
  return `₱${num.toLocaleString('en-PH', { maximumFractionDigits: 2 })}`
}

const isYesNo = (f) =>
  f.fieldType === 'SELECT' && f.options?.length === 2 && f.options[0].label === 'Yes' && f.options[1].label === 'No'

function fieldToQuestion(f, ref = f.id) {
  const type = f.fieldType === 'NUMBER' ? 'NUMBER'
    : f.fieldType === 'TEXT' ? 'TEXT'
    : f.fieldType === 'MULTI_SELECT' ? 'ANY'
    : isYesNo(f) ? 'YESNO' : 'ONE'
  return {
    ref,
    id: ref === f.id ? f.id : undefined,
    // The saved question this came from, even for a copy (see serviceToDraft).
    sourceId: f.id,
    label: f.label,
    helpText: f.helpText || '',
    type,
    choices: (f.options || []).map((o) => o.label),
    min: f.minValue ?? null,
    max: f.maxValue ?? null,
    required: f.required !== false,
    match: !!f.usedForMatching,
  }
}

export function emptyQuestion() {
  return { ref: null, label: '', helpText: '', type: 'ONE', choices: ['', ''], min: 1, max: 10, required: true, match: false }
}

export function emptyDraft() {
  return {
    details: { name: '', description: '', basePrice: '', icon: null, requiresCertification: false },
    common: [],
    jobs: [],
    splitCount: 0,
  }
}

/**
 * A question linked to several jobs is shown as its own copy under each job
 * (the first keeps its id, the rest are saved as new questions), since the
 * editor edits every job's questions independently. splitCount lets the
 * page tell the admin that happened.
 */
export function serviceToDraft(service) {
  const jobs = (service.tasks || []).map((t) => ({
    ref: t.id,
    id: t.id,
    name: t.name,
    description: t.description || '',
    unit: t.unitLabel || '',
    price: t.basePrice,
    minPrice: t.minPrice,
    maxPrice: t.maxPrice,
    model: t.pricingModel,
    durationHours: t.durationHours ?? '',
    isActive: t.isActive,
    overrideReason: '',
    quantityRef: null,
    questions: [],
  }))
  const jobById = new Map(jobs.map((j) => [j.id, j]))
  const common = []
  let splitCount = 0

  for (const f of service.scopeFields || []) {
    const linked = (f.taskLinks || []).map((l) => jobById.get(l.serviceTaskId)).filter(Boolean)
    if (linked.length === 0) {
      common.push(fieldToQuestion(f))
      continue
    }
    if (linked.length > 1) splitCount++
    linked.forEach((job, i) => job.questions.push(fieldToQuestion(f, i === 0 ? f.id : newKey('q'))))
  }

  for (const t of service.tasks || []) {
    if (!t.quantityScopeFieldId) continue
    const job = jobById.get(t.id)
    if (common.some((q) => q.id === t.quantityScopeFieldId)) {
      job.quantityRef = t.quantityScopeFieldId
      continue
    }
    const own = job.questions.find((q) => q.sourceId === t.quantityScopeFieldId)
    const field = (service.scopeFields || []).find((f) => f.id === t.quantityScopeFieldId)
    if (own) {
      job.quantityRef = own.ref
    } else if (field) {
      // The count question is linked to other jobs only. It's still asked
      // for this one (the price needs it), so give this job its own copy.
      const copy = fieldToQuestion(field, newKey('q'))
      job.questions.unshift(copy)
      job.quantityRef = copy.ref
      splitCount++
    }
  }

  return {
    details: {
      name: service.name,
      description: service.description || '',
      basePrice: String(service.basePrice ?? ''),
      icon: service.icon || null,
      requiresCertification: !!service.requiresCertification,
    },
    common,
    jobs,
    splitCount,
  }
}

function questionToField(q, taskRefs) {
  const options = q.type === 'YESNO' ? ['Yes', 'No'] : isChoiceType(q.type) ? q.choices.map((c) => c.trim()).filter(Boolean) : []
  return {
    ...(q.id ? { id: q.id } : { key: q.ref }),
    label: q.label.trim(),
    helpText: q.helpText.trim() || null,
    fieldType: q.type === 'NUMBER' ? 'NUMBER' : q.type === 'TEXT' ? 'TEXT' : q.type === 'ANY' ? 'MULTI_SELECT' : 'SELECT',
    required: q.required,
    options,
    minValue: q.type === 'NUMBER' ? Number(q.min) : null,
    maxValue: q.type === 'NUMBER' ? Number(q.max) : null,
    usedForMatching: isChoiceType(q.type) ? q.match : false,
    taskRefs,
  }
}

export function draftToPayload(draft) {
  const { details } = draft
  return {
    name: details.name.trim(),
    description: details.description.trim() || null,
    basePrice: Number(details.basePrice),
    icon: details.icon,
    requiresCertification: details.requiresCertification,
    tasks: draft.jobs.map((j) => {
      const quote = j.model === 'CUSTOM_QUOTE'
      return {
        ...(j.id ? { id: j.id } : { key: j.ref }),
        name: j.name.trim(),
        description: j.description.trim() || null,
        basePrice: quote ? 0 : Number(j.price),
        pricingModel: j.model,
        minPrice: quote ? null : Number(j.minPrice),
        maxPrice: quote ? null : Number(j.maxPrice),
        unitLabel: j.unit.trim() || null,
        quantityFieldRef: usesCount(j.model) ? j.quantityRef : null,
        durationHours: quote || j.durationHours === '' || j.durationHours == null ? null : Number(j.durationHours),
        isActive: j.isActive,
        overrideReason: j.overrideReason.trim() || undefined,
      }
    }),
    scopeFields: [
      ...draft.common.map((q) => questionToField(q, [])),
      ...draft.jobs.flatMap((j) => j.questions.map((q) => questionToField(q, [j.ref]))),
    ],
  }
}

export const findQuestion = (draft, ref) =>
  draft.common.find((q) => q.ref === ref) || draft.jobs.flatMap((j) => j.questions).find((q) => q.ref === ref)

export const countQuestionFor = (draft, job) => (job.quantityRef ? findQuestion(draft, job.quantityRef) : null)

/** First problem that would stop a save, in the admin's words, or null. */
export function validateDraft(draft, doleFloor) {
  const d = draft.details
  if (!d.name.trim()) return 'Give the category a name.'
  if (d.basePrice === '' || !(Number(d.basePrice) >= 0)) return 'Set a starting price for the category (₱0 or more).'

  const commonLabels = new Set(draft.common.map((q) => q.label.trim().toLowerCase()))
  for (const q of draft.common) {
    if (!q.label.trim()) return 'A common question has no text.'
  }
  if (commonLabels.size !== draft.common.length) return 'Two common questions have the same text. Reword one of them.'

  for (const j of draft.jobs) {
    const name = j.name.trim() || 'Untitled job'
    if (!j.name.trim()) return 'A job has no name.'
    if (j.model !== 'CUSTOM_QUOTE') {
      if (!(Number(j.price) > 0)) return `“${name}” needs a standard price above ₱0.`
      if (!(Number(j.minPrice) >= 0) || !(Number(j.maxPrice) >= Number(j.minPrice))) {
        return `“${name}”: the lowest worker price must be at or below the highest.`
      }
      if (doleFloor && Number(j.minPrice) < doleFloor && !j.overrideReason.trim()) {
        return `“${name}”: the lowest worker price is under the DOLE hourly wage reference (₱${doleFloor.toFixed(2)}). Edit the job and give a reason to keep it.`
      }
    }
    if (usesCount(j.model)) {
      if (!j.unit.trim()) return `“${name}” is priced per unit, so it needs a unit (e.g. unit, room, kilo).`
      const count = countQuestionFor(draft, j)
      if (!count || count.type !== 'NUMBER') {
        return `“${name}” is priced per ${j.unit || 'unit'} but has no count question. Add a Number question and tick “This number sets the price”.`
      }
    }
    const seen = new Set(commonLabels)
    for (const q of j.questions) {
      const key = q.label.trim().toLowerCase()
      if (!key) return `A question under “${name}” has no text.`
      if (seen.has(key)) return `Two questions for “${name}” read “${q.label.trim()}” (counting common questions). Reword one of them.`
      seen.add(key)
    }
  }
  return null
}

/** Every distinct question (text + type) used anywhere, for "Start from a saved question". */
export function buildLibrary(services, draft) {
  const seen = new Map()
  const add = (q) => {
    const key = `${q.label.trim().toLowerCase()}|${q.type}`
    if (q.label.trim() && !seen.has(key)) seen.set(key, q)
  }
  draft.common.forEach(add)
  draft.jobs.forEach((j) => j.questions.forEach(add))
  for (const s of services || []) for (const f of s.scopeFields || []) add(fieldToQuestion(f))
  return [...seen.values()].sort((a, b) => a.label.localeCompare(b.label))
}
