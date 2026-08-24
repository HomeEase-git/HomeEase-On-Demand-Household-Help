import { useState } from 'react'

/** Renders a monospace reference ID with a click-to-copy affordance. Shows
 * an em dash when there's nothing to show (e.g. no Xendit ID yet). */
export default function CopyableId({ value, title }) {
  const [copied, setCopied] = useState(false)

  if (!value) {
    return <span style={{ color: 'var(--text-muted)' }}>—</span>
  }

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard API unavailable (e.g. insecure context) — nothing to do.
    }
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      title={title || value}
      style={{
        fontFamily: 'monospace',
        fontSize: '0.8125rem',
        background: 'none',
        border: 'none',
        padding: 0,
        cursor: 'pointer',
        color: copied ? 'var(--success)' : 'var(--text)',
        textDecoration: copied ? 'none' : 'underline dotted',
      }}
    >
      {copied ? 'Copied!' : value}
    </button>
  )
}
