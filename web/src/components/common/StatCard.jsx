import { Link } from 'react-router-dom'

const TREND_ICON = { up: 'fa-arrow-trend-up', down: 'fa-arrow-trend-down', flat: 'fa-minus' }

// trend (optional): { direction: 'up' | 'down' | 'flat', change: '20%', detail: '+12 in 7 days' }
export default function StatCard({ label, value, sublabel, icon, color = 'blue', to, trend }) {
  const content = (
    <>
      <div className="stat-card__body">
        <div className="label">{label}</div>
        <div className="value">{value}</div>
        {sublabel && <div className="stat-card__sublabel">{sublabel}</div>}
        {trend && (
          <div className="stat-card__trend">
            <span className={`trend-chip trend-chip--${trend.direction}`}>
              <i className={`fas ${TREND_ICON[trend.direction]}`} aria-hidden="true" />
              {trend.change}
            </span>
            <span className="stat-card__trend-detail">{trend.detail}</span>
          </div>
        )}
      </div>
      <div className={`icon-wrap ${color}`}>
        <i className={`fas ${icon}`} />
      </div>
      {to && <i className="fas fa-chevron-right stat-card__chevron" />}
    </>
  )

  if (to) {
    return (
      <Link to={to} className="stat-card stat-card--clickable">
        {content}
      </Link>
    )
  }

  return <div className="stat-card">{content}</div>
}
