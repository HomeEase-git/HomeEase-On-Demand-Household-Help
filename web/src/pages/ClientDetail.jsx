import { Link, Navigate, useParams } from 'react-router-dom'
import PageHeader from '../components/common/PageHeader'
import SectionCard from '../components/common/SectionCard'
import Badge from '../components/common/Badge'
import LoadingState from '../components/common/LoadingState'
import ErrorState from '../components/common/ErrorState'
import { useDetailQuery } from '../hooks/useListQuery'
import { fetchClientById } from '../services/users'

export default function ClientDetail() {
  const { id } = useParams()
  const { data: client, loading, error, reload } = useDetailQuery(fetchClientById, id)

  if (loading) return <LoadingState message="Loading client..." />
  if (error) return <ErrorState message={error} onRetry={reload} />
  if (!client) return <Navigate to="/users" replace />

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
                <th>Booking ID</th><th>Service</th><th>Worker</th><th>Date</th><th>Status</th>
              </tr>
            </thead>
            <tbody>
              {(client.recentBookings || []).length === 0 ? (
                <tr>
                  <td colSpan={5} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>No bookings yet.</td>
                </tr>
              ) : (
                client.recentBookings.map((b) => (
                  <tr key={b.bookingId}>
                    <td>{b.id}</td>
                    <td>{b.service}</td>
                    <td>{b.worker}</td>
                    <td>{b.date}</td>
                    <td><Badge variant={b.status === 'COMPLETED' ? 'approved' : 'pending'}>{b.status}</Badge></td>
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
