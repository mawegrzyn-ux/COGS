import { useAuth0 } from '@auth0/auth0-react'
import Logo from '../components/Logo'

export default function DashboardPage() {
  const { user, logout } = useAuth0()

  return (
    <div className="min-h-screen bg-surface-2">
      {/* Top nav */}
      <header className="bg-surface border-b border-border px-6 py-4 flex items-center justify-between shadow-sm">
        <Logo size="sm" />
        <div className="flex items-center gap-4">
          <span className="text-text-3 text-sm">{user?.email}</span>
          <button
            onClick={() => logout({ logoutParams: { returnTo: window.location.origin + '/login' } })}
            className="btn-outline py-1.5 px-3 text-sm"
          >
            Sign out
          </button>
        </div>
      </header>

      {/* Body */}
      <main className="max-w-5xl mx-auto px-6 py-12">
        <div className="card p-8 text-center">
          <div className="w-14 h-14 rounded-full bg-accent-dim flex items-center justify-center mx-auto mb-4">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#146A34" strokeWidth="2" strokeLinecap="round">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
              <polyline points="22 4 12 14.01 9 11.01"/>
            </svg>
          </div>
          <h2 className="text-xl font-bold text-text-1 mb-2">You're in!</h2>
          <p className="text-text-3 text-sm mb-6">
            React frontend is running. Dashboard content coming in Phase 1.
          </p>
          <span className="badge-green">Auth0 ✓ Connected</span>
        </div>
      </main>
    </div>
  )
}
