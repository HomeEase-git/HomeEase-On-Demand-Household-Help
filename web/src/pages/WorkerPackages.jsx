import { useCallback, useState } from 'react'
import { Link } from 'react-router-dom'
import PageHeader from '../components/common/PageHeader'
import SectionCard from '../components/common/SectionCard'
import LoadingState from '../components/common/LoadingState'
import ErrorState from '../components/common/ErrorState'
import Badge from '../components/common/Badge'
import { useListQuery } from '../hooks/useListQuery'
import { fetchWorkerPackages, approveWorkerPackage, rejectWorkerPackage } from '../services/packages'
import { formatPeso } from '../components/serviceCatalog/catalogModel'
import { useToast } from '../context/ToastContext'

const STATUS_BADGE_VARIANT = { PENDING: 'pending', APPROVED: 'active', REJECTED: 'suspended' }

function formatDate(value) {
  if (!value) return '—'
  return new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

/**
 * Packages workers propose (a bundle + price). Clients only see approved
 * ones. The admin can approve at the proposed price or set a different one;
 * a worker editing an approved package sends it back here.
 */
export default function WorkerPackages() {
  const { showError, showSuccess } = useToast()
  const [statusFilter, setStatusFilter] = useState('PENDING')
  const [approving, setApproving] = useState(null)
  const [approvePrice, setApprovePrice] = useState('')
  const [rejecting, setRejecting] = useState(null)
  const [rejectReason, setRejectReason] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const fetchFn = useCallback(() => fetchWorkerPackages(statusFilter), [statusFilter])
  const { data: packages, loading, error, reload, setData } = useListQuery(fetchFn)

  const priceValid = Number(approvePrice) > 0

  const handleApprove = async () => {
    if (!priceValid) return
    setSubmitting(true)
    try {
      const price = Number(approvePrice)
      await approveWorkerPackage(approving.id, price === approving.price ? undefined : price)
      setData((prev) => prev.filter((p) => p.id !== approving.id))
      showSuccess(`"${approving.name}" approved at ${formatPeso(price)}.`)
      setApproving(null)
    } catch (err) {
      showError(err.message || 'Failed to approve')
    } finally {
      setSubmitting(false)
    }
  }

  const handleReject = async () => {
    if (!rejectReason.trim()) return
    setSubmitting(true)
    try {
      await rejectWorkerPackage(rejecting.id, rejectReason.trim())
      setData((prev) => prev.filter((p) => p.id !== rejecting.id))
      showSuccess('Package rejected. The worker has been notified.')
      setRejecting(null)
    } catch (err) {
      showError(err.message || 'Failed to reject')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      <PageHeader
        title="Worker Packages"
        subtitle="Bundles workers propose for their services. Clients only see packages you approve."
      />
      <div className="toolbar">
        <select
          className="form-input"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          style={{ maxWidth: '160px' }}
          aria-label="Filter by status"
        >
          <option value="PENDING">Pending</option>
          <option value="APPROVED">Approved</option>
          <option value="REJECTED">Rejected</option>
          <option value="ALL">All</option>
        </select>
      </div>
      <SectionCard title="Packages">
        {loading && <LoadingState message="Loading packages..." />}
        {error && <ErrorState message={error} onRetry={reload} />}
        {!loading && !error && (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Package</th><th>Worker</th><th>Service</th><th>Price</th><th>Updated</th><th>Status</th><th></th>
                </tr>
              </thead>
              <tbody>
                {packages.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="table-empty">
                      No {statusFilter !== 'ALL' ? statusFilter.toLowerCase() : ''} packages.
                    </td>
                  </tr>
                ) : (
                  packages.map((p) => (
                    <tr key={p.id}>
                      <td>
                        <strong>{p.name}</strong>
                        {p.description && (
                          <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem', maxWidth: '320px' }}>
                            {p.description}
                          </div>
                        )}
                      </td>
                      <td>
                        <Link to={`/workers/${p.worker.userId}`}>{p.worker.fullName}</Link>
                      </td>
                      <td>{p.serviceType?.name ?? '—'}</td>
                      <td>{formatPeso(p.price)}</td>
                      <td>{formatDate(p.updatedAt)}</td>
                      <td>
                        <Badge variant={STATUS_BADGE_VARIANT[p.status] ?? 'pending'}>{p.status}</Badge>
                        {p.status === 'REJECTED' && p.rejectionReason && (
                          <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem', marginTop: '0.2rem' }}>
                            {p.rejectionReason}
                          </div>
                        )}
                        {!p.isActive && (
                          <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>Paused by worker</div>
                        )}
                      </td>
                      <td>
                        {p.status === 'PENDING' && (
                          <div className="row-actions">
                            <button
                              type="button"
                              className="action-btn approve"
                              title="Approve"
                              aria-label={`Approve ${p.name}`}
                              onClick={() => {
                                setApproving(p)
                                setApprovePrice(String(p.price))
                              }}
                            >
                              <i className="fas fa-check" />
                            </button>
                            <button
                              type="button"
                              className="action-btn delete"
                              title="Reject"
                              aria-label={`Reject ${p.name}`}
                              onClick={() => {
                                setRejecting(p)
                                setRejectReason('')
                              }}
                            >
                              <i className="fas fa-xmark" />
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      {approving && (
        <div className="modal-backdrop" onClick={() => setApproving(null)} role="presentation">
          <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <h2 className="modal-title">Approve Package</h2>
            <p className="modal-body">
              {approving.worker.fullName} proposed <strong>{approving.name}</strong> at {formatPeso(approving.price)}.
              Clients will pay the price you approve.
            </p>
            <div className="form-field">
              <label htmlFor="package-approve-price">Approved price (₱)</label>
              <input
                id="package-approve-price"
                type="number"
                min="1"
                value={approvePrice}
                onChange={(e) => setApprovePrice(e.target.value)}
                className="field-full field-plain"
              />
            </div>
            <div className="modal-actions">
              <button type="button" className="btn btn-outline" onClick={() => setApproving(null)}>
                Cancel
              </button>
              <button type="button" className="btn btn-primary" disabled={submitting || !priceValid} onClick={handleApprove}>
                {submitting ? 'Approving...' : 'Approve'}
              </button>
            </div>
          </div>
        </div>
      )}

      {rejecting && (
        <div className="modal-backdrop" onClick={() => setRejecting(null)} role="presentation">
          <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <h2 className="modal-title">Reject Package</h2>
            <p className="modal-body">
              Tell {rejecting.worker.fullName} why "{rejecting.name}" wasn't approved. They can edit it and resubmit.
            </p>
            <div className="form-field">
              <label htmlFor="package-reject-reason">Reason</label>
              <input
                id="package-reject-reason"
                type="text"
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="e.g. Price is too high for what's included"
                className="field-full field-plain"
              />
            </div>
            <div className="modal-actions">
              <button type="button" className="btn btn-outline" onClick={() => setRejecting(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={submitting || !rejectReason.trim()}
                onClick={handleReject}
              >
                {submitting ? 'Rejecting...' : 'Reject'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
