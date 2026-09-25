// Grey placeholder shapes in the layout that's about to load, instead of a
// spinner, so the page doesn't jump when data arrives. The message is kept
// for screen readers.
//
// variant:
//   table     - rows of a list/table (default; list pages)
//   detail    - header card + two columns of fields (detail pages)
//   dashboard - stat cards, a chart and two side-by-side cards
//   block     - a few lines, for a small section inside a page
function Bar({ width = '100%', height = 12 }) {
  return <span className="skeleton" style={{ width, height }} />
}

function TableSkeleton({ rows }) {
  return (
    <div className="skeleton-table">
      <div className="skeleton-table__row skeleton-table__row--head">
        <Bar width="18%" /><Bar width="22%" /><Bar width="14%" /><Bar width="12%" />
      </div>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="skeleton-table__row">
          <Bar width="22%" /><Bar width="28%" /><Bar width="12%" />
          <span className="skeleton skeleton--pill" />
        </div>
      ))}
    </div>
  )
}

function DetailSkeleton() {
  return (
    <div className="skeleton-detail">
      <div className="skeleton-card skeleton-detail__header">
        <span className="skeleton skeleton--avatar" />
        <div className="skeleton-stack">
          <Bar width="40%" height={18} />
          <Bar width="25%" />
        </div>
      </div>
      <div className="two-col">
        {[0, 1].map((col) => (
          <div key={col} className="skeleton-card skeleton-stack">
            <Bar width="35%" height={14} />
            {Array.from({ length: 5 }, (_, i) => (
              <Bar key={i} width={`${60 + ((i * 17) % 35)}%`} />
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

function DashboardSkeleton() {
  return (
    <div className="skeleton-dashboard">
      <div className="cards-row">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="skeleton-card skeleton-stat">
            <div className="skeleton-stack">
              <Bar width="60%" />
              <Bar width="40%" height={22} />
            </div>
            <span className="skeleton skeleton--icon" />
          </div>
        ))}
      </div>
      <div className="skeleton-card skeleton-stack">
        <Bar width="25%" height={14} />
        <span className="skeleton" style={{ width: '100%', height: 200 }} />
      </div>
      <div className="two-col">
        {[0, 1].map((col) => (
          <div key={col} className="skeleton-card skeleton-stack">
            <Bar width="35%" height={14} />
            {Array.from({ length: 4 }, (_, i) => <Bar key={i} width="85%" />)}
          </div>
        ))}
      </div>
    </div>
  )
}

function BlockSkeleton() {
  return (
    <div className="skeleton-stack skeleton-block">
      <Bar width="45%" height={14} />
      <Bar width="90%" />
      <Bar width="75%" />
    </div>
  )
}

export default function LoadingState({ message = 'Loading...', variant = 'table', rows = 6 }) {
  return (
    <div className="loading-skeleton" role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">{message}</span>
      <div aria-hidden="true">
        {variant === 'detail' && <DetailSkeleton />}
        {variant === 'dashboard' && <DashboardSkeleton />}
        {variant === 'block' && <BlockSkeleton />}
        {variant === 'table' && <TableSkeleton rows={rows} />}
      </div>
    </div>
  )
}
