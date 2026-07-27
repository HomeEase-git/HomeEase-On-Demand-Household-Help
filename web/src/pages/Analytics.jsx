import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import StatCard from '../components/common/StatCard'
import SectionCard from '../components/common/SectionCard'
import LoadingState from '../components/common/LoadingState'
import ErrorState from '../components/common/ErrorState'
import BookingsTrendChart from '../components/charts/BookingsTrendChart'
import CategoryBreakdownChart from '../components/charts/CategoryBreakdownChart'
import { fetchAnalytics } from '../services/analytics'

export default function Analytics() {
  const [analytics, setAnalytics] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const load = async () => {
    setLoading(true)
    setError(null)

    try {
      const data = await fetchAnalytics()
      setAnalytics(data)
    } catch (err) {
      setError(err.message || 'Failed to load analytics')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  if (loading) return <LoadingState message="Loading analytics..." />
  if (error) return <ErrorState message={error} onRetry={load} />

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
