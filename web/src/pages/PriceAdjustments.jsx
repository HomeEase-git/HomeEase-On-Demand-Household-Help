import { Link } from 'react-router-dom'
import {
  AdornedNumberField,
  SettingsFormPage,
  SettingsSection,
  toPercentDisplay,
  useSettingsForm,
} from '../components/settings/SettingsForm'

// Everything that can move a booking's price away from its Price List price.
// Commission and worker debt aren't here on purpose: they come off the
// worker's side and never change what the client pays (Payments → Commission
// & Debt). Same-day minimum notice stays a booking rule in Settings.
const NUMBER_FIELD_BOUNDS = {
  freeDistanceKm: [0, 50],
  perKmFee: [0, 500],
  tierProMinRating: [0, 5],
  tierProMinJobs: [0, null],
  tierProMinYears: [0, 60],
  tierProMultiplier: [1, 5],
  tierExpertMinRating: [0, 5],
  tierExpertMinJobs: [0, null],
  tierExpertMinYears: [0, 60],
  tierExpertMultiplier: [1, 5],
  noShowPenaltyAmount: [0, 100000],
  clientFaultCompensationAmount: [0, 100000],
}
const PERCENT_FIELDS = ['rushFeeRate']
const FIELDS = [...Object.keys(NUMBER_FIELD_BOUNDS), ...PERCENT_FIELDS]

export default function PriceAdjustments() {
  const form = useSettingsForm({ fields: FIELDS, numberBounds: NUMBER_FIELD_BOUNDS, percentFields: PERCENT_FIELDS })
  const { current, fieldErrors, updateNumberField, updatePercentField } = form

  return (
    <SettingsFormPage
      title="Price Adjustments"
      subtitle="What can change a booking's price after the job price is set. Job prices themselves are on the Price List."
      form={form}
    >
      {current && (
        <>
          <SettingsSection
            icon="fa-bolt"
            title="Same-Day Fee"
            description={
              <>
                Added when a client books for today. How much notice a same-day booking needs is set in{' '}
                <Link to="/settings">Settings → Booking Rules</Link>.
              </>
            }
          >
            <div className="detail-grid" style={{ marginBottom: 0 }}>
              <AdornedNumberField
                id="settings-rush-fee-rate"
                label="Same-Day Fee"
                suffix="%"
                min={0}
                max={100}
                step={1}
                value={toPercentDisplay(current.rushFeeRate)}
                onChange={updatePercentField('rushFeeRate')}
                error={fieldErrors.rushFeeRate}
                hint="Percent of the job price only. Not add-ons, materials or distance."
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
            description="Rates scale up for higher tiers, computed live from a worker's rating, completed jobs and years of experience (declared at KYC, confirmed by the admin) — not manually assigned. A worker needs all three."
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
                id="settings-pro-min-years"
                label="Min Years of Experience"
                suffix="yrs"
                min={0}
                max={60}
                value={current.tierProMinYears}
                onChange={updateNumberField('tierProMinYears')}
                error={fieldErrors.tierProMinYears}
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
                  id="settings-expert-min-years"
                  label="Min Years of Experience"
                  suffix="yrs"
                  min={0}
                  max={60}
                  value={current.tierExpertMinYears}
                  onChange={updateNumberField('tierExpertMinYears')}
                  error={fieldErrors.tierExpertMinYears}
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

          <SettingsSection
            icon="fa-scale-balanced"
            title="Penalties & Compensation"
            description="Fixed amounts charged when a booking goes wrong on site. They aren't part of the job price and are only charged in these cases."
          >
            <div className="detail-grid" style={{ marginBottom: 0 }}>
              <AdornedNumberField
                id="settings-no-show-penalty"
                label="Worker No-Show Penalty"
                prefix="₱"
                min={0}
                max={100000}
                step={50}
                value={current.noShowPenaltyAmount}
                onChange={updateNumberField('noShowPenaltyAmount')}
                error={fieldErrors.noShowPenaltyAmount}
                hint="Added to the worker's dues for a no-show or a worker-fault cancellation on site."
              />
              <AdornedNumberField
                id="settings-client-fault-fee"
                label="Client-Fault Compensation"
                prefix="₱"
                min={0}
                max={100000}
                step={50}
                value={current.clientFaultCompensationAmount}
                onChange={updateNumberField('clientFaultCompensationAmount')}
                error={fieldErrors.clientFaultCompensationAmount}
                hint="Charged to the client and paid to the worker when an on-site cancellation is approved as the client's fault."
              />
            </div>
            <p className="toggle-row__hint" style={{ marginTop: '0.75rem', marginBottom: 0 }}>
              The no-show grace period and dispute handling are in <Link to="/settings">Settings → Trust &amp; Safety</Link>.
            </p>
          </SettingsSection>

          <p className="toggle-row__hint" style={{ marginTop: '0.5rem' }}>
            Looking for the commission rate or the worker debt limit? They don&apos;t change what clients pay, so they&apos;re in{' '}
            <Link to="/payments/commission">Payments → Commission &amp; Debt</Link>.
          </p>
        </>
      )}
    </SettingsFormPage>
  )
}
