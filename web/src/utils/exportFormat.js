/** "Pending_completion" -> "Pending completion". */
export function prettyStatus(value) {
  return typeof value === 'string' ? value.replace(/_/g, ' ') : value
}

const HIDDEN_KEYS = new Set(['id', 'urgencyLevel', 'selfDealingFlag', 'archived', 'xenditInvoiceId'])
const isInternalId = (key) => key !== 'displayId' && /Id$/.test(key)

const HEADER_LABELS = { displayId: 'ID' }

/** "userAmount" -> "User Amount". */
export function exportHeader(key) {
  if (HEADER_LABELS[key]) return HEADER_LABELS[key]
  const spaced = key.replace(/([a-z0-9])([A-Z])/g, '$1 $2')
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

export function friendlyExportRow(row) {
  const out = {}
  for (const [key, value] of Object.entries(row)) {
    if (HIDDEN_KEYS.has(key) || isInternalId(key)) continue
    out[exportHeader(key)] = key === 'status' ? prettyStatus(value) : value
  }
  return out
}

export function pdfSafeText(value) {
  return typeof value === 'string' ? value.replace(/₱\s?/g, 'PHP ') : value
}
