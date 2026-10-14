import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { Link } from 'react-router-dom'
import PageHeader from '../components/common/PageHeader'
import SubNav from '../components/common/SubNav'
import SectionCard from '../components/common/SectionCard'
import LoadingState from '../components/common/LoadingState'
import ErrorState from '../components/common/ErrorState'
import { useDetailQuery } from '../hooks/useListQuery'
import { fetchReviewById, updateReview, warnReviewAuthor, warnedParty } from '../services/reviews'
import { useToast } from '../context/ToastContext'

const SUB_NAV = [
  { to: '/reviews', label: 'All Reviews' },
  { to: '/reviews/flagged', label: 'Flagged Reviews' },
]

const MIN_WARN_REASON_LENGTH = 10

export default function ReviewDetail() {
  const { id } = useParams()
  const { data: review, loading, error, reload } = useDetailQuery(fetchReviewById, id)
  const { showSuccess, showError } = useToast()
  const [warnModalOpen, setWarnModalOpen] = useState(false)
  const [warnReason, setWarnReason] = useState('')
  const [warnSubmitting, setWarnSubmitting] = useState(false)

  const dismissFlag = async () => {
    try {
      // Clears the flag only — no change to status/visibility. For a report
      // that turns out to be nothing; anything serious enough to act on
      // goes through Warn User instead.
      await updateReview(id, { flagged: false })
      await reload()
      showSuccess('Flag dismissed.')
    } catch (err) {
      showError(err.message || 'Failed to update review')
    }
  }

  const closeWarnModal = () => {
    setWarnModalOpen(false)
    setWarnReason('')
  }

  const confirmWarnUser = async () => {
    if (warnReason.trim().length < MIN_WARN_REASON_LENGTH) return
    setWarnSubmitting(true)
    try {
      const result = await warnReviewAuthor(review, warnReason.trim())
      await reload()
      showSuccess(
        result.suspended
          ? `Warning ${result.warningCount}: account suspended.`
          : `User warned (${result.warningCount} of 3).`,
      )
      closeWarnModal()
    } catch (err) {
      showError(err.message || 'Failed to update review')
    } finally {
      setWarnSubmitting(false)
    }
  }

  if (loading) {
    return <LoadingState variant="detail" message="Loading review details..." />
  }

  if (error) {
    return <ErrorState message={error} onRetry={reload} />
  }

  if (!review) {
    return (
      <SectionCard>
        <p className="text-muted">Review not found.</p>
      </SectionCard>
    )
  }

  return (
    <>
      <PageHeader
        backTo="/reviews"
        title="Review Detail"
        subtitle={`Review ${review.displayId}`}
        actions={
          <>
            {review.flagged && (
              <button
                type="button"
                className="btn btn-outline"
                style={{ marginRight: '0.5rem' }}
                onClick={dismissFlag}
                title="Dismiss flag (no change to the review)"
              >
                Dismiss Flag
              </button>
            )}
            <button
              type="button"
              className="btn btn-danger"
              style={{ marginRight: '0.5rem' }}
              onClick={() => setWarnModalOpen(true)}
              title="Hide and warn user"
            >
              Warn User
            </button>
          </>
        }
      />
      <SectionCard>
        <div className="detail-grid">
          <div className="detail-block">
            <label>Review ID</label>
            <div className="value">{review.displayId}</div>
          </div>
          <div className="detail-block">
            <label>Booking</label>
            <div className="value">{review.booking}</div>
          </div>
          <div className="detail-block">
            <label>Client</label>
            <div className="value">{review.client}</div>
          </div>
          <div className="detail-block">
            <label>Worker</label>
            <div className="value">{review.worker}</div>
          </div>
          <div className="detail-block">
            <label>Rating</label>
            <div className="value">★ {review.rating}</div>
          </div>
          <div className="detail-block">
            <label>Status</label>
            <div className="value">{review.status}</div>
          </div>
          <div className="detail-block detail-block--full">
            <label>Comment</label>
            <div className="value">{review.comment}</div>
          </div>
          {review.photoUrls?.length > 0 && (
            <div className="detail-block detail-block--full">
              <label>Photos</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 4 }}>
                {review.photoUrls.map((url) => (
                  <a key={url} href={url} target="_blank" rel="noreferrer">
                    <img
                      src={url}
                      alt="Review attachment"
                      style={{ width: 80, height: 80, objectFit: 'cover', borderRadius: 8 }}
                    />
                  </a>
                ))}
              </div>
            </div>
          )}
          {review.flagged && (
            <div className="detail-block detail-block--full">
              <label>Flag Reason ({review.flagTarget === 'RESPONSE' ? "worker's reply" : 'review'} reported)</label>
              <div className="value">{review.flagReason || 'No reason provided'}</div>
            </div>
          )}
          {review.workerResponse && (
            <div className="detail-block detail-block--full">
              <label>Worker's Response</label>
              <div className="value">{review.workerResponse}</div>
            </div>
          )}
        </div>
      </SectionCard>
      <SubNav items={SUB_NAV} />

      {warnModalOpen && (
        <div className="modal-backdrop" onClick={closeWarnModal} role="presentation">
          <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <h2 className="modal-title">Warn User — {review.displayId}</h2>
            <p className="modal-body" style={{ marginBottom: '0.75rem' }}>
              Warns <strong>{warnedParty(review)}</strong>. They get a notification with this reason. 1st warning,
              2nd final warning, 3rd suspends the account. A warned review is taken off the worker&apos;s profile.
            </p>
            <label htmlFor="warn-reason" style={{ display: 'block', marginBottom: '0.35rem', fontWeight: 600 }}>
              Reason for warning (required, at least {MIN_WARN_REASON_LENGTH} characters)
            </label>
            <textarea
              id="warn-reason"
              className="form-input field-full field-textarea"
              rows={3}
              value={warnReason}
              onChange={(e) => setWarnReason(e.target.value)}
              placeholder="Explain why this user is being warned..."
            />
            <div className="modal-actions" style={{ justifyContent: 'flex-end', marginTop: '1rem' }}>
              <button type="button" className="btn btn-outline" onClick={closeWarnModal} disabled={warnSubmitting}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-danger"
                onClick={confirmWarnUser}
                disabled={warnReason.trim().length < MIN_WARN_REASON_LENGTH || warnSubmitting}
              >
                {warnSubmitting ? 'Submitting...' : 'Confirm Warning'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
