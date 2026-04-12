import { useAuth0 } from '@auth0/auth0-react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import LoginPage            from './pages/LoginPage'
import AppLayout            from './components/AppLayout'
import DashboardPage        from './pages/DashboardPage'
import LoadingScreen        from './components/LoadingScreen'
import InventoryPage        from './pages/InventoryPage'
import RecipesPage          from './pages/RecipesPage'
import MenusPage            from './pages/MenusPage'
import SalesItemsPage       from './pages/SalesItemsPage'
import AllergenMatrixPage   from './pages/AllergenMatrixPage'
import HACCPPage            from './pages/HACCPPage'
import StockManagerPage     from './pages/StockManagerPage'
import BugsBacklogPage     from './pages/BugsBacklogPage'
import HelpPage             from './pages/HelpPage'
import MediaLibraryPage     from './pages/MediaLibraryPage'
import ConfigurationPage    from './pages/ConfigurationPage'
import SystemPage           from './pages/SystemPage'
import PosTesterPage        from './pages/PosTesterPage'
import SharedMenuPage       from './pages/SharedMenuPage'
import PendingPage          from './pages/PendingPage'
import PermissionsProvider  from './components/PermissionsProvider'
import { usePermissions }   from './hooks/usePermissions'

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading: authLoading } = useAuth0()
  const { user, loading: permLoading } = usePermissions()

  if (authLoading || permLoading) return <LoadingScreen />
  if (!isAuthenticated)           return <Navigate to="/login" replace />
  if (user?.status === 'pending') return <PendingPage />

  return <>{children}</>
}

export default function App() {
  const { isLoading } = useAuth0()
  if (isLoading) return <LoadingScreen />

  return (
    <BrowserRouter>
      <PermissionsProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />

          {/* Protected app shell */}
          <Route path="/" element={
            <ProtectedRoute>
              <AppLayout />
            </ProtectedRoute>
          }>
            <Route index                element={<Navigate to="/dashboard" replace />} />
            <Route path="dashboard"     element={<DashboardPage />} />
            <Route path="configuration" element={<ConfigurationPage />} />
            <Route path="system"        element={<SystemPage />} />
            <Route path="settings"      element={<Navigate to="/configuration" replace />} />
            <Route path="markets"       element={<Navigate to="/configuration" replace />} />
            <Route path="countries"     element={<Navigate to="/configuration" replace />} />
            <Route path="locations"     element={<Navigate to="/configuration" replace />} />
            <Route path="categories"    element={<Navigate to="/configuration" replace />} />
            <Route path="inventory"     element={<InventoryPage />} />
            <Route path="recipes"       element={<RecipesPage />} />
            <Route path="sales-items"   element={<SalesItemsPage />} />
            <Route path="menus"         element={<MenusPage />} />
            <Route path="allergens"     element={<AllergenMatrixPage />} />
            <Route path="haccp"         element={<HACCPPage />} />
            <Route path="stock-manager" element={<StockManagerPage />} />
            <Route path="bugs-backlog" element={<BugsBacklogPage />} />
            <Route path="media"         element={<MediaLibraryPage />} />
            <Route path="help"          element={<HelpPage />} />
            <Route path="pos-tester"   element={<PosTesterPage />} />
            <Route path="import"        element={<Navigate to="/configuration" replace />} />
          </Route>

          {/* Public shared pages — no auth, outside RBAC */}
          <Route path="/share/:slug" element={<SharedMenuPage />} />

          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </PermissionsProvider>
    </BrowserRouter>
  )
}
