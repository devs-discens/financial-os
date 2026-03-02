import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import Layout from './components/Layout'
import TwinDashboard from './pages/TwinDashboard'
import YourPlan from './pages/YourPlan'
import Settings from './pages/Settings'
import Progress from './pages/Progress'
import Login from './pages/Login'
import Admin, { RegistryTab, UsersTab, DemoTab, BenchmarksTab, BackgroundTab } from './pages/Admin'
import LoadingSpinner from './components/LoadingSpinner'
import type { ReactNode } from 'react'

function ProtectedRoute({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth()
  if (loading) return <LoadingSpinner />
  if (!user) return <Navigate to="/login" replace />
  return <>{children}</>
}

function AdminRoute({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth()
  if (loading) return <LoadingSpinner />
  if (!user) return <Navigate to="/login" replace />
  if (user.role !== 'admin') return <Navigate to="/" replace />
  return <>{children}</>
}

function UserHome() {
  const { user } = useAuth()
  if (user?.role === 'admin') return <Navigate to="/admin" replace />
  return <TwinDashboard />
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route element={<ProtectedRoute><Layout /></ProtectedRoute>}>
            <Route path="/" element={<UserHome />} />
            <Route path="/progress" element={<Progress />} />
            <Route path="/plan" element={<YourPlan />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/admin" element={<AdminRoute><Admin /></AdminRoute>}>
              <Route index element={<Navigate to="registry" replace />} />
              <Route path="registry" element={<RegistryTab />} />
              <Route path="users" element={<UsersTab />} />
              <Route path="demo" element={<DemoTab />} />
              <Route path="benchmarks" element={<BenchmarksTab />} />
              <Route path="background" element={<BackgroundTab />} />
            </Route>
          </Route>
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}
