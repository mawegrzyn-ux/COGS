import { lazy, Suspense } from 'react'
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
// BugsBacklogPage is now embedded in SystemPage — import removed from here
import HelpPage             from './pages/HelpPage'
import MediaLibraryPage     from './pages/MediaLibraryPage'
import ConfigurationPage    from './pages/ConfigurationPage'
import SystemPage           from './pages/SystemPage'
import PosTesterPage        from './pages/PosTesterPage'
// QSC Audits — lazy-loaded to keep the main bundle small.
// These pages pull in the full 150-question bank + runner/report UI; they
// only matter to users who have `audits:read` access.
const AuditsPage          = lazy(() => import('./pages/audits/AuditsPage'))
const AuditRunnerPage     = lazy(() => import('./pages/audits/AuditRunnerPage'))
const AuditReportPage     = lazy(() => import('./pages/audits/AuditReportPage'))
const AuditTemplatesPage  = lazy(() => import('./pages/audits/AuditTemplatesPage'))
import SharedMenuPage       from './pages/SharedMenuPage'
import WidgetPopoutPage     from './pages/WidgetPopoutPage'
import PendingPage          from './pages/PendingPage'
import PermissionsProvider  from './components/PermissionsProvider'
import { usePermissions }   from './hooks/usePermissions'
import { MarketProvider }   from './contexts/MarketContext'
import { LanguageProvider } from './contexts/LanguageContext'
import { FeatureFlagsProvider, useFeatureFlags } from './contexts/FeatureFlagsContext'

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading: authLoading } = useAuth0()
  const { user, loading: permLoading } = usePermissions()

  if (authLoading || permLoading) return <LoadingScreen />
  if (!isAuthenticated)           return <Navigate to="/login" replace />
  if (user?.status === 'pending') return <PendingPage />

  return <>{children}</>
}

// Redirect to /dashboard if a feature flag is disabled. Used to hide
// whole modules (Stock Manager, HACCP, Allergens) from users without
// changing RBAC. Waits for flags to load to avoid flash-of-redirect.
function FeatureRoute({ flag, children }: { flag: keyof import('./contexts/FeatureFlagsContext').FeatureFlags; children: React.ReactNode }) {
  const { flags, loading } = useFeatureFlags()
  if (loading) return <LoadingScreen />
  if (!flags[flag]) return <Navigate to="/dashboard" replace />
  return <>{children}</>
}

export default function App() {
  const { isLoading } = useAuth0()
  if (isLoading) return <LoadingScreen />

  return (
    <BrowserRouter>
      <PermissionsProvider>
        <FeatureFlagsProvider>
        <LanguageProvider>
        <MarketProvider>
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
            <Route path="allergens"     element={<FeatureRoute flag="allergens"><AllergenMatrixPage /></FeatureRoute>} />
            <Route path="haccp"         element={<FeatureRoute flag="haccp"><HACCPPage /></FeatureRoute>} />
            <Route path="audits"               element={<FeatureRoute flag="audits"><Suspense fallback={<LoadingScreen />}><AuditsPage /></Suspense></FeatureRoute>} />
            <Route path="audits/templates"     element={<FeatureRoute flag="audits"><Suspense fallback={<LoadingScreen />}><AuditTemplatesPage /></Suspense></FeatureRoute>} />
            <Route path="audits/:id/run"       element={<FeatureRoute flag="audits"><Suspense fallback={<LoadingScreen />}><AuditRunnerPage /></Suspense></FeatureRoute>} />
            <Route path="audits/:id/report"    element={<FeatureRoute flag="audits"><Suspense fallback={<LoadingScreen />}><AuditReportPage /></Suspense></FeatureRoute>} />
            <Route path="stock-manager" element={<FeatureRoute flag="stock_manager"><StockManagerPage /></FeatureRoute>} />
            <Route path="bugs-backlog" element={<Navigate to="/system" replace />} />
            <Route path="media"         element={<MediaLibraryPage />} />
            <Route path="help"          element={<HelpPage />} />
            <Route path="pos-tester"   element={<PosTesterPage />} />
            <Route path="import"        element={<Navigate to="/configuration" replace />} />
          </Route>

          {/* Protected but outside the AppLayout shell — the widget popout is
              launched via window.open() and needs just the widget, not the
              sidebar / Pepper dock. Still requires auth + active user status. */}
          <Route path="/widget/:widgetId" element={
            <ProtectedRoute>
              <WidgetPopoutPage />
            </ProtectedRoute>
          } />

          {/* Public shared pages — no auth, outside RBAC */}
          <Route path="/share/:slug" element={<SharedMenuPage />} />

          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
        </MarketProvider>
        </LanguageProvider>
        </FeatureFlagsProvider>
      </PermissionsProvider>
    </BrowserRouter>
  )
}
