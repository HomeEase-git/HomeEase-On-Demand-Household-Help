import { useState } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import PageHeader from '../components/common/PageHeader'
import SectionCard from '../components/common/SectionCard'
import DocumentViewer from '../components/common/DocumentViewer'
import LoadingState from '../components/common/LoadingState'
import ErrorState from '../components/common/ErrorState'
import Badge from '../components/common/Badge'
import { useDetailQuery } from '../hooks/useListQuery'
import {
  fetchVerificationById,
  approveVerification,
  rejectVerification,
  rerunVerification,
} from '../services/verification'

export default function VerificationDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { data: verification, loading, error, reload } = useDetailQuery(fetchVerificationById, id)

  const [mode, setMode] = useState(null)
  const [rejectReason, setRejectReason] = useState('')
  const [adminOverrideReason, setAdminOverrideReason] = useState('')
  const [rerunError, setRerunError] = useState(null)
  const [actionError, setActionError] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [rerunning, setRerunning] = useState(false)

  const closeModal = () => {
    setMode(null)
    setRejectReason('')
    setAdminOverrideReason('')
    setActionError(null)
  }

  const handleApprove = async () => {
    setSubmitting(true)
    setActionError(null)
    try {
      await approveVerification(id, adminOverrideReason)
      setMode('success')
    } catch (err) {
      setActionError(err.message || 'Failed to approve verification')
    } finally {
      setSubmitting(false)
    }
  }

  const handleRerun = async () => {
    setRerunning(true)
    setRerunError(null)
    try {
      await rerunVerification(id)
      reload()
    } catch (err) {
      setRerunError(err.message || 'Failed to queue AI rerun')
    } finally {
      setRerunning(false)
    }
  }

  const handleReject = async (e) => {
    e.preventDefault()
    setSubmitting(true)
    setActionError(null)
    try {
      await rejectVerification(id, rejectReason)
      navigate('/verification', { replace: true })
    } catch (err) {
      setActionError(err.message || 'Failed to reject verification')
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return <LoadingState message="Loading verification details..." />
  }

  if (error) {
    return <ErrorState message={error} onRetry={reload} />
  }

  if (!verification) {
    return <Navigate to="/verification" replace />
  }

  const isPending = verification.status === 'PENDING' || verification.status === 'AI_REVIEWED'

  const details = [
    { label: 'Applicant', value: verification.name },
    { label: 'Email', value: verification.email },
    { label: 'Type', value: verification.type },
    { label: 'Submitted', value: verification.submitted },
    { label: 'Document Type', value: verification.documentType },
    { label: 'Services / Reason', value: verification.services },
    {
      label: 'Status',
      value: (
        <Badge variant={verification.status === 'APPROVED' ? 'approved' : verification.status === 'REJECTED' ? 'flagged' : 'pending'}>
          {verification.status}
        </Badge>
      ),
    },
    verification.adminOverrideReason
      ? { label: 'Admin Override Reason', value: verification.adminOverrideReason }
      : null,
    verification.aiStatus ? { label: 'AI Status', value: verification.aiStatus } : null,
  ].filter(Boolean)

  return (
    <>
      <PageHeader
        title="Verification Detail Review"
        subtitle="Review documents and approve or reject"
        actions={<Link to="/verification" className="btn btn-outline">Back to Pending</Link>}
      />
      <div className="detail-grid">
        {details.map(({ label, value }) => (
          <div key={label} className="detail-block">
            <label>{label}</label>
            <div className="value" style={label === 'Type' ? { textTransform: 'capitalize' } : undefined}>
              {value}
            </div>
          </div>
        ))}
      </div>
      <SectionCard title="AI Review Summary">
        {verification.aiSummary ? (
          <div className="detail-block">
            <label>Summary</label>
            <div className="value">{verification.aiSummary}</div>
            {verification.aiConfidence != null && (
              <div className="value" style={{ marginTop: '0.5rem', color: '#4b5563' }}>
                Confidence: {(verification.aiConfidence * 100).toFixed(0)}%
              </div>
            )}
            {verification.aiError && (
              <div className="value" style={{ marginTop: '0.5rem', color: '#b91c1c' }}>
                Error: {verification.aiError}
              </div>
            )}
          </div>
        ) : (
          <div className="value">No AI review has been completed yet.</div>
        )}

        {(verification.status !== 'APPROVED' && verification.status !== 'REJECTED') && (
          <div style={{ marginTop: '1rem' }}>
            <button
              type="button"
              className="btn btn-outline"
              onClick={handleRerun}
              disabled={rerunning}
            >
              {rerunning ? 'Queueing AI rerun...' : 'Re-run AI Review'}
            </button>
            {rerunError && <div className="form-error" style={{ marginTop: '0.75rem' }}>{rerunError}</div>}
          </div>
        )}
      </SectionCard>
      <SectionCard title="Uploaded Documents">
        <DocumentViewer documents={verification.documents} />
      </SectionCard>
      {isPending && (
        <div className="cta-buttons">
          <button type="button" className="btn btn-success" onClick={() => setMode('approve')}>
            Approve Verification
          </button>
          <button type="button" className="btn btn-danger" onClick={() => setMode('reject')}>
            Reject Verification
          </button>
        </div>
      )}

      {mode === 'approve' && (
        <div className="modal-backdrop" onClick={closeModal} role="presentation">
          <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <h2 className="modal-title">Approve Verification</h2>
            <p className="modal-body">
              Are you sure you want to approve verification for <strong>{verification.name}</strong>?
            </p>
            <form>
              <div className="form-field">
                <label htmlFor="admin-override-reason">Admin Override Reason (optional)</label>
                <textarea
                  id="admin-override-reason"
                  rows={3}
                  value={adminOverrideReason}
                  onChange={(e) => setAdminOverrideReason(e.target.value)}
                  className="form-textarea"
                />
              </div>
            </form>
            {actionError && <div className="form-error">{actionError}</div>}
            <div className="modal-actions">
              <button type="button" className="btn btn-outline" onClick={closeModal} disabled={submitting}>
                Cancel
              </button>
              <button type="button" className="btn btn-success" onClick={handleApprove} disabled={submitting}>
                {submitting ? 'Approving...' : 'Approve'}
              </button>
            </div>
          </div>
        </div>
      )}

      {mode === 'reject' && (
        <div className="modal-backdrop" onClick={closeModal} role="presentation">
          <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <h2 className="modal-title">Reject Verification</h2>
            <p className="modal-body">Provide a reason for rejecting this verification.</p>
            <form onSubmit={handleReject}>
              <div className="form-field">
                <label htmlFor="reject-reason-detail">Rejection Reason</label>
                <textarea
                  id="reject-reason-detail"
                  rows={3}
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  required
                  className="form-textarea"
                />
              </div>
              {actionError && <div className="form-error">{actionError}</div>}
              <div className="modal-actions" style={{ marginTop: '1rem' }}>
                <button type="button" className="btn btn-outline" onClick={closeModal} disabled={submitting}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-danger" disabled={submitting}>
                  {submitting ? 'Rejecting...' : 'Confirm Reject'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {mode === 'success' && (
        <div className="modal-backdrop" onClick={() => navigate('/verification')} role="presentation">
          <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <h2 className="modal-title">Verification Approved</h2>
            <p className="modal-body">
              The verification for <strong>{verification.name}</strong> has been approved successfully.
            </p>
            <div className="modal-actions">
              <button type="button" className="btn btn-primary" onClick={() => navigate('/verification')}>
                OK
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
