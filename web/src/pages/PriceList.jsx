import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import PageHeader from '../components/common/PageHeader'
import SectionCard from '../components/common/SectionCard'
import LoadingState from '../components/common/LoadingState'
import ErrorState from '../components/common/ErrorState'
import SearchBar from '../components/common/SearchBar'
import Badge from '../components/common/Badge'
import { useDetailQuery } from '../hooks/useListQuery'
import { fetchPriceList, savePriceList } from '../services/priceList'
import { formatPeso } from '../components/serviceCatalog/catalogModel'
import { useToast } from '../context/ToastContext'

const ROUNDING = [1, 5, 10, 50]

// Edits are kept as strings (exactly what the admin typed) and only become
// numbers when checked or saved.
const parsePrice = (raw) => (raw === '' || raw == null ? NaN : Number(raw))

function chargedAs(task) {
  if (task.pricingModel === 'CUSTOM_QUOTE') return 'Custom quote'
  if (task.pricingModel === 'PER_UNIT') return `Per ${task.unitLabel || 'unit'}`
  return task.unitLabel ? `Flat, per ${task.unitLabel}` : 'Flat'
}

function percentChange(from, to) {
  if (!from) return null
  const pct = ((to - from) / from) * 100
  return `${pct > 0 ? '+' : ''}${Math.round(pct * 10) / 10}%`
}

/**
 * Every job's price on one screen. Edit in place or apply a bulk change to
 * the rows shown, review, then save everything at once. Only prices change
 * here; a job's name, pricing model and questions stay in the Service Catalog.
 */
export default function PriceList() {
  const { showError, showSuccess } = useToast()
  const { data, loading, error, reload } = useDetailQuery(fetchPriceList, 'all')
  const [taskDraft, setTaskDraft] = useState({})
  const [categoryDraft, setCategoryDraft] = useState({})
  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('ALL')
  const [showHidden, setShowHidden] = useState(false)
  const [bulkMode, setBulkMode] = useState('percent')
  const [bulkValue, setBulkValue] = useState('')
  const [bulkRounding, setBulkRounding] = useState(5)
  const [bulkIncludeStarting, setBulkIncludeStarting] = useState(true)
  const [reviewing, setReviewing] = useState(false)
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)

  const categories = data?.categories ?? []
  const floor = data?.doleFloor

  // Rows the filters leave on screen; the bulk change applies to exactly these.
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    return categories
      .filter((c) => categoryFilter === 'ALL' || c.id === categoryFilter)
      .filter((c) => showHidden || c.isActive)
      .map((c) => {
        const categoryMatches = !q || c.name.toLowerCase().includes(q)
        const tasks = c.tasks
          .filter((t) => showHidden || t.isActive)
          .filter((t) => categoryMatches || t.name.toLowerCase().includes(q))
        return { ...c, tasks, categoryMatches }
      })
      .filter((c) => c.tasks.length > 0 || c.categoryMatches)
  }, [categories, search, categoryFilter, showHidden])

  const shownValue = (id, saved, drafts) => (id in drafts ? drafts[id] : String(saved))

  // Everything that differs from what's saved, for the save bar and review.
  const changes = useMemo(() => {
    const tasks = []
    const cats = []
    for (const c of categories) {
      if (c.id in categoryDraft) {
        const to = parsePrice(categoryDraft[c.id])
        if (to !== c.basePrice) cats.push({ id: c.id, name: c.name, from: c.basePrice, to })
      }
      for (const t of c.tasks) {
        if (t.id in taskDraft) {
          const to = parsePrice(taskDraft[t.id])
          if (to !== t.basePrice) tasks.push({ id: t.id, name: t.name, category: c.name, from: t.basePrice, to })
        }
      }
    }
    return { tasks, categories: cats }
  }, [categories, taskDraft, categoryDraft])

  const changeCount = changes.tasks.length + changes.categories.length
  const invalid = [...changes.tasks.filter((c) => !(c.to > 0)), ...changes.categories.filter((c) => !(c.to >= 0))]
  const belowFloor = floor ? changes.tasks.filter((c) => c.to > 0 && c.to < floor.hourlyWage) : []

  const bulkNumber = Number(bulkValue)
  const bulkReady = bulkValue !== '' && Number.isFinite(bulkNumber) && bulkNumber !== 0
  const bulkTargetCount = visible.reduce(
    (n, c) => n + c.tasks.filter((t) => t.pricingModel !== 'CUSTOM_QUOTE').length,
    0
  )

  const applyBulk = () => {
    if (!bulkReady) return
    const adjust = (raw) => {
      const price = parsePrice(raw)
      if (!Number.isFinite(price)) return raw
      const next = bulkMode === 'percent' ? price * (1 + bulkNumber / 100) : price + bulkNumber
      const rounded = Math.round(next / bulkRounding) * bulkRounding
      return String(Math.max(rounded, 0))
    }
    const nextTasks = { ...taskDraft }
    const nextCats = { ...categoryDraft }
    for (const c of visible) {
      for (const t of c.tasks) {
        if (t.pricingModel === 'CUSTOM_QUOTE') continue
        nextTasks[t.id] = adjust(shownValue(t.id, t.basePrice, taskDraft))
      }
      if (bulkIncludeStarting) nextCats[c.id] = adjust(shownValue(c.id, c.basePrice, categoryDraft))
    }
    setTaskDraft(nextTasks)
    setCategoryDraft(nextCats)
    setBulkValue('')
    showSuccess(`Changed ${bulkTargetCount} job price${bulkTargetCount === 1 ? '' : 's'}. Review and save when ready.`)
  }

  const discard = () => {
    setTaskDraft({})
    setCategoryDraft({})
    setReason('')
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      await savePriceList({
        tasks: changes.tasks.map((c) => ({ id: c.id, basePrice: c.to })),
        categories: changes.categories.map((c) => ({ id: c.id, basePrice: c.to })),
        overrideReason: reason.trim() || undefined,
      })
      await reload()
      discard()
      setReviewing(false)
      showSuccess(`Saved ${changeCount} price change${changeCount === 1 ? '' : 's'}.`)
    } catch (err) {
      showError(err.message || 'Failed to save prices')
    } finally {
      setSaving(false)
    }
  }

  if (loading && !data) {
    return (
      <>
        <PageHeader title="Price List" />
        <LoadingState variant="block" message="Loading prices..." />
      </>
    )
  }
  if (error && !data) {
    return (
      <>
        <PageHeader title="Price List" />
        <ErrorState message={error} onRetry={reload} />
      </>
    )
  }

  return (
    <>
      <PageHeader
        title="Price List"
        subtitle="What every job costs before adjustments. The same-day fee, distance fee and expertise tiers are added at booking time (see Price Adjustments)."
      />

      <div className="toolbar">
        <SearchBar placeholder="Search jobs or categories..." value={search} onChange={setSearch} />
        <select
          className="field-plain"
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          aria-label="Filter by category"
        >
          <option value="ALL">All categories</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <label className="pl-check">
          <input type="checkbox" checked={showHidden} onChange={(e) => setShowHidden(e.target.checked)} />
          Show hidden jobs
        </label>
      </div>

      <SectionCard title="Bulk change" className="pl-bulk-card">
        <div className="pl-bulk">
          <div className="pl-bulk__field">
            <label htmlFor="pl-bulk-mode">Change by</label>
            <select id="pl-bulk-mode" className="field-plain" value={bulkMode} onChange={(e) => setBulkMode(e.target.value)}>
              <option value="percent">Percent</option>
              <option value="amount">Peso amount</option>
            </select>
          </div>
          <div className="pl-bulk__field">
            <label htmlFor="pl-bulk-value">{bulkMode === 'percent' ? 'Percent (use − to lower)' : 'Amount in ₱ (use − to lower)'}</label>
            <input
              id="pl-bulk-value"
              type="number"
              className="field-plain"
              placeholder={bulkMode === 'percent' ? 'e.g. 10' : 'e.g. 50'}
              value={bulkValue}
              onChange={(e) => setBulkValue(e.target.value)}
            />
          </div>
          <div className="pl-bulk__field">
            <label htmlFor="pl-bulk-rounding">Round to nearest</label>
            <select
              id="pl-bulk-rounding"
              className="field-plain"
              value={bulkRounding}
              onChange={(e) => setBulkRounding(Number(e.target.value))}
            >
              {ROUNDING.map((r) => (
                <option key={r} value={r}>
                  ₱{r}
                </option>
              ))}
            </select>
          </div>
          <label className="pl-check pl-bulk__check">
            <input
              type="checkbox"
              checked={bulkIncludeStarting}
              onChange={(e) => setBulkIncludeStarting(e.target.checked)}
            />
            Also change category starting prices
          </label>
          <button type="button" className="btn btn-outline" disabled={!bulkReady || bulkTargetCount === 0} onClick={applyBulk}>
            Apply to {bulkTargetCount} job{bulkTargetCount === 1 ? '' : 's'} shown
          </button>
        </div>
        <p className="pl-note">
          Applies to the jobs the filters above are showing, not custom-quote jobs. Nothing is saved until you review and save.
        </p>
      </SectionCard>

      <SectionCard title="Prices">
        <div className="table-wrap">
          <table className="table pl-table">
            <thead>
              <tr>
                <th>Job</th>
                <th>Charged as</th>
                <th className="pl-num">Price</th>
                <th>Change</th>
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 && (
                <tr>
                  <td colSpan={4} className="table-empty">
                    No jobs match these filters.
                  </td>
                </tr>
              )}
              {visible.map((c) => {
                const catValue = shownValue(c.id, c.basePrice, categoryDraft)
                const catNum = parsePrice(catValue)
                const catChanged = catValue !== String(c.basePrice)
                return [
                  <tr key={c.id} className="pl-category">
                    <td>
                      <Link to={`/service-catalog/${c.id}`} className="pl-category__name">
                        {c.name}
                      </Link>
                      {!c.isActive && <Badge variant="suspended">Hidden</Badge>}
                    </td>
                    <td className="pl-muted">Starting price shown to clients</td>
                    <td className="pl-num">
                      <PriceInput
                        id={`pl-cat-${c.id}`}
                        label={`${c.name} starting price`}
                        value={catValue}
                        changed={catChanged}
                        invalid={catChanged && !(catNum >= 0)}
                        onChange={(v) => setCategoryDraft((d) => ({ ...d, [c.id]: v }))}
                      />
                    </td>
                    <td>{catChanged && <ChangeNote from={c.basePrice} to={catNum} />}</td>
                  </tr>,
                  ...c.tasks.map((t) => {
                    if (t.pricingModel === 'CUSTOM_QUOTE') {
                      return (
                        <tr key={t.id}>
                          <td className="pl-job">
                            {t.name}
                            {!t.isActive && <Badge variant="suspended">Hidden</Badge>}
                          </td>
                          <td>{chargedAs(t)}</td>
                          <td className="pl-num pl-muted">Worker quotes on site</td>
                          <td />
                        </tr>
                      )
                    }
                    const value = shownValue(t.id, t.basePrice, taskDraft)
                    const num = parsePrice(value)
                    const changed = value !== String(t.basePrice)
                    const isBelowFloor = floor && num > 0 && num < floor.hourlyWage
                    return (
                      <tr key={t.id}>
                        <td className="pl-job">
                          {t.name}
                          {!t.isActive && <Badge variant="suspended">Hidden</Badge>}
                        </td>
                        <td>{chargedAs(t)}</td>
                        <td className="pl-num">
                          <PriceInput
                            id={`pl-task-${t.id}`}
                            label={`${t.name} price`}
                            value={value}
                            changed={changed}
                            invalid={changed && !(num > 0)}
                            onChange={(v) => setTaskDraft((d) => ({ ...d, [t.id]: v }))}
                          />
                        </td>
                        <td>
                          {changed && <ChangeNote from={t.basePrice} to={num} />}
                          {changed && !(num > 0) && <div className="pl-warn">Must be above ₱0</div>}
                          {isBelowFloor && (
                            <div className="pl-warn">Below the DOLE hourly floor ({formatPeso(floor.hourlyWage)})</div>
                          )}
                        </td>
                      </tr>
                    )
                  }),
                ]
              })}
            </tbody>
          </table>
        </div>
      </SectionCard>

      <div className="settings-savebar">
        <div className={`settings-savebar__status ${changeCount ? '' : 'settings-savebar__status--clean'}`}>
          <span className="settings-savebar__dot" />
          {changeCount ? `${changeCount} unsaved price change${changeCount === 1 ? '' : 's'}` : 'All prices saved'}
        </div>
        <div className="settings-savebar__actions">
          {changeCount > 0 && (
            <button type="button" className="btn btn-outline" onClick={discard} disabled={saving}>
              Discard
            </button>
          )}
          <button
            type="button"
            className="btn btn-primary"
            disabled={!changeCount || invalid.length > 0}
            onClick={() => setReviewing(true)}
          >
            Review &amp; Save
          </button>
        </div>
      </div>

      {reviewing && (
        <div className="modal-backdrop" onClick={() => !saving && setReviewing(false)} role="presentation">
          <div
            className="modal modal--landscape"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="pl-review-title"
          >
            <h2 className="modal-title" id="pl-review-title">
              Save {changeCount} price change{changeCount === 1 ? '' : 's'}
            </h2>
            <p className="modal-body">
              New bookings use the new prices right away. Bookings already made keep the price they were booked at.
            </p>
            <div className="table-wrap pl-review">
              <table className="table">
                <thead>
                  <tr>
                    <th>Item</th>
                    <th className="pl-num">Was</th>
                    <th className="pl-num">Now</th>
                    <th className="pl-num">Change</th>
                  </tr>
                </thead>
                <tbody>
                  {changes.categories.map((c) => (
                    <tr key={c.id}>
                      <td>
                        {c.name} <span className="pl-muted">· starting price</span>
                      </td>
                      <td className="pl-num">{formatPeso(c.from)}</td>
                      <td className="pl-num">{formatPeso(c.to)}</td>
                      <td className="pl-num">{percentChange(c.from, c.to) ?? '—'}</td>
                    </tr>
                  ))}
                  {changes.tasks.map((c) => (
                    <tr key={c.id}>
                      <td>
                        {c.name} <span className="pl-muted">· {c.category}</span>
                      </td>
                      <td className="pl-num">{formatPeso(c.from)}</td>
                      <td className="pl-num">{formatPeso(c.to)}</td>
                      <td className="pl-num">{percentChange(c.from, c.to) ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="form-field">
              <label htmlFor="pl-reason">
                {belowFloor.length
                  ? `Reason (required: ${belowFloor.length} job${belowFloor.length === 1 ? '' : 's'} below the DOLE ${floor.label} hourly floor of ${formatPeso(floor.hourlyWage)})`
                  : 'Note for the audit log (optional)'}
              </label>
              <textarea
                id="pl-reason"
                rows={2}
                className="field-full field-plain field-textarea pl-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder={belowFloor.length ? 'Why these prices are intentionally low' : 'e.g. 2026 market-rate update'}
              />
            </div>
            <div className="modal-actions">
              <button type="button" className="btn btn-outline" onClick={() => setReviewing(false)} disabled={saving}>
                Back to editing
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={saving || (belowFloor.length > 0 && !reason.trim())}
                onClick={handleSave}
              >
                {saving ? 'Saving...' : 'Save prices'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

function PriceInput({ id, label, value, changed, invalid, onChange }) {
  return (
    <div className={`pl-price ${changed ? 'pl-price--changed' : ''} ${invalid ? 'pl-price--invalid' : ''}`}>
      <span aria-hidden="true">₱</span>
      <input
        id={id}
        type="number"
        min="0"
        step="1"
        value={value}
        aria-label={label}
        aria-invalid={invalid || undefined}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  )
}

function ChangeNote({ from, to }) {
  if (!Number.isFinite(to)) return null
  const pct = percentChange(from, to)
  return (
    <span className="pl-change">
      was {formatPeso(from)}
      {pct && <strong className={to > from ? 'pl-up' : 'pl-down'}> {pct}</strong>}
    </span>
  )
}
