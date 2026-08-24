const ACRONYMS = { id: 'ID', nbi: 'NBI', ai: 'AI', kyc: 'KYC' }

// Backend enum/type values arrive as raw SNAKE_CASE (e.g. "GOVERNMENT_ID_FRONT",
// "client_verification") — this turns them into "Government ID Front" /
// "Client Verification" for display instead of relying on CSS text-transform,
// which only capitalizes the first character of the whole string.
export function humanizeEnum(value) {
  if (!value) return '—'
  return value
    .toString()
    .toLowerCase()
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((word) => ACRONYMS[word] || word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

// For the "Services / Reason" column/field, which is a comma-joined list of
// raw document type enum values from the API (e.g. "GOVERNMENT_ID_FRONT,
// SELFIE").
export function humanizeList(value) {
  if (!value || value === '—') return value ?? '—'
  return value
    .split(',')
    .map((part) => humanizeEnum(part.trim()))
    .join(', ')
}
