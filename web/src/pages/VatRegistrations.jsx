import { useCallback, useState } from 'react'
import PageHeader from '../components/common/PageHeader'
import SubNav from '../components/common/SubNav'
import SectionCard from '../components/common/SectionCard'
import LoadingState from '../components/common/LoadingState'
import ErrorState from '../components/common/ErrorState'
import Badge from '../components/common/Badge'
import { useListQuery } from '../hooks/useListQuery'
import { fetchVatRegistrations, approveVatRegistration, rejectVatRegistration } from '../services/vat'
import { useToast } from '../context/ToastContext'

const SUB_NAV = [
  { to: '/payments', label: 'All Transactions' },
  { to: '/payments/refunds', label: 'Refund History' },
  { to: '/payments/payouts', label: 'Payout Distribution' },
  { to: '/payments/tax-certificates', label: 'Tax Certificates' },
  { to: '/payments/tax-remittance', label: 'Tax Remittance' },
  { to: '/payments/vat-registrations', label: 'VAT Registrations' },
]

const STATUS_BADGE_VARIANT = { PENDING: 'pending', APPROVED: 'active', REJECTED: 'suspended' }

function formatDate(value) {
  if (!value) return '—'
  return new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function VatRegistrations() {
  const { showError, showSuccess } = useToast()
  const [statusFilter, setStatusFilter] = useState('PENDING')
  const [actioningId, setActioningId] = useState(null)
  const [rejectingWorker, setRejectingWorker] = useState(null)
  const [rejectReason, setRejectReason] = useState('')
  const [rejecting, setRejecting] = useState(false)

  const fetchFn = useCallback(() => fetchVatRegistrations(statusFilter), [statusFilter])
  const { data: registrations, loading, error, reload, setData } = useListQuery(fetchFn)

  const handleApprove = async (workerId) => {
    setActioningId(workerId)
    try {
      await approveVatRegistration(workerId)
      setData((prev) => prev.filter((r) => r.userId !== workerId))
      showSuccess('VAT registration approved.')
    } catch (err) {
      showError(err.message || 'Failed to approve')
    } finally {
      setActioningId(null)
    }
  }

  const openReject = (registration) => {
    setRejectingWorker(registration)
    setRejectReason('')
  }

  const handleReject = async () => {
    if (!rejectReason.trim()) return
    setRejecting(true)
    try {
      await rejectVatRegistration(rejectingWorker.userId, rejectReason.trim())
      setData((prev) => prev.filter((r) => r.userId !== rejectingWorker.userId))
      showSuccess('VAT registration rejected.')
      setRejectingWorker(null)
    } catch (err) {
      showError(err.message || 'Failed to reject')
    } finally {
      setRejecting(false)
    }
  }

  return (
    <>
      <PageHeader
        title="VAT Registrations"
        subtitle="Review worker-submitted proof of VAT registration before it affects any booking's pricing"
      />
      <SubNav items={SUB_NAV} />
      <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', margin: '0.5rem 0 1rem' }}>
        Approving here is the only thing that makes VAT apply to a worker's future bookings — submitting a document
        alone does nothing. None of this platform's trades are BIR-licensed professions, so one ATC code covers
        every worker regardless of VAT status (see Settings for the code on file).
      </p>
      <div className="toolbar">
        <select
          className="form-input"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          style={{ maxWidth: '160px' }}
        >
          <option value="PENDING">Pending</option>
          <option value="APPROVED">Approved</option>
          <option value="REJECTED">Rejected</option>
          <option value="ALL">All</option>
        </select>
      </div>
      <SectionCard title="Registrations">
        {loading && <LoadingState message="Loading registrations..." />}
        {error && <ErrorState message={error} onRetry={reload} />}
        {!loading && !error && (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Worker</th><th>Submitted</th><th>Document</th><th>Status</th><th></th>
                </tr>
              </thead>
              <tbody>
                {registrations.length === 0 ? (
                  <tr>
                    <td colSpan={5} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
                      No {statusFilter !== 'ALL' ? statusFilter.toLowerCase() : ''} registrations.
                    </td>
                  </tr>
                ) : (
                  registrations.map((r) => (
                    <tr key={r.userId}>
                      <td>
                        <strong>{r.user?.fullName}</strong>
                        <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>{r.user?.email}</div>
                      </td>
                      <td>{formatDate(r.vatSubmittedAt)}</td>
                      <td>
                        {r.vatDocumentUrl ? (
                          <a href={r.vatDocumentUrl} target="_blank" rel="noopener noreferrer">
                            View
                          </a>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td>
                        <Badge variant={STATUS_BADGE_VARIANT[r.vatVerificationStatus] ?? 'pending'}>
                          {r.vatVerificationStatus}
                        </Badge>
                        {r.vatVerificationStatus === 'REJECTED' && r.vatRejectionReason && (
                          <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem', marginTop: '0.2rem' }}>
                            {r.vatRejectionReason}
                          </div>
                        )}
                      </td>
                      <td>
                        {r.vatVerificationStatus === 'PENDING' && (
                          <div className="row-actions">
                            <button
                              type="button"
                              className="action-btn approve"
                              title="Approve"
                              aria-label={`Approve ${r.user?.fullName}`}
                              disabled={actioningId === r.userId}
                              onClick={() => handleApprove(r.userId)}
                            >
                              <i className="fas fa-check" />
                            </button>
                            <button
                              type="button"
                              className="action-btn delete"
                              title="Reject"
                              aria-label={`Reject ${r.user?.fullName}`}
                              onClick={() => openReject(r)}
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

      {rejectingWorker && (
        <div className="modal-backdrop" onClick={() => setRejectingWorker(null)} role="presentation">
          <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <h2 className="modal-title">Reject VAT Registration</h2>
            <p className="modal-body">
              Tell {rejectingWorker.user?.fullName} why this submission was rejected.
            </p>
            <div className="form-field">
              <label htmlFor="vat-reject-reason">Reason</label>
              <input
                id="vat-reject-reason"
                type="text"
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="e.g. Document is illegible, please re-upload"
                style={{ width: '100%', padding: '0.5rem 0.75rem', border: '1px solid var(--border)', borderRadius: 8 }}
              />
            </div>
            <div className="modal-actions">
              <button type="button" className="btn btn-outline" onClick={() => setRejectingWorker(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={rejecting || !rejectReason.trim()}
                onClick={handleReject}
              >
                {rejecting ? 'Rejecting...' : 'Reject'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
