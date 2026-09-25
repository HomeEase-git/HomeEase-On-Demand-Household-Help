import { downloadCsv } from './csvExport'

const PAGE_SIZE = 50 // the admin API's maximum page size

/**
 * Downloads every row matching the list's current filters and sort as CSV,
 * fetching page by page (up to maxRows). Returns how many rows were saved
 * and whether the cap cut the export short.
 */
export async function exportListToCsv({ fetchPage, filename, mapRow, maxRows = 2000 }) {
  const rows = []
  let total = 0
  for (let page = 1; rows.length < maxRows; page++) {
    const { data, meta } = await fetchPage({ page, limit: PAGE_SIZE })
    total = meta?.total ?? total
    rows.push(...(data ?? []))
    if (!meta?.hasNext || !data?.length) break
  }
  const saved = rows.slice(0, maxRows)
  if (saved.length) downloadCsv(filename, saved.map(mapRow))
  return { count: saved.length, total, truncated: total > saved.length }
}

export const csvDateStamp = () => new Date().toISOString().slice(0, 10)
