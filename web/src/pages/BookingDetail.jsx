import { useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import PageHeader from '../components/common/PageHeader'
import SubNav from '../components/common/SubNav'
import Badge from '../components/common/Badge'
import LoadingState from '../components/common/LoadingState'
import ErrorState from '../components/common/ErrorState'
import { useDetailQuery } from '../hooks/useListQuery'
import { fetchBookingById, cancelBookingAdmin } from '../services/bookings'
import { useToast } from '../context/ToastContext'

const SUB_NAV = [
  { to: '/bookings', label: 'All Bookings' },
  { to: '/bookings/dispute', label: 'Booking Dispute' },
]

const TERMINAL_STATUSES = ['Completed', 'Cancelled', 'Rejected']

export default function BookingDetail() {
  const { id } = useParams()
  const { data: booking, loading, error, reload } = useDetailQuery(fetchBookingById, id)
  const { showSuccess, showError } = useToast()
  const [cancelModalOpen, setCancelModalOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [submitting, setSubmitting] = useState(false)

  if (loading) return <LoadingState message="Loading booking..." />
  if (error) return <ErrorState message={error} onRetry={reload} />
  if (!booking) return <Navigate to="/bookings" replace />

  const canCancel = !TERMINAL_STATUSES.includes(booking.status)

  const handleForceCancel = async () => {
    setSubmitting(true)
    try {
      await cancelBookingAdmin(booking.id, reason.trim() || 'Cancelled by admin')
      showSuccess('Booking cancelled and payment hold released.')
      setCancelModalOpen(false)
      setReason('')
      reload()
    } catch (err) {
      showError(err.message || 'Failed to cancel booking')
    } finally {
      setSubmitting(false)
    }
  }

  const details = [
    { label: 'Booking ID', value: booking.displayId },
    { label: 'Client', value: booking.client },
    { label: 'Worker', value: booking.worker },
    { label: 'Service', value: booking.service },
    { label: 'Date & Time', value: booking.date },
    {
      label: 'Status',
      value: <Badge variant={booking.status === 'Completed' ? 'approved' : 'pending'}>{booking.status}</Badge>,
    },
    { label: 'Amount', value: booking.amount },
  ]

  return (
    <>
      <PageHeader
        title="Booking Detail"
        subtitle={`Booking ${booking.displayId}`}
        actions={
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            {canCancel && (
              <button type="button" className="btn btn-danger" onClick={() => setCancelModalOpen(true)}>
                Force Cancel
              </button>
            )}
            <Link to="/bookings" className="btn btn-outline">Back</Link>
          </div>
        }
      />
      <div className="detail-grid">
        {details.map(({ label, value }) => (
          <div key={label} className="detail-block">
            <label>{label}</label>
            <div className="value">{value}</div>
          </div>
        ))}
      </div>
      <SubNav items={SUB_NAV} />

      {cancelModalOpen && (
        <div className="modal-backdrop" onClick={() => setCancelModalOpen(false)} role="presentation">
          <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <h2 className="modal-title">Force cancel this booking?</h2>
            <p className="modal-body">
              This immediately cancels booking {booking.displayId} and releases/refunds any held payment. This
              can&apos;t be undone.
            </p>
            <label htmlFor="cancel-reason" style={{ display: 'block', margin: '0.75rem 0 0.35rem', fontWeight: 600 }}>
              Reason
            </label>
            <textarea
              id="cancel-reason"
              className="form-input"
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Why is this booking being force-cancelled?"
              style={{ width: '100%', resize: 'vertical' }}
            />
            <div className="modal-actions">
              <button type="button" className="btn btn-outline" onClick={() => setCancelModalOpen(false)} disabled={submitting}>
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
