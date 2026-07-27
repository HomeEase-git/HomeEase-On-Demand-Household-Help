import { useState } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import SectionCard from '../components/common/SectionCard'
import homeEaseLogo from '../components/Assets/HomeEase Logo.jpg'
import { useAuth } from '../context/AuthContext'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
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
    setIsSubmitting(true)

    try {
      await login(email.trim(), password)
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
        {/* {import.meta.env.DEV && (
          <p className="page-subtitle" style={{ textAlign: 'center', marginBottom: '1rem', color: '#64748b' }}>
            Dummy admin login: admin@homeeaseadmin.com / Admin1234
          </p>
        )} */}
        <form className="auth-form" onSubmit={handleSubmit}>
          <div className="form-field">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Enter Email "
              autoComplete="email"
              required
            />
          </div>
          <div className="form-field">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter password"
              autoComplete="current-password"
              required
            />
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
        {/* <p className="auth-hint">
          Use the seeded admin account after running the seed-admin script in backend/prisma/seeds.
        </p> */}
      </SectionCard>
    </div>
  )
}
