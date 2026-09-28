// Tax periods are Philippine calendar quarters. "Now" is taken in Manila time
// (UTC+8, no daylight saving) so the current quarter flips at midnight
// Manila, not 8 AM. Boundaries are sent as plain dates ("2026-07-01"), which
// the backend reads as midnight Manila.

const MANILA_OFFSET_MS = 8 * 60 * 60 * 1000

function dateKey(year, month0) {
  const d = new Date(Date.UTC(year, month0, 1))
  return d.toISOString().slice(0, 10)
}

/**
 * The most recent `count` closed calendar quarters, newest first:
 * [{ periodStart: '2026-04-01', periodEnd: '2026-07-01', label: 'Q2 2026' }, ...]
 */
export function recentClosedQuarters(count = 8) {
  const manilaNow = new Date(Date.now() + MANILA_OFFSET_MS)
  let year = manilaNow.getUTCFullYear()
  let quarter = Math.floor(manilaNow.getUTCMonth() / 3)
  const periods = []
  for (let i = 0; i < count; i++) {
    quarter -= 1
    if (quarter < 0) {
      quarter = 3
      year -= 1
    }
    periods.push({
      periodStart: dateKey(year, quarter * 3),
      periodEnd: dateKey(year, quarter * 3 + 3),
      label: `Q${quarter + 1} ${year}`,
    })
  }
  return periods
}

/** "2026-07" -> "Jul" */
export function monthShort(key) {
  const [year, month] = key.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, 15)).toLocaleDateString('en-PH', { month: 'short', timeZone: 'UTC' })
}
