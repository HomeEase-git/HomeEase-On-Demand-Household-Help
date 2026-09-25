import { useEffect, useMemo, useState } from 'react'
import SectionCard from '../common/SectionCard'
import LoadingState from '../common/LoadingState'
import ErrorState from '../common/ErrorState'
import PageHeader from '../common/PageHeader'
import { fetchSettings, updateSettings } from '../../services/settings'
import { useDetailQuery } from '../../hooks/useListQuery'
import { useToast } from '../../context/ToastContext'

// Shared by every page that edits a slice of the AppSettings singleton
// (Settings, Pricing Rules, Tax Settings). Each page only ever sends its own
// fields, so saving one page can never overwrite a value another page owns.

export function AdornedNumberField({ id, label, hint, value, onChange, min, max, step, error, prefix, suffix }) {
  const modifier = prefix ? 'input-adornment--prefix' : suffix ? 'input-adornment--suffix' : ''
  return (
    <div className="detail-block">
      <label htmlFor={id}>{label}</label>
      <div className={`input-adornment ${modifier}`}>
        {prefix && <span className="input-adornment__affix input-adornment__affix--prefix">{prefix}</span>}
        <input
          id={id}
          type="number"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={onChange}
          className={`input ${error ? 'has-error' : ''}`}
          aria-invalid={!!error}
          aria-describedby={error ? `${id}-error` : undefined}
        />
        {suffix && <span className="input-adornment__affix input-adornment__affix--suffix">{suffix}</span>}
      </div>
      {hint && !error && <span className="toggle-row__hint">{hint}</span>}
      {error && (
        <span id={`${id}-error`} className="field-error">
          {error}
        </span>
      )}
    </div>
  )
}

export function SettingsSection({ icon, title, description, children }) {
  return (
    <SectionCard className="settings-section">
      <div className="settings-section__head">
        <div className="settings-section__icon">
          <i className={`fas ${icon}`} />
        </div>
        <div>
          <h3>{title}</h3>
          {description && <p>{description}</p>}
        </div>
      </div>
      {children}
    </SectionCard>
  )
}

// `raw` is the string straight from the input — checked for '' first since
// `Number('')` is 0, not NaN, which would otherwise let a cleared field pass
// range validation as if the admin had typed 0.
function fieldValidationError(raw, min, max) {
  if (raw === '' || raw === null || raw === undefined) return 'Required.'
  const value = Number(raw)
  if (Number.isNaN(value)) return 'Enter a number.'
  if (min != null && value < min) return `Must be at least ${min}.`
  if (max != null && value > max) return `Must be at most ${max}.`
  return null
}

function nullableFieldValidationError(raw, min, max) {
  if (raw === '' || raw === null || raw === undefined) return null
  return fieldValidationError(raw, min, max)
}

function pickFields(record, fields) {
  return Object.fromEntries(fields.map((f) => [f, record[f]]))
}

// Rates are stored as fractions (0.1) but edited as percents (10).
export function toPercentDisplay(value) {
  return value === '' ? '' : Math.round(value * 1000) / 10
}

/**
 * Draft/validate/save state for one settings page.
 *
 * - `fields`: every AppSettings key this page owns — the only keys compared
 *   for dirtiness and the only keys sent on save.
 * - `numberBounds`: required numeric fields, `{ field: [min, max] }`.
 * - `percentFields`: required fraction fields edited as 0–100 percents.
 * - `nullableBounds`: numeric fields where blank means "off" (null).
 */
export function useSettingsForm({ fields, numberBounds = {}, percentFields = [], nullableBounds = {} }) {
  const { data: loaded, loading, error: loadError, reload } = useDetailQuery(fetchSettings, 'singleton')
  const [settings, setSettings] = useState(null)
  const [fieldErrors, setFieldErrors] = useState({})
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const { showSuccess, showError } = useToast()

  // Draft state mirrors the loaded record so edits don't mutate the shared
  // cache until Save actually succeeds; re-syncs whenever a fresh fetch
  // lands (first load, or after reload() following a save resets settings
  // back to null below).
  const current = settings ?? loaded
  useEffect(() => {
    if (loaded && settings === null) {
      setSettings(loaded)
    }
  }, [loaded, settings])

  const pick = (record) => pickFields(record, fields)

  const isDirty = useMemo(
    () => !!loaded && !!settings && JSON.stringify(pickFields(loaded, fields)) !== JSON.stringify(pickFields(settings, fields)),
    [loaded, settings, fields]
  )

  const updateField = (field) => (value) => setSettings((prev) => ({ ...prev, [field]: value }))

  const updateNumberField = (field) => (e) => {
    const raw = e.target.value
    setSettings((prev) => ({ ...prev, [field]: raw === '' ? raw : Number(raw) }))
    const [min, max] = numberBounds[field]
    setFieldErrors((prev) => ({ ...prev, [field]: fieldValidationError(raw, min, max) }))
  }

  const updatePercentField = (field) => (e) => {
    const raw = e.target.value
    setSettings((prev) => ({ ...prev, [field]: raw === '' ? raw : Number(raw) / 100 }))
    setFieldErrors((prev) => ({ ...prev, [field]: fieldValidationError(raw, 0, 100) }))
  }

  // Blank clears the field back to null (off) rather than failing validation.
  const updateNullableNumberField = (field) => (e) => {
    const raw = e.target.value
    setSettings((prev) => ({ ...prev, [field]: raw === '' ? null : Number(raw) }))
    const [min, max] = nullableBounds[field]
    setFieldErrors((prev) => ({ ...prev, [field]: nullableFieldValidationError(raw, min, max) }))
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!current) return

    const nextFieldErrors = {}
    Object.entries(numberBounds).forEach(([field, [min, max]]) => {
      const err = fieldValidationError(current[field], min, max)
      if (err) nextFieldErrors[field] = err
    })
    percentFields.forEach((field) => {
      const err = fieldValidationError(toPercentDisplay(current[field]), 0, 100)
      if (err) nextFieldErrors[field] = err
    })
    Object.entries(nullableBounds).forEach(([field, [min, max]]) => {
      const err = nullableFieldValidationError(current[field], min, max)
      if (err) nextFieldErrors[field] = err
    })
    setFieldErrors(nextFieldErrors)
    if (Object.keys(nextFieldErrors).length > 0) {
      setError('Fix the highlighted fields before saving.')
      return
    }

    setSaving(true)
    setError('')

    try {
      await updateSettings(pick(current))
      await reload()
      setSettings(null) // re-seed the draft from the freshly-reloaded record
      showSuccess('Settings saved.')
    } catch (err) {
      showError(err.message || 'Failed to save settings')
    } finally {
      setSaving(false)
    }
  }

  const discardChanges = () => {
    setSettings(loaded)
    setFieldErrors({})
    setError('')
  }

  return {
    current,
    loading,
    loadError,
    reload,
    fieldErrors,
    error,
    saving,
    isDirty,
    updateField,
    updateNumberField,
    updatePercentField,
    updateNullableNumberField,
    handleSubmit,
    discardChanges,
  }
}

// Renders the loading/error states until the record is available, then the
// page's sections inside a form with the sticky save bar.
export function SettingsFormPage({ title, subtitle, form, children }) {
  const { current, loading, loadError, reload, error, saving, isDirty, handleSubmit, discardChanges } = form

  if (loading && !current) {
    return (
      <>
        <PageHeader title={title} subtitle={subtitle} />
        <LoadingState variant="block" message="Loading settings..." />
      </>
    )
  }

  if (loadError && !current) {
    return (
      <>
        <PageHeader title={title} subtitle={subtitle} />
        <ErrorState message={loadError} onRetry={reload} />
      </>
    )
  }

  return (
    <form onSubmit={handleSubmit} noValidate>
      <PageHeader title={title} subtitle={subtitle} />

      {children}

      {error && <div className="form-error" style={{ marginTop: '1rem' }}>{error}</div>}

      <div className="settings-savebar">
        <div className={`settings-savebar__status ${isDirty ? '' : 'settings-savebar__status--clean'}`}>
          <span className="settings-savebar__dot" />
          {isDirty ? 'You have unsaved changes' : 'All changes saved'}
        </div>
        <div className="settings-savebar__actions">
          {isDirty && (
            <button type="button" className="btn btn-outline" onClick={discardChanges} disabled={saving}>
              Discard
            </button>
          )}
          <button type="submit" className="btn btn-primary" disabled={saving || !isDirty}>
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </div>
    </form>
  )
}
