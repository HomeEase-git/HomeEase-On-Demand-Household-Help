import { useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import PageHeader from '../components/common/PageHeader'
import SectionCard from '../components/common/SectionCard'
import Badge from '../components/common/Badge'
import LoadingState from '../components/common/LoadingState'
import ErrorState from '../components/common/ErrorState'
import { useDetailQuery } from '../hooks/useListQuery'
import { fetchWorkerById } from '../services/workers'
import { suspendUser, reinstateUser } from '../services/users'
import { useToast } from '../context/ToastContext'

export default function WorkerDetail() {
  const { id } = useParams()
  const { data: worker, loading, error, reload } = useDetailQuery(fetchWorkerById, id)
  const { showSuccess, showError } = useToast()
  const [statusModalOpen, setStatusModalOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [submitting, setSubmitting] = useState(false)

  if (loading) return <LoadingState message="Loading worker..." />
  if (error) return <ErrorState message={error} onRetry={reload} />
  if (!worker) return <Navigate to="/workers" replace />

  const isSuspended = worker.accountStatus !== 'active'

  const handleToggleStatus = async () => {
    setSubmitting(true)
    try {
      if (isSuspended) {
        await reinstateUser(worker.id, reason.trim() || 'Reinstated by admin')
        showSuccess('Worker account reinstated.')
      } else {
        await suspendUser(worker.id, reason.trim() || 'Suspended by admin')
        showSuccess('Worker account suspended.')
      }
      setStatusModalOpen(false)
      setReason('')
      reload()
    } catch (err) {
      showError(err.message || 'Failed to update account status')
    } finally {
      setSubmitting(false)
    }
  }

  const details = [
    { label: 'Worker ID', value: worker.displayId },
    { label: 'Full Name', value: worker.name },
    { label: 'Email', value: worker.email },
    { label: 'Services', value: worker.services },
    { label: 'Rating', value: `★ ${worker.rating} (${worker.reviews} reviews)` },
    { label: 'Total Earnings', value: worker.earnings },
    {
      label: 'Verification',
      value: (
        <Badge variant={worker.verification === 'Verified' ? 'approved' : 'pending'}>
          {worker.verification}
        </Badge>
      ),
    },
    {
      label: 'Account Status',
      value: <Badge variant={worker.accountStatus === 'active' ? 'active' : 'suspended'}>{worker.accountStatus}</Badge>,
    },
    { label: 'Joined', value: worker.joined },
  ]

  return (
    <>
      <PageHeader
        title="Worker Detail"
        subtitle="View and manage worker profile"
        actions={(
          <>
            <Link to="/workers" className="btn btn-outline">Back to Workers</Link>
            <button
              type="button"
              className={isSuspended ? 'btn btn-success' : 'btn btn-danger'}
              onClick={() => setStatusModalOpen(true)}
            >
              {isSuspended ? 'Reinstate Account' : 'Suspend Account'}
            </button>
          </>
        )}
      />
      <div className="detail-grid">
        {details.map(({ label, value }) => (
          <div key={label} className="detail-block">
            <label>{label}</label>
            <div className="value">{value}</div>
          </div>
        ))}
      </div>
      <SectionCard title="Recent Bookings">
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Booking ID</th><th>Client</th><th>Service</th><th>Date</th><th>Earnings</th>
              </tr>
            </thead>
            <tbody>
              {(worker.recentBookings || []).length === 0 ? (
                <tr>
                  <td colSpan={5} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>No bookings yet.</td>
                </tr>
              ) : (
                worker.recentBookings.map((b) => (
                  <tr key={b.bookingId}>
                    <td>{b.id}</td>
                    <td>{b.client}</td>
                    <td>{b.service}</td>
                    <td>{b.date}</td>
                    <td>{b.earnings}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </SectionCard>

      {statusModalOpen && (
        <div className="modal-backdrop" onClick={() => setStatusModalOpen(false)} role="presentation">
          <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <h2 className="modal-title">{isSuspended ? 'Reinstate' : 'Suspend'} {worker.name}?</h2>
            {!isSuspended && (
              <p className="modal-body">
                Suspending blocks this worker from accepting new bookings and being surfaced in discovery until
                reinstated.
              </p>
            )}
            <label htmlFor="status-reason" style={{ display: 'block', margin: '0.5rem 0 0.35rem', fontWeight: 600 }}>
              Reason
            </label>
            <textarea
              id="status-reason"
              className="form-input"
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={isSuspended ? 'Why is this account being reinstated?' : 'Why is this account being suspended?'}
              style={{ width: '100%', resize: 'vertical' }}
            />
            <div className="modal-actions">
              <button type="button" className="btn btn-outline" onClick={() => setStatusModalOpen(false)} disabled={submitting}>
                Cancel
              </button>
              <button
                type="button"
                className={isSuspended ? 'btn btn-success' : 'btn btn-danger'}
                onClick={handleToggleStatus}
                disabled={submitting}
              >
                {submitting ? 'Saving...' : isSuspended ? 'Confirm Reinstate' : 'Confirm Suspend'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
