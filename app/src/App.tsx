import { useAuth0 } from '@auth0/auth0-react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import LoginPage          from './pages/LoginPage'
import AppLayout          from './components/AppLayout'
import DashboardPage      from './pages/DashboardPage'
import SettingsPage       from './pages/SettingsPage'
import LoadingScreen      from './components/LoadingScreen'
import MarketsPage        from './pages/MarketsPage'
import CategoriesPage     from './pages/CategoriesPage'
import InventoryPage      from './pages/InventoryPage'
import RecipesPage        from './pages/RecipesPage'
import MenusPage          from './pages/MenusPage'
import AllergenMatrixPage from './pages/AllergenMatrixPage'
import HACCPPage          from './pages/HACCPPage'

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
          <Route path="markets"    element={<MarketsPage />} />
          <Route path="countries"  element={<Navigate to="/markets" replace />} />
          <Route path="locations"  element={<Navigate to="/markets" replace />} />
          <Route path="categories" element={<CategoriesPage />} />
          <Route path="inventory"  element={<InventoryPage />} />
          <Route path="recipes"    element={<RecipesPage />} />
          <Route path="menus"      element={<MenusPage />} />
          <Route path="allergens"  element={<AllergenMatrixPage />} />
          <Route path="haccp"      element={<HACCPPage />} />
        
       
        </Route>

        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
