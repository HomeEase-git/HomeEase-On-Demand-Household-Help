import { useCallback, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import PageHeader from '../components/common/PageHeader'
import SubNav from '../components/common/SubNav'
import SearchBar from '../components/common/SearchBar'
import FilterTabs from '../components/common/FilterTabs'
import SectionCard from '../components/common/SectionCard'
import Pagination from '../components/common/Pagination'
import SortableTh from '../components/common/SortableTh'
import { exportListToCsv, csvDateStamp } from '../utils/exportList'
import { useToast } from '../context/ToastContext'
import Badge from '../components/common/Badge'
import { getPaymentStatusVariant } from '../utils/statusBadge'
import LoadingState from '../components/common/LoadingState'
import ErrorState from '../components/common/ErrorState'
import { useListQuery } from '../hooks/useListQuery'
import { fetchPayments } from '../services/payments'
import { formatPeso } from '../data/payments'

const SUB_NAV = [
  { to: '/payments', label: 'All Transactions' },
  { to: '/payments/refunds', label: 'Refund History' },
  { to: '/payments/payouts', label: 'Payout Distribution' },
]

const STATUS_MAP = {
  All: 'all',
  Completed: 'completed',
  Pending: 'pending',
  Failed: 'failed',
}

// The filters and sort behind the table, shared by the table and the CSV export
// so an export always matches what's on screen.
function toApiParams(params) {
  return {
    sortBy: params.sortBy || '',
    sortDir: params.sortDir || '',
    search: params.search || '',
    status: STATUS_MAP[params.statusTab] || 'all',
  }
}

export default function Payments() {
  const fetchFn = useCallback(
    (params) => fetchPayments({ page: params.page || 1, limit: 10, ...toApiParams(params) }),
    []
  )

  const {
    data: transactions,
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
    initialParams: { page: 1, statusTab: 'All' },
    pollIntervalMs: 25000,
  })

  // Backend-aggregated across every Completed payment matching the current
  // search (not just the current page) — see listPayments' completedWhere.
  const totals = useMemo(() => {
    const gross = meta.completedGrossVolume ?? 0
    const workers = meta.completedWorkerEarnings ?? 0
    const platform = meta.completedPlatformCommission ?? 0
    // Derived from the actual totals rather than a hardcoded constant, so
    // this always reflects AppSettings.commissionRate as configured —
    // whatever an admin sets it to in Settings — instead of going stale.
    const ratePercent = gross > 0 ? Math.round((platform / gross) * 100) : null
    return { gross, workers, platform, ratePercent }
  }, [meta.completedGrossVolume, meta.completedWorkerEarnings, meta.completedPlatformCommission])

  const { showSuccess, showError } = useToast()
  const [exporting, setExporting] = useState(false)
  const handleExport = async () => {
    setExporting(true)
    try {
      const { count, total, truncated } = await exportListToCsv({
        fetchPage: ({ page, limit }) => fetchPayments({ page, limit, ...toApiParams(params) }),
        filename: `payments-${csvDateStamp()}.csv`,
        mapRow: (t) => ({
          'Transaction ID': t.displayId || t.id,
          Booking: t.booking,
          Client: t.client,
          Worker: t.worker,
          'Client Paid': t.userAmount,
          'Worker Earnings': t.workerAmount,
          'Platform Fee': t.platformFee,
          Method: t.method,
          Date: t.date,
          Status: t.status,
        }),
      })
      if (!count) showError('Nothing to export for these filters')
      else if (truncated) showSuccess(`Exported the first ${count} of ${total} payments. Narrow the filters to get the rest.`)
      else showSuccess(`Exported ${count} payments`)
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
        title="Payment Management" subtitle="All transactions" />
      <SubNav items={SUB_NAV} />
      <div className="toolbar">
        <SearchBar
          placeholder="Search by ID, booking, client, or worker..."
          value={params.search || ''}
          onChange={setSearch}
        />
        <FilterTabs
          tabs={['All', 'Completed', 'Pending', 'Failed']}
          activeTab={params.statusTab || 'All'}
          onTabChange={(tab) => setFilter('statusTab', tab)}
        />
      </div>
      <SectionCard title="Commission Overview">
        <div className="detail-grid" style={{ marginBottom: 0 }}>
          <div className="detail-block">
            <label>Completed Gross Volume</label>
            <div className="value">{formatPeso(totals.gross)}</div>
          </div>
          <div className="detail-block">
            <label>Worker Earnings (Payout)</label>
            <div className="value">{formatPeso(totals.workers)}</div>
          </div>
          <div className="detail-block">
            <label>Platform Commission</label>
            <div className="value">
              {formatPeso(totals.platform)}{' '}
              {totals.ratePercent != null && (
                <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                  (~{totals.ratePercent}% of completed payments)
                </span>
              )}
            </div>
          </div>
        </div>
      </SectionCard>
      <SectionCard>
        {loading && <LoadingState message="Loading transactions..." />}
        {error && <ErrorState message={error} onRetry={reload} />}
        {!loading && !error && (
          <>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Transaction ID</th>
                    <th>Booking</th>
                    <SortableTh label="Client" sortKey="client" params={params} onSort={setSort} />
                    <SortableTh label="Worker" sortKey="worker" params={params} onSort={setSort} />
                    <SortableTh label="Client Paid" sortKey="clientPaid" params={params} onSort={setSort} firstDir="desc" />
                    <SortableTh label="Worker Earnings" sortKey="workerEarnings" params={params} onSort={setSort} firstDir="desc" />
                    <SortableTh label="Platform Fee" sortKey="platformFee" params={params} onSort={setSort} firstDir="desc" />
                    <th>Method</th>
                    <SortableTh label="Date" sortKey="date" params={params} onSort={setSort} firstDir="desc" />
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {transactions.length === 0 ? (
                    <tr>
                      <td colSpan={11} className="table-empty">
                        No payments found.
                      </td>
                    </tr>
                  ) : (
                    transactions.map((t) => (
                      <tr key={t.id}>
                        <td>{t.displayId || t.id}</td>
                        <td>{t.booking}</td>
                        <td>{t.client}</td>
                        <td>{t.worker}</td>
                        <td>{formatPeso(t.userAmount)}</td>
                        <td>{formatPeso(t.workerAmount)}</td>
                        <td>{formatPeso(t.platformFee)}</td>
                        <td>{t.method}</td>
                        <td>{t.date}</td>
                        <td>
                          <Badge variant={getPaymentStatusVariant(t.status)}>
                            {t.status}
                          </Badge>
                        </td>
                        <td>
                          <div className="row-actions">
                            <Link
                              to={`/payments/transaction/${t.id}`}
                              className="action-btn view"
                              title="View"
                              aria-label={`View transaction ${t.displayId || t.id}`}
                            >
                              <i className="fas fa-eye" />
                            </Link>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            <Pagination
              info={`Showing ${transactions.length} of ${meta.total} transactions`}
              hasPrev={meta.hasPrev}
              hasNext={meta.hasNext}
              onPrev={() => goToPage(meta.page - 1)}
              onNext={() => goToPage(meta.page + 1)}
            />
          </>
        )}
      </SectionCard>
    </>
  )
}
