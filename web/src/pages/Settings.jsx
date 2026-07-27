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
    </>
  )
}
