import { Link, Navigate, useParams } from 'react-router-dom'
import PageHeader from '../components/common/PageHeader'
import SubNav from '../components/common/SubNav'
import Badge from '../components/common/Badge'
import LoadingState from '../components/common/LoadingState'
import ErrorState from '../components/common/ErrorState'
import { useDetailQuery } from '../hooks/useListQuery'
import { fetchBookingById } from '../services/bookings'

const SUB_NAV = [
  { to: '/bookings', label: 'All Bookings' },
  { to: '/bookings/dispute', label: 'Booking Dispute' },
]

export default function BookingDetail() {
  const { id } = useParams()
  const { data: booking, loading, error, reload } = useDetailQuery(fetchBookingById, id)

  if (loading) return <LoadingState message="Loading booking..." />
  if (error) return <ErrorState message={error} onRetry={reload} />
  if (!booking) return <Navigate to="/bookings" replace />

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
        actions={<Link to="/bookings" className="btn btn-outline">Back</Link>}
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
    </>
  )
}
