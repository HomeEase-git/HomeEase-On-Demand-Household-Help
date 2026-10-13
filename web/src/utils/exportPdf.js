import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import homeEaseLogo from '../components/Assets/home-ease-logo.png'

const PAGE_SIZE = 50 // the admin API's maximum page size

// The logo import resolves to a URL (it's well over Vite's 4KB inline
// threshold, so it's never a data: URI), but jsPDF's addImage needs actual
// image bytes — fetched and converted to a data URL once, then reused for
// every export in the session.
let logoDataUrlPromise = null
function getLogoDataUrl() {
  if (!logoDataUrlPromise) {
    logoDataUrlPromise = fetch(homeEaseLogo)
      .then((res) => res.blob())
      .then(
        (blob) =>
          new Promise((resolve, reject) => {
            const reader = new FileReader()
            reader.onload = () => resolve(reader.result)
            reader.onerror = () => reject(reader.error)
            reader.readAsDataURL(blob)
          })
      )
  }
  return logoDataUrlPromise
}

// Every exported report shares this letterhead: the HomeEase logo centered
// at the top, the company name/tagline under it, then the report title and
// who/when generated it — before any table data starts.
async function drawLetterhead(doc, { title, subtitle, generatedBy }) {
  const pageWidth = doc.internal.pageSize.getWidth()
  const logoSize = 20
  let y = 12

  try {
    const logoDataUrl = await getLogoDataUrl()
    doc.addImage(logoDataUrl, 'PNG', (pageWidth - logoSize) / 2, y, logoSize, logoSize)
  } catch {
    // Logo failed to load (offline, blocked request) — still produce the
    // report, just without the image.
  }
  y += logoSize + 6

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(14)
  doc.setTextColor(30, 41, 59)
  doc.text('HomeEase', pageWidth / 2, y, { align: 'center' })
  y += 5

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(100, 116, 139)
  doc.text('On-Demand Household Help', pageWidth / 2, y, { align: 'center' })
  y += 8

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(12)
  doc.setTextColor(30, 41, 59)
  doc.text(title, pageWidth / 2, y, { align: 'center' })
  y += 5

  if (subtitle) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    doc.setTextColor(100, 116, 139)
    doc.text(subtitle, pageWidth / 2, y, { align: 'center' })
    y += 5
  }

  const generatedAt = new Date().toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' })
  doc.setFontSize(8)
  doc.setTextColor(148, 163, 184)
  doc.text(
    `Generated ${generatedAt}${generatedBy ? ` by ${generatedBy}` : ''}`,
    pageWidth / 2,
    y,
    { align: 'center' }
  )
  y += 5

  doc.setDrawColor(226, 232, 240)
  doc.line(14, y, pageWidth - 14, y)
  doc.setTextColor(0, 0, 0)

  return y + 6
}

/**
 * Renders rows already in hand as a letterhead PDF (logo, company name,
 * report title/filters, generated-by line, then the data table).
 */
export async function downloadPdf({ filename, title, subtitle, generatedBy, columns, rows, orientation }) {
  if (!rows.length) return

  const doc = new jsPDF({ orientation: orientation || (columns.length > 6 ? 'landscape' : 'portrait') })
  const startY = await drawLetterhead(doc, { title, subtitle, generatedBy })

  autoTable(doc, {
    startY,
    head: [columns],
    body: rows,
    styles: { fontSize: 8, cellPadding: 3 },
    headStyles: { fillColor: [37, 99, 235], textColor: 255, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    margin: { left: 14, right: 14 },
  })

  doc.save(filename)
}

/**
 * Downloads every row matching the list's current filters/sort as a
 * letterhead PDF, fetching page by page (up to maxRows) the same way
 * exportListToCsv does. Returns how many rows were saved and whether the
 * cap cut the export short.
 */
export async function exportListToPdf({
  fetchPage,
  filename,
  title,
  subtitle,
  generatedBy,
  mapRow,
  maxRows = 500,
  orientation,
}) {
  const rawRows = []
  let total = 0
  for (let page = 1; rawRows.length < maxRows; page++) {
    const { data, meta } = await fetchPage({ page, limit: PAGE_SIZE })
    total = meta?.total ?? total
    rawRows.push(...(data ?? []))
    if (!meta?.hasNext || !data?.length) break
  }
  const saved = rawRows.slice(0, maxRows)
  if (!saved.length) return { count: 0, total, truncated: false }

  const mapped = saved.map(mapRow)
  const columns = Object.keys(mapped[0])
  await downloadPdf({
    filename,
    title,
    subtitle,
    generatedBy,
    columns,
    rows: mapped.map((row) => columns.map((key) => row[key] ?? '')),
    orientation,
  })

  return { count: saved.length, total, truncated: total > saved.length }
}
