import { useEffect, useState } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import homeEaseLogo from '../Assets/home-ease-icon.png'
import { useAuth } from '../../context/AuthContext'
import LogoutConfirmModal from '../common/LogoutConfirmModal'

// Standalone links render directly; grouped links collapse related pages
// behind a single dropdown so the sidebar doesn't list every page at once.
const NAV_STRUCTURE = [
  { type: 'link', to: '/dashboard', page: 'dashboard', icon: 'fa-th-large', label: 'Dashboard' },
  {
    type: 'group',
    key: 'people',
    icon: 'fa-users',
    label: 'Users',
    children: [
      { to: '/users', page: 'users', icon: 'fa-users', label: 'Clients' },
      { to: '/workers', page: 'workers', icon: 'fa-user-cog', label: 'Workers' },
      { to: '/verification', page: 'verification', icon: 'fa-id-card', label: 'Verification' },
    ],
  },
  {
    type: 'group',
    key: 'catalog',
    icon: 'fa-list-check',
    label: 'Catalog & Pricing',
    children: [
      { to: '/service-catalog', page: 'service-catalog', icon: 'fa-list-check', label: 'Service Catalog' },
      { to: '/price-control', page: 'price-control', icon: 'fa-sliders', label: 'Price Control' },
    ],
  },
  // Bookings and Payments already expose their sub-pages (Disputes, Payouts,
  // Refunds) via an in-page SubNav tab strip, so they stay single links here
  // instead of duplicating that navigation as a sidebar dropdown too.
  { type: 'link', to: '/bookings', page: 'bookings', icon: 'fa-calendar-check', label: 'Bookings' },
  { type: 'link', to: '/payments', page: 'payments', icon: 'fa-credit-card', label: 'Payments' },
  { type: 'link', to: '/reviews', page: 'reviews', icon: 'fa-star', label: 'Reviews' },
  {
    type: 'group',
    key: 'insights',
    icon: 'fa-chart-line',
    label: 'Insights',
    children: [
      { to: '/reports/logs', page: 'reports', icon: 'fa-chart-bar', label: 'Reports' },
      { to: '/analytics', page: 'analytics', icon: 'fa-chart-line', label: 'Analytics' },
    ],
  },
  { type: 'link', to: '/settings', page: 'settings', icon: 'fa-cog', label: 'Settings' },
]

function groupIsActive(group, pathname) {
  return group.children.some((child) => pathname.startsWith(child.to))
}

export default function Sidebar({ isOpen, onClose }) {
  const navigate = useNavigate()
  const { logout } = useAuth()
  const { pathname } = useLocation()
  const [showLogoutModal, setShowLogoutModal] = useState(false)
  const [openGroups, setOpenGroups] = useState(() => {
    const initial = {}
    NAV_STRUCTURE.forEach((item) => {
      if (item.type === 'group' && groupIsActive(item, pathname)) {
        initial[item.key] = true
      }
    })
    return initial
  })

  // Keep the group containing the active route expanded when navigating directly to it.
  useEffect(() => {
    NAV_STRUCTURE.forEach((item) => {
      if (item.type === 'group' && groupIsActive(item, pathname)) {
        setOpenGroups((prev) => (prev[item.key] ? prev : { ...prev, [item.key]: true }))
      }
    })
  }, [pathname])

  const toggleGroup = (key) => {
    setOpenGroups((prev) => ({ ...prev, [key]: !prev[key] }))
  }

  const handleLogoutClick = () => {
    setShowLogoutModal(true)
  }

  const handleConfirmLogout = () => {
    setShowLogoutModal(false)
    logout()
    navigate('/login')
  }

  const handleCancelLogout = () => {
    setShowLogoutModal(false)
  }

  const handleNavClick = () => {
    if (onClose) onClose()
  }

  return (
    <>
      {isOpen && <div className="sidebar-overlay" onClick={onClose} role="presentation" />}
      <aside className={`sidebar ${isOpen ? 'sidebar--open' : ''}`}>
        <div className="sidebar-brand">
          <div className="sidebar-brand-content">
            <img src={homeEaseLogo} alt="HomeEase Logo" className="sidebar-logo" />
            <span>HomeEase</span>
          </div>
          <button
            type="button"
            className="sidebar-close"
            onClick={onClose}
            aria-label="Close menu"
          >
            <i className="fas fa-xmark" />
          </button>
        </div>
        <nav className="sidebar-nav">
          {NAV_STRUCTURE.map((item) => {
            if (item.type === 'link') {
              return (
                <NavLink
                  key={item.page}
                  to={item.to}
                  className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
                  data-page={item.page}
                  onClick={handleNavClick}
                >
                  <i className={`fas ${item.icon}`} />
                  <span>{item.label}</span>
                </NavLink>
              )
            }

            const expanded = !!openGroups[item.key]
            const active = groupIsActive(item, pathname)
            return (
              <div key={item.key} className="nav-group">
                <button
                  type="button"
                  className={`nav-item nav-group__toggle ${active ? 'active' : ''}`}
                  onClick={() => toggleGroup(item.key)}
                  aria-expanded={expanded}
                >
                  <i className={`fas ${item.icon}`} />
                  <span>{item.label}</span>
                  <i className={`fas fa-chevron-down nav-group__chevron ${expanded ? 'is-open' : ''}`} />
                </button>
                {expanded && (
                  <div className="nav-group__children">
                    {item.children.map((child) => (
                      <NavLink
                        key={child.page}
                        to={child.to}
                        className={({ isActive }) => `nav-item nav-item--child ${isActive ? 'active' : ''}`}
                        data-page={child.page}
                        onClick={handleNavClick}
                      >
                        <i className={`fas ${child.icon}`} />
                        <span>{child.label}</span>
                      </NavLink>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
          <button
            type="button"
            onClick={handleLogoutClick}
            className="nav-item nav-item--logout"
            data-page="logout"
          >
            <i className="fas fa-right-from-bracket" />
            <span>Logout</span>
          </button>
        </nav>
      </aside>
      {showLogoutModal && (
        <LogoutConfirmModal onCancel={handleCancelLogout} onConfirm={handleConfirmLogout} />
      )}
    </>
  )
}
