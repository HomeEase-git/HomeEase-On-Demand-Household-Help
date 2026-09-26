import { useCallback, useState } from 'react'
import { Link } from 'react-router-dom'
import PageHeader from '../components/common/PageHeader'
import SectionCard from '../components/common/SectionCard'
import LoadingState from '../components/common/LoadingState'
import ErrorState from '../components/common/ErrorState'
import Badge from '../components/common/Badge'
import { useListQuery } from '../hooks/useListQuery'
import { fetchServiceRequests, approveServiceRequest, rejectServiceRequest } from '../services/serviceRequests'
import { useToast } from '../context/ToastContext'

const STATUS_LABEL = { PENDING_VERIFICATION: 'Pending', VERIFIED: 'Approved', REJECTED: 'Rejected' }
const STATUS_BADGE_VARIANT = { PENDING_VERIFICATION: 'pending', VERIFIED: 'active', REJECTED: 'suspended' }
const DOC_BADGE_VARIANT = { PENDING: 'pending', APPROVED: 'active', REJECTED: 'suspended' }

function formatDate(value) {
  if (!value) return '—'
  return new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

/**
 * Workers asking to offer another service. Approving unlocks the service so
 * the worker can pick its tasks (and approves the documents attached to the
 * request); rejecting sends the worker the reason so they can try again.
 */
export default function ServiceRequests() {
  const { showError, showSuccess } = useToast()
  const [statusFilter, setStatusFilter] = useState('PENDING_VERIFICATION')
  const [actioningId, setActioningId] = useState(null)
  const [rejecting, setRejecting] = useState(null)
  const [rejectReason, setRejectReason] = useState('')
  const [submittingReject, setSubmittingReject] = useState(false)

  const fetchFn = useCallback(() => fetchServiceRequests(statusFilter), [statusFilter])
  const { data: requests, loading, error, reload, setData } = useListQuery(fetchFn)

  const handleApprove = async (request) => {
    setActioningId(request.id)
    try {
      await approveServiceRequest(request.id)
      setData((prev) => prev.filter((r) => r.id !== request.id))
      showSuccess(`${request.worker.fullName} can now offer ${request.serviceType.name}.`)
    } catch (err) {
      showError(err.message || 'Failed to approve')
    } finally {
      setActioningId(null)
    }
  }

  const handleReject = async () => {
    if (!rejectReason.trim()) return
    setSubmittingReject(true)
    try {
      await rejectServiceRequest(rejecting.id, rejectReason.trim())
      setData((prev) => prev.filter((r) => r.id !== rejecting.id))
      showSuccess('Request rejected. The worker has been notified.')
      setRejecting(null)
    } catch (err) {
      showError(err.message || 'Failed to reject')
    } finally {
      setSubmittingReject(false)
    }
  }

  return (
    <>
      <PageHeader
        title="Service Requests"
        subtitle="Workers asking to offer another service, with the documents that prove their skills"
      />
      <div className="toolbar">
        <select
          className="form-input"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          style={{ maxWidth: '160px' }}
          aria-label="Filter by status"
        >
          <option value="PENDING_VERIFICATION">Pending</option>
          <option value="VERIFIED">Approved</option>
          <option value="REJECTED">Rejected</option>
          <option value="ALL">All</option>
        </select>
      </div>
      <SectionCard title="Requests">
        {loading && <LoadingState message="Loading requests..." />}
        {error && <ErrorState message={error} onRetry={reload} />}
        {!loading && !error && (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Worker</th><th>Service</th><th>Documents</th><th>Requested</th><th>Status</th><th></th>
                </tr>
              </thead>
              <tbody>
                {requests.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="table-empty">
                      No {statusFilter !== 'ALL' ? STATUS_LABEL[statusFilter].toLowerCase() : ''} requests.
                    </td>
                  </tr>
                ) : (
                  requests.map((r) => (
                    <tr key={r.id}>
                      <td>
                        <Link to={`/workers/${r.worker.userId}`}><strong>{r.worker.fullName}</strong></Link>
                        <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>{r.worker.email}</div>
                        {r.worker.currentServices.length > 0 && (
                          <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>
                            Offers: {r.worker.currentServices.join(', ')}
                          </div>
                        )}
                      </td>
                      <td>
                        {r.serviceType.name}
                        {r.serviceType.requiresCertification && (
                          <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>Licensed trade</div>
                        )}
                      </td>
                      <td>
                        {r.documents.length === 0 ? (
                          '—'
                        ) : (
                          <ul style={{ margin: 0, paddingLeft: '1rem' }}>
                            {r.documents.map((d) => (
                              <li key={d.id} style={{ marginBottom: '0.3rem' }}>
                                <a href={d.documentUrl} target="_blank" rel="noopener noreferrer">{d.title}</a>
                                <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>
                                  {d.issuer} · issued {formatDate(d.issueDate)}
                                  {d.expiryDate ? ` · expires ${formatDate(d.expiryDate)}` : ''}{' '}
                                  <Badge variant={DOC_BADGE_VARIANT[d.verificationStatus] ?? 'pending'}>
                                    {d.verificationStatus}
                                  </Badge>
                                </div>
                              </li>
                            ))}
                          </ul>
                        )}
                      </td>
                      <td>{formatDate(r.requestedAt)}</td>
                      <td>
                        <Badge variant={STATUS_BADGE_VARIANT[r.status] ?? 'pending'}>{STATUS_LABEL[r.status]}</Badge>
                      </td>
                      <td>
                        {r.status === 'PENDING_VERIFICATION' && (
                          <div className="row-actions">
                            <button
                              type="button"
                              className="action-btn approve"
                              title="Approve"
                              aria-label={`Approve ${r.serviceType.name} for ${r.worker.fullName}`}
                              disabled={actioningId === r.id}
                              onClick={() => handleApprove(r)}
                            >
                              <i className="fas fa-check" />
                            </button>
                            <button
                              type="button"
                              className="action-btn delete"
                              title="Reject"
                              aria-label={`Reject ${r.serviceType.name} for ${r.worker.fullName}`}
                              onClick={() => {
                                setRejecting(r)
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

      {rejecting && (
        <div className="modal-backdrop" onClick={() => setRejecting(null)} role="presentation">
          <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <h2 className="modal-title">Reject Service Request</h2>
            <p className="modal-body">
              Tell {rejecting.worker.fullName} why they can't offer {rejecting.serviceType.name} yet. They can request
              it again with new documents.
            </p>
            <div className="form-field">
              <label htmlFor="service-reject-reason">Reason</label>
              <input
                id="service-reject-reason"
                type="text"
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="e.g. The certificate is for a different trade"
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
                disabled={submittingReject || !rejectReason.trim()}
                onClick={handleReject}
              >
                {submittingReject ? 'Rejecting...' : 'Reject'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
