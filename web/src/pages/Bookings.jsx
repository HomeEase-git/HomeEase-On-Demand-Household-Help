import { useCallback, useState } from 'react'
import { Link } from 'react-router-dom'
import PageHeader from '../components/common/PageHeader'
import SubNav from '../components/common/SubNav'
import SearchBar from '../components/common/SearchBar'
import FilterTabs from '../components/common/FilterTabs'
import SectionCard from '../components/common/SectionCard'
import Pagination from '../components/common/Pagination'
import SortableTh from '../components/common/SortableTh'
import { exportListToCsv, csvDateStamp } from '../utils/exportList'
import Badge from '../components/common/Badge'
import LoadingState from '../components/common/LoadingState'
import ErrorState from '../components/common/ErrorState'
import { useListQuery } from '../hooks/useListQuery'
import { fetchBookings, cancelBookingAdmin } from '../services/bookings'
import { useToast } from '../context/ToastContext'
import { getBookingStatusVariant } from '../utils/statusBadge'

const SUB_NAV = [
  { to: '/bookings', label: 'All Bookings' },
  { to: '/bookings/dispute', label: 'Booking Dispute' },
]

const STATUS_MAP = {
  All: 'all',
  Pending: 'pending',
  Completed: 'completed',
  Cancelled: 'cancelled',
}

const TERMINAL_STATUSES = ['Completed', 'Cancelled', 'Rejected']

// The filters and sort behind the table, shared by the table and the CSV export
// so an export always matches what's on screen.
function toApiParams(params) {
  return {
    sortBy: params.sortBy || '',
    sortDir: params.sortDir || '',
    search: params.search || '',
    status: STATUS_MAP[params.statusTab] || 'all',
    dateFrom: params.dateFrom || '',
    dateTo: params.dateTo || '',
  }
}

export default function Bookings() {
  const { showSuccess, showError } = useToast()
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [cancelTarget, setCancelTarget] = useState(null)
  const [reason, setReason] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const fetchFn = useCallback(
    (params) => fetchBookings({ page: params.page || 1, limit: 10, ...toApiParams(params) }),
    []
  )

  const {
    data: bookings,
    meta,
    params,
    loading,
    error,
    reload,
    setSearch,
    setFilter,
    goToPage,
    setSort,
  } = useListQuery(fetchFn, {
    initialParams: { page: 1, statusTab: 'All', dateFrom: '', dateTo: '' },
    // Paused while the force-cancel modal is open so a background refresh
    // can't swap the row out from under the admin mid-action.
    pollIntervalMs: cancelTarget ? null : 25000,
  })

  const applyDateRange = () => {
    setFilter('dateFrom', dateFrom)
    setFilter('dateTo', dateTo)
  }

  const clearDateRange = () => {
    setDateFrom('')
    setDateTo('')
    setFilter('dateFrom', '')
    setFilter('dateTo', '')
  }

  const closeCancelModal = () => {
    setCancelTarget(null)
    setReason('')
  }

  const handleForceCancel = async () => {
    if (!cancelTarget) return
    setSubmitting(true)
    try {
      await cancelBookingAdmin(cancelTarget.id, reason.trim() || 'Cancelled by admin')
      showSuccess(`Booking ${cancelTarget.displayId} cancelled.`)
      closeCancelModal()
      reload()
    } catch (err) {
      showError(err.message || 'Failed to cancel booking')
    } finally {
      setSubmitting(false)
    }
  }

  const [exporting, setExporting] = useState(false)
  const handleExport = async () => {
    setExporting(true)
    try {
      const { count, total, truncated } = await exportListToCsv({
        fetchPage: ({ page, limit }) => fetchBookings({ page, limit, ...toApiParams(params) }),
        filename: `bookings-${csvDateStamp()}.csv`,
        mapRow: (b) => ({
          'Booking ID': b.displayId,
          Client: b.client,
          Worker: b.worker,
          Service: b.service,
          Date: b.date,
          Amount: b.amount,
          Status: b.status,
        }),
      })
      if (!count) showError('Nothing to export for these filters')
      else if (truncated) showSuccess(`Exported the first ${count} of ${total} bookings. Narrow the filters to get the rest.`)
      else showSuccess(`Exported ${count} bookings`)
    } catch (err) {
      showError(err.message || 'Export failed')
    } finally {
      setExporting(false)
    }
  }

  return (
    <>
      <PageHeader
        actions={
          <button type="button" className="btn btn-outline" onClick={handleExport} disabled={exporting}>
            <i className={`fas ${exporting ? 'fa-spinner fa-spin' : 'fa-file-csv'}`} /> {exporting ? 'Exporting…' : 'Export CSV'}
          </button>
        }
        title="Booking Management" subtitle="All bookings" />
      <SubNav items={SUB_NAV} />
      <div className="toolbar">
        <SearchBar placeholder="Search bookings..." value={params.search || ''} onChange={setSearch} />
        <FilterTabs
          tabs={['All', 'Pending', 'Completed', 'Cancelled']}
          activeTab={params.statusTab || 'All'}
          onTabChange={(tab) => setFilter('statusTab', tab)}
        />
      </div>
      <div className="toolbar" style={{ alignItems: 'center' }}>
        <label className="text-muted text-small">From</label>
        <input
          type="date"
          className="form-input"
          value={dateFrom}
          onChange={(e) => setDateFrom(e.target.value)}
          style={{ maxWidth: '160px' }}
        />
        <label className="text-muted text-small">To</label>
        <input
          type="date"
          className="form-input"
          value={dateTo}
          onChange={(e) => setDateTo(e.target.value)}
          style={{ maxWidth: '160px' }}
        />
        <button type="button" className="btn btn-outline" onClick={applyDateRange}>
          Apply
        </button>
        {(params.dateFrom || params.dateTo) && (
          <button type="button" className="btn btn-outline" onClick={clearDateRange}>
            Clear
          </button>
        )}
      </div>
      <SectionCard>
        {loading && <LoadingState message="Loading bookings..." />}
        {error && <ErrorState message={error} onRetry={reload} />}
        {!loading && !error && (
          <>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Booking ID</th><SortableTh label="Client" sortKey="client" params={params} onSort={setSort} /><SortableTh label="Worker" sortKey="worker" params={params} onSort={setSort} /><th>Service</th><SortableTh label="Date" sortKey="date" params={params} onSort={setSort} firstDir="desc" /><th>Amount</th><th>Status</th><th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {bookings.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="table-empty">No bookings found.</td>
                    </tr>
                  ) : (
                    bookings.map((b) => (
                      <tr key={b.id}>
                        <td>{b.displayId}</td>
                        <td>
                          {b.client}
                          {b.selfDealingFlag && (
                            <i
                              className="fas fa-triangle-exclamation"
                              style={{ color: 'var(--warning)', marginLeft: '0.4rem' }}
                              title="Client and worker share a phone number — possible self-dealing"
                            />
                          )}
                        </td>
                        <td>{b.worker}</td>
                        <td>
                          {b.service}{' '}
                          {b.urgencyLevel && b.urgencyLevel !== 'STANDARD' && (
                            <Badge variant={b.urgencyLevel === 'EMERGENCY' ? 'flagged' : 'pending'}>
                              {b.urgencyLevel === 'EMERGENCY' ? 'Emergency' : 'Urgent'}
                            </Badge>
                          )}
                        </td>
                        <td>{b.date}</td>
                        <td>{b.amount}</td>
                        <td>
                          <Badge variant={getBookingStatusVariant(b.status)}>{b.status}</Badge>
                        </td>
                        <td>
                          <div className="row-actions">
                            <Link
                              to={`/bookings/detail/${b.id}`}
                              className="action-btn view"
                              title="View"
                              aria-label={`View booking ${b.displayId}`}
                            >
                              <i className="fas fa-eye" />
                            </Link>
                            {!TERMINAL_STATUSES.includes(b.status) && (
                              <button
                                type="button"
                                className="action-btn delete"
                                title="Force cancel"
                                aria-label={`Force cancel booking ${b.displayId}`}
                                onClick={() => setCancelTarget(b)}
                              >
                                <i className="fas fa-ban" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            <Pagination
              info={`Showing ${bookings.length} of ${meta.total} bookings`}
              hasPrev={meta.hasPrev}
              hasNext={meta.hasNext}
              onPrev={() => goToPage(meta.page - 1)}
              onNext={() => goToPage(meta.page + 1)}
            />
          </>
        )}
      </SectionCard>

      {cancelTarget && (
        <div className="modal-backdrop" onClick={closeCancelModal} role="presentation">
          <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <h2 className="modal-title">Force cancel booking {cancelTarget.displayId}?</h2>
            <p className="modal-body">This releases/refunds any held payment. This can&apos;t be undone.</p>
            <label htmlFor="cancel-reason" className="form-label form-label--spaced">
              Reason
            </label>
            <textarea
              id="cancel-reason"
              className="form-input field-full field-textarea"
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Why is this booking being force-cancelled?"
            />
            <div className="modal-actions">
              <button type="button" className="btn btn-outline" onClick={closeCancelModal} disabled={submitting}>
                Keep Booking
              </button>
              <button type="button" className="btn btn-danger" onClick={handleForceCancel} disabled={submitting}>
                {submitting ? 'Cancelling...' : 'Confirm Cancel'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
