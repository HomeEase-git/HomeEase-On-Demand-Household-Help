import { useParams } from 'react-router-dom'
import { Link } from 'react-router-dom'
import PageHeader from '../components/common/PageHeader'
import SubNav from '../components/common/SubNav'
import SectionCard from '../components/common/SectionCard'
import LoadingState from '../components/common/LoadingState'
import ErrorState from '../components/common/ErrorState'
import { useDetailQuery } from '../hooks/useListQuery'
import { fetchReviewById, updateReview } from '../services/reviews'
import { useToast } from '../context/ToastContext'

const SUB_NAV = [
  { to: '/reviews', label: 'All Reviews' },
  { to: '/reviews/flagged', label: 'Flagged Reviews' },
]

export default function ReviewDetail() {
  const { id } = useParams()
  const { data: review, loading, error, reload } = useDetailQuery(fetchReviewById, id)
  const { showSuccess, showError } = useToast()

  const keepPublic = async () => {
    try {
      await updateReview(id, { flagged: false, status: 'VISIBLE', flagReason: null })
      await reload()
      showSuccess('Review kept public.')
    } catch (err) {
      showError(err.message || 'Failed to update review')
    }
  }

  const hideReview = async () => {
    try {
      await updateReview(id, { flagged: false, status: 'HIDDEN' })
      await reload()
      showSuccess('Review hidden from the worker profile.')
    } catch (err) {
      showError(err.message || 'Failed to update review')
    }
  }

  const warnUser = async () => {
    try {
      await updateReview(id, { flagged: false, status: 'WARNED' })
      await reload()
      showSuccess('Review hidden and user warned.')
    } catch (err) {
      showError(err.message || 'Failed to update review')
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
        title="Review Detail"
        subtitle={`Review ${review.displayId}`}
        actions={
          <>
            <button
              type="button"
              className="btn btn-outline"
              style={{ marginRight: '0.5rem' }}
              onClick={keepPublic}
              title="Keep Public (dismiss flag)"
            >
              Keep Public
            </button>
            <button
              type="button"
              className="btn btn-outline"
              style={{ marginRight: '0.5rem' }}
              onClick={hideReview}
              title="Hide review from worker profile"
            >
              Hide Review
            </button>
            <button
              type="button"
              className="btn btn-danger"
              style={{ marginRight: '0.5rem' }}
              onClick={warnUser}
              title="Hide and warn user"
            >
              Warn User
            </button>
            <Link to="/reviews" className="btn btn-outline">Back</Link>
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
              <label>Flag Reason</label>
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
    </>
  )
}
