import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import PageHeader from '../components/common/PageHeader'
import SubNav from '../components/common/SubNav'
import { BOOKINGS_SUB_NAV } from '../constants/bookingsSubNav'
import SectionCard from '../components/common/SectionCard'
import Badge from '../components/common/Badge'
import { getBookingStatusVariant } from '../utils/statusBadge'
import LoadingState from '../components/common/LoadingState'
import ErrorState from '../components/common/ErrorState'
import { useDetailQuery } from '../hooks/useListQuery'
import { fetchBookingById, cancelBookingAdmin } from '../services/bookings'
import { useToast } from '../context/ToastContext'


const TERMINAL_STATUSES = ['Completed', 'Cancelled', 'Rejected']

const peso = (n) => `₱${Number(n ?? 0).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`

function formatTime12h(time) {
  if (!time) return ''
  const [h, m] = time.split(':').map(Number)
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`
}

const CANCELLATION_REVIEW_LABEL = {
  PENDING_REVIEW: { variant: 'pending', label: 'Waiting for admin review' },
  APPROVED: { variant: 'approved', label: 'Approved — client at fault' },
  REJECTED: { variant: 'flagged', label: 'Rejected — worker at fault' },
}

function PhotoRow({ urls, alt }) {
  if (!urls?.length) return <span className="text-muted">None</span>
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
      {urls.map((url, idx) => (
        <a key={url} href={url} target="_blank" rel="noopener noreferrer" title={`${alt} ${idx + 1}`}>
          <img
            src={url}
            alt={`${alt} ${idx + 1}`}
            style={{ width: '96px', height: '96px', objectFit: 'cover', borderRadius: '6px', border: '1px solid var(--border-color, #ddd)' }}
          />
        </a>
      ))}
    </div>
  )
}

export default function BookingDetail() {
  const { id } = useParams()
  const { data: booking, loading, error, reload } = useDetailQuery(fetchBookingById, id)
  const { showSuccess, showError } = useToast()
  const [cancelModalOpen, setCancelModalOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [submitting, setSubmitting] = useState(false)

  if (loading) return <LoadingState variant="detail" message="Loading booking..." />
  if (error) return <ErrorState message={error} onRetry={reload} />
  if (!booking) {
    return (
      <SectionCard>
        <p className="text-muted">Booking not found. <Link to="/bookings">Back to Bookings</Link></p>
      </SectionCard>
    )
  }

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
      value: <Badge variant={getBookingStatusVariant(booking.status)}>{booking.status}</Badge>,
    },
    {
      label: 'Same-Day',
      value: booking.isRush ? (
        <Badge variant="pending">Same-day · +{peso(booking.rushFee)}</Badge>
      ) : (
        'No'
      ),
    },
    { label: 'Amount', value: booking.amount },
    ...(booking.parentBookingId
      ? [
          {
            label: 'Follow-up Of',
            value: <Link to={`/bookings/detail/${booking.parentBookingId}`}>View inspection booking</Link>,
          },
        ]
      : []),
    ...(booking.selfDealingFlag
      ? [
          {
            label: 'Flag',
            value: (
              <span title="The client and assigned worker share a phone number">
                <Badge variant="flagged">Possible Self-Dealing</Badge>
              </span>
            ),
          },
        ]
      : []),
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
      <SubNav items={BOOKINGS_SUB_NAV} />

      {booking.visits?.length > 0 && (
        <SectionCard title="Follow-up Visits">
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Start</th>
                  <th>Status</th>
                  <th>Notes</th>
                </tr>
              </thead>
              <tbody>
                {booking.visits.map((v) => (
                  <tr key={v.id}>
                    <td>{new Date(`${v.date}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })}</td>
                    <td>{formatTime12h(v.time)}</td>
                    <td>{v.status.charAt(0) + v.status.slice(1).toLowerCase()}</td>
                    <td>{v.notes || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SectionCard>
      )}

      {booking.quote && (
        <SectionCard title={`Quote${booking.quote.revision > 0 ? ` (revision ${booking.quote.revision + 1})` : ''}`}>
          <div className="detail-grid">
            <div className="detail-block">
              <label>Status</label>
              <div className="value">{booking.quote.status ? booking.quote.status.replace(/_/g, ' ') : '—'}</div>
            </div>
            <div className="detail-block">
              <label>Service</label>
              <div className="value">{booking.quote.laborCost != null ? peso(booking.quote.laborCost) : '—'}</div>
            </div>
            <div className="detail-block">
              <label>Materials</label>
              <div className="value">{peso(booking.quote.materialsCost)}</div>
            </div>
            {booking.quote.notes && (
              <div className="detail-block detail-block--full">
                <label>Worker&apos;s Notes</label>
                <div className="value">{booking.quote.notes}</div>
              </div>
            )}
            {booking.quote.rejectionReason && (
              <div className="detail-block detail-block--full">
                <label>Client Refused Because</label>
                <div className="value">{booking.quote.rejectionReason}</div>
              </div>
            )}
            <div className="detail-block detail-block--full">
              <label>Receipts</label>
              <div className="value">
                <PhotoRow urls={booking.quote.receiptUrls} alt="Receipt" />
              </div>
            </div>
            <div className="detail-block detail-block--full">
              <label>Materials In Use</label>
              <div className="value">
                <PhotoRow urls={booking.quote.proofOfUseUrls} alt="Materials in use" />
              </div>
            </div>
          </div>
        </SectionCard>
      )}

      {booking.cancellation && (
        <SectionCard title="Cancellation">
          <div className="detail-grid">
            <div className="detail-block">
              <label>Cancelled By</label>
              <div className="value">{booking.cancellation.cancelledBy ?? '—'}</div>
            </div>
            <div className="detail-block">
              <label>Fault</label>
              <div className="value">{booking.cancellation.fault ?? '—'}</div>
            </div>
            {booking.cancellation.penaltyAmount != null && (
              <div className="detail-block">
                <label>Worker Penalty</label>
                <div className="value">{peso(booking.cancellation.penaltyAmount)}</div>
              </div>
            )}
            {booking.cancellation.compensationStatus && (
              <div className="detail-block">
                <label>Client-Fault Review</label>
                <div className="value">
                  <Badge variant={CANCELLATION_REVIEW_LABEL[booking.cancellation.compensationStatus]?.variant ?? 'pending'}>
                    {CANCELLATION_REVIEW_LABEL[booking.cancellation.compensationStatus]?.label ??
                      booking.cancellation.compensationStatus}
                  </Badge>
                  {booking.cancellation.compensationStatus === 'PENDING_REVIEW' && (
                    <div style={{ marginTop: '0.35rem' }}>
                      <Link to="/bookings/cancellations">Review it</Link>
                    </div>
                  )}
                </div>
              </div>
            )}
            {booking.cancellation.reason && (
              <div className="detail-block detail-block--full">
                <label>Reason</label>
                <div className="value">{booking.cancellation.reason}</div>
              </div>
            )}
            {booking.cancellation.proofUrls?.length > 0 && (
              <div className="detail-block detail-block--full">
                <label>Proof</label>
                <div className="value">
                  <PhotoRow urls={booking.cancellation.proofUrls} alt="Cancellation proof" />
                </div>
              </div>
            )}
            {booking.cancellation.reviewNote && (
              <div className="detail-block detail-block--full">
                <label>Review Note</label>
                <div className="value">{booking.cancellation.reviewNote}</div>
              </div>
            )}
          </div>
        </SectionCard>
      )}

      {cancelModalOpen && (
        <div className="modal-backdrop" onClick={() => setCancelModalOpen(false)} role="presentation">
          <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <h2 className="modal-title">Force cancel this booking?</h2>
            <p className="modal-body">
              This immediately cancels booking {booking.displayId} and releases/refunds any held payment. This
              can&apos;t be undone.
            </p>
            <label htmlFor="cancel-reason" className="form-label form-label--spaced">
              Reason
            </label>
            <textarea
              id="cancel-reason"
              className="form-input field-full field-textarea"
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Why is this booking being force-cancelled?"
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
