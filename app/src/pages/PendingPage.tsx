import { useAuth0 } from '@auth0/auth0-react'

export default function PendingPage() {
  const { logout, user } = useAuth0()

  return (
    <div className="min-h-screen bg-surface-2 flex items-center justify-center p-6">
      <div className="max-w-md w-full bg-surface rounded-2xl shadow-lg border border-border p-8 text-center">
        {/* Logo */}
        <div className="w-14 h-14 rounded-2xl bg-accent flex items-center justify-center mx-auto mb-6">
          <svg className="w-7 h-7 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>

        <h1 className="text-xl font-bold text-text-1 mb-2">Account Pending Approval</h1>
        <p className="text-text-3 text-sm leading-relaxed mb-6">
          Your account <span className="font-medium text-text-2">{user?.email}</span> has been
          registered and is awaiting approval by an administrator. You'll be able to access
          the app once your account is activated.
        </p>

        <div className="bg-accent-dim rounded-xl p-4 mb-6 text-left">
          <p className="text-xs font-semibold text-accent uppercase tracking-wide mb-2">What happens next?</p>
          <ul className="space-y-1.5 text-sm text-text-2">
            <li className="flex items-start gap-2">
              <span className="text-accent mt-0.5 flex-shrink-0">1.</span>
              An admin will review your registration
            </li>
            <li className="flex items-start gap-2">
              <span className="text-accent mt-0.5 flex-shrink-0">2.</span>
              They'll assign you a role and any market access
            </li>
            <li className="flex items-start gap-2">
              <span className="text-accent mt-0.5 flex-shrink-0">3.</span>
              Refresh this page to check your status
            </li>
          </ul>
        </div>

        <div className="flex gap-3">
          <button
            className="btn-outline flex-1 py-2.5"
            onClick={() => window.location.reload()}
          >
            Refresh
          </button>
          <button
            className="btn-ghost flex-1 py-2.5 text-text-3"
            onClick={() => logout({ logoutParams: { returnTo: window.location.origin + '/login' } })}
          >
            Sign out
          </button>
        </div>
      </div>
    </div>
  )
}
