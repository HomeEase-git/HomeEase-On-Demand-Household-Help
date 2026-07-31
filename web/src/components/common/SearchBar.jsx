import { useEffect, useRef, useState } from 'react'

export default function SearchBar({ placeholder = 'Search...', value, onChange, debounceMs = 350 }) {
  const [draft, setDraft] = useState(value ?? '')
  const skipNextSync = useRef(false)

  useEffect(() => {
    if (skipNextSync.current) {
      skipNextSync.current = false
      return
    }
    setDraft(value ?? '')
  }, [value])

  useEffect(() => {
    if (draft === (value ?? '')) return
    const timer = setTimeout(() => {
      skipNextSync.current = true
      onChange?.(draft)
    }, debounceMs)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, debounceMs])

  return (
    <div className="search-wrap">
      <i className="fas fa-search" />
      <input
        type="text"
        placeholder={placeholder}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
      />
    </div>
  )
}
