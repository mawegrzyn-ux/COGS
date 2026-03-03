import { useAuth0 } from '@auth0/auth0-react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import LoginPage     from './pages/LoginPage'
import AppLayout     from './components/AppLayout'
import DashboardPage from './pages/DashboardPage'
import SettingsPage  from './pages/SettingsPage'
import LoadingScreen from './components/LoadingScreen'

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth0()
  if (isLoading)        return <LoadingScreen />
  if (!isAuthenticated) return <Navigate to="/login" replace />
  return <>{children}</>
}

export default function App() {
  const { isLoading } = useAuth0()
  if (isLoading) return <LoadingScreen />

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />

        {/* Protected app shell */}
        <Route path="/" element={
          <ProtectedRoute>
            <AppLayout />
          </ProtectedRoute>
        }>
          <Route index             element={<Navigate to="/dashboard" replace />} />
          <Route path="dashboard"  element={<DashboardPage />} />
          <Route path="settings"   element={<SettingsPage />} />

          {/* Pages to be built — placeholder redirects for now */}
          <Route path="inventory"  element={<Navigate to="/dashboard" replace />} />
          <Route path="recipes"    element={<Navigate to="/dashboard" replace />} />
          <Route path="menus"      element={<Navigate to="/dashboard" replace />} />
          <Route path="countries"  element={<Navigate to="/dashboard" replace />} />
          <Route path="categories" element={<Navigate to="/dashboard" replace />} />
        </Route>

        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
