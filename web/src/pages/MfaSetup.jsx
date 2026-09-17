import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import PageHeader from '../components/common/PageHeader'
import SectionCard from '../components/common/SectionCard'
import LoadingState from '../components/common/LoadingState'
import ErrorState from '../components/common/ErrorState'
import { fetchCurrentUser } from '../services/auth'
import { startMfaSetup, confirmMfaSetup, disableMfa } from '../services/mfa'
import { useToast } from '../context/ToastContext'

// Reachable from Settings, and auto-shown right after login when the
// backend flags `mfaSetupRequired: true` (an admin who hasn't enrolled
// yet) — see Login.jsx's routeAfterLogin. Also doubles as the
// disable-MFA screen once enrollment is confirmed, since both need the
// same "what's my current MFA state" fetch on mount.
export default function MfaSetup() {
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [mfaEnabled, setMfaEnabled] = useState(false)

  // Setup flow state
  const [setupData, setSetupData] = useState(null) // { provisioningUri, qrCodeDataUrl, secret }
  const [confirmCode, setConfirmCode] = useState('')
  const [confirmError, setConfirmError] = useState('')
  const [isStarting, setIsStarting] = useState(false)
  const [isConfirming, setIsConfirming] = useState(false)
  const [backupCodes, setBackupCodes] = useState(null)

  // Disable flow state
  const [disablePassword, setDisablePassword] = useState('')
  const [disableCode, setDisableCode] = useState('')
  const [disableError, setDisableError] = useState('')
  const [isDisabling, setIsDisabling] = useState(false)

  const navigate = useNavigate()
  const { showSuccess, showError } = useToast()

  const loadStatus = async () => {
    setLoading(true)
    setLoadError('')
    try {
      const current = await fetchCurrentUser()
      setMfaEnabled(Boolean(current.mfaEnabled))
    } catch (err) {
      setLoadError(err.message || 'Failed to load MFA status')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadStatus()
  }, [])

  const handleStartSetup = async () => {
    setIsStarting(true)
    try {
      const data = await startMfaSetup()
      setSetupData(data)
    } catch (err) {
      showError(err.message || 'Failed to start MFA setup')
    } finally {
      setIsStarting(false)
    }
  }

  const handleConfirmSetup = async (e) => {
    e.preventDefault()
    setConfirmError('')
    const trimmed = confirmCode.trim()
    if (!/^\d{6}$/.test(trimmed)) {
      setConfirmError('Enter the 6-digit code from your authenticator app.')
      return
    }

    setIsConfirming(true)
    try {
      const result = await confirmMfaSetup(trimmed)
      setBackupCodes(result.backupCodes)
      setMfaEnabled(true)
      showSuccess('MFA enabled.')
    } catch (err) {
      setConfirmError(err.message || 'Invalid code')
    } finally {
      setIsConfirming(false)
    }
  }

  const handleDisable = async (e) => {
    e.preventDefault()
    setDisableError('')
    if (!disablePassword || !disableCode.trim()) {
      setDisableError('Password and MFA code are required.')
      return
    }

    setIsDisabling(true)
    try {
      await disableMfa(disablePassword, disableCode.trim())
      showSuccess('MFA disabled.')
      setMfaEnabled(false)
      setSetupData(null)
      setBackupCodes(null)
      setDisablePassword('')
      setDisableCode('')
    } catch (err) {
      setDisableError(err.message || 'Failed to disable MFA')
    } finally {
      setIsDisabling(false)
    }
  }

  if (loading) {
    return (
      <>
        <PageHeader title="Two-Factor Authentication" subtitle="Required for admin accounts" />
        <LoadingState message="Loading MFA status..." />
      </>
    )
  }

  if (loadError) {
    return (
      <>
        <PageHeader title="Two-Factor Authentication" subtitle="Required for admin accounts" />
        <ErrorState message={loadError} onRetry={loadStatus} />
      </>
    )
  }

  // Backup codes are shown exactly once, right after a successful
  // verify-setup — nothing lets you retrieve them again after leaving
  // this screen.
  if (backupCodes) {
    return (
      <>
        <PageHeader title="Two-Factor Authentication" subtitle="Save your backup codes" />
        <SectionCard>
          <div className="form-error" style={{ marginBottom: '1rem' }}>
            Save these backup codes now. Each one can be used once to sign in if you lose access to
            your authenticator app. They will not be shown again.
          </div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
              gap: '0.5rem',
              fontFamily: 'monospace',
              fontSize: '1rem',
              marginBottom: '1.5rem',
            }}
          >
            {backupCodes.map((code) => (
              <div key={code} className="input" style={{ textAlign: 'center' }}>
                {code}
              </div>
            ))}
          </div>
          <button type="button" className="btn btn-primary" onClick={() => navigate('/dashboard')}>
            I&rsquo;ve saved these codes — continue
          </button>
        </SectionCard>
      </>
    )
  }

  if (!mfaEnabled) {
    return (
      <>
        <PageHeader
          title="Two-Factor Authentication"
          subtitle="Admin accounts are required to enable MFA to close a security-audit gap."
        />
        <SectionCard>
          {!setupData ? (
            <>
              <p className="page-subtitle" style={{ marginTop: 0 }}>
                Set up an authenticator app (Google Authenticator, Authy, 1Password, etc.) to protect
                this admin account.
              </p>
              <button type="button" className="btn btn-primary" onClick={handleStartSetup} disabled={isStarting}>
                {isStarting ? 'Starting...' : 'Start setup'}
              </button>
            </>
          ) : (
            <>
              <p className="page-subtitle" style={{ marginTop: 0 }}>
                Scan this QR code with your authenticator app, then enter the 6-digit code it shows.
              </p>
              <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '1rem' }}>
                <img src={setupData.qrCodeDataUrl} alt="MFA QR code" width={200} height={200} />
              </div>
              <div className="detail-block" style={{ marginBottom: '1rem' }}>
                <label>Can&rsquo;t scan? Enter this key manually</label>
                <input className="input" value={setupData.secret} readOnly onFocus={(e) => e.target.select()} />
              </div>
              <form onSubmit={handleConfirmSetup} noValidate>
                <div className="form-field">
                  <label htmlFor="mfa-confirm-code">6-digit code</label>
                  <input
                    id="mfa-confirm-code"
                    type="text"
                    inputMode="numeric"
                    value={confirmCode}
                    onChange={(e) => {
                      setConfirmCode(e.target.value)
                      if (confirmError) setConfirmError('')
                    }}
                    placeholder="123456"
                    aria-invalid={!!confirmError}
                  />
                  {confirmError && <span className="field-error">{confirmError}</span>}
                </div>
                <button type="submit" className="btn btn-primary" disabled={isConfirming}>
                  {isConfirming ? 'Confirming...' : 'Confirm and enable MFA'}
                </button>
              </form>
            </>
          )}
        </SectionCard>
      </>
    )
  }

  return (
    <>
      <PageHeader title="Two-Factor Authentication" subtitle="Enabled on this account" />
      <SectionCard title="Disable MFA">
        <p className="page-subtitle" style={{ marginTop: 0 }}>
          Requires your current password and a valid authenticator/backup code.
        </p>
        <form onSubmit={handleDisable} noValidate>
          <div className="form-field">
            <label htmlFor="disable-password">Current password</label>
            <input
              id="disable-password"
              type="password"
              value={disablePassword}
              onChange={(e) => setDisablePassword(e.target.value)}
              autoComplete="current-password"
            />
          </div>
          <div className="form-field">
            <label htmlFor="disable-code">Authentication code</label>
            <input
              id="disable-code"
              type="text"
              value={disableCode}
              onChange={(e) => setDisableCode(e.target.value)}
              placeholder="123456 or XXXX-XXXX"
            />
          </div>
          {disableError && <div className="form-error">{disableError}</div>}
          <button type="submit" className="btn btn-outline" disabled={isDisabling}>
            {isDisabling ? 'Disabling...' : 'Disable MFA'}
          </button>
        </form>
      </SectionCard>
    </>
  )
}
