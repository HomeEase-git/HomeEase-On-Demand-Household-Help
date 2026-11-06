const MANILA_OFFSET_MS = 8 * 60 * 60 * 1000

function dateKey(year, month0) {
  const d = new Date(Date.UTC(year, month0, 1))
  return d.toISOString().slice(0, 10)
}

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
