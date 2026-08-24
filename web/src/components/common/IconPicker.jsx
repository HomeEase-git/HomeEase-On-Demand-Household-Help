import { useMemo, useState } from 'react'
import { SERVICE_ICON_GROUPS, msIconFor } from '../../constants/serviceIcons'

/** Trigger button showing the current selection — opens the grid picker modal on click. */
export default function IconPicker({ value, onChange }) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')

  const selectedName = useMemo(() => {
    for (const group of SERVICE_ICON_GROUPS) {
      const match = group.icons.find((i) => i.ion === value)
      if (match) return match.name
    }
    return null
  }, [value])

  const filteredGroups = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return SERVICE_ICON_GROUPS
    return SERVICE_ICON_GROUPS.map((group) => ({
      ...group,
      icons: group.icons.filter(
        (i) => i.name.toLowerCase().includes(q) || i.ion.toLowerCase().includes(q)
      ),
    })).filter((group) => group.icons.length > 0)
  }, [search])

  const pick = (ion) => {
    onChange(ion)
    setOpen(false)
    setSearch('')
  }

  return (
    <>
      <button type="button" className="icon-picker-trigger" onClick={() => setOpen(true)}>
        <span className="icon-picker-trigger__swatch">
          <span className="msym">{value ? msIconFor(value) : 'help_outline'}</span>
        </span>
        <span className="icon-picker-trigger__label">
          {value ? selectedName || value : 'No icon selected'}
          <small>{value || 'Falls back to a name-based guess on mobile'}</small>
        </span>
        <i className="fas fa-chevron-right" style={{ color: 'var(--text-subtle)' }} />
      </button>

      {open && (
        <div className="modal-backdrop" onClick={() => setOpen(false)} role="presentation">
          <div
            className="modal modal--landscape"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            <h2 className="modal-title">Choose an icon</h2>
            <p className="modal-body" style={{ marginBottom: '0.75rem' }}>
              Shown on the client app instead of the default trade-name guess.
            </p>

            <div className="icon-picker-search">
              <span className="msym">search</span>
              <input
                type="text"
                className="input"
                placeholder="Search by trade or icon name..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                autoFocus
              />
            </div>

            <div className="icon-picker-groups">
              {filteredGroups.length === 0 && (
                <p className="value" style={{ color: 'var(--text-muted)' }}>No icons match &ldquo;{search}&rdquo;.</p>
              )}
              {filteredGroups.map((group) => (
                <div key={group.group} className="icon-picker-group">
                  <h4>{group.group}</h4>
                  <div className="icon-picker-grid">
                    {group.icons.map((icon) => (
                      <button
                        key={icon.ion}
                        type="button"
                        className={`icon-picker-item ${value === icon.ion ? 'is-selected' : ''}`}
                        onClick={() => pick(icon.ion)}
                        title={icon.ion}
                      >
                        <span className="msym">{icon.ms}</span>
                        <span>{icon.name}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            <div className="modal-actions" style={{ marginTop: '1rem' }}>
              {value && (
                <button type="button" className="btn btn-outline" onClick={() => pick(null)}>
                  Clear icon
                </button>
              )}
              <button type="button" className="btn btn-outline" onClick={() => setOpen(false)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
