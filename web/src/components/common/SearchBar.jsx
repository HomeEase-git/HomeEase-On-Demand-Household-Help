export default function SearchBar({ placeholder = 'Search...', value, onChange }) {
  return (
    <div className="search-wrap">
      <i className="fas fa-search" />
      <input
        type="text"
        placeholder={placeholder}
        value={value ?? ''}
        onChange={(e) => onChange?.(e.target.value)}
      />
    </div>
  )
}
