import { lazy, Suspense } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import MainLayout from './components/layout/MainLayout'
import ProtectedRoute from './components/auth/ProtectedRoute'
import LoadingState from './components/common/LoadingState'
import Login from './pages/Login'

// Every other page is lazy-loaded so the initial bundle only ships what's
// needed to reach the login/dashboard shell — a page's code downloads the
// first time it's actually navigated to, not all 24 of them upfront.
const Dashboard = lazy(() => import('./pages/Dashboard'))
const Analytics = lazy(() => import('./pages/Analytics'))
const Users = lazy(() => import('./pages/Users'))
const ClientDetail = lazy(() => import('./pages/ClientDetail'))
const WorkerDetail = lazy(() => import('./pages/WorkerDetail'))
const Workers = lazy(() => import('./pages/Workers'))
const Verification = lazy(() => import('./pages/Verification'))
const VerificationDetail = lazy(() => import('./pages/VerificationDetail'))
const Bookings = lazy(() => import('./pages/Bookings'))
const BookingDetail = lazy(() => import('./pages/BookingDetail'))
const BookingDispute = lazy(() => import('./pages/BookingDispute'))
const Payments = lazy(() => import('./pages/Payments'))
const TransactionDetail = lazy(() => import('./pages/TransactionDetail'))
const Refunds = lazy(() => import('./pages/Refunds'))
const Payouts = lazy(() => import('./pages/Payouts'))
const TaxCertificates = lazy(() => import('./pages/TaxCertificates'))
const TaxRemittance = lazy(() => import('./pages/TaxRemittance'))
const Reviews = lazy(() => import('./pages/Reviews'))
const ReviewsFlagged = lazy(() => import('./pages/ReviewsFlagged'))
const ReviewDetail = lazy(() => import('./pages/ReviewDetail'))
const Reports = lazy(() => import('./pages/Reports'))
const Settings = lazy(() => import('./pages/Settings'))
const PriceControl = lazy(() => import('./pages/PriceControl'))
const ServiceCatalog = lazy(() => import('./pages/ServiceCatalog'))

export default function App() {
  return (
    <Routes>
      <Route path="login" element={<Login />} />
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <MainLayout />
          </ProtectedRoute>
        }
      >
        <Route
          index
          element={<Navigate to="/dashboard" replace />}
        />
        {[
          { path: 'dashboard', element: <Dashboard /> },
          { path: 'analytics', element: <Analytics /> },
          { path: 'users', element: <Users /> },
          { path: 'users/clients', element: <Users /> },
          { path: 'users/workers', element: <Navigate to="/workers" replace /> },
          { path: 'users/client/:id', element: <ClientDetail /> },
          { path: 'workers', element: <Workers /> },
          { path: 'workers/:id', element: <WorkerDetail /> },
          { path: 'verification', element: <Verification /> },
          { path: 'verification/detail/:id', element: <VerificationDetail /> },
          { path: 'bookings', element: <Bookings /> },
          { path: 'bookings/detail/:id', element: <BookingDetail /> },
          { path: 'bookings/dispute', element: <BookingDispute /> },
          { path: 'payments', element: <Payments /> },
          { path: 'payments/transaction/:id', element: <TransactionDetail /> },
          { path: 'payments/refunds', element: <Refunds /> },
          { path: 'payments/payouts', element: <Payouts /> },
          { path: 'payments/tax-certificates', element: <TaxCertificates /> },
          { path: 'payments/tax-remittance', element: <TaxRemittance /> },
          { path: 'reviews', element: <Reviews /> },
          { path: 'reviews/flagged', element: <ReviewsFlagged /> },
          { path: 'reviews/detail/:id', element: <ReviewDetail /> },
          { path: 'reports', element: <Navigate to="/reports/logs" replace /> },
          { path: 'reports/logs', element: <Reports /> },
          { path: 'reports/service', element: <Reports /> },
          { path: 'reports/activity', element: <Reports /> },
          { path: 'reports/export', element: <Reports /> },
          { path: 'price-control', element: <PriceControl /> },
          { path: 'service-catalog', element: <ServiceCatalog /> },
          { path: 'settings', element: <Settings /> },
        ].map(({ path, element }) => (
          <Route
            key={path}
            path={path}
            element={<Suspense fallback={<LoadingState message="Loading page..." />}>{element}</Suspense>}
          />
        ))}
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Route>
    </Routes>
  )
}
