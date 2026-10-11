import { useCallback, useMemo, useState } from 'react'
import PageHeader from '../components/common/PageHeader'
import SubNav from '../components/common/SubNav'
import SectionCard from '../components/common/SectionCard'
import LoadingState from '../components/common/LoadingState'
import ErrorState from '../components/common/ErrorState'
import Pagination from '../components/common/Pagination'
import { fetchReviews, updateReview } from '../services/reviews'
import { useToast } from '../context/ToastContext'
import { useListQuery } from '../hooks/useListQuery'

const SUB_NAV = [
  { to: '/reviews', label: 'All Reviews' },
  { to: '/reviews/flagged', label: 'Flagged Reviews' },
]

const PAGE_SIZE = 10

const MIN_WARN_REASON_LENGTH = 10

export default function ReviewsFlagged() {
  const [selected, setSelected] = useState(null)
  const [page, setPage] = useState(1)
  const [warnTarget, setWarnTarget] = useState(null)
  const [warnReason, setWarnReason] = useState('')
  const [warnSubmitting, setWarnSubmitting] = useState(false)
  const { showSuccess, showError } = useToast()

  const fetchFn = useCallback(() => fetchReviews({ flagged: 'true', page: 1, limit: 50 }), [])
  const { data: flagged, loading, error, reload: loadFlaggedReviews, setData: setFlagged } = useListQuery(fetchFn)

  const totalPages = Math.max(1, Math.ceil(flagged.length / PAGE_SIZE))
  const currentPage = Math.min(page, totalPages)
  const pagedFlagged = useMemo(
    () => flagged.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE),
    [flagged, currentPage]
  )

  const updateLocalReview = (updated) => {
    setFlagged((prev) => prev.map((review) => (review.id === updated.id ? updated : review)))
    if (selected?.id === updated.id) {
      setSelected(updated)
    }
  }

  const dismissFlag = async (id) => {
    try {
      // Clears the flag only — no change to status/visibility. For a report
      // that turns out to be nothing; anything serious enough to act on
      // goes through Warn User instead.
      const updated = await updateReview(id, { flagged: false })
      updateLocalReview(updated)
      showSuccess('Flag dismissed.')
    } catch (err) {
      showError(err.message || 'Failed to update review')
    }
  }

  const closeWarnModal = () => {
    setWarnTarget(null)
    setWarnReason('')
  }

  const confirmWarnUser = async () => {
    if (!warnTarget || warnReason.trim().length < MIN_WARN_REASON_LENGTH) return
    setWarnSubmitting(true)
    try {
      const updated = await updateReview(warnTarget.id, {
        flagged: false,
        status: 'WARNED',
        flagReason: warnReason.trim(),
      })
      updateLocalReview(updated)
      showSuccess('Review hidden and user warned.')
      closeWarnModal()
    } catch (err) {
      showError(err.message || 'Failed to update review')
    } finally {
      setWarnSubmitting(false)
    }
  }

  return (
    <>
      <PageHeader title="Flagged Reviews" subtitle="Reviews reported by users" />
      <SubNav items={SUB_NAV} />
      <SectionCard>
        {loading && <LoadingState message="Loading flagged reviews..." />}
        {error && <ErrorState message={error} onRetry={loadFlaggedReviews} />}
        {!loading && !error && (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Review</th>
                  <th>Worker</th>
                  <th>Rating</th>
                  <th>Flag Reason</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {flagged.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="table-empty">
                      No flagged reviews found.
                    </td>
                  </tr>
                ) : (
                  pagedFlagged.map((review) => (
                    <tr key={review.id}>
                      <td>{review.displayId}</td>
                      <td>{review.worker}</td>
                      <td>★ {review.rating}</td>
                      <td>{review.flagReason || 'No reason provided'}</td>
                      <td>{review.status}</td>
                      <td>
                        <button
                          type="button"
                          className="btn btn-primary"
                          style={{ padding: '0.25rem 0.5rem', marginRight: '0.5rem' }}
                          onClick={() => setSelected(review)}
                        >
                          Review
                        </button>
                        <button
                          type="button"
                          className="btn btn-outline"
                          style={{ padding: '0.25rem 0.5rem', marginRight: '0.5rem' }}
                          onClick={() => dismissFlag(review.id)}
                          title="Dismiss flag (no change to the review)"
                        >
                          Dismiss
                        </button>
                        <button
                          type="button"
                          className="btn btn-danger"
                          style={{ padding: '0.25rem 0.5rem' }}
                          onClick={() => setWarnTarget(review)}
                          title="Hide and warn user"
                        >
                          Warn User
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
        {!loading && !error && flagged.length > 0 && (
          <Pagination
            info={`Showing ${pagedFlagged.length ? (currentPage - 1) * PAGE_SIZE + 1 : 0}-${
              (currentPage - 1) * PAGE_SIZE + pagedFlagged.length
            } of ${flagged.length} flagged reviews`}
            hasPrev={currentPage > 1}
            hasNext={currentPage < totalPages}
            onPrev={() => setPage((p) => Math.max(1, p - 1))}
            onNext={() => setPage((p) => Math.min(totalPages, p + 1))}
          />
        )}
      </SectionCard>

      {selected && (
        <div className="modal-backdrop" onClick={() => setSelected(null)} role="presentation">
          <div
            className="modal"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            <h2 className="modal-title">Flagged Review {selected.displayId}</h2>
            <p className="modal-body" style={{ marginBottom: '0.75rem' }}>
              This review was flagged as a potential issue. Review the details below before taking action.
            </p>

            <div className="detail-grid" style={{ marginBottom: '1rem' }}>
              <div className="detail-block">
                <label>Worker</label>
                <div className="value">{selected.worker}</div>
              </div>
              <div className="detail-block">
                <label>Rating</label>
                <div className="value">★ {selected.rating}</div>
              </div>
              <div className="detail-block">
                <label>Current Status</label>
                <div className="value">{selected.status}</div>
              </div>
              <div className="detail-block">
                <label>Flag Reason</label>
                <div className="value">{selected.flagReason || 'No reason provided'}</div>
              </div>
              <div className="detail-block detail-block--full">
                <label>Review Comment</label>
                <div className="value">{selected.comment}</div>
              </div>
              {selected.photoUrls?.length > 0 && (
                <div className="detail-block detail-block--full">
                  <label>Photos</label>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 4 }}>
                    {selected.photoUrls.map((url) => (
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
            </div>

            <div className="modal-actions">
              <button
                type="button"
                className="btn btn-outline"
                onClick={() => setSelected(null)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {warnTarget && (
        <div className="modal-backdrop" onClick={closeWarnModal} role="presentation">
          <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <h2 className="modal-title">Warn User — {warnTarget.displayId}</h2>
            <p className="modal-body" style={{ marginBottom: '0.75rem' }}>
              This hides the review and records why the user is being warned. The reason below is kept as the
              review's flag reason.
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
