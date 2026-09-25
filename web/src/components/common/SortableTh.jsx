// A table header you can click to sort the list by that column (on the
// server, so the order covers every page). Pair with useListQuery's setSort.
export default function SortableTh({ label, sortKey, params, onSort, firstDir = 'asc' }) {
  const active = params.sortBy === sortKey
  const dir = active ? params.sortDir : null
  return (
    <th aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button type="button" className={`th-sort ${active ? 'is-active' : ''}`} onClick={() => onSort(sortKey, firstDir)}>
        {label}
        <i className={`fas ${active ? (dir === 'asc' ? 'fa-arrow-up' : 'fa-arrow-down') : 'fa-sort'}`} aria-hidden="true" />
      </button>
    </th>
  )
}
