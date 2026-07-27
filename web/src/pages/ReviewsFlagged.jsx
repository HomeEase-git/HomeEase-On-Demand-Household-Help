import { useEffect, useState } from 'react'
import PageHeader from '../components/common/PageHeader'
import SubNav from '../components/common/SubNav'
import SectionCard from '../components/common/SectionCard'
import LoadingState from '../components/common/LoadingState'
import ErrorState from '../components/common/ErrorState'
import { fetchReviews, updateReview } from '../services/reviews'

const SUB_NAV = [
  { to: '/reviews', label: 'All Reviews' },
  { to: '/reviews/flagged', label: 'Flagged Reviews' },
]

export default function ReviewsFlagged() {
  const [flagged, setFlagged] = useState([])
  const [selected, setSelected] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const loadFlaggedReviews = async () => {
    setLoading(true)
    setError(null)

    try {
      const result = await fetchReviews({ flagged: 'true', page: 1, limit: 50 })
      setFlagged(result.data)
    } catch (err) {
      setError(err.message || 'Failed to load flagged reviews')
      setFlagged([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadFlaggedReviews()
  }, [])

  const updateLocalReview = (updated) => {
    setFlagged((prev) => prev.map((review) => (review.id === updated.id ? updated : review)))
    if (selected?.id === updated.id) {
      setSelected(updated)
    }
  }

  const keepPublic = async (id) => {
    try {
      const updated = await updateReview(id, {
        flagged: false,
        status: 'VISIBLE',
        flagReason: null,
      })
      updateLocalReview(updated)
    } catch (err) {
      setError(err.message || 'Failed to update review')
    }
  }

  const hideReview = async (id) => {
    try {
      const updated = await updateReview(id, {
        flagged: false,
        status: 'HIDDEN',
      })
      updateLocalReview(updated)
    } catch (err) {
      setError(err.message || 'Failed to update review')
    }
  }

  const warnUser = async (id) => {
    try {
      const updated = await updateReview(id, {
        flagged: false,
        status: 'WARNED',
      })
      updateLocalReview(updated)
    } catch (err) {
      setError(err.message || 'Failed to update review')
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
                    <td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
                      No flagged reviews found.
                    </td>
                  </tr>
                ) : (
                  flagged.map((review) => (
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
                          onClick={() => keepPublic(review.id)}
                          title="Keep Public (dismiss flag)"
                        >
                          Keep Public
                        </button>
                        <button
                          type="button"
                          className="btn btn-outline"
                          style={{ padding: '0.25rem 0.5rem', marginRight: '0.5rem' }}
                          onClick={() => hideReview(review.id)}
                          title="Hide review from worker profile"
                        >
                          Hide Review
                        </button>
                        <button
                          type="button"
                          className="btn btn-danger"
                          style={{ padding: '0.25rem 0.5rem' }}
                          onClick={() => warnUser(review.id)}
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
    </>
  )
}
