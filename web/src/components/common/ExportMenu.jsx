import { useEffect, useRef, useState } from 'react'

/**
 * "Export" button with a CSV/PDF choice. Reuses the header-dropdown styling
 * (generic positioned-panel classes, not actually header-specific) so it
 * matches the rest of the admin UI's menus.
 */
export default function ExportMenu({ onExportCsv, onExportPdf, exporting, label = 'Export' }) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef(null)

  useEffect(() => {
    function handleClickOutside(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const run = (fn) => {
    setOpen(false)
    fn?.()
  }

  return (
    <div className="header-dropdown-wrap" ref={wrapRef}>
      <button
        type="button"
        className="btn btn-outline"
        onClick={() => setOpen((o) => !o)}
        disabled={exporting}
        aria-expanded={open}
      >
        <i className={`fas ${exporting ? 'fa-spinner fa-spin' : 'fa-download'}`} /> {exporting ? 'Exporting…' : label}
      </button>
      {open && (
        <div className="header-dropdown" style={{ minWidth: '170px' }}>
          <button type="button" className="header-dropdown__item" onClick={() => run(onExportCsv)}>
            <i className="fas fa-file-csv" />
            <span className="header-dropdown__item-label">Export as CSV</span>
          </button>
          <button type="button" className="header-dropdown__item" onClick={() => run(onExportPdf)}>
            <i className="fas fa-file-pdf" />
            <span className="header-dropdown__item-label">Export as PDF</span>
          </button>
        </div>
      )}
    </div>
  )
}
