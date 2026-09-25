import { useState } from 'react'
import { Link } from 'react-router-dom'
import StatCard from '../components/common/StatCard'
import SectionCard from '../components/common/SectionCard'
import LoadingState from '../components/common/LoadingState'
import ErrorState from '../components/common/ErrorState'
import BookingsTrendChart from '../components/charts/BookingsTrendChart'
import { fetchDashboardStats } from '../services/dashboard'
import { useDetailQuery } from '../hooks/useListQuery'
import { useAdminNotifications } from '../hooks/useAdminNotifications'

const RANGES = [7, 30, 90]

const pesoFormatter = new Intl.NumberFormat('en-PH', {
  style: 'currency',
  currency: 'PHP',
  maximumFractionDigits: 0,
})

// "+12 in 7 days" plus a % change against the previous period of the same
// length. Only used on running totals — a % on a live queue (pending
// approvals, open disputes) wouldn't mean anything.
function describeTrend(trend, days, format = String, { compareOnly = false } = {}) {
  if (!trend) return null
  const { current, previous } = trend
  // compareOnly: the card's big number already is this period's count, so
  // show the previous period instead of repeating it.
  const detail = compareOnly
    ? `vs ${format(previous)} the ${days} days before`
    : `${current > 0 ? '+' : ''}${format(current)} in ${days} days`
  if (previous === 0) {
    return { direction: current > 0 ? 'up' : 'flat', change: current > 0 ? 'New' : '—', detail }
  }
  const pct = Math.round(((current - previous) / previous) * 100)
  return {
    direction: pct > 0 ? 'up' : pct < 0 ? 'down' : 'flat',
    change: `${Math.abs(pct)}%`,
    detail,
  }
}

export default function Dashboard() {
  const [days, setDays] = useState(7)
  // One cache slot per range, so switching back to a range is instant.
  const { data, loading, error, reload } = useDetailQuery(fetchDashboardStats, String(days))
  const { items: attentionItems, loading: attentionLoading } = useAdminNotifications()

  // useDetailQuery keeps the previous range's data while a new range loads,
  // so the page stays put (dimmed) instead of flashing back to placeholders.
  const refreshing = loading && !!data

  if (!data && loading) return <LoadingState variant="dashboard" message="Loading dashboard..." />
  if (!data && error) return <ErrorState message={error} onRetry={reload} />

  const { stats, recentActivity, topWorkers, bookingsTrend, trends, rangeDays = days } = data

  const statCards = [
    { label: 'Total Clients', value: String(stats.totalClients), icon: 'fa-users', color: 'blue', to: '/users', trend: describeTrend(trends?.clients, rangeDays) },
    { label: 'Total Workers', value: String(stats.totalWorkers), icon: 'fa-user-cog', color: 'purple', to: '/workers', trend: describeTrend(trends?.workers, rangeDays) },
    { label: 'Bookings', value: String(trends?.bookings?.current ?? '—'), sublabel: `Last ${rangeDays} days`, icon: 'fa-calendar-plus', color: 'blue', to: '/bookings', trend: describeTrend(trends?.bookings, rangeDays, String, { compareOnly: true }) },
    { label: 'Active Bookings', value: String(stats.activeBookings), icon: 'fa-calendar-check', color: 'blue', to: '/bookings' },
    { label: 'Pending Approvals', value: String(stats.pendingApprovals), icon: 'fa-id-card', color: 'orange', to: '/verification' },
    { label: 'Open Disputes', value: String(stats.openDisputes), icon: 'fa-triangle-exclamation', color: 'pink', to: '/bookings/dispute' },
    { label: 'Total Revenue', value: stats.totalRevenue, icon: 'fa-peso-sign', color: 'green', to: '/payments', trend: describeTrend(trends?.revenue, rangeDays, (n) => pesoFormatter.format(n)) },
    { label: 'Total Worker Payouts', value: stats.totalPayouts, icon: 'fa-money-bill-transfer', color: 'green', to: '/payments/payouts', trend: describeTrend(trends?.payouts, rangeDays, (n) => pesoFormatter.format(n)) },
  ]

  // Everything waiting on an admin, in one place: the header bell's queues
  // plus the money problems the dashboard already counts.
  const attention = [
    ...attentionItems,
    stats.overduePayments > 0 && {
      key: 'overduePayments',
      label: 'Overdue payments',
      to: '/payments',
      icon: 'fa-clock',
      count: stats.overduePayments,
    },
    stats.workersOnHoldCount > 0 && {
      key: 'workersOnHold',
      label: 'Workers on hold',
      to: '/workers',
      icon: 'fa-user-lock',
      count: stats.workersOnHoldCount,
    },
  ].filter(Boolean)

  return (
    <div className={refreshing ? 'dashboard is-refreshing' : 'dashboard'}>
      <div className="dashboard-header">
        <div>
          <h1 className="page-title">Dashboard</h1>
          <p className="page-subtitle">Activity across HomeEase</p>
        </div>
        <div className="segmented" role="group" aria-label="Time range">
          {RANGES.map((range) => (
            <button
              key={range}
              type="button"
              className={`segmented__option ${days === range ? 'is-active' : ''}`}
              aria-pressed={days === range}
              onClick={() => setDays(range)}
            >
              {range}d
            </button>
          ))}
        </div>
      </div>

      <section className="attention-strip" aria-label="Needs attention">
        <div className="attention-strip__title">
          <i className="fas fa-bell" /> Needs attention
        </div>
        {attention.length === 0 ? (
          <div className="attention-strip__clear">
            <i className="fas fa-circle-check" />
            {attentionLoading ? 'Checking queues…' : "You're all caught up."}
          </div>
        ) : (
          <div className="attention-strip__items">
            {attention.map((item) => (
              <Link key={item.key} to={item.to} className="attention-chip">
                <i className={`fas ${item.icon}`} />
                <span className="attention-chip__count">{item.count}</span>
                <span>{item.label}</span>
                <i className="fas fa-chevron-right attention-chip__chevron" />
              </Link>
            ))}
          </div>
        )}
      </section>

      <div className="cards-row">
        {statCards.map((stat) => (
          <StatCard key={stat.label} {...stat} />
        ))}
      </div>
      <SectionCard title={`Bookings Trend (Last ${rangeDays} Days)`}>
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
        <Link to="/bookings/dispute" className="btn btn-danger">Resolve Disputes ({stats.openDisputes})</Link>
        <Link to="/payments" className="btn btn-purple">Process Payments</Link>
        <Link to="/reports" className="btn btn-orange">Check Reports</Link>
        <Link to="/analytics" className="btn btn-outline">Analytics & Reports</Link>
      </div>
    </div>
  )
}
