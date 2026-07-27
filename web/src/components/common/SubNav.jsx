import { Link, useLocation } from 'react-router-dom'

export default function SubNav({ items }) {
  const { pathname } = useLocation()

  return (
    <div className="sub-nav">
      {items.map(({ to, label }) => {
        const isActive = pathname === to
        return (
          <Link key={to} to={to} className={isActive ? 'active' : ''}>
            {label}
          </Link>
        )
      })}
    </div>
  )
}
