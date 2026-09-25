import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { NAV_PAGES } from '../../constants/navigation'

// Pages reached through a page's own tabs rather than the sidebar, plus
// extra words people are likely to type for sidebar pages.
const EXTRA_PAGES = [
  { to: '/bookings/dispute', icon: 'fa-triangle-exclamation', label: 'Disputes', group: 'Bookings' },
  { to: '/payments/refunds', icon: 'fa-rotate-left', label: 'Refunds', group: 'Payments' },
  { to: '/payments/payouts', icon: 'fa-money-bill-transfer', label: 'Payouts', group: 'Payments' },
  { to: '/reviews/flagged', icon: 'fa-flag', label: 'Flagged reviews', group: 'Reviews' },
  { to: '/mfa-setup', icon: 'fa-shield-halved', label: 'Two-factor authentication', group: 'Settings' },
]
const KEYWORDS = {
  '/users': 'customers users',
  '/verification': 'kyc approve documents',
  '/service-catalog': 'services categories jobs tasks',
  '/tax/certificates': 'bir 2307',
  '/reports/logs': 'audit logs export csv',
  '/promo-banners': 'carousel home ads',
}

export const OPEN_COMMAND_PALETTE_EVENT = 'homeease:open-command-palette'

/**
 * Ctrl/Cmd+K: type to jump to any admin page. Also opened by the search
 * button in the header (via OPEN_COMMAND_PALETTE_EVENT).
 */
export default function CommandPalette() {
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const inputRef = useRef(null)
  const returnFocusRef = useRef(null)

  const pages = useMemo(() => [...NAV_PAGES, ...EXTRA_PAGES], [])
  const results = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean)
    if (!words.length) return pages
    return pages.filter((page) => {
      const haystack = `${page.label} ${page.group ?? ''} ${KEYWORDS[page.to] ?? ''}`.toLowerCase()
      return words.every((w) => haystack.includes(w))
    })
  }, [pages, query])

  useEffect(() => {
    const show = () => {
      returnFocusRef.current = document.activeElement
      setQuery('')
      setActive(0)
      setOpen(true)
    }
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen((isOpen) => {
          if (!isOpen) {
            returnFocusRef.current = document.activeElement
            setQuery('')
            setActive(0)
          }
          return !isOpen
        })
      }
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener(OPEN_COMMAND_PALETTE_EVENT, show)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener(OPEN_COMMAND_PALETTE_EVENT, show)
    }
  }, [])

  useEffect(() => {
    if (open) inputRef.current?.focus()
    else returnFocusRef.current?.focus?.()
  }, [open])

  if (!open) return null

  const close = () => setOpen(false)
  const go = (page) => {
    close()
    navigate(page.to)
  }
  const onInputKey = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((i) => Math.min(i + 1, results.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter' && results[active]) {
      e.preventDefault()
      go(results[active])
    } else if (e.key === 'Escape') {
      e.preventDefault()
      close()
    }
  }

  return (
    <div className="palette-backdrop" onClick={close} role="presentation">
      <div className="palette" role="dialog" aria-modal="true" aria-label="Go to page" onClick={(e) => e.stopPropagation()}>
        <div className="palette__search">
          <i className="fas fa-magnifying-glass" aria-hidden="true" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setActive(0)
            }}
            onKeyDown={onInputKey}
            placeholder="Go to page…"
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-results"
            aria-activedescendant={results[active] ? `palette-item-${active}` : undefined}
          />
          <kbd>Esc</kbd>
        </div>
        <ul className="palette__results" id="palette-results" role="listbox">
          {results.length === 0 && <li className="palette__empty">No pages match “{query}”</li>}
          {results.map((page, index) => (
            <li
              key={page.to}
              id={`palette-item-${index}`}
              role="option"
              aria-selected={index === active}
              className={`palette__item ${index === active ? 'is-active' : ''}`}
              onMouseEnter={() => setActive(index)}
              onClick={() => go(page)}
            >
              <i className={`fas ${page.icon}`} aria-hidden="true" />
              <span className="palette__label">{page.label}</span>
              {page.group && <span className="palette__group">{page.group}</span>}
            </li>
          ))}
        </ul>
        <div className="palette__hint">
          <span><kbd>↑</kbd><kbd>↓</kbd> move</span>
          <span><kbd>Enter</kbd> open</span>
        </div>
      </div>
    </div>
  )
}
