import {
  AdornedNumberField,
  SettingsFormPage,
  SettingsSection,
  toPercentDisplay,
  useSettingsForm,
} from '../components/settings/SettingsForm'

const NUMBER_FIELD_BOUNDS = {
  workerDebtHoldLimit: [0, 100000],
  freeDistanceKm: [0, 50],
  perKmFee: [0, 500],
  tierProMinRating: [0, 5],
  tierProMinJobs: [0, null],
  tierProMultiplier: [1, 5],
  tierExpertMinRating: [0, 5],
  tierExpertMinJobs: [0, null],
  tierExpertMultiplier: [1, 5],
}
const PERCENT_FIELDS = ['commissionRate']
const FIELDS = [...Object.keys(NUMBER_FIELD_BOUNDS), ...PERCENT_FIELDS]

export default function PricingRules() {
  const form = useSettingsForm({ fields: FIELDS, numberBounds: NUMBER_FIELD_BOUNDS, percentFields: PERCENT_FIELDS })
  const { current, fieldErrors, updateNumberField, updatePercentField } = form

  return (
    <SettingsFormPage
      title="Pricing Rules"
      subtitle="Platform-wide rules that shape every booking's price, alongside the per-city limits in Price Control"
      form={form}
    >
      {current && (
        <>
          <SettingsSection
            icon="fa-coins"
            title="Commission & Worker Debt"
            description="Commission rate changes apply to new payments going forward; existing payments keep the rate they were charged at."
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
            </div>
          </SettingsSection>

          <SettingsSection
            icon="fa-route"
            title="Distance Fee"
            description="Charged when a worker's driving distance to the client exceeds the free radius. Distance is Google's real driving-route distance when configured, falling back to straight-line distance otherwise — never traffic-adjusted."
          >
            <div className="detail-grid" style={{ marginBottom: 0 }}>
              <AdornedNumberField
                id="settings-free-distance-km"
                label="Free Distance Radius"
                suffix="km"
                min={0}
                max={50}
                step={0.5}
                value={current.freeDistanceKm}
                onChange={updateNumberField('freeDistanceKm')}
                error={fieldErrors.freeDistanceKm}
              />
              <AdornedNumberField
                id="settings-per-km-fee"
                label="Fee Per Extra Km"
                prefix="₱"
                min={0}
                max={500}
                step={1}
                value={current.perKmFee}
                onChange={updateNumberField('perKmFee')}
                error={fieldErrors.perKmFee}
              />
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
        </>
      )}
    </SettingsFormPage>
  )
}
