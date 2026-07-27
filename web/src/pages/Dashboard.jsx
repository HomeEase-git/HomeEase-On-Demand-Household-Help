import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import StatCard from '../components/common/StatCard'
import SectionCard from '../components/common/SectionCard'
import LoadingState from '../components/common/LoadingState'
import ErrorState from '../components/common/ErrorState'
import BookingsTrendChart from '../components/charts/BookingsTrendChart'
import { fetchDashboardStats } from '../services/dashboard'

export default function Dashboard() {
  const [dashboard, setDashboard] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const load = async () => {
    setLoading(true)
    setError(null)

    try {
      const data = await fetchDashboardStats()
      setDashboard(data)
    } catch (err) {
      setError(err.message || 'Failed to load dashboard')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  if (loading) return <LoadingState message="Loading dashboard..." />
  if (error) return <ErrorState message={error} onRetry={load} />

  const { stats, recentActivity, topWorkers, bookingsTrend } = dashboard

  const statCards = [
    { label: 'Total Users', value: String(stats.totalUsers), icon: 'fa-users', color: 'purple' },
    { label: 'Total Clients', value: String(stats.totalClients), icon: 'fa-users', color: 'purple' },
    { label: 'Total Workers', value: String(stats.totalWorkers), icon: 'fa-user-cog', color: 'blue' },
    { label: 'Pending Approvals', value: String(stats.pendingApprovals), icon: 'fa-check-circle', color: 'green' },
    { label: 'Active Bookings', value: String(stats.activeBookings), icon: 'fa-calendar-check', color: 'purple' },
    { label: 'Total Revenue', value: stats.totalRevenue, icon: 'fa-peso-sign', color: 'blue' },
  ]

  return (
    <>
      <div className="welcome-banner">
        <div>
          <div className="welcome-banner__title">Dashboard Overview</div>
          <div className="welcome-banner__subtitle">
            Welcome back! Here&apos;s what&apos;s happening with HomeEase today.
          </div>
        </div>
        <div className="welcome-banner__icon">
          <i className="fas fa-chart-line" />
        </div>
      </div>
      <div className="cards-row">
        {statCards.map((stat) => (
          <StatCard key={stat.label} {...stat} />
        ))}
      </div>
      <SectionCard title="Bookings Trend (Last 7 Days)">
        <BookingsTrendChart data={bookingsTrend} />
      </SectionCard>
      <div className="two-col">
        <SectionCard title="Recent Activities">
          <div className="activity-list">
            {recentActivity.length === 0 && <p className="page-subtitle">No recent activity yet.</p>}
            {recentActivity.map((item) => (
              <div key={item.id} className="activity-item">
                <div className="icon">
                  <i className="fas fa-file-alt" />
                </div>
                <div>
                  <div>{item.text}</div>
                  <div className="time">{item.time}</div>
                </div>
              </div>
            ))}
          </div>
        </SectionCard>
        <SectionCard title="Top Performing Workers">
          <div className="rank-list">
            {topWorkers.length === 0 && <p className="page-subtitle">No workers yet.</p>}
            {topWorkers.map((worker, i) => (
              <div key={worker.id} className="rank-item">
                <div className="rank-num">{i + 1}</div>
                <div>
                  <div><strong>{worker.name}</strong></div>
                  <div className="meta">{worker.services}</div>
                </div>
                <div className="stars">
                  ★ {worker.rating} <span className="meta">({worker.reviews} reviews)</span>
                </div>
              </div>
            ))}
          </div>
        </SectionCard>
      </div>
      <div className="cta-buttons">
        <Link to="/verification" className="btn btn-primary">Approve Workers ({stats.pendingApprovals})</Link>
        <Link to="/bookings" className="btn btn-success">View Bookings ({stats.activeBookings})</Link>
        <Link to="/payments" className="btn btn-purple">Process Payments</Link>
        <Link to="/reports" className="btn btn-orange">Check Reports</Link>
        <Link to="/analytics" className="btn btn-outline">Analytics & Reports</Link>
      </div>
    </>
  )
}
