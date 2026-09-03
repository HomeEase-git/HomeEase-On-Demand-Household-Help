import { useEffect, useMemo, useState } from 'react'
import PageHeader from '../components/common/PageHeader'
import SectionCard from '../components/common/SectionCard'
import LoadingState from '../components/common/LoadingState'
import ErrorState from '../components/common/ErrorState'
import { fetchSettings, updateSettings } from '../services/settings'
import { useDetailQuery } from '../hooks/useListQuery'
import { useToast } from '../context/ToastContext'

function AdornedNumberField({ id, label, hint, value, onChange, min, max, step, error, prefix, suffix }) {
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

function SettingsSection({ icon, title, description, children }) {
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

// Each numeric field's [min, max] bounds, keyed by settings field name —
// shared between live per-field validation and the pre-submit sweep below.
const NUMBER_FIELD_BOUNDS = {
  workerDebtHoldLimit: [0, 100000],
  commissionRatePercent: [0, 100],
  withholdingTaxRatePercent: [0, 100],
  maxSlotsPerDay: [1, 24],
  pendingExpiryMinutes: [5, 10080],
  geofenceRadiusMeters: [10, 5000],
  maxDeclinesBeforeCooldown: [1, 20],
  declineWindowHours: [1, 720],
  declineCooldownHours: [1, 720],
  tierProMinRating: [0, 5],
  tierProMinJobs: [0, null],
  tierProMultiplier: [1, 5],
  tierExpertMinRating: [0, 5],
  tierExpertMinJobs: [0, null],
  tierExpertMultiplier: [1, 5],
}

export default function Settings() {
  const { data: loaded, loading, error: loadError, reload: loadSettings } = useDetailQuery(fetchSettings, 'singleton')
  const [settings, setSettings] = useState(null)
  const [fieldErrors, setFieldErrors] = useState({})
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const { showSuccess, showError } = useToast()

  // Draft state mirrors the loaded record so edits don't mutate the shared
  // cache until Save actually succeeds; re-syncs whenever a fresh fetch
  // lands (first load, or after loadSettings() following a save resets
  // settings back to null below).
  const current = settings ?? loaded
  useEffect(() => {
    if (loaded && settings === null) {
      setSettings(loaded)
    }
  }, [loaded, settings])

  const isDirty = useMemo(
    () => !!loaded && !!settings && JSON.stringify(loaded) !== JSON.stringify(settings),
    [loaded, settings]
  )

  const updateNumberField = (field) => (e) => {
    const raw = e.target.value
    setSettings((prev) => ({ ...prev, [field]: raw === '' ? raw : Number(raw) }))
    const [min, max] = NUMBER_FIELD_BOUNDS[field]
    setFieldErrors((prev) => ({ ...prev, [field]: fieldValidationError(raw, min, max) }))
  }

  const updatePercentField = (field, percentKey) => (e) => {
    const raw = e.target.value
    setSettings((prev) => ({ ...prev, [field]: raw === '' ? raw : Number(raw) / 100 }))
    setFieldErrors((prev) => ({ ...prev, [percentKey]: fieldValidationError(raw, 0, 100) }))
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!current) return

    const nextFieldErrors = {}
    Object.entries(NUMBER_FIELD_BOUNDS).forEach(([field, [min, max]]) => {
      const rawSettingsKey = field === 'commissionRatePercent' || field === 'withholdingTaxRatePercent'
        ? field.replace('Percent', '')
        : field
      const rawValue = current[rawSettingsKey]
      const displayValue = (rawSettingsKey === 'commissionRate' || rawSettingsKey === 'withholdingTaxRate') && rawValue !== ''
        ? Math.round(rawValue * 1000) / 10
        : rawValue
      const err = fieldValidationError(displayValue, min, max)
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
      await updateSettings(current)
      await loadSettings()
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

  if (loading && !current) {
    return (
      <>
        <PageHeader title="Settings" subtitle="General administration settings" />
        <LoadingState message="Loading settings..." />
      </>
    )
  }

  if (loadError && !current) {
    return (
      <>
        <PageHeader title="Settings" subtitle="General administration settings" />
        <ErrorState message={loadError} onRetry={loadSettings} />
      </>
    )
  }

  return (
    <form onSubmit={handleSubmit} noValidate>
      <PageHeader title="Settings" subtitle="General administration settings" />

      <SettingsSection icon="fa-building" title="General" description="Public-facing site identity.">
        <div className="detail-grid" style={{ marginBottom: 0 }}>
          <div className="detail-block">
            <label htmlFor="settings-site-name">Site Name</label>
            <input
              id="settings-site-name"
              value={current.siteName}
              onChange={(e) => setSettings((prev) => ({ ...prev, siteName: e.target.value }))}
              className="input"
              required
            />
          </div>
          <div className="detail-block">
            <label htmlFor="settings-support-email">Support Email</label>
            <input
              id="settings-support-email"
              type="email"
              value={current.supportEmail}
              onChange={(e) => setSettings((prev) => ({ ...prev, supportEmail: e.target.value }))}
              className="input"
              required
            />
          </div>
        </div>
      </SettingsSection>

      <SettingsSection icon="fa-bell" title="Notifications" description="Email and in-app admin alerts.">
        <div className="toggle-row">
          <div>
            <div className="toggle-row__label">Enable admin notifications</div>
            <div className="toggle-row__hint">New bookings, disputes, and payout failures alert the admin team.</div>
          </div>
          <label className="toggle">
            <input
              id="settings-notifications-enabled"
              type="checkbox"
              checked={current.notificationsEnabled}
              onChange={() => setSettings((prev) => ({ ...prev, notificationsEnabled: !prev.notificationsEnabled }))}
            />
            <span className="toggle__track">
              <span className="toggle__thumb" />
            </span>
          </label>
        </div>
      </SettingsSection>

      <SettingsSection
        icon="fa-sliders"
        title="Platform Configuration"
        description="Live business rules enforced by the booking, payment, and worker-availability flows. Commission/tax rate changes apply to new payments going forward; existing payments keep the rate they were charged at."
      >
        <p className="settings-group__label" style={{ marginTop: 0 }}>Pricing &amp; Revenue</p>
        <div className="detail-grid" style={{ marginBottom: 0 }}>
          <AdornedNumberField
            id="settings-debt-hold-limit"
            label="Worker Debt Hold Limit"
            prefix="₱"
            min={0}
            max={100000}
            step={50}
            value={current.workerDebtHoldLimit}
            onChange={updateNumberField('workerDebtHoldLimit')}
            error={fieldErrors.workerDebtHoldLimit}
          />
          <AdornedNumberField
            id="settings-commission-rate"
            label="Commission Rate"
            suffix="%"
            min={0}
            max={100}
            step={0.5}
            value={current.commissionRate === '' ? '' : Math.round(current.commissionRate * 1000) / 10}
            onChange={updatePercentField('commissionRate', 'commissionRatePercent')}
            error={fieldErrors.commissionRatePercent}
          />
          <AdornedNumberField
            id="settings-withholding-tax"
            label="Withholding Tax Rate"
            suffix="%"
            min={0}
            max={100}
            step={0.5}
            value={current.withholdingTaxRate === '' ? '' : Math.round(current.withholdingTaxRate * 1000) / 10}
            onChange={updatePercentField('withholdingTaxRate', 'withholdingTaxRatePercent')}
            error={fieldErrors.withholdingTaxRatePercent}
          />
        </div>

        <div className="settings-group">
          <p className="settings-group__label">Booking &amp; Availability</p>
          <div className="detail-grid" style={{ marginBottom: 0 }}>
            <AdornedNumberField
              id="settings-max-slots"
              label="Max Availability Slots / Day"
              min={1}
              max={24}
              value={current.maxSlotsPerDay}
              onChange={updateNumberField('maxSlotsPerDay')}
              error={fieldErrors.maxSlotsPerDay}
            />
            <AdornedNumberField
              id="settings-pending-expiry"
              label="Pending Booking Hold Timeout"
              suffix="min"
              min={5}
              max={10080}
              value={current.pendingExpiryMinutes}
              onChange={updateNumberField('pendingExpiryMinutes')}
              error={fieldErrors.pendingExpiryMinutes}
            />
            <AdornedNumberField
              id="settings-geofence-radius"
              label="Arrival Geofence Radius"
              suffix="m"
              min={10}
              max={5000}
              value={current.geofenceRadiusMeters}
              onChange={updateNumberField('geofenceRadiusMeters')}
              error={fieldErrors.geofenceRadiusMeters}
            />
          </div>
        </div>

        <div className="settings-group">
          <p className="settings-group__label">Worker Decline Policy</p>
          <div className="detail-grid" style={{ marginBottom: 0 }}>
            <AdornedNumberField
              id="settings-max-declines"
              label="Max Declines Before Cooldown"
              min={1}
              max={20}
              value={current.maxDeclinesBeforeCooldown}
              onChange={updateNumberField('maxDeclinesBeforeCooldown')}
              error={fieldErrors.maxDeclinesBeforeCooldown}
            />
            <AdornedNumberField
              id="settings-decline-window"
              label="Decline Rolling Window"
              suffix="hrs"
              min={1}
              max={720}
              value={current.declineWindowHours}
              onChange={updateNumberField('declineWindowHours')}
              error={fieldErrors.declineWindowHours}
            />
            <AdornedNumberField
              id="settings-decline-cooldown"
              label="Decline Cooldown Duration"
              suffix="hrs"
              min={1}
              max={720}
              value={current.declineCooldownHours}
              onChange={updateNumberField('declineCooldownHours')}
              error={fieldErrors.declineCooldownHours}
            />
          </div>
        </div>
      </SettingsSection>

      <SettingsSection
        icon="fa-ranking-star"
        title="Expertise Tiers"
        description="Rates scale up for higher tiers, computed live from a worker's rating and completed-job count — not manually assigned."
      >
        <p className="settings-group__label" style={{ marginTop: 0 }}>Pro Tier</p>
        <div className="detail-grid" style={{ marginBottom: 0 }}>
          <AdornedNumberField
            id="settings-pro-min-rating"
            label="Min Rating"
            min={0}
            max={5}
            step={0.1}
            value={current.tierProMinRating}
            onChange={updateNumberField('tierProMinRating')}
            error={fieldErrors.tierProMinRating}
          />
          <AdornedNumberField
            id="settings-pro-min-jobs"
            label="Min Completed Jobs"
            min={0}
            value={current.tierProMinJobs}
            onChange={updateNumberField('tierProMinJobs')}
            error={fieldErrors.tierProMinJobs}
          />
          <AdornedNumberField
            id="settings-pro-multiplier"
            label="Rate Multiplier"
            suffix="×"
            min={1}
            max={5}
            step={0.05}
            value={current.tierProMultiplier}
            onChange={updateNumberField('tierProMultiplier')}
            error={fieldErrors.tierProMultiplier}
          />
        </div>

        <div className="settings-group">
          <p className="settings-group__label">Expert Tier</p>
          <div className="detail-grid" style={{ marginBottom: 0 }}>
            <AdornedNumberField
              id="settings-expert-min-rating"
              label="Min Rating"
              min={0}
              max={5}
              step={0.1}
              value={current.tierExpertMinRating}
              onChange={updateNumberField('tierExpertMinRating')}
              error={fieldErrors.tierExpertMinRating}
            />
            <AdornedNumberField
              id="settings-expert-min-jobs"
              label="Min Completed Jobs"
              min={0}
              value={current.tierExpertMinJobs}
              onChange={updateNumberField('tierExpertMinJobs')}
              error={fieldErrors.tierExpertMinJobs}
            />
            <AdornedNumberField
              id="settings-expert-multiplier"
              label="Rate Multiplier"
              suffix="×"
              min={1}
              max={5}
              step={0.05}
              value={current.tierExpertMultiplier}
              onChange={updateNumberField('tierExpertMultiplier')}
              error={fieldErrors.tierExpertMultiplier}
            />
          </div>
        </div>
      </SettingsSection>

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
