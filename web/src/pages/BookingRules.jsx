import SubNav from '../components/common/SubNav'
import { BOOKINGS_SUB_NAV } from '../constants/bookingsSubNav'
import {
  AdornedNumberField,
  SettingsFormPage,
  SettingsSection,
  useSettingsForm,
} from '../components/settings/SettingsForm'

// Live rules enforced by the booking and worker-availability flows. The
// same-day notice sits with the same-day fee (Price Adjustments), worker age
// with Trust & Safety (Settings).
const NUMBER_FIELD_BOUNDS = {
  pendingExpiryMinutes: [5, 10080],
  geofenceRadiusMeters: [0, 5000],
  maxDeclinesBeforeCooldown: [1, 20],
  declineWindowHours: [1, 720],
  declineCooldownHours: [1, 720],
}
const FIELDS = Object.keys(NUMBER_FIELD_BOUNDS)

export default function BookingRules() {
  const form = useSettingsForm({ fields: FIELDS, numberBounds: NUMBER_FIELD_BOUNDS })
  const { current, fieldErrors, updateNumberField } = form

  return (
    <SettingsFormPage
      title="Bookings"
      subtitle="Booking rules"
      form={form}
      nav={<SubNav items={BOOKINGS_SUB_NAV} />}
    >
      {current && (
        <>
          <SettingsSection
            icon="fa-calendar-check"
            title="Booking & Availability"
            description="Live rules enforced by the booking and worker-availability flows."
          >
            <div className="detail-grid" style={{ marginBottom: 0 }}>
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
                hint="0 turns the distance check off: workers can check in from anywhere."
                suffix="m"
                min={0}
                max={5000}
                value={current.geofenceRadiusMeters}
                onChange={updateNumberField('geofenceRadiusMeters')}
                error={fieldErrors.geofenceRadiusMeters}
              />
            </div>
          </SettingsSection>

          <SettingsSection
            icon="fa-user-clock"
            title="Worker Decline Policy"
            description="A worker who declines too many bookings is excluded from auto-match for a cooldown."
          >
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
          </SettingsSection>
        </>
      )}
    </SettingsFormPage>
  )
}
