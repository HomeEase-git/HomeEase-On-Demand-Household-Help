import SubNav from '../components/common/SubNav'
import { PAYMENTS_SUB_NAV } from '../constants/paymentsNav'
import {
  AdornedNumberField,
  SettingsFormPage,
  SettingsSection,
  toPercentDisplay,
  useSettingsForm,
} from '../components/settings/SettingsForm'

// The platform's side of each payment. Neither setting changes what a client
// pays, which is why they live under Payments rather than Price Adjustments.
const NUMBER_FIELD_BOUNDS = {
  workerDebtHoldLimit: [0, 100000],
}
const PERCENT_FIELDS = ['commissionRate']
const FIELDS = [...Object.keys(NUMBER_FIELD_BOUNDS), ...PERCENT_FIELDS]

export default function CommissionSettings() {
  const form = useSettingsForm({ fields: FIELDS, numberBounds: NUMBER_FIELD_BOUNDS, percentFields: PERCENT_FIELDS })
  const { current, fieldErrors, updateNumberField, updatePercentField } = form

  return (
    <SettingsFormPage
      title="Payment Management"
      subtitle="Commission & worker debt"
      form={form}
      nav={<SubNav items={PAYMENTS_SUB_NAV} />}
    >
      {current && (
        <>
          <SettingsSection
            icon="fa-percent"
            title="Commission"
            description="HomeEase's share of each completed job, taken from the worker's earnings. Changes apply to new payments; past payments keep the rate they were charged at."
          >
            <div className="detail-grid" style={{ marginBottom: 0 }}>
              <AdornedNumberField
                id="settings-commission-rate"
                label="Commission Rate"
                suffix="%"
                min={0}
                max={100}
                step={0.5}
                value={toPercentDisplay(current.commissionRate)}
                onChange={updatePercentField('commissionRate')}
                error={fieldErrors.commissionRate}
              />
            </div>
          </SettingsSection>

          <SettingsSection
            icon="fa-hand-holding-dollar"
            title="Worker Debt"
            description="Cash jobs leave the worker owing HomeEase its commission. That debt is taken out of their next GCash/Maya payouts."
          >
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
                hint="When a worker's unpaid dues reach this amount, their account goes on hold (no new jobs) until an admin releases it. ₱0 turns the hold off."
              />
            </div>
          </SettingsSection>
        </>
      )}
    </SettingsFormPage>
  )
}
