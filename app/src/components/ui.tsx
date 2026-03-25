import { useEffect } from 'react'

// ── Modal ─────────────────────────────────────────────────────────────────────
interface ModalProps {
  title:    string
  onClose:  () => void
  children: React.ReactNode
  width?:   string
}

export function Modal({ title, onClose, children, width = 'max-w-lg' }: ModalProps) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className={`relative bg-surface rounded-xl shadow-modal w-full ${width} max-h-[90vh] flex flex-col`}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h2 className="text-base font-bold text-text-1">{title}</h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-surface-2 text-text-3 hover:text-text-1 transition-colors">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M18 6L6 18M6 6l12 12"/>
            </svg>
          </button>
        </div>
        <div className="overflow-y-auto flex-1 px-6 py-5">{children}</div>
      </div>
    </div>
  )
}

// ── PepperHelpButton ───────────────────────────────────────────────────────────
// Small inline cog icon that fires a tutorial prompt at Pepper.
// Also sets data-ai-context so right-click "Ask Pepper" works too.
export function PepperHelpButton({ prompt, size = 14 }: { prompt: string; size?: number }) {
  function fire(e: React.MouseEvent) {
    e.stopPropagation()
    window.dispatchEvent(new CustomEvent('pepper-ask', { detail: { message: prompt } }))
  }
  return (
    <button
      onClick={fire}
      title="Ask Pepper — how to use this section"
      data-ai-context={JSON.stringify({ type: 'tutorial', prompt })}
      className="inline-flex items-center justify-center rounded-full opacity-30 hover:opacity-100 transition-opacity flex-shrink-0 focus:outline-none"
      style={{ color: 'var(--accent)', width: size + 4, height: size + 4 }}
      aria-label="Pepper help"
    >
      {/* Mini cog */}
      <svg viewBox="-100 -100 200 200" width={size} height={size} xmlns="http://www.w3.org/2000/svg">
        <circle cx="0" cy="0" r="66" fill="currentColor"/>
        <g fill="currentColor">
          {[0,30,60,90,120,150,180,210,240,270,300,330].map(deg => (
            <rect key={deg} x="-9" y="-80" width="18" height="20" rx="3" transform={`rotate(${deg})`}/>
          ))}
        </g>
        <circle cx="0" cy="0" r="54" fill="var(--accent)"/>
      </svg>
    </button>
  )
}

// ── Page Header ───────────────────────────────────────────────────────────────
interface PageHeaderProps {
  title:          string
  subtitle?:      string
  action?:        React.ReactNode
  tutorialPrompt?: string
}

export function PageHeader({ title, subtitle, action, tutorialPrompt }: PageHeaderProps) {
  return (
    <div
      className="flex items-center justify-between px-6 py-5 border-b border-border bg-surface"
      data-ai-context={tutorialPrompt ? JSON.stringify({ type: 'tutorial', prompt: tutorialPrompt }) : undefined}
    >
      <div className="flex items-start gap-2">
        <div>
          <h1 className="text-xl font-extrabold text-text-1">{title}</h1>
          {subtitle && <p className="text-sm text-text-3 mt-0.5">{subtitle}</p>}
        </div>
        {tutorialPrompt && <PepperHelpButton prompt={tutorialPrompt} size={14} />}
      </div>
      {action && <div>{action}</div>}
    </div>
  )
}

// ── Empty State ───────────────────────────────────────────────────────────────
interface EmptyStateProps {
  message: string
  action?: React.ReactNode
}

export function EmptyState({ message, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="w-12 h-12 rounded-full bg-surface-2 flex items-center justify-center mb-3">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#6B7F74" strokeWidth="1.5" strokeLinecap="round">
          <circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/>
        </svg>
      </div>
      <p className="text-text-3 text-sm mb-4">{message}</p>
      {action}
    </div>
  )
}

// ── Spinner ───────────────────────────────────────────────────────────────────
export function Spinner() {
  return (
    <div className="flex items-center justify-center py-12">
      <div className="w-8 h-8 rounded-full border-4 border-accent-dim border-t-accent animate-spin" />
    </div>
  )
}

// ── Badge ─────────────────────────────────────────────────────────────────────
type BadgeVariant = 'green' | 'yellow' | 'neutral' | 'red'
const badgeClasses: Record<BadgeVariant, string> = {
  green:   'bg-accent-dim text-accent',
  yellow:  'bg-yellow-50 text-yellow-700',
  neutral: 'bg-surface-2 text-text-3',
  red:     'bg-red-50 text-red-600',
}

export function Badge({ label, variant = 'neutral' }: { label: string; variant?: BadgeVariant }) {
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${badgeClasses[variant]}`}>
      {label}
    </span>
  )
}

// ── Confirm Dialog ────────────────────────────────────────────────────────────
interface ConfirmProps {
  message:   string
  onConfirm: () => void
  onCancel:  () => void
  danger?:   boolean
}

export function ConfirmDialog({ message, onConfirm, onCancel, danger = true }: ConfirmProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onCancel} />
      <div className="relative bg-surface rounded-xl shadow-modal w-full max-w-sm p-6">
        <p className="text-text-1 text-sm mb-6">{message}</p>
        <div className="flex gap-3 justify-end">
          <button onClick={onCancel} className="btn-ghost px-4 py-2 text-sm">Cancel</button>
          <button
            onClick={onConfirm}
            className={danger ? 'btn-danger px-4 py-2 text-sm' : 'btn-primary px-4 py-2 text-sm'}
          >
            Confirm
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Form Field ────────────────────────────────────────────────────────────────
interface FieldProps {
  label:     string
  error?:    string
  required?: boolean
  children:  React.ReactNode
}

export function Field({ label, error, required, children }: FieldProps) {
  return (
    <div className="mb-4">
      <label className="block text-sm font-semibold text-text-2 mb-1.5">
        {label}{required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      {children}
      {error && <p className="text-red-500 text-xs mt-1">{error}</p>}
    </div>
  )
}

// ── Toast ─────────────────────────────────────────────────────────────────────
interface ToastProps {
  message: string
  type?:   'success' | 'error'
  onClose: () => void
}

export function Toast({ message, type = 'success', onClose }: ToastProps) {
  useEffect(() => {
    const t = setTimeout(onClose, 3000)
    return () => clearTimeout(t)
  }, [onClose])

  return (
    <div className={`fixed bottom-6 right-6 z-50 flex items-center gap-3 px-4 py-3 rounded-lg shadow-modal text-sm font-semibold
      ${type === 'success' ? 'bg-accent text-white' : 'bg-red-600 text-white'}`}>
      {type === 'success'
        ? <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M20 6L9 17l-5-5"/></svg>
        : <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
      }
      {message}
      <button onClick={onClose} className="ml-2 opacity-70 hover:opacity-100">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
      </button>
    </div>
  )
}
