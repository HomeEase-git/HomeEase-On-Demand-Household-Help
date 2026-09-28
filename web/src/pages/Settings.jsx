import { Link } from 'react-router-dom'
import {
  AdornedNumberField,
  SettingsFormPage,
  SettingsSection,
  useSettingsForm,
} from '../components/settings/SettingsForm'

// Price changes (same-day fee, distance fee, expertise tiers, no-show penalty,
// client-fault compensation) live on Price Adjustments, commission and worker
// debt on Payments → Commission & Debt, and withholding tax/ATC on Tax
// Settings — this page keeps site identity, admin account/alert settings, and
// booking-operation rules.
const NUMBER_FIELD_BOUNDS = {
  pendingExpiryMinutes: [5, 10080],
  geofenceRadiusMeters: [10, 5000],
  maxDeclinesBeforeCooldown: [1, 20],
  declineWindowHours: [1, 720],
  declineCooldownHours: [1, 720],
  noShowGraceMinutes: [15, 480],
  rushMinLeadHours: [0, 24],
  workerMinAge: [18, 100],
  workerMaxAge: [18, 100],
  disputeEscalationHours: [1, 720],
}

// These are OFF (null) unless the admin sets them, so an empty field is valid
// here (not "Required.", unlike every other numeric setting above).
const NULLABLE_NUMBER_FIELD_BOUNDS = {
  autoSuspendRatingThreshold: [0, 5],
  autoSuspendDisputeCountThreshold: [1, 1000],
  autoSuspendDisputeCountWindowDays: [1, 3650],
}

const FIELDS = [
  'siteName',
  'supportEmail',
  'notificationsEnabled',
  ...Object.keys(NUMBER_FIELD_BOUNDS),
  ...Object.keys(NULLABLE_NUMBER_FIELD_BOUNDS),
]

export default function Settings() {
  const form = useSettingsForm({
    fields: FIELDS,
    numberBounds: NUMBER_FIELD_BOUNDS,
    nullableBounds: NULLABLE_NUMBER_FIELD_BOUNDS,
  })
  const { current, fieldErrors, updateField, updateNumberField, updateNullableNumberField } = form

  return (
    <SettingsFormPage title="Settings" subtitle="General administration settings" form={form}>
      {current && (
        <>
          <SettingsSection icon="fa-building" title="General" description="Public-facing site identity.">
            <div className="detail-grid" style={{ marginBottom: 0 }}>
              <div className="detail-block">
                <label htmlFor="settings-site-name">Site Name</label>
                <input
                  id="settings-site-name"
                  value={current.siteName}
                  onChange={(e) => updateField('siteName')(e.target.value)}
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
                  onChange={(e) => updateField('supportEmail')(e.target.value)}
                  className="input"
                  required
                />
              </div>
            </div>
          </SettingsSection>

          <SettingsSection
            icon="fa-shield-halved"
            title="Security"
            description="Admins sign in with an authenticator app (required). Clients and workers can turn on email or text-message codes from the app."
          >
            <div className="toggle-row">
              <div>
                <div className="toggle-row__label">Two-Factor Authentication</div>
                <div className="toggle-row__hint">Set up or disable TOTP-based MFA for your own admin account.</div>
              </div>
              <Link to="/mfa-setup" className="btn btn-outline">
                Manage MFA
              </Link>
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
                  onChange={() => updateField('notificationsEnabled')(!current.notificationsEnabled)}
                />
                <span className="toggle__track">
                  <span className="toggle__thumb" />
                </span>
              </label>
            </div>
          </SettingsSection>

          <SettingsSection
            icon="fa-calendar-check"
            title="Booking Rules"
            description="Live rules enforced by the booking and worker-availability flows."
          >
            <p className="settings-group__label" style={{ marginTop: 0 }}>Booking &amp; Availability</p>
            <div className="detail-grid" style={{ marginBottom: 0 }}>
              <AdornedNumberField
                id="settings-rush-lead"
                label="Same-Day Minimum Notice"
                suffix="hrs"
                min={0}
                max={24}
                value={current.rushMinLeadHours}
                onChange={updateNumberField('rushMinLeadHours')}
                error={fieldErrors.rushMinLeadHours}
                hint="How far ahead a same-day booking must start. The same-day fee is in Price Adjustments."
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

            <div className="settings-group">
              <p className="settings-group__label">Worker Age</p>
              <div className="detail-grid" style={{ marginBottom: 0 }}>
                <AdornedNumberField
                  id="settings-worker-min-age"
                  label="Minimum Age"
                  suffix="yrs"
                  min={18}
                  max={100}
                  value={current.workerMinAge}
                  onChange={updateNumberField('workerMinAge')}
                  error={fieldErrors.workerMinAge}
                  hint="Checked at sign-up and again at KYC approval. Never below 18."
                />
                <AdornedNumberField
                  id="settings-worker-max-age"
                  label="Maximum Age"
                  suffix="yrs"
                  min={18}
                  max={100}
                  value={current.workerMaxAge}
                  onChange={updateNumberField('workerMaxAge')}
                  error={fieldErrors.workerMaxAge}
                />
              </div>
            </div>
          </SettingsSection>

          <SettingsSection
            icon="fa-shield-halved"
            title="Trust & Safety"
            description="No-show/dispute handling and automatic suspension. The auto-suspend thresholds are OFF (leave blank) until you set both a rating floor and a dispute-count/window — suspension is reversible, never a ban."
          >
            <p className="settings-group__label" style={{ marginTop: 0 }}>Booking &amp; Dispute Handling</p>
            <p className="toggle-row__hint" style={{ marginTop: 0 }}>
              The no-show penalty and client-fault compensation amounts are in{' '}
              <Link to="/price-adjustments">Price Adjustments</Link>.
            </p>
            <div className="detail-grid" style={{ marginBottom: 0 }}>
              <AdornedNumberField
                id="settings-no-show-grace"
                label="Worker No-Show Grace Period"
                suffix="min"
                min={15}
                max={480}
                value={current.noShowGraceMinutes}
                onChange={updateNumberField('noShowGraceMinutes')}
                error={fieldErrors.noShowGraceMinutes}
                hint="How long past the start time without a check-in before the job is cancelled as a no-show."
              />
              <AdornedNumberField
                id="settings-dispute-escalation"
                label="Dispute Escalation Threshold"
                suffix="hrs"
                min={1}
                max={720}
                value={current.disputeEscalationHours}
                onChange={updateNumberField('disputeEscalationHours')}
                error={fieldErrors.disputeEscalationHours}
                hint="How long a dispute can sit unresolved before admins are re-notified."
              />
            </div>

            <div className="settings-group">
              <p className="settings-group__label">Automatic Suspension (opt-in)</p>
              <div className="detail-grid" style={{ marginBottom: 0 }}>
                <AdornedNumberField
                  id="settings-auto-suspend-rating"
                  label="Rating Floor"
                  min={0}
                  max={5}
                  step={0.1}
                  value={current.autoSuspendRatingThreshold ?? ''}
                  onChange={updateNullableNumberField('autoSuspendRatingThreshold')}
                  error={fieldErrors.autoSuspendRatingThreshold}
                  hint="Leave blank to disable. A worker at or below this rating is auto-suspended."
                />
                <AdornedNumberField
                  id="settings-auto-suspend-dispute-count"
                  label="Dispute Count Threshold"
                  min={1}
                  max={1000}
                  value={current.autoSuspendDisputeCountThreshold ?? ''}
                  onChange={updateNullableNumberField('autoSuspendDisputeCountThreshold')}
                  error={fieldErrors.autoSuspendDisputeCountThreshold}
                  hint="Leave blank to disable."
                />
                <AdornedNumberField
                  id="settings-auto-suspend-dispute-window"
                  label="Dispute Count Window"
                  suffix="days"
                  min={1}
                  max={3650}
                  value={current.autoSuspendDisputeCountWindowDays ?? ''}
                  onChange={updateNullableNumberField('autoSuspendDisputeCountWindowDays')}
                  error={fieldErrors.autoSuspendDisputeCountWindowDays}
                  hint="Leave blank to disable."
                />
              </div>
            </div>
          </SettingsSection>

          <p className="toggle-row__hint" style={{ marginTop: '0.5rem' }}>
            Looking for job prices or fees? Job prices are on the <Link to="/price-list">Price List</Link>; the same-day
            fee, distance fee and expertise tiers are in <Link to="/price-adjustments">Price Adjustments</Link>; commission
            is in <Link to="/payments/commission">Payments → Commission &amp; Debt</Link>. Withholding tax and the BIR ATC code are in{' '}
            <Link to="/tax/settings">Tax Settings</Link>.
          </p>
        </>
      )}
    </SettingsFormPage>
  )
}
