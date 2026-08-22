import { useEffect, useState } from 'react'
import SectionCard from '../components/common/SectionCard'
import LoadingState from '../components/common/LoadingState'
import ErrorState from '../components/common/ErrorState'
import { fetchSettings, updateSettings } from '../services/settings'

function NumberField({ id, label, value, onChange, min, max, step, error }) {
  return (
    <div className="detail-block">
      <label htmlFor={id}>{label}</label>
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
      {error && (
        <span id={`${id}-error`} className="field-error">
          {error}
        </span>
      )}
    </div>
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

export default function Settings() {
  const [settings, setSettings] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [fieldErrors, setFieldErrors] = useState({})

  const loadSettings = async () => {
    setLoading(true)
    setError(null)

    try {
      const data = await fetchSettings()
      setSettings(data)
    } catch (err) {
      setError(err.message || 'Failed to load settings')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadSettings()
  }, [])

  // Each numeric field's [min, max] bounds, keyed by settings field name —
  // shared between live per-field validation and the pre-submit sweep below.
  const NUMBER_FIELD_BOUNDS = {
    adminFeePerJob: [0, 1000],
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

  const updateNumberField = (field) => (e) => {
    const raw = e.target.value
    setSettings((prev) => ({ ...prev, [field]: raw === '' ? raw : Number(raw) }))
    const [min, max] = NUMBER_FIELD_BOUNDS[field]
    setFieldErrors((prev) => ({ ...prev, [field]: fieldValidationError(raw, min, max) }))
  }

  const handleSubmit = async (e) => {
    e.preventDefault()

    const nextFieldErrors = {}
    Object.entries(NUMBER_FIELD_BOUNDS).forEach(([field, [min, max]]) => {
      const rawSettingsKey = field === 'commissionRatePercent' || field === 'withholdingTaxRatePercent'
        ? field.replace('Percent', '')
        : field
      const rawValue = settings[rawSettingsKey]
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
    setError(null)

    try {
      const updated = await updateSettings(settings)
      setSettings(updated)
      setSaved(true)
      window.setTimeout(() => setSaved(false), 1800)
    } catch (err) {
      setError(err.message || 'Failed to save settings')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <>
        <h1 className="page-title">Settings</h1>
        <p className="page-subtitle">General administration settings</p>
        <LoadingState message="Loading settings..." />
      </>
    )
  }

  if (error && !settings) {
    return (
      <>
        <h1 className="page-title">Settings</h1>
        <p className="page-subtitle">General administration settings</p>
        <ErrorState message={error} onRetry={loadSettings} />
      </>
    )
  }

  return (
    <form onSubmit={handleSubmit} noValidate>
      <h1 className="page-title">Settings</h1>
      <p className="page-subtitle">General administration settings</p>
      <SectionCard title="General">
        <div className="detail-grid">
          <div className="detail-block">
            <label htmlFor="settings-site-name">Site Name</label>
            <input
              id="settings-site-name"
              value={settings.siteName}
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
              value={settings.supportEmail}
              onChange={(e) => setSettings((prev) => ({ ...prev, supportEmail: e.target.value }))}
              className="input"
              required
            />
          </div>
        </div>
      </SectionCard>
      <SectionCard title="Notifications">
        <p className="page-subtitle">Configure email and in-app notifications.</p>
        <label htmlFor="settings-notifications-enabled" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginTop: '0.75rem' }}>
          <input
            id="settings-notifications-enabled"
            type="checkbox"
            checked={settings.notificationsEnabled}
            onChange={() => setSettings((prev) => ({ ...prev, notificationsEnabled: !prev.notificationsEnabled }))}
          />
          Enable admin notifications
        </label>
      </SectionCard>
      <SectionCard title="Platform Configuration">
        <p className="page-subtitle">
          Live business rules enforced by the booking, payment, and worker-availability flows. Commission/tax rate
          changes apply to new payments going forward; existing payments keep the rate they were charged at.
        </p>
        <div className="detail-grid" style={{ marginTop: '0.75rem' }}>
          <NumberField
            id="settings-admin-fee"
            label="Admin Fee Per Job (₱)"
            min={0}
            max={1000}
            step={1}
            value={settings.adminFeePerJob}
            onChange={updateNumberField('adminFeePerJob')}
            error={fieldErrors.adminFeePerJob}
          />
          <NumberField
            id="settings-commission-rate"
            label="Commission Rate (%)"
            min={0}
            max={100}
            step={0.5}
            value={settings.commissionRate === '' ? '' : Math.round(settings.commissionRate * 1000) / 10}
            onChange={(e) => {
              const raw = e.target.value
              setSettings((prev) => ({ ...prev, commissionRate: raw === '' ? raw : Number(raw) / 100 }))
              setFieldErrors((prev) => ({ ...prev, commissionRatePercent: fieldValidationError(raw, 0, 100) }))
            }}
            error={fieldErrors.commissionRatePercent}
          />
          <NumberField
            id="settings-withholding-tax"
            label="Withholding Tax Rate (%)"
            min={0}
            max={100}
            step={0.5}
            value={settings.withholdingTaxRate === '' ? '' : Math.round(settings.withholdingTaxRate * 1000) / 10}
            onChange={(e) => {
              const raw = e.target.value
              setSettings((prev) => ({ ...prev, withholdingTaxRate: raw === '' ? raw : Number(raw) / 100 }))
              setFieldErrors((prev) => ({ ...prev, withholdingTaxRatePercent: fieldValidationError(raw, 0, 100) }))
            }}
            error={fieldErrors.withholdingTaxRatePercent}
          />
          <NumberField
            id="settings-max-slots"
            label="Max Availability Slots / Day"
            min={1}
            max={24}
            value={settings.maxSlotsPerDay}
            onChange={updateNumberField('maxSlotsPerDay')}
            error={fieldErrors.maxSlotsPerDay}
          />
          <NumberField
            id="settings-pending-expiry"
            label="Pending Booking Hold Timeout (minutes)"
            min={5}
            max={10080}
            value={settings.pendingExpiryMinutes}
            onChange={updateNumberField('pendingExpiryMinutes')}
            error={fieldErrors.pendingExpiryMinutes}
          />
          <NumberField
            id="settings-geofence-radius"
            label="Arrival Geofence Radius (meters)"
            min={10}
            max={5000}
            value={settings.geofenceRadiusMeters}
            onChange={updateNumberField('geofenceRadiusMeters')}
            error={fieldErrors.geofenceRadiusMeters}
          />
          <NumberField
            id="settings-max-declines"
            label="Max Declines Before Cooldown"
            min={1}
            max={20}
            value={settings.maxDeclinesBeforeCooldown}
            onChange={updateNumberField('maxDeclinesBeforeCooldown')}
            error={fieldErrors.maxDeclinesBeforeCooldown}
          />
          <NumberField
            id="settings-decline-window"
            label="Decline Rolling Window (hours)"
            min={1}
            max={720}
            value={settings.declineWindowHours}
            onChange={updateNumberField('declineWindowHours')}
            error={fieldErrors.declineWindowHours}
          />
          <NumberField
            id="settings-decline-cooldown"
            label="Decline Cooldown Duration (hours)"
            min={1}
            max={720}
            value={settings.declineCooldownHours}
            onChange={updateNumberField('declineCooldownHours')}
            error={fieldErrors.declineCooldownHours}
          />
        </div>
      </SectionCard>
      <SectionCard title="Expertise Tiers">
        <p className="page-subtitle">
          Rates scale up for higher tiers, computed live from a worker&apos;s rating and completed-job count — not
          manually assigned.
        </p>
        <div className="detail-grid" style={{ marginTop: '0.75rem' }}>
          <NumberField
            id="settings-pro-min-rating"
            label="Pro: Min Rating"
            min={0}
            max={5}
            step={0.1}
            value={settings.tierProMinRating}
            onChange={updateNumberField('tierProMinRating')}
            error={fieldErrors.tierProMinRating}
          />
          <NumberField
            id="settings-pro-min-jobs"
            label="Pro: Min Completed Jobs"
            min={0}
            value={settings.tierProMinJobs}
            onChange={updateNumberField('tierProMinJobs')}
            error={fieldErrors.tierProMinJobs}
          />
          <NumberField
            id="settings-pro-multiplier"
            label="Pro: Rate Multiplier"
            min={1}
            max={5}
            step={0.05}
            value={settings.tierProMultiplier}
            onChange={updateNumberField('tierProMultiplier')}
            error={fieldErrors.tierProMultiplier}
          />
          <NumberField
            id="settings-expert-min-rating"
            label="Expert: Min Rating"
            min={0}
            max={5}
            step={0.1}
            value={settings.tierExpertMinRating}
            onChange={updateNumberField('tierExpertMinRating')}
            error={fieldErrors.tierExpertMinRating}
          />
          <NumberField
            id="settings-expert-min-jobs"
            label="Expert: Min Completed Jobs"
            min={0}
            value={settings.tierExpertMinJobs}
            onChange={updateNumberField('tierExpertMinJobs')}
            error={fieldErrors.tierExpertMinJobs}
          />
          <NumberField
            id="settings-expert-multiplier"
            label="Expert: Rate Multiplier"
            min={1}
            max={5}
            step={0.05}
            value={settings.tierExpertMultiplier}
            onChange={updateNumberField('tierExpertMultiplier')}
            error={fieldErrors.tierExpertMultiplier}
          />
        </div>
        {error && <div className="form-error" style={{ marginTop: '0.75rem' }}>{error}</div>}
        <button
          type="submit"
          className="btn btn-primary"
          style={{ marginTop: '1rem' }}
          disabled={saving}
        >
          {saving ? 'Saving...' : 'Save Changes'}
        </button>
        {saved && <p className="page-subtitle" style={{ marginTop: '0.75rem', color: 'var(--success)' }}>Settings saved.</p>}
      </SectionCard>
    </form>
  )
}
