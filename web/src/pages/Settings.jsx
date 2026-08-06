import { useEffect, useState } from 'react'
import SectionCard from '../components/common/SectionCard'
import LoadingState from '../components/common/LoadingState'
import ErrorState from '../components/common/ErrorState'
import { fetchSettings, updateSettings } from '../services/settings'

export default function Settings() {
  const [settings, setSettings] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

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

  const handleSave = async () => {
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
    <>
      <h1 className="page-title">Settings</h1>
      <p className="page-subtitle">General administration settings</p>
      <SectionCard title="General">
        <div className="detail-grid">
          <div className="detail-block">
            <label>Site Name</label>
            <input
              value={settings.siteName}
              onChange={(e) => setSettings((prev) => ({ ...prev, siteName: e.target.value }))}
              className="input"
            />
          </div>
          <div className="detail-block">
            <label>Support Email</label>
            <input
              value={settings.supportEmail}
              onChange={(e) => setSettings((prev) => ({ ...prev, supportEmail: e.target.value }))}
              className="input"
            />
          </div>
        </div>
      </SectionCard>
      <SectionCard title="Notifications">
        <p className="page-subtitle">Configure email and in-app notifications.</p>
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginTop: '0.75rem' }}>
          <input
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
          <div className="detail-block">
            <label>Commission Rate (%)</label>
            <input
              type="number"
              min="0"
              max="100"
              step="0.5"
              value={Math.round(settings.commissionRate * 1000) / 10}
              onChange={(e) =>
                setSettings((prev) => ({ ...prev, commissionRate: Number(e.target.value) / 100 }))
              }
              className="input"
            />
          </div>
          <div className="detail-block">
            <label>Withholding Tax Rate (%)</label>
            <input
              type="number"
              min="0"
              max="100"
              step="0.5"
              value={Math.round(settings.withholdingTaxRate * 1000) / 10}
              onChange={(e) =>
                setSettings((prev) => ({ ...prev, withholdingTaxRate: Number(e.target.value) / 100 }))
              }
              className="input"
            />
          </div>
          <div className="detail-block">
            <label>Max Availability Slots / Day</label>
            <input
              type="number"
              min="1"
              max="24"
              value={settings.maxSlotsPerDay}
              onChange={(e) => setSettings((prev) => ({ ...prev, maxSlotsPerDay: Number(e.target.value) }))}
              className="input"
            />
          </div>
          <div className="detail-block">
            <label>Pending Booking Hold Timeout (minutes)</label>
            <input
              type="number"
              min="5"
              max="10080"
              value={settings.pendingExpiryMinutes}
              onChange={(e) => setSettings((prev) => ({ ...prev, pendingExpiryMinutes: Number(e.target.value) }))}
              className="input"
            />
          </div>
          <div className="detail-block">
            <label>Arrival Geofence Radius (meters)</label>
            <input
              type="number"
              min="10"
              max="5000"
              value={settings.geofenceRadiusMeters}
              onChange={(e) => setSettings((prev) => ({ ...prev, geofenceRadiusMeters: Number(e.target.value) }))}
              className="input"
            />
          </div>
        </div>
        {error && <div className="form-error" style={{ marginTop: '0.75rem' }}>{error}</div>}
        <button
          type="button"
          className="btn btn-primary"
          style={{ marginTop: '1rem' }}
          onClick={handleSave}
          disabled={saving}
        >
          {saving ? 'Saving...' : 'Save Changes'}
        </button>
        {saved && <p className="page-subtitle" style={{ marginTop: '0.75rem', color: 'var(--success)' }}>Settings saved.</p>}
      </SectionCard>
    </>
  )
}
