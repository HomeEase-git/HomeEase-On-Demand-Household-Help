import { Routes, Route, Navigate } from 'react-router-dom'
import MainLayout from './components/layout/MainLayout'
import ProtectedRoute from './components/auth/ProtectedRoute'
import Dashboard from './pages/Dashboard'
import Analytics from './pages/Analytics'
import Users from './pages/Users'
import ClientDetail from './pages/ClientDetail'
import WorkerDetail from './pages/WorkerDetail'
import Workers from './pages/Workers'
import SuspendUser from './pages/SuspendUser'
import Verification from './pages/Verification'
import VerificationDetail from './pages/VerificationDetail'
import Bookings from './pages/Bookings'
import BookingDetail from './pages/BookingDetail'
import BookingDispute from './pages/BookingDispute'
import Payments from './pages/Payments'
import TransactionDetail from './pages/TransactionDetail'
import Refunds from './pages/Refunds'
import Reviews from './pages/Reviews'
import ReviewsFlagged from './pages/ReviewsFlagged'
import ReviewDetail from './pages/ReviewDetail'
import Reports from './pages/Reports'
import Settings from './pages/Settings'
import Login from './pages/Login'
import PriceControl from './pages/PriceControl'

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
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="dashboard" element={<Dashboard />} />
        <Route path="analytics" element={<Analytics />} />
        <Route path="users" element={<Users />} />
        <Route path="users/clients" element={<Users />} />
        <Route path="users/workers" element={<Navigate to="/workers" replace />} />
        <Route path="users/client/:id" element={<ClientDetail />} />
        <Route path="users/suspend" element={<SuspendUser />} />
        <Route path="workers" element={<Workers />} />
        <Route path="workers/:id" element={<WorkerDetail />} />
        <Route path="verification" element={<Verification />} />
        <Route path="verification/detail/:id" element={<VerificationDetail />} />
        <Route path="bookings" element={<Bookings />} />
        <Route path="bookings/detail/:id" element={<BookingDetail />} />
        <Route path="bookings/dispute" element={<BookingDispute />} />
        <Route path="payments" element={<Payments />} />
        <Route path="payments/transaction/:id" element={<TransactionDetail />} />
        <Route path="payments/refunds" element={<Refunds />} />
        <Route path="reviews" element={<Reviews />} />
        <Route path="reviews/flagged" element={<ReviewsFlagged />} />
        <Route path="reviews/detail/:id" element={<ReviewDetail />} />
        <Route path="reports" element={<Navigate to="/reports/logs" replace />} />
        <Route path="reports/logs" element={<Reports />} />
        <Route path="reports/service" element={<Reports />} />
        <Route path="reports/activity" element={<Reports />} />
        <Route path="reports/export" element={<Reports />} />
        <Route path="price-control" element={<PriceControl />} />
        <Route path="settings" element={<Settings />} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Route>
    </Routes>
  )
}
