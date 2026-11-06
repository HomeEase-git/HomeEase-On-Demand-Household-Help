import { useEffect, useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import homeEaseLogo from '../Assets/home-ease-icon.png'
import { NAV_STRUCTURE } from '../../constants/navigation'


function groupIsActive(group, pathname) {
  return group.children.some((child) => pathname.startsWith(child.to))
}

function activeGroupKey(pathname) {
  return NAV_STRUCTURE.find((item) => item.type === 'group' && groupIsActive(item, pathname))?.key ?? null
}

export default function Sidebar({ isOpen, onClose }) {
  const { pathname } = useLocation()
  const [openGroup, setOpenGroup] = useState(() => activeGroupKey(pathname))

  useEffect(() => {
    const key = activeGroupKey(pathname)
    if (key) setOpenGroup(key)
  }, [pathname])

  const toggleGroup = (key) => {
    setOpenGroup((current) => (current === key ? null : key))
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

            const expanded = openGroup === item.key
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
                <div
                  className={`nav-group__panel ${expanded ? 'is-open' : ''}`}
                  ref={(el) => {
                    if (el) el.inert = !expanded
                  }}
                >
                  <div className="nav-group__children">
                    {item.children.map((child, index) => (
                      <NavLink
                        key={child.page}
                        to={child.to}
                        className={({ isActive }) => `nav-item nav-item--child ${isActive ? 'active' : ''}`}
                        style={{ '--i': index }}
                        data-page={child.page}
                        onClick={handleNavClick}
                      >
                        <i className={`fas ${child.icon}`} />
                        <span>{child.label}</span>
                      </NavLink>
                    ))}
                  </div>
                </div>
              </div>
            )
          })}
        </nav>
      </aside>
    </>
  )
}
