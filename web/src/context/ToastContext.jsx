import { createContext, useCallback, useContext, useRef, useState } from 'react'
import ToastViewport from '../components/common/Toast'

const ToastContext = createContext(null)
const DEFAULT_DURATION = 3500

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])
  const nextId = useRef(0)

  const dismissToast = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const showToast = useCallback(
    (message, type = 'info', duration = DEFAULT_DURATION) => {
      const id = nextId.current++
      setToasts((prev) => [...prev, { id, message, type }])
      if (duration > 0) {
        window.setTimeout(() => dismissToast(id), duration)
      }
      return id
    },
    [dismissToast]
  )

  const value = {
    showToast,
    showSuccess: (message, duration) => showToast(message, 'success', duration),
    showError: (message, duration) => showToast(message, 'error', duration),
    dismissToast,
  }

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastViewport toasts={toasts} onDismiss={dismissToast} />
    </ToastContext.Provider>
  )
}

export function useToast() {
  const context = useContext(ToastContext)
  if (!context) {
    throw new Error('useToast must be used within ToastProvider')
  }
  return context
}