import { useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import PageHeader from '../components/common/PageHeader'
import SectionCard from '../components/common/SectionCard'
import Badge from '../components/common/Badge'
import { getBookingStatusVariant } from '../utils/statusBadge'
import LoadingState from '../components/common/LoadingState'
import ErrorState from '../components/common/ErrorState'
import { useDetailQuery } from '../hooks/useListQuery'
import { fetchClientById, suspendUser, reinstateUser } from '../services/users'
import { cancelBookingAdmin } from '../services/bookings'
import { useToast } from '../context/ToastContext'

const ACTIVE_BOOKING_STATUSES = ['PENDING', 'ACCEPTED', 'IN_PROGRESS', 'QUOTE_SUBMITTED', 'QUOTE_APPROVED', 'DISPUTED', 'PENDING_COMPLETION']

export default function ClientDetail() {
  const { id } = useParams()
  const { data: client, loading, error, reload } = useDetailQuery(fetchClientById, id)
  const { showSuccess, showError } = useToast()
  const [statusModalOpen, setStatusModalOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [refundTarget, setRefundTarget] = useState(null)
  const [submitting, setSubmitting] = useState(false)

  if (loading) return <LoadingState message="Loading client..." />
  if (error) return <ErrorState message={error} onRetry={reload} />
  if (!client) return <Navigate to="/users" replace />

  const isSuspended = client.status !== 'active'

  const handleToggleStatus = async () => {
    setSubmitting(true)
    try {
      if (isSuspended) {
        await reinstateUser(client.id, reason.trim() || 'Reinstated by admin')
        showSuccess('Client account reinstated.')
      } else {
        await suspendUser(client.id, reason.trim() || 'Suspended by admin')
        showSuccess('Client account suspended.')
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

  const handleRefund = async () => {
    if (!refundTarget) return
    setSubmitting(true)
    try {
      await cancelBookingAdmin(refundTarget.bookingId, reason.trim() || 'Manual refund by admin')
      showSuccess(`Booking ${refundTarget.id} cancelled and refunded.`)
      setRefundTarget(null)
      setReason('')
      reload()
    } catch (err) {
      showError(err.message || 'Failed to process refund')
    } finally {
      setSubmitting(false)
    }
  }

  const details = [
    { label: 'Client ID', value: client.displayId },
    { label: 'Full Name', value: client.name },
    { label: 'Email', value: client.email },
    { label: 'Phone', value: client.phone },
    {
      label: 'Status',
      value: <Badge variant={client.status === 'active' ? 'active' : 'suspended'}>{client.status}</Badge>,
    },
    { label: 'Total Bookings', value: String(client.bookings) },
    { label: 'Total Spent', value: client.spent },
    { label: 'Joined', value: client.joined },
  ]

  return (
    <>
      <PageHeader
        title="Client Detail"
        subtitle="View and manage client information"
        actions={(
          <>
            <Link to="/users" className="btn btn-outline">Back to Users</Link>
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
        <p style={{ color: 'var(--text-muted)', fontSize: '0.8125rem', marginBottom: '0.75rem' }}>
          Manual refund cancels the booking and releases its held payment — only available while the booking&apos;s
          payment hold hasn&apos;t been released to the worker yet (i.e. not yet Completed).
        </p>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Booking ID</th><th>Service</th><th>Worker</th><th>Date</th><th>Status</th><th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {(client.recentBookings || []).length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>No bookings yet.</td>
                </tr>
              ) : (
                client.recentBookings.map((b) => (
                  <tr key={b.bookingId}>
                    <td>{b.id}</td>
                    <td>{b.service}</td>
                    <td>{b.worker}</td>
                    <td>{b.date}</td>
                    <td><Badge variant={getBookingStatusVariant(b.status)}>{b.status}</Badge></td>
                    <td>
                      {ACTIVE_BOOKING_STATUSES.includes(b.status) ? (
                        <button
                          type="button"
                          className="btn btn-outline"
                          style={{ padding: '0.25rem 0.5rem', fontSize: '0.8125rem' }}
                          onClick={() => setRefundTarget(b)}
                        >
                          Refund
                        </button>
                      ) : (
                        <span style={{ color: 'var(--text-muted)', fontSize: '0.8125rem' }}>—</span>
                      )}
                    </td>
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
            <h2 className="modal-title">{isSuspended ? 'Reinstate' : 'Suspend'} {client.name}?</h2>
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

      {refundTarget && (
        <div className="modal-backdrop" onClick={() => setRefundTarget(null)} role="presentation">
          <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <h2 className="modal-title">Refund booking {refundTarget.id}?</h2>
            <p className="modal-body">This cancels the booking and releases its held payment back to the client.</p>
            <label htmlFor="refund-reason" style={{ display: 'block', margin: '0.5rem 0 0.35rem', fontWeight: 600 }}>
              Reason
            </label>
            <textarea
              id="refund-reason"
              className="form-input"
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Why is this refund being issued?"
              style={{ width: '100%', resize: 'vertical' }}
            />
            <div className="modal-actions">
              <button type="button" className="btn btn-outline" onClick={() => setRefundTarget(null)} disabled={submitting}>
                Cancel
              </button>
              <button type="button" className="btn btn-danger" onClick={handleRefund} disabled={submitting}>
                {submitting ? 'Processing...' : 'Confirm Refund'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
