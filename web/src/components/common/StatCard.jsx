import { Link } from 'react-router-dom'

export default function StatCard({ label, value, icon, color = 'blue', to }) {
  const content = (
    <>
      <div>
        <div className="label">{label}</div>
        <div className="value">{value}</div>
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
