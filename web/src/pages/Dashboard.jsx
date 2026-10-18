import { useState } from 'react'
import { Link } from 'react-router-dom'
import StatCard from '../components/common/StatCard'
import SectionCard from '../components/common/SectionCard'
import LoadingState from '../components/common/LoadingState'
import ErrorState from '../components/common/ErrorState'
import BookingsTrendChart from '../components/charts/BookingsTrendChart'
import CategoryBreakdownChart from '../components/charts/CategoryBreakdownChart'
import { fetchDashboardStats, fetchDashboardCharts } from '../services/dashboard'
import { fetchAnalytics } from '../services/analytics'
import { useDetailQuery } from '../hooks/useListQuery'
import { useAdminNotifications } from '../hooks/useAdminNotifications'
import { useAuth } from '../context/AuthContext'

const RANGES = [7, 30, 90]

const pesoFormatter = new Intl.NumberFormat('en-PH', {
  style: 'currency',
  currency: 'PHP',
  maximumFractionDigits: 0,
})

// The last 12 calendar months (this one first), as "2026-10" values, for the
// charts' month picker. Manila time, like the rest of the admin's dates.
function recentMonths(count = 12) {
  const manilaNow = new Date(Date.now() + 8 * 60 * 60 * 1000)
  let year = manilaNow.getUTCFullYear()
  let month = manilaNow.getUTCMonth()
  const months = []
  for (let i = 0; i < count; i++) {
    months.push({
      value: `${year}-${String(month + 1).padStart(2, '0')}`,
      label: new Date(Date.UTC(year, month, 1)).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }),
    })
    month -= 1
    if (month < 0) {
      month = 11
      year -= 1
    }
  }
  return months
}

const MONTH_OPTIONS = recentMonths()

const formatCount = (n) => (n == null ? '—' : Number(n).toLocaleString('en-PH'))

// Keyed by the category label the API sends with each activity row.
const ACTIVITY_ICON = {
  'Admin Actions': 'fa-user-shield',
  'Login History': 'fa-right-to-bracket',
  'System Errors': 'fa-triangle-exclamation',
  'Status Changes': 'fa-arrows-rotate',
}

function getGreeting() {
  const hour = new Date().getHours()
  if (hour < 12) return 'Good morning'
  if (hour < 17) return 'Good afternoon'
  return 'Good evening'
}

const todayLabel = () =>
  new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })

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
  // '' = charts follow the range above; otherwise one calendar month (YYYY-MM).
  const [chartMonth, setChartMonth] = useState('')
  // One cache slot per range, so switching back to a range is instant.
  const { data, loading, error, reload } = useDetailQuery(fetchDashboardStats, String(days))
  const { items: attentionItems, loading: attentionLoading } = useAdminNotifications()
  // All-time completion rate, rating and category mix (what the old Analytics page showed).
  const { data: analytics } = useDetailQuery(fetchAnalytics, 'snapshot')
  // Only fetched once a month is picked; the hook ignores an empty key.
  const { data: monthCharts, error: monthError } = useDetailQuery(fetchDashboardCharts, chartMonth)
  const { user } = useAuth()
  const firstName = user?.name?.split(' ')[0] || 'Admin'

  // useDetailQuery keeps the previous range's data while a new range loads,
  // so the page stays put (dimmed) instead of flashing back to placeholders.
  const refreshing = loading && !!data

  if (!data && loading) return <LoadingState variant="dashboard" message="Loading dashboard..." />
  if (!data && error) return <ErrorState message={error} onRetry={reload} />

  // The hook keeps the previous month's data while a new one loads; don't show it under the new title.
  const monthData = monthCharts?.month === chartMonth ? monthCharts : null
  const monthLabel = MONTH_OPTIONS.find((m) => m.value === chartMonth)?.label ?? chartMonth

  const { stats, recentActivity, topWorkers, bookingsTrend, trends, rangeDays = days } = data

  const statCards = [
    { label: 'Total Clients', value: formatCount(stats.totalClients), icon: 'fa-users', color: 'blue', to: '/users', trend: describeTrend(trends?.clients, rangeDays, formatCount) },
    { label: 'Total Workers', value: formatCount(stats.totalWorkers), icon: 'fa-user-cog', color: 'purple', to: '/workers', trend: describeTrend(trends?.workers, rangeDays, formatCount) },
    { label: 'Bookings', value: formatCount(trends?.bookings?.current), sublabel: `Last ${rangeDays} days`, icon: 'fa-calendar-plus', color: 'blue', to: '/bookings', trend: describeTrend(trends?.bookings, rangeDays, formatCount, { compareOnly: true }) },
    { label: 'Active Bookings', value: formatCount(stats.activeBookings), icon: 'fa-calendar-check', color: 'blue' },
    // Pending approvals and open disputes live in the "Needs attention" strip above.
    { label: 'Completion Rate', sublabel: 'All bookings', value: analytics ? `${Math.round(analytics.completionRate * 100)}%` : '—', icon: 'fa-chart-line', color: 'green' },
    { label: 'Avg. Rating', sublabel: 'All reviews', value: analytics ? analytics.avgRating.toFixed(1) : '—', icon: 'fa-star', color: 'purple', to: '/reviews' },
    // Revenue is the platform's commission (not what clients paid); payouts
    // are money actually sent to workers.
    { label: 'Platform Revenue', sublabel: stats.revenueFromCashJobs && stats.revenueFromCashJobs !== '₱0.00' ? `Commission · ${stats.revenueFromCashJobs} owed from cash jobs` : 'Commission earned', value: stats.totalRevenue, icon: 'fa-peso-sign', color: 'green', to: '/payments', trend: describeTrend(trends?.revenue, rangeDays, (n) => pesoFormatter.format(n)) },
    { label: 'Paid to Workers', sublabel: 'GCash/Maya payouts sent', value: stats.totalPayouts, icon: 'fa-money-bill-transfer', color: 'green', to: '/payments/payouts', trend: describeTrend(trends?.payouts, rangeDays, (n) => pesoFormatter.format(n)) },
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
          <h1 className="page-title">{getGreeting()}, {firstName}</h1>
          <p className="page-subtitle">{todayLabel()}</p>
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
      <div className="chart-filter">
        <label htmlFor="chart-month">Charts</label>
        <select id="chart-month" className="input" value={chartMonth} onChange={(e) => setChartMonth(e.target.value)}>
          <option value="">Follow the range above</option>
          {MONTH_OPTIONS.map((m) => (
            <option key={m.value} value={m.value}>{m.label}</option>
          ))}
        </select>
      </div>
      <SectionCard title={chartMonth ? `Bookings Trend (${monthLabel})` : `Bookings Trend (Last ${rangeDays} Days)`}>
        {chartMonth && !monthData && !monthError ? (
          <div className="chart-placeholder">Loading {monthLabel}…</div>
        ) : chartMonth && !monthData ? (
          <div className="chart-placeholder">Couldn't load {monthLabel}.</div>
        ) : (
          <BookingsTrendChart data={chartMonth ? monthData?.bookingsTrend : bookingsTrend} />
        )}
      </SectionCard>
      {(chartMonth ? monthData : analytics) && (
        <SectionCard title={chartMonth ? `Bookings by Category (${monthLabel})` : 'Bookings by Category'}>
          <CategoryBreakdownChart data={chartMonth ? monthData.bookingsByCategory : analytics.bookingsByCategory} />
        </SectionCard>
      )}
      <div className="two-col">
        <SectionCard title="Recent Activities">
          <div className="activity-list">
            {recentActivity.length === 0 && <p className="page-subtitle">No recent activity yet.</p>}
            {recentActivity.map((item) => {
              const body = (
                <>
                  <div className="icon">
                    <i className={`fas ${ACTIVITY_ICON[item.category] || 'fa-file-alt'}`} />
                  </div>
                  <div>
                    <div>{item.text}</div>
                    <div className="time">{item.time}</div>
                  </div>
                </>
              )
              return item.bookingId ? (
                <Link key={item.id} to={`/bookings/detail/${item.bookingId}`} className="activity-item activity-item--link">
                  {body}
                </Link>
              ) : (
                <div key={item.id} className="activity-item">{body}</div>
              )
            })}
          </div>
          <Link to="/reports/logs" className="section-card__more">View all activity</Link>
        </SectionCard>
        <SectionCard title="Top Performing Workers">
          <div className="rank-list">
            {topWorkers.length === 0 && <p className="page-subtitle">No reviewed workers yet.</p>}
            {topWorkers.map((worker, i) => (
              <Link key={worker.id} to={`/workers/${worker.id}`} className="rank-item">
                <div className="rank-num">{i + 1}</div>
                <div>
                  <div><strong>{worker.name}</strong></div>
                  <div className="meta">{worker.services}</div>
                </div>
                <div className="stars">
                  ★ {worker.rating}{' '}
                  <span className="meta">({worker.reviews} {worker.reviews === 1 ? 'review' : 'reviews'})</span>
                </div>
              </Link>
            ))}
          </div>
        </SectionCard>
      </div>
    </div>
  )
}
