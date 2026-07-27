import { Link, Navigate, useParams } from 'react-router-dom'
import PageHeader from '../components/common/PageHeader'
import SectionCard from '../components/common/SectionCard'
import Badge from '../components/common/Badge'
import LoadingState from '../components/common/LoadingState'
import ErrorState from '../components/common/ErrorState'
import { useDetailQuery } from '../hooks/useListQuery'
import { fetchWorkerById } from '../services/workers'

export default function WorkerDetail() {
  const { id } = useParams()
  const { data: worker, loading, error, reload } = useDetailQuery(fetchWorkerById, id)

  if (loading) return <LoadingState message="Loading worker..." />
  if (error) return <ErrorState message={error} onRetry={reload} />
  if (!worker) return <Navigate to="/workers" replace />

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
            <Link to="/users/suspend" className="btn btn-danger">Suspend / Ban User</Link>
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
    </>
  )
}
