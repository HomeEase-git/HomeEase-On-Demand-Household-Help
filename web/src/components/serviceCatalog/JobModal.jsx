import { useEffect, useRef, useState } from 'react'
import { COMMON_UNITS, PRICING_MODELS, usesCount } from './catalogModel'

/**
 * Add/edit one row of the job order matrix. The price set here is what every
 * client pays and every worker earns; workers can't change it.
 */
export default function JobModal({ initial, numberQuestions, doleRef, onSave, onClose }) {
  const [job, setJob] = useState(() => ({
    name: '',
    description: '',
    unit: 'job',
    price: '',
    model: 'FIXED',
    durationHours: '',
    overrideReason: '',
    quantityRef: null,
    ...initial,
  }))
  const [error, setError] = useState('')
  const nameRef = useRef(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  useEffect(() => {
    nameRef.current?.focus()
    const onKey = (e) => e.key === 'Escape' && closeRef.current()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const patch = (p) => setJob((prev) => ({ ...prev, ...p }))
  const quote = job.model === 'CUSTOM_QUOTE'
  const belowFloor = !quote && doleRef && job.price !== '' && Number(job.price) < doleRef.hourlyWage

  const submit = (e) => {
    e.preventDefault()
    if (!job.name.trim()) return setError('Give the job a name.')
    if (!quote) {
      if (!(Number(job.price) > 0)) return setError('Set a price above ₱0.')
      if (belowFloor && !job.overrideReason.trim()) {
        return setError('The price is under the DOLE wage reference. Give a reason to keep it.')
      }
    }
    if (usesCount(job.model) && !job.unit.trim()) return setError('Per-unit pricing needs a unit, e.g. unit, room, kilo.')
    if (job.durationHours !== '' && !(Number(job.durationHours) > 0)) return setError('Duration must be more than 0 hours, or left blank.')
    onSave({ ...job, name: job.name.trim(), unit: job.unit.trim().replace(/^per\s+/i, '') })
  }

  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <form
        className="modal sce-modal"
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
        role="dialog"
        aria-modal="true"
        aria-labelledby="sce-j-title"
      >
        <div className="sce-modal__head">
          <h2 id="sce-j-title">{initial ? 'Edit job' : 'Add job'}</h2>
          <p>One row of this category's job order matrix.</p>
        </div>

        <div className="sce-modal__body">
          <label className="sce-field">
            <span>Job order</span>
            <input
              ref={nameRef}
              className="sce-input"
              value={job.name}
              onChange={(e) => patch({ name: e.target.value })}
              placeholder="e.g. Aircon Cleaning – Split Type"
            />
          </label>
          <label className="sce-field">
            <span>Description (optional)</span>
            <input
              className="sce-input"
              value={job.description}
              onChange={(e) => patch({ description: e.target.value })}
              placeholder="Shown to clients under the job name"
            />
          </label>

          <div className="sce-field">
            <span>How it's priced</span>
            <div className="sce-checks">
              {Object.entries(PRICING_MODELS).map(([key, m]) => (
                <label key={key} className="sce-check">
                  <input type="radio" name="sce-j-model" checked={job.model === key} onChange={() => patch({ model: key })} />
                  <span>
                    {m.label}
                    <small>{m.hint}</small>
                  </span>
                </label>
              ))}
            </div>
          </div>

          <div className="sce-grid2">
            <label className="sce-field">
              <span>Unit</span>
              <div className="sce-affix">
                <span>per</span>
                <input
                  className="sce-input"
                  list="sce-units"
                  value={job.unit}
                  onChange={(e) => patch({ unit: e.target.value })}
                  placeholder="job"
                />
              </div>
              <datalist id="sce-units">
                {COMMON_UNITS.map((u) => <option key={u} value={u} />)}
              </datalist>
            </label>
            <label className="sce-field">
              <span>{usesCount(job.model) ? `Price per ${job.unit || 'unit'} (₱)` : 'Price (₱)'}</span>
              <input
                className="sce-input"
                type="number"
                min="0"
                value={quote ? '' : job.price}
                disabled={quote}
                placeholder={quote ? 'Quoted by the worker on-site' : ''}
                onChange={(e) => patch({ price: e.target.value })}
              />
            </label>
          </div>

          {!quote && (
            <div className="sce-grid2">
              <label className="sce-field">
                <span>Duration (hours, optional)</span>
                <input
                  className="sce-input"
                  type="number"
                  min="0"
                  step="0.5"
                  value={job.durationHours ?? ''}
                  onChange={(e) => patch({ durationHours: e.target.value })}
                />
              </label>
            </div>
          )}
          {!quote && (
            <div className="sce-note">
              Every client pays this price and every worker earns from it. Workers can't change it; only the
              expertise-tier surcharge and the distance fee are added at booking.
            </div>
          )}

          {belowFloor && (
            <div className="sce-field">
              <div className="sce-note sce-note--warn">
                This price is under the DOLE {doleRef.label} hourly wage reference (₱{doleRef.hourlyWage.toFixed(2)}/hr,{' '}
                {doleRef.wageOrder}). This is a soft guardrail for independent contractors, not a legal requirement.
              </div>
              <textarea
                className="sce-input"
                rows={2}
                value={job.overrideReason}
                onChange={(e) => patch({ overrideReason: e.target.value })}
                placeholder="Why this price is intentionally below the DOLE reference"
              />
            </div>
          )}

          {usesCount(job.model) && (
            <label className="sce-field">
              <span>Count question (sets the price)</span>
              <select
                className="sce-input"
                value={job.quantityRef || ''}
                onChange={(e) => patch({ quantityRef: e.target.value || null })}
              >
                <option value="">{numberQuestions.length ? 'Pick a Number question…' : 'No Number questions yet'}</option>
                {numberQuestions.map((q) => (
                  <option key={q.ref} value={q.ref}>
                    {q.label}{q.common ? ' (common question)' : ''}
                  </option>
                ))}
              </select>
              <small style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>
                Or save the job, then add a Number question under it and tick “This number sets the price”.
              </small>
            </label>
          )}

          {error && <div className="form-error" role="alert">{error}</div>}
        </div>

        <div className="sce-modal__foot">
          <button type="button" className="btn btn-outline" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary">{initial ? 'Save changes' : 'Add job'}</button>
        </div>
      </form>
    </div>
  )
}
