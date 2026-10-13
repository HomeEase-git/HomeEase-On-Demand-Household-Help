import { useCallback, useState } from 'react'
import { useLocation } from 'react-router-dom'
import PageHeader from '../components/common/PageHeader'
import SubNav from '../components/common/SubNav'
import SectionCard from '../components/common/SectionCard'
import Pagination from '../components/common/Pagination'
import Badge from '../components/common/Badge'
import FilterTabs from '../components/common/FilterTabs'
import LoadingState from '../components/common/LoadingState'
import ErrorState from '../components/common/ErrorState'
import { fetchAuditLogs } from '../services/auditLogs'
import { fetchServiceReport, fetchActivityReport } from '../services/reports'
import { fetchBookings } from '../services/bookings'
import { fetchPayments } from '../services/payments'
import { fetchClients } from '../services/users'
import { fetchReviews } from '../services/reviews'
import { downloadCsv } from '../utils/csvExport'
import { downloadPdf } from '../utils/exportPdf'
import { useAuth } from '../context/AuthContext'
import { useListQuery } from '../hooks/useListQuery'

const SUB_NAV = [
  { to: '/reports/logs', label: 'System Logs' },
  { to: '/reports/service', label: 'Service Reports' },
  { to: '/reports/activity', label: 'User Activity Reports' },
  { to: '/reports/export', label: 'Export Reports' },
]

const TITLES = {
  logs: ['System Logs', 'View and filter logs'],
  service: ['Service Reports', 'Business performance summary'],
  activity: ['User Activity Reports', 'Engagement and behavior tracker'],
  export: ['Export Reports', 'Export data to CSV or PDF'],
}

const LOG_CATEGORY_TABS = ['All', 'Security', 'Admin Actions', 'Login History', 'System Errors', 'Status Changes']

const EXPORT_FETCHERS = {
  Bookings: fetchBookings,
  Payments: fetchPayments,
  Users: fetchClients,
  Reviews: fetchReviews,
}

// API rows can carry nested objects/arrays, which print as "[object Object]" in
// a CSV and break a PDF table. Keep one readable value per column.
function flattenRow(row) {
  const out = {}
  for (const [key, value] of Object.entries(row ?? {})) {
    if (value === null || value === undefined) out[key] = ''
    else if (Array.isArray(value)) out[key] = value.map((v) => (typeof v === 'object' ? JSON.stringify(v) : v)).join('; ')
    else if (typeof value === 'object') out[key] = JSON.stringify(value)
    else out[key] = value
  }
  return out
}

export default function Reports() {
  const { user } = useAuth()
  const { pathname } = useLocation()
  const path = pathname.replace(/^\//, '') || 'reports'
  // Each of the 4 report views is its own <Route> entry pointing at this same
  // component (see App.jsx) — navigating between them remounts Reports, so
  // `view` is stable for the lifetime of any one mount and it's safe to
  // branch a single unconditional useListQuery call on it below.
  const view = path.includes('export') ? 'export' : path.includes('activity') ? 'activity' : path.includes('service') ? 'service' : 'logs'
  const [title, subtitle] = TITLES[view] || TITLES.logs

  const [exportType, setExportType] = useState('Bookings')
  const [exportFormat, setExportFormat] = useState('csv')
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState(null)

  const fetchFn = useCallback(
    (params) => {
      if (view === 'logs') return fetchAuditLogs({ category: params.filterTab, page: params.page, limit: 10 })
      if (view === 'service') return fetchServiceReport()
      if (view === 'activity') return fetchActivityReport()
      return Promise.resolve([]) // 'export' view has no list data to cache — it's an action, not a report
    },
    [view]
  )

  const { data: rows, meta, loading, error, reload, params, setFilter, goToPage } = useListQuery(fetchFn, {
    initialParams: { filterTab: 'All', page: 1 },
  })

  const handleExport = async () => {
    setExporting(true)
    setExportError(null)

    try {
      const exportFetchFn = EXPORT_FETCHERS[exportType]
      const rowsAcc = []
      for (let p = 1; p <= 10; p++) {
        const response = await exportFetchFn({ page: p, limit: 50 })
        rowsAcc.push(...response.data)
        if (!response.meta?.hasNext) break
      }
      if (!rowsAcc.length) {
        setExportError('Nothing to export for this report type')
        return
      }
      const flat = rowsAcc.map(flattenRow)
      const filename = `${exportType.toLowerCase()}-export-${new Date().toISOString().slice(0, 10)}.${exportFormat}`
      if (exportFormat === 'pdf') {
        const columns = Object.keys(flat[0])
        await downloadPdf({
          filename,
          title: `${exportType} Report`,
          subtitle: `${flat.length} record${flat.length === 1 ? '' : 's'}`,
          generatedBy: user?.name || user?.email,
          columns,
          rows: flat.map((row) => columns.map((key) => row[key] ?? '')),
          orientation: 'landscape',
        })
      } else {
        downloadCsv(filename, flat)
      }
    } catch (err) {
      setExportError(err.message || 'Failed to generate export')
    } finally {
      setExporting(false)
    }
  }

  return (
    <>
      <PageHeader
        title={title}
        subtitle={subtitle}
        actions={view === 'export' ? (
          <button type="button" className="btn btn-primary" onClick={handleExport} disabled={exporting}>
            <i className="fas fa-download" /> {exporting ? 'Exporting...' : 'Export'}
          </button>
        ) : null}
      />
      <SubNav items={SUB_NAV} />
      <SectionCard>
        {view === 'export' ? (
          <>
            <p style={{ marginBottom: '1rem' }}>Select report type and date range to export.</p>
            <div className="detail-grid" style={{ marginBottom: '1rem' }}>
              <div className="detail-block">
                <label>Report Type</label>
                <select
                  value={exportType}
                  onChange={(e) => setExportType(e.target.value)}
                  style={{ width: '100%', padding: '0.5rem', border: '1px solid var(--border)', borderRadius: 8 }}
                >
                  <option>Bookings</option>
                  <option>Payments</option>
                  <option>Users</option>
                  <option>Reviews</option>
                </select>
              </div>
              <div className="detail-block">
                <label>Format</label>
                <select
                  value={exportFormat}
                  onChange={(e) => setExportFormat(e.target.value)}
                  style={{ width: '100%', padding: '0.5rem', border: '1px solid var(--border)', borderRadius: 8 }}
                >
                  <option value="csv">CSV</option>
                  <option value="pdf">PDF</option>
                </select>
              </div>
            </div>
            <p className="page-subtitle" style={{ marginBottom: '1rem' }}>
              Export returns all available rows for the selected type, capped at 500, in the format you choose. For a date-filtered export, use
              the Payout Distribution page instead.
            </p>
            {exportError && <div className="form-error" style={{ marginBottom: '1rem' }}>{exportError}</div>}
            <button type="button" className="btn btn-primary" onClick={handleExport} disabled={exporting}>
              <i className="fas fa-download" /> {exporting ? 'Generating...' : 'Generate Export'}
            </button>
          </>
        ) : (
          <>
            {view === 'logs' && (
              <div className="toolbar" style={{ marginBottom: '1rem' }}>
                <FilterTabs
                  tabs={LOG_CATEGORY_TABS}
                  activeTab={params.filterTab}
                  onTabChange={(tab) => setFilter('filterTab', tab)}
                />
              </div>
            )}

            {loading && <LoadingState message="Loading report..." />}
            {error && <ErrorState message={error} onRetry={reload} />}

            {!loading && !error && view === 'logs' && (
              <>
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Timestamp</th>
                        <th>Level</th>
                        <th>Category</th>
                        <th>Source</th>
                        <th>Message</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((log) => (
                        <tr key={log.id}>
                          <td>{log.time}</td>
                          <td>
                            <Badge variant={log.level === 'ERROR' ? 'flagged' : log.level === 'WARN' ? 'pending' : 'active'}>
                              {log.level}
                            </Badge>
                          </td>
                          <td>{log.category}</td>
                          <td>{log.source}</td>
                          <td>{log.message}</td>
                        </tr>
                      ))}
                      {rows.length === 0 && (
                        <tr>
                          <td colSpan={5} style={{ color: 'var(--text-muted)', padding: '1rem' }}>
                            No log entries found.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
                <Pagination
                  info={`Showing ${rows.length} of ${meta.total ?? rows.length} log entries`}
                  hasPrev={meta.hasPrev}
                  hasNext={meta.hasNext}
                  onPrev={() => goToPage(Math.max(1, params.page - 1))}
                  onNext={() => goToPage(params.page + 1)}
                />
              </>
            )}

            {!loading && !error && (view === 'service' || view === 'activity') && (
              <div className="detail-grid" style={{ marginBottom: 0 }}>
                {rows.map((row) => (
                  <div key={row.metric} className="detail-block">
                    <label>{row.metric}</label>
                    <div className="value">{row.value}</div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </SectionCard>
    </>
  )
}
