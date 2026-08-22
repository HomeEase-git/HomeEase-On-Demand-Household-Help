import { useCallback, useMemo, useState } from 'react'
import PageHeader from '../components/common/PageHeader'
import SubNav from '../components/common/SubNav'
import SearchBar from '../components/common/SearchBar'
import SectionCard from '../components/common/SectionCard'
import Pagination from '../components/common/Pagination'
import LoadingState from '../components/common/LoadingState'
import ErrorState from '../components/common/ErrorState'
import { useListQuery } from '../hooks/useListQuery'
import { fetchPayouts, downloadPayoutsCsv, retryPayout } from '../services/payments'
import { formatPeso } from '../data/payments'
import { useToast } from '../context/ToastContext'
import Badge from '../components/common/Badge'

const STATUS_BADGE_VARIANT = {
  Paid: 'approved',
  Processing: 'pending',
  Pending: 'pending',
  Failed: 'flagged',
}

const SUB_NAV = [
  { to: '/payments', label: 'All Transactions' },
  { to: '/payments/refunds', label: 'Refund History' },
  { to: '/payments/payouts', label: 'Payout Distribution' },
]

export default function Payouts() {
  const { showError, showSuccess } = useToast()
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [exporting, setExporting] = useState(false)
  const [retryingId, setRetryingId] = useState(null)
  const [selectedId, setSelectedId] = useState(null)

  const fetchFn = useCallback(
    (params) =>
      fetchPayouts({
        page: params.page || 1,
        limit: 10,
        search: params.search || '',
        dateFrom: params.dateFrom || '',
        dateTo: params.dateTo || '',
      }),
    []
  )

  const { data: payouts, meta, params, loading, error, reload, setSearch, setFilter, goToPage } = useListQuery(
    fetchFn,
    { initialParams: { page: 1, dateFrom: '', dateTo: '' }, pollIntervalMs: 25000 }
  )

  const selected = useMemo(() => payouts.find((p) => p.id === selectedId) || null, [payouts, selectedId])

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

  const handleExport = async () => {
    setExporting(true)
    try {
      await downloadPayoutsCsv({ search: params.search || '', dateFrom: params.dateFrom || '', dateTo: params.dateTo || '' })
    } catch (err) {
      showError(err.message || 'Failed to export payouts')
    } finally {
      setExporting(false)
    }
  }

  const handleRetry = async (id) => {
    setRetryingId(id)
    try {
      await retryPayout(id)
      showSuccess('Payout re-queued for another attempt')
      reload()
    } catch (err) {
      showError(err.message || 'Failed to retry payout')
    } finally {
      setRetryingId(null)
    }
  }

  return (
    <>
      <PageHeader
        title="Payout Distribution"
        subtitle="Worker earnings released from escrow on job completion"
        actions={(
          <button type="button" className="btn btn-outline" onClick={handleExport} disabled={exporting}>
            {exporting ? 'Exporting...' : 'Export CSV'}
          </button>
        )}
      />
      <SubNav items={SUB_NAV} />
      <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', margin: '0.5rem 0 1rem' }}>
        Payouts are sent to the worker&apos;s configured GCash/Maya account via Xendit once a booking&apos;s held
        payment is released. Failed sends can be retried below.
      </p>
      {meta.legacyUnpayoutCount > 0 && (
        <p style={{ color: 'var(--warning)', fontSize: '0.8125rem', margin: '0 0 1rem' }}>
          {meta.legacyUnpayoutCount} released payment{meta.legacyUnpayoutCount === 1 ? '' : 's'} predate payout
          tracking and have no payout record — reconcile these manually.
        </p>
      )}
      <div className="toolbar">
        <SearchBar placeholder="Search by worker name..." value={params.search || ''} onChange={setSearch} />
      </div>
      <div className="toolbar" style={{ alignItems: 'center' }}>
        <label style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>From</label>
        <input type="date" className="form-input" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} style={{ maxWidth: '160px' }} />
        <label style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>To</label>
        <input type="date" className="form-input" value={dateTo} onChange={(e) => setDateTo(e.target.value)} style={{ maxWidth: '160px' }} />
        <button type="button" className="btn btn-outline" onClick={applyDateRange}>Apply</button>
        {(params.dateFrom || params.dateTo) && (
          <button type="button" className="btn btn-outline" onClick={clearDateRange}>Clear</button>
        )}
      </div>
      <SectionCard title="Total Payout (current filter)">
        <div className="detail-grid" style={{ marginBottom: 0 }}>
          <div className="detail-block">
            <label>Total Released to Workers</label>
            <div className="value">{meta.totalPayoutFormatted ?? formatPeso(meta.totalPayoutAmount ?? 0)}</div>
          </div>
          <div className="detail-block">
            <label>Payout Records</label>
            <div className="value">{meta.total ?? 0}</div>
          </div>
        </div>
      </SectionCard>
      <SectionCard>
        {loading && <LoadingState message="Loading payouts..." />}
        {error && <ErrorState message={error} onRetry={reload} />}
        {!loading && !error && (
          <>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Payout ID</th><th>Booking</th><th>Worker</th><th>Client</th><th>Payout Amount</th><th>Commission</th><th>Method</th><th>Status</th><th>Released</th><th></th>
                  </tr>
                </thead>
                <tbody>
                  {payouts.length === 0 ? (
                    <tr>
                      <td colSpan={10} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>No payouts found.</td>
                    </tr>
                  ) : (
                    payouts.map((p) => (
                      <tr key={p.id}>
                        <td>{p.displayId}</td>
                        <td>{p.booking}</td>
                        <td>{p.worker}</td>
                        <td>{p.client}</td>
                        <td>{formatPeso(p.payoutAmount)}</td>
                        <td>{p.commissionAmount != null ? formatPeso(p.commissionAmount) : '—'}</td>
                        <td>{p.method}</td>
                        <td title={p.failureReason || undefined}>
                          <Badge variant={STATUS_BADGE_VARIANT[p.status] ?? 'pending'}>{p.status}</Badge>
                        </td>
                        <td>{p.releasedDate}</td>
                        <td>
                          <div className="row-actions">
                            <button
                              type="button"
                              className="action-btn view"
                              title="View payout details"
                              aria-label={`View details for payout ${p.displayId}`}
                              onClick={() => setSelectedId(p.id)}
                            >
                              <i className="fas fa-eye" />
                            </button>
                            {p.status === 'Failed' && (
                              <button
                                type="button"
                                className="btn btn-outline"
                                disabled={retryingId === p.id}
                                onClick={() => handleRetry(p.id)}
                              >
                                {retryingId === p.id ? 'Retrying...' : 'Retry'}
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
              info={`Showing ${payouts.length} of ${meta.total} payouts`}
              hasPrev={meta.hasPrev}
              hasNext={meta.hasNext}
              onPrev={() => goToPage(meta.page - 1)}
              onNext={() => goToPage(meta.page + 1)}
            />
          </>
        )}
      </SectionCard>

      {selected && (
        <div className="modal-backdrop" onClick={() => setSelectedId(null)} role="presentation">
          <div
            className="modal modal--landscape"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            <h2 className="modal-title">Payout — {selected.displayId}</h2>
            <p className="modal-body" style={{ marginBottom: '0.75rem' }}>
              <strong>Status:</strong> <Badge variant={STATUS_BADGE_VARIANT[selected.status] ?? 'pending'}>{selected.status}</Badge>
            </p>
            <div className="modal-detail-grid--2col">
              <div className="detail-block">
                <label>Booking</label>
                <div className="value">{selected.booking}</div>
              </div>
              <div className="detail-block">
                <label>Worker</label>
                <div className="value">{selected.worker}</div>
              </div>
              <div className="detail-block">
                <label>Client</label>
                <div className="value">{selected.client}</div>
              </div>
              <div className="detail-block">
                <label>Method</label>
                <div className="value">{selected.method}</div>
              </div>
              <div className="detail-block">
                <label>Payout Amount</label>
                <div className="value">{formatPeso(selected.payoutAmount)}</div>
              </div>
              <div className="detail-block">
                <label>Commission</label>
                <div className="value">{selected.commissionAmount != null ? formatPeso(selected.commissionAmount) : '—'}</div>
              </div>
              <div className="detail-block">
                <label>Released</label>
                <div className="value">{selected.releasedDate}</div>
              </div>
              <div className="detail-block">
                <label>Attempts</label>
                <div className="value">{selected.attempts ?? 0}</div>
              </div>
              <div className="detail-block">
                <label>Xendit Disbursement ID</label>
                <div className="value">{selected.xenditDisbursementId || '—'}</div>
              </div>
              <div className="detail-block">
                <label>Xendit Status</label>
                <div className="value">{selected.xenditStatus || '—'}</div>
              </div>
              {selected.failureReason && (
                <div className="detail-block detail-block--full">
                  <label>Failure Reason</label>
                  <div className="value">{selected.failureReason}</div>
                </div>
              )}
            </div>
            <div className="modal-actions" style={{ justifyContent: 'space-between' }}>
              <button type="button" className="btn btn-outline" onClick={() => setSelectedId(null)}>
                Close
              </button>
              {selected.status === 'Failed' && (
                <button
                  type="button"
                  className="btn btn-outline"
                  disabled={retryingId === selected.id}
                  onClick={() => handleRetry(selected.id)}
                >
                  {retryingId === selected.id ? 'Retrying...' : 'Retry'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
