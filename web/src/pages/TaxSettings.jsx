import {
  AdornedNumberField,
  SettingsFormPage,
  SettingsSection,
  toPercentDisplay,
  useSettingsForm,
} from '../components/settings/SettingsForm'

const PERCENT_FIELDS = ['withholdingTaxRate']
const FIELDS = [...PERCENT_FIELDS, 'atcCode']

export default function TaxSettings() {
  const form = useSettingsForm({ fields: FIELDS, percentFields: PERCENT_FIELDS })
  const { current, fieldErrors, updateField, updatePercentField } = form

  return (
    <SettingsFormPage
      title="Tax Settings"
      subtitle="Withholding tax configuration used by payments and BIR Form 2307 generation"
      form={form}
    >
      {current && (
        <SettingsSection
          icon="fa-file-invoice-dollar"
          title="Withholding Tax"
          description="Rate changes apply to new payments going forward; existing payments keep the rate they were charged at."
        >
          <div className="detail-grid" style={{ marginBottom: 0 }}>
            <AdornedNumberField
              id="settings-withholding-tax"
              label="Withholding Tax Rate"
              suffix="%"
              min={0}
              max={100}
              step={0.5}
              value={toPercentDisplay(current.withholdingTaxRate)}
              onChange={updatePercentField('withholdingTaxRate')}
              error={fieldErrors.withholdingTaxRate}
            />
            <div className="detail-block">
              <label htmlFor="settings-atc-code">BIR ATC Code</label>
              <input
                id="settings-atc-code"
                value={current.atcCode ?? ''}
                onChange={(e) => updateField('atcCode')(e.target.value)}
                className="input"
                placeholder="e.g. WI120"
              />
              <span className="toggle-row__hint">
                Printed on every generated Form 2307. Certificate generation refuses to run while this is blank.
              </span>
            </div>
          </div>
        </SettingsSection>
      )}
    </SettingsFormPage>
  )
}
