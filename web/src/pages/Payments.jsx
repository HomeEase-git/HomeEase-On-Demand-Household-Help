import { useCallback, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import PageHeader from '../components/common/PageHeader'
import SubNav from '../components/common/SubNav'
import SearchBar from '../components/common/SearchBar'
import FilterTabs from '../components/common/FilterTabs'
import SectionCard from '../components/common/SectionCard'
import Pagination from '../components/common/Pagination'
import Badge from '../components/common/Badge'
import LoadingState from '../components/common/LoadingState'
import ErrorState from '../components/common/ErrorState'
import { useListQuery } from '../hooks/useListQuery'
import { fetchPayments } from '../services/payments'
import { formatPeso } from '../data/payments'

const SUB_NAV = [
  { to: '/payments', label: 'All Transactions' },
  { to: '/payments/refunds', label: 'Refund Management' },
]

const STATUS_MAP = {
  All: 'all',
  Completed: 'completed',
  Pending: 'pending',
  Failed: 'failed',
}

const PLATFORM_RATE = 0.15

export default function Payments() {
  const fetchFn = useCallback(
    (params) =>
      fetchPayments({
        page: params.page || 1,
        limit: 10,
        search: params.search || '',
        status: STATUS_MAP[params.statusTab] || 'all',
      }),
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
  } = useListQuery(fetchFn, {
    initialParams: { page: 1, statusTab: 'All' },
  })

  const totals = useMemo(() => {
    const completed = transactions.filter((t) => t.status === 'Completed')
    const platform = completed.reduce((sum, t) => sum + t.platformFee, 0)
    const workers = completed.reduce((sum, t) => sum + t.workerAmount, 0)
    const gross = completed.reduce((sum, t) => sum + t.userAmount, 0)
    return { gross, workers, platform }
  }, [transactions])

  return (
    <>
      <PageHeader title="Payment Management" subtitle="All transactions" />
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
              <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                (~{Math.round(PLATFORM_RATE * 100)}% of completed payments)
              </span>
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
                    <th>Client</th>
                    <th>Worker</th>
                    <th>Client Paid</th>
                    <th>Worker Earnings</th>
                    <th>Platform Fee</th>
                    <th>Method</th>
                    <th>Date</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {transactions.length === 0 ? (
                    <tr>
                      <td colSpan={11} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
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
                          <Badge variant={t.status === 'Completed' ? 'approved' : 'pending'}>
                            {t.status}
                          </Badge>
                        </td>
                        <td>
                          <div className="row-actions">
                            <Link to={`/payments/transaction/${t.id}`} className="action-btn view" title="View">
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
