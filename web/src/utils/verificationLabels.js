const ACRONYMS = { id: 'ID', nbi: 'NBI', ai: 'AI', kyc: 'KYC' }

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

export function humanizeList(value) {
  if (!value || value === '—') return value ?? '—'
  return value
    .split(',')
    .map((part) => humanizeEnum(part.trim()))
    .join(', ')
}
