import { useEffect, useRef, useState } from 'react'
import { COMMON_UNITS, PRICING_MODELS, usesCount } from './catalogModel'

/**
 * Add/edit one row of the job order matrix. The price set here is what every
 * client pays and every worker earns; workers can't change it.
 */
export default function JobModal({ initial, doleRef, onSave, onClose }) {
  const [job, setJob] = useState(() => ({
    name: '',
    description: '',
    unit: 'job',
    price: '',
    model: 'FIXED',
    allowsFollowUp: false,
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
  const belowFloor = doleRef && job.price !== '' && Number(job.price) < doleRef.hourlyWage

  const submit = (e) => {
    e.preventDefault()
    if (!job.name.trim()) return setError('Give the job a name.')
    if (!(Number(job.price) > 0)) return setError('Set a price above ₱0.')
    if (belowFloor && !job.overrideReason.trim()) {
      return setError('The price is under the DOLE wage reference. Give a reason to keep it.')
    }
    if (usesCount(job.model) && !job.unit.trim()) return setError('Price per piece needs a unit, e.g. outlet, room, kilo.')
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
            {usesCount(job.model) && <label className="sce-field">
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
            </label>}
            <label className="sce-field">
              <span>{usesCount(job.model) ? `Price per ${job.unit || 'unit'} (₱)` : 'Price (₱)'}</span>
              <input
                className="sce-input"
                type="number"
                min="0"
                value={job.price}
                onChange={(e) => patch({ price: e.target.value })}
              />
            </label>
          </div>

          <div className="sce-note">
            Every client pays this price and every worker earns from it. Workers can't change it; only the
            expertise-tier surcharge, the distance fee and the same-day fee are added at booking. Parts and extra
            work go on the worker's invoice at the end of the job.
          </div>

          <label className="sce-check">
            <input
              type="checkbox"
              checked={Boolean(job.allowsFollowUp)}
              onChange={(e) => patch({ allowsFollowUp: e.target.checked })}
            />
            <span>
              Inspection / diagnosis job — allows a follow-up job
              <small>
                After this job the worker can propose the repair as a follow-up job. It's only booked once the client
                confirms.
              </small>
            </span>
          </label>

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
