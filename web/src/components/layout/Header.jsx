import { useAuth } from '../../context/AuthContext'

function getGreeting() {
  const hour = new Date().getHours()
  if (hour < 12) return 'Good morning'
  if (hour < 17) return 'Good afternoon'
  return 'Good evening'
}

function getFormattedDate() {
  return new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })
}

function getInitials(name) {
  if (!name) return 'A'
  return name
    .split(' ')
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()
}

export default function Header() {
  const { user } = useAuth()
  const displayName = user?.name?.split(' ')[0] || 'Admin'

  return (
    <header className="header">
      <div className="header-left">
        <div className="header-greeting">{getGreeting()}, {displayName}</div>
        <div className="header-date">{getFormattedDate()}</div>
      </div>
      <div className="header-right">
        <button type="button" className="icon-btn" title="Notifications" aria-label="Notifications">
          <i className="fas fa-bell" />
          <span className="badge">3</span>
        </button>
        <div className="user-menu">
          <div className="avatar">{getInitials(user?.name)}</div>
          <span className="user-email">{user?.email || 'admin@homeeaseadmin.com'}</span>
          <i className="fas fa-chevron-down" />
        </div>
      </div>
    </header>
  )
}
