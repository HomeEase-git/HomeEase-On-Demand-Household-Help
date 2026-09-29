// First, so errors anywhere below are reported.
import { Sentry } from './monitoring'
import React from 'react'
import ReactDOM from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import App from './App'
import { AuthProvider } from './context/AuthContext'
import { ToastProvider } from './context/ToastContext'
import '@fontsource/plus-jakarta-sans/400.css'
import '@fontsource/plus-jakarta-sans/400-italic.css'
import '@fontsource/plus-jakarta-sans/500.css'
import '@fontsource/plus-jakarta-sans/600.css'
import '@fontsource/plus-jakarta-sans/700.css'
import '@fortawesome/fontawesome-free/css/all.min.css'
import './styles/index.css'

// Shown instead of a blank page if a screen crashes; the error is reported.
function CrashScreen() {
  return (
    <div style={{ padding: '3rem', maxWidth: 520, margin: '0 auto', textAlign: 'center' }}>
      <h1 style={{ fontSize: '1.5rem' }}>Something went wrong on this page</h1>
      <p style={{ color: '#64748b' }}>It has been reported. Reload to try again.</p>
      <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>
        Reload
      </button>
    </div>
  )
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <Sentry.ErrorBoundary fallback={<CrashScreen />}>
      <HashRouter>
        <AuthProvider>
          <ToastProvider>
            <App />
          </ToastProvider>
        </AuthProvider>
      </HashRouter>
    </Sentry.ErrorBoundary>
  </React.StrictMode>,
)
