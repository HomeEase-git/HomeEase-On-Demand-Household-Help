import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { useAdminNotifications } from '../../hooks/useAdminNotifications'
import LogoutConfirmModal from '../common/LogoutConfirmModal'

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

export default function Header({ onMenuClick }) {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const displayName = user?.name?.split(' ')[0] || 'Admin'
  const { items: notifItems, total: notifTotal } = useAdminNotifications()

  const [notifOpen, setNotifOpen] = useState(false)
  const [userMenuOpen, setUserMenuOpen] = useState(false)
  const [showLogoutModal, setShowLogoutModal] = useState(false)
  const notifRef = useRef(null)
  const userMenuRef = useRef(null)

  useEffect(() => {
    function handleClickOutside(e) {
      if (notifRef.current && !notifRef.current.contains(e.target)) setNotifOpen(false)
      if (userMenuRef.current && !userMenuRef.current.contains(e.target)) setUserMenuOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const handleConfirmLogout = () => {
    setShowLogoutModal(false)
    logout()
    navigate('/login')
  }

  return (
    <>
      <header className="header">
        <div className="header-left">
          <button
            type="button"
            className="icon-btn sidebar-toggle"
            onClick={onMenuClick}
            aria-label="Toggle menu"
          >
            <i className="fas fa-bars" />
          </button>
          <div className="header-left-text">
            <div className="header-greeting">{getGreeting()}, {displayName}</div>
            <div className="header-date">{getFormattedDate()}</div>
          </div>
        </div>
        <div className="header-right">
          <div className="header-dropdown-wrap" ref={notifRef}>
            <button
              type="button"
              className="icon-btn"
              title="Notifications"
              aria-label="Notifications"
              aria-expanded={notifOpen}
              onClick={() => setNotifOpen((open) => !open)}
            >
              <i className="fas fa-bell" />
              {notifTotal > 0 && <span className="badge">{notifTotal > 99 ? '99+' : notifTotal}</span>}
            </button>
            {notifOpen && (
              <div className="header-dropdown header-dropdown--notif">
                <div className="header-dropdown__title">Needs attention</div>
                {notifItems.length === 0 ? (
                  <div className="header-dropdown__empty">
                    <i className="fas fa-circle-check" /> You&apos;re all caught up.
                  </div>
                ) : (
                  notifItems.map((item) => (
                    <Link
                      key={item.key}
                      to={item.to}
                      className="header-dropdown__item"
                      onClick={() => setNotifOpen(false)}
                    >
                      <i className={`fas ${item.icon}`} />
                      <span className="header-dropdown__item-label">{item.label}</span>
                      <span className="header-dropdown__item-count">{item.count}</span>
                    </Link>
                  ))
                )}
              </div>
            )}
          </div>
          <div className="header-dropdown-wrap" ref={userMenuRef}>
            <button
              type="button"
              className="user-menu"
              aria-expanded={userMenuOpen}
              onClick={() => setUserMenuOpen((open) => !open)}
            >
              <div className="avatar">{getInitials(user?.name)}</div>
              <span className="user-email">{user?.email}</span>
              <i className={`fas fa-chevron-down ${userMenuOpen ? 'is-open' : ''}`} />
            </button>
            {userMenuOpen && (
              <div className="header-dropdown header-dropdown--user">
                <Link to="/settings" className="header-dropdown__item" onClick={() => setUserMenuOpen(false)}>
                  <i className="fas fa-cog" />
                  <span className="header-dropdown__item-label">Settings</span>
                </Link>
                <button
                  type="button"
                  className="header-dropdown__item header-dropdown__item--danger"
                  onClick={() => {
                    setUserMenuOpen(false)
                    setShowLogoutModal(true)
                  }}
                >
                  <i className="fas fa-right-from-bracket" />
                  <span className="header-dropdown__item-label">Logout</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </header>
      {showLogoutModal && (
        <LogoutConfirmModal onCancel={() => setShowLogoutModal(false)} onConfirm={handleConfirmLogout} />
      )}
    </>
  )
}
