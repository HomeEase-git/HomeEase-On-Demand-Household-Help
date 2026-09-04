import { Link } from 'react-router-dom'
import StatCard from '../components/common/StatCard'
import SectionCard from '../components/common/SectionCard'
import LoadingState from '../components/common/LoadingState'
import ErrorState from '../components/common/ErrorState'
import BookingsTrendChart from '../components/charts/BookingsTrendChart'
import CategoryBreakdownChart from '../components/charts/CategoryBreakdownChart'
import { fetchAnalytics } from '../services/analytics'
import { useDetailQuery } from '../hooks/useListQuery'

export default function Analytics() {
  // useDetailQuery caches by `${pathname}:${id}` — there's no real "id" for
  // a single analytics snapshot, so a constant key just gives it a cache slot.
  const { data: analytics, loading, error, reload } = useDetailQuery(fetchAnalytics, 'snapshot')

  if (loading) return <LoadingState message="Loading analytics..." />
  if (error) return <ErrorState message={error} onRetry={reload} />

  const stats = [
    { label: 'Total Bookings', value: String(analytics.totalBookings), icon: 'fa-calendar-check', color: 'blue' },
    { label: 'Completion Rate', value: `${Math.round(analytics.completionRate * 100)}%`, icon: 'fa-chart-line', color: 'green' },
    { label: 'Avg. Rating', value: analytics.avgRating.toFixed(1), icon: 'fa-star', color: 'purple' },
  ]

  return (
    <>
      <h1 className="page-title">Analytics & Reports</h1>
      <p className="page-subtitle">View platform metrics and performance analytics.</p>
      <div className="cards-row">
        {stats.map((stat) => (
          <StatCard key={stat.label} {...stat} />
        ))}
      </div>
      <SectionCard title="Bookings Over Time (Last 30 Days)">
        <BookingsTrendChart data={analytics.bookingsOverTime} />
      </SectionCard>
      <SectionCard title="Bookings by Category">
        <CategoryBreakdownChart data={analytics.bookingsByCategory} />
      </SectionCard>
      <Link to="/dashboard" className="btn btn-outline">Back to Dashboard</Link>
    </>
  )
}
