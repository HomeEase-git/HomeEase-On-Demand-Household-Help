import { useEffect, useState } from 'react'
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

const LOG_CATEGORY_TABS = ['All', 'Admin Actions', 'Login History', 'System Errors', 'Status Changes']

const EXPORT_FETCHERS = {
  Bookings: fetchBookings,
  Payments: fetchPayments,
  Users: fetchClients,
  Reviews: fetchReviews,
}

export default function Reports() {
  const { pathname } = useLocation()
  const path = pathname.replace(/^\//, '') || 'reports'
  const view = path.includes('export') ? 'export' : path.includes('activity') ? 'activity' : path.includes('service') ? 'service' : 'logs'
  const [title, subtitle] = TITLES[view] || TITLES.logs

  const [filterTab, setFilterTab] = useState('All')
  const [rows, setRows] = useState([])
  const [meta, setMeta] = useState({ page: 1, hasPrev: false, hasNext: false, total: 0 })
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const [exportType, setExportType] = useState('Bookings')
  const [exporting, setExporting] = useState(false)

  const load = async () => {
    setLoading(true)
    setError(null)

    try {
      if (view === 'logs') {
        const response = await fetchAuditLogs({ category: filterTab, page, limit: 10 })
        setRows(response.data)
        setMeta(response.meta)
      } else if (view === 'service') {
        const data = await fetchServiceReport()
        setRows(data)
      } else if (view === 'activity') {
        const data = await fetchActivityReport()
        setRows(data)
      }
    } catch (err) {
      setError(err.message || 'Failed to load report')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (view === 'export') return
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, filterTab, page])

  useEffect(() => {
    setPage(1)
  }, [view, filterTab])

  const handleExport = async () => {
    setExporting(true)
    setError(null)

    try {
      const fetchFn = EXPORT_FETCHERS[exportType]
      const rowsAcc = []
      for (let p = 1; p <= 10; p++) {
        const response = await fetchFn({ page: p, limit: 50 })
        rowsAcc.push(...response.data)
        if (!response.meta?.hasNext) break
      }
      downloadCsv(`${exportType.toLowerCase()}-export.csv`, rowsAcc)
    } catch (err) {
      setError(err.message || 'Failed to generate export')
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
                <select style={{ width: '100%', padding: '0.5rem', border: '1px solid var(--border)', borderRadius: 8 }}>
                  <option>CSV</option>
                </select>
              </div>
            </div>
            <p className="page-subtitle" style={{ marginBottom: '1rem' }}>
              Export returns all available rows for the selected type, capped at 500. For a date-filtered export, use
              the Payout Distribution page instead.
            </p>
            {error && <div className="form-error" style={{ marginBottom: '1rem' }}>{error}</div>}
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
                  activeTab={filterTab}
                  onTabChange={setFilterTab}
                />
              </div>
            )}

            {loading && <LoadingState message="Loading report..." />}
            {error && <ErrorState message={error} onRetry={load} />}

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
                  onPrev={() => setPage((p) => Math.max(1, p - 1))}
                  onNext={() => setPage((p) => p + 1)}
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
