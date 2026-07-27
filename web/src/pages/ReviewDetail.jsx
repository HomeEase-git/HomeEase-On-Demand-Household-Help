import { useParams } from 'react-router-dom'
import { Link } from 'react-router-dom'
import PageHeader from '../components/common/PageHeader'
import SubNav from '../components/common/SubNav'
import SectionCard from '../components/common/SectionCard'
import LoadingState from '../components/common/LoadingState'
import ErrorState from '../components/common/ErrorState'
import { useDetailQuery } from '../hooks/useListQuery'
import { fetchReviewById } from '../services/reviews'

const SUB_NAV = [
  { to: '/reviews', label: 'All Reviews' },
  { to: '/reviews/flagged', label: 'Flagged Reviews' },
]

export default function ReviewDetail() {
  const { id } = useParams()
  const { data: review, loading, error, reload } = useDetailQuery(fetchReviewById, id)

  if (loading) {
    return <LoadingState message="Loading review details..." />
  }

  if (error) {
    return <ErrorState message={error} onRetry={reload} />
  }

  if (!review) {
    return (
      <SectionCard>
        <p style={{ color: 'var(--text-muted)' }}>Review not found.</p>
      </SectionCard>
    )
  }

  return (
    <>
      <PageHeader
        title="Review Detail"
        subtitle={`Review ${review.displayId}`}
        actions={<Link to="/reviews" className="btn btn-outline">Back</Link>}
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
          {review.flagged && (
            <div className="detail-block detail-block--full">
              <label>Flag Reason</label>
              <div className="value">{review.flagReason || 'No reason provided'}</div>
            </div>
          )}
        </div>
      </SectionCard>
      <SubNav items={SUB_NAV} />
    </>
  )
}
