import { useState } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import SectionCard from '../components/common/SectionCard'
import homeEaseLogo from '../components/Assets/home-ease-logo.png'
import { useAuth } from '../context/AuthContext'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [fieldErrors, setFieldErrors] = useState({})
  const [isSubmitting, setIsSubmitting] = useState(false)
  const navigate = useNavigate()
  const location = useLocation()
  const { login, isAuthenticated, isAdmin, isLoading } = useAuth()

  const from = location.state?.from || '/dashboard'

  if (!isLoading && isAuthenticated && isAdmin) {
    return <Navigate to={from} replace />
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')

    const nextFieldErrors = {}
    const trimmedEmail = email.trim()
    if (!trimmedEmail) nextFieldErrors.email = 'Email is required.'
    else if (!EMAIL_PATTERN.test(trimmedEmail)) nextFieldErrors.email = 'Enter a valid email address.'
    if (!password) nextFieldErrors.password = 'Password is required.'
    setFieldErrors(nextFieldErrors)
    if (Object.keys(nextFieldErrors).length > 0) return

    setIsSubmitting(true)
    try {
      await login(trimmedEmail, password)
      navigate(from, { replace: true })
    } catch (err) {
      setError(err.message || 'Login failed')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="auth-page">
      <SectionCard className="auth-card">
        <div className="auth-logo-wrap">
          <img src={homeEaseLogo} alt="HomeEase Logo" className="auth-logo" />
        </div>
        <h1 className="page-title" style={{ textAlign: 'center', marginBottom: '0.375rem' }}>
          Welcome back
        </h1>
        <p className="page-subtitle" style={{ textAlign: 'center', marginBottom: '1.75rem' }}>
          Sign in to your HomeEase admin account
        </p>
        <form className="auth-form" onSubmit={handleSubmit} noValidate>
          <div className="form-field">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value)
                if (fieldErrors.email) setFieldErrors((prev) => ({ ...prev, email: undefined }))
              }}
              placeholder="Enter Email "
              autoComplete="email"
              aria-invalid={!!fieldErrors.email}
              aria-describedby={fieldErrors.email ? 'email-error' : undefined}
            />
            {fieldErrors.email && <span id="email-error" className="field-error">{fieldErrors.email}</span>}
          </div>
          <div className="form-field">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value)
                if (fieldErrors.password) setFieldErrors((prev) => ({ ...prev, password: undefined }))
              }}
              placeholder="Enter password"
              autoComplete="current-password"
              aria-invalid={!!fieldErrors.password}
              aria-describedby={fieldErrors.password ? 'password-error' : undefined}
            />
            {fieldErrors.password && <span id="password-error" className="field-error">{fieldErrors.password}</span>}
          </div>
          {error && <div className="form-error">{error}</div>}
          <button
            type="submit"
            className="btn btn-primary"
            style={{ width: '100%', marginTop: '0.5rem' }}
            disabled={isSubmitting}
          >
            {isSubmitting ? 'Signing in...' : 'Login'}
          </button>
        </form>
      </SectionCard>
    </div>
  )
}
