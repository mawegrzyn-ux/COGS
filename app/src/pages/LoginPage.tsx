import { useAuth0 } from '@auth0/auth0-react'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Logo from '../components/Logo'
import PwaInstallModal, { PwaInstallLink } from '../components/PwaInstallModal'

export default function LoginPage() {
  const { loginWithRedirect, isAuthenticated, isLoading } = useAuth0()
  const navigate = useNavigate()
  const [showPwa, setShowPwa] = useState(false)

  // If already logged in, go straight to dashboard
  useEffect(() => {
    if (!isLoading && isAuthenticated) {
      navigate('/dashboard', { replace: true })
    }
  }, [isAuthenticated, isLoading, navigate])

  return (
    <div className="min-h-screen flex">

      {/* ── Left panel — brand ─────────────────────────────────────────── */}
      <div
        className="hidden lg:flex lg:w-1/2 flex-col justify-between p-12 relative overflow-hidden"
        style={{ background: 'linear-gradient(145deg, #0D4D26 0%, #146A34 50%, #1E8A44 100%)' }}
      >
        {/* Subtle grid texture */}
        <div
          className="absolute inset-0 opacity-10"
          style={{
            backgroundImage: 'linear-gradient(rgba(255,255,255,0.15) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.15) 1px, transparent 1px)',
            backgroundSize: '32px 32px',
          }}
        />

        {/* Large decorative circle */}
        <div
          className="absolute -bottom-32 -right-32 w-96 h-96 rounded-full opacity-10"
          style={{ background: 'radial-gradient(circle, #ffffff 0%, transparent 70%)' }}
        />

        <div className="relative z-10">
          <Logo size="lg" variant="light" />
        </div>

        <div className="relative z-10">
          <blockquote className="text-white/90 text-xl font-light leading-relaxed mb-6">
            "Know your costs.<br />
            <span className="font-bold text-white">Own your margins."</span>
          </blockquote>
          <div className="flex gap-6">
            {[
              { label: 'Countries', value: 'Multi' },
              { label: 'Currencies', value: 'Live FX' },
              { label: 'COGS engine', value: 'Real-time' },
            ].map(stat => (
              <div key={stat.label}>
                <div className="text-white font-bold text-lg">{stat.value}</div>
                <div className="text-white/60 text-xs font-semibold uppercase tracking-widest">{stat.label}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Right panel — login ────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 py-12 bg-surface">

        {/* Mobile logo */}
        <div className="lg:hidden mb-10">
          <Logo size="md" />
        </div>

        <div className="w-full max-w-sm">
          <h1 className="text-2xl font-extrabold text-text-1 mb-1">Welcome back</h1>
          <p className="text-text-3 text-sm mb-8">Sign in to your Menu COGS account</p>

          <PwaInstallLink
            onClick={() => setShowPwa(true)}
            className="text-text-3 hover:text-accent mb-3 w-full justify-center"
          />

          <button
            onClick={() => loginWithRedirect()}
            disabled={isLoading}
            className="w-full btn-primary py-3 text-base rounded-lg shadow-sm mb-4 disabled:opacity-60"
          >
            {isLoading ? (
              <span className="flex items-center justify-center gap-2">
                <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                Loading…
              </span>
            ) : (
              'Sign in'
            )}
          </button>

          <p className="text-center text-xs text-text-3 mt-6">
            Multi-country franchise COGS management
          </p>
        </div>

        <footer className="absolute bottom-6 text-text-3 text-xs">
          © {new Date().getFullYear()} Menu COGS
        </footer>
      </div>

      {showPwa && <PwaInstallModal onClose={() => setShowPwa(false)} />}
    </div>
  )
}
