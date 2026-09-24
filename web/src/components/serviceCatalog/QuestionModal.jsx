import { useEffect, useRef, useState } from 'react'
import { PreviewQuestion } from './ClientPreview'
import { QUESTION_TYPES, emptyQuestion, formatPeso, isChoiceType, usesCount } from './catalogModel'

/**
 * Add/edit one booking question. `job` is null for a common question. For a
 * job's Number question, "This number sets the price" makes it the job's
 * count question (onSave's second argument).
 */
export default function QuestionModal({ initial, job, isCount, currentCountLabel, library, onSave, onClose }) {
  const [q, setQ] = useState(() => (initial ? { ...initial, choices: [...initial.choices] } : emptyQuestion()))
  const [setsPrice, setSetsPrice] = useState(!!isCount)
  const [error, setError] = useState('')
  const labelRef = useRef(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  useEffect(() => {
    labelRef.current?.focus()
    const onKey = (e) => e.key === 'Escape' && closeRef.current()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const patch = (p) => setQ((prev) => ({ ...prev, ...p }))
  const setType = (type) => {
    setQ((prev) => {
      const next = { ...prev, type }
      if (isChoiceType(type) && next.choices.filter((c) => c.trim()).length === 0) next.choices = ['', '']
      if (type === 'NUMBER' && (next.min === '' || next.min == null)) Object.assign(next, { min: 1, max: 10 })
      if (!isChoiceType(type)) next.match = false
      return next
    })
    if (type !== 'NUMBER') setSetsPrice(false)
  }
  const setChoice = (i, value) => setQ((prev) => ({ ...prev, choices: prev.choices.map((c, k) => (k === i ? value : c)) }))
  const moveChoice = (i, delta) =>
    setQ((prev) => {
      const choices = [...prev.choices]
      const k = i + delta
      if (k < 0 || k >= choices.length) return prev
      ;[choices[i], choices[k]] = [choices[k], choices[i]]
      return { ...prev, choices }
    })

  const startFrom = (index) => {
    if (index === '') return
    const src = library[Number(index)]
    setQ((prev) => ({
      ...prev,
      label: src.label,
      helpText: src.helpText,
      type: src.type,
      choices: src.choices.length ? [...src.choices] : ['', ''],
      min: src.min ?? 1,
      max: src.max ?? 10,
      required: src.required,
      match: src.match,
    }))
    if (src.type !== 'NUMBER') setSetsPrice(false)
  }

  const submit = (e) => {
    e.preventDefault()
    const label = q.label.trim()
    if (!label) return setError('Type the question the client will see.')
    const out = { ...q, label, helpText: q.helpText.trim() }
    if (isChoiceType(q.type)) {
      out.choices = q.choices.map((c) => c.trim()).filter(Boolean)
      if (out.choices.length < 2) return setError('Add at least two choices.')
      if (new Set(out.choices.map((c) => c.toLowerCase())).size !== out.choices.length) return setError('Two choices are the same.')
    } else {
      out.choices = []
    }
    if (q.type === 'NUMBER') {
      if (q.min === '' || q.max === '' || q.min == null || q.max == null) return setError('Set a minimum and a maximum.')
      if (Number(q.min) > Number(q.max)) return setError('The minimum is larger than the maximum.')
      out.min = Number(q.min)
      out.max = Number(q.max)
    } else {
      out.min = null
      out.max = null
    }
    onSave(out, q.type === 'NUMBER' && setsPrice)
  }

  const showPriceToggle = !!job && q.type === 'NUMBER'
  const willChangeModel = showPriceToggle && setsPrice && !usesCount(job.model)
  const replacesCount = showPriceToggle && setsPrice && !isCount && currentCountLabel

  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <form
        className="modal sce-modal"
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
        role="dialog"
        aria-modal="true"
        aria-labelledby="sce-q-title"
      >
        <div className="sce-modal__head">
          <h2 id="sce-q-title">{initial ? 'Edit question' : 'Add question'}</h2>
          <p>{job ? `Job: ${job.name || 'Untitled job'}` : 'Common question, asked for every job'}</p>
        </div>

        <div className="sce-modal__body">
          {!initial && library.length > 0 && (
            <label className="sce-field">
              <span>Start from a saved question (optional)</span>
              <select className="sce-input" defaultValue="" onChange={(e) => startFrom(e.target.value)}>
                <option value="">Blank question</option>
                {library.map((item, i) => (
                  <option key={`${item.label}|${item.type}`} value={i}>
                    {item.label} · {QUESTION_TYPES[item.type].label}
                  </option>
                ))}
              </select>
            </label>
          )}

          <label className="sce-field">
            <span>Question</span>
            <input
              ref={labelRef}
              className="sce-input"
              value={q.label}
              onChange={(e) => patch({ label: e.target.value })}
              placeholder="e.g. What is the unit's horsepower (HP)?"
            />
          </label>

          <label className="sce-field">
            <span>Help text (optional)</span>
            <input
              className="sce-input"
              value={q.helpText}
              onChange={(e) => patch({ helpText: e.target.value })}
              placeholder="e.g. Check the sticker on the indoor unit"
            />
          </label>

          <div className="sce-field">
            <span>Answer type</span>
            <div className="sce-types" role="radiogroup" aria-label="Answer type">
              {Object.entries(QUESTION_TYPES).map(([key, t]) => (
                <label key={key} className={`sce-type ${q.type === key ? 'is-on' : ''}`}>
                  <input type="radio" name="sce-q-type" value={key} checked={q.type === key} onChange={() => setType(key)} />
                  <b>{t.label}</b>
                  <small>{t.hint}</small>
                  <small>{t.example}</small>
                </label>
              ))}
            </div>
          </div>

          {q.type === 'NUMBER' && (
            <div className="sce-grid2">
              <label className="sce-field">
                <span>Minimum</span>
                <input className="sce-input" type="number" value={q.min ?? ''} onChange={(e) => patch({ min: e.target.value })} />
              </label>
              <label className="sce-field">
                <span>Maximum</span>
                <input className="sce-input" type="number" value={q.max ?? ''} onChange={(e) => patch({ max: e.target.value })} />
              </label>
            </div>
          )}

          {isChoiceType(q.type) && (
            <div className="sce-field">
              <span>Choices</span>
              <div className="sce-checks" style={{ gap: '0.35rem' }}>
                {q.choices.map((c, i) => (
                  <div key={i} className="sce-choice">
                    <input
                      className="sce-input"
                      value={c}
                      onChange={(e) => setChoice(i, e.target.value)}
                      placeholder={`Choice ${i + 1}`}
                      aria-label={`Choice ${i + 1}`}
                    />
                    <button type="button" className="sce-ib" onClick={() => moveChoice(i, -1)} disabled={i === 0} aria-label={`Move choice ${i + 1} up`}>
                      <i className="fas fa-chevron-up" />
                    </button>
                    <button type="button" className="sce-ib" onClick={() => moveChoice(i, 1)} disabled={i === q.choices.length - 1} aria-label={`Move choice ${i + 1} down`}>
                      <i className="fas fa-chevron-down" />
                    </button>
                    <button
                      type="button"
                      className="sce-ib sce-ib--danger"
                      onClick={() => patch({ choices: q.choices.filter((_, k) => k !== i) })}
                      disabled={q.choices.length <= 1}
                      aria-label={`Remove choice ${i + 1}`}
                    >
                      <i className="fas fa-trash" />
                    </button>
                  </div>
                ))}
                <div>
                  <button type="button" className="btn btn-outline btn-sm" onClick={() => patch({ choices: [...q.choices, ''] })}>
                    <i className="fas fa-plus" /> Add choice
                  </button>
                </div>
              </div>
            </div>
          )}

          {q.type === 'YESNO' && <div className="sce-note">The client picks Yes or No.</div>}

          <div className="sce-checks">
            <label className="sce-check">
              <input type="checkbox" checked={q.required} onChange={(e) => patch({ required: e.target.checked })} />
              <span>
                Required
                <small>The client can't book without answering.</small>
              </span>
            </label>
            {showPriceToggle && (
              <label className="sce-check">
                <input type="checkbox" checked={setsPrice} onChange={(e) => setSetsPrice(e.target.checked)} />
                <span>
                  This number sets the price
                  <small>
                    {job.model === 'CUSTOM_QUOTE' ? 'Price' : formatPeso(job.price)} × this answer
                    {job.unit ? ` (${job.unit})` : ''}.
                  </small>
                </span>
              </label>
            )}
            <label className={`sce-check ${isChoiceType(q.type) ? '' : 'is-disabled'}`}>
              <input
                type="checkbox"
                checked={q.match}
                disabled={!isChoiceType(q.type)}
                onChange={(e) => patch({ match: e.target.checked })}
              />
              <span>
                Match workers by this answer
                <small>Only show workers who handle the client's choice. For Pick one and Pick any questions.</small>
              </span>
            </label>
          </div>

          {willChangeModel && (
            <div className="sce-note sce-note--warn">Saving changes this job's pricing to price × count.</div>
          )}
          {replacesCount && (
            <div className="sce-note sce-note--warn">Replaces “{currentCountLabel}” as the question that sets the price.</div>
          )}

          <div className="sce-modal-preview">
            <span>What the client sees</span>
            <PreviewQuestion question={q} />
          </div>

          {error && <div className="form-error" role="alert">{error}</div>}
        </div>

        <div className="sce-modal__foot">
          <button type="button" className="btn btn-outline" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary">{initial ? 'Save changes' : 'Add question'}</button>
        </div>
      </form>
    </div>
  )
}
