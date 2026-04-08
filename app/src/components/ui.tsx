import { useEffect, useState, useMemo } from 'react'
import { createPortal } from 'react-dom'

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

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
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
    </div>,
    document.body
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
  subtitle?:      React.ReactNode
  action?:        React.ReactNode
  tutorialPrompt?: string
}

export function PageHeader({ title, subtitle, action, tutorialPrompt }: PageHeaderProps) {
  return (
    <div
      className="flex items-center justify-between px-6 py-4 border-b border-border bg-surface"
      data-ai-context={tutorialPrompt ? JSON.stringify({ type: 'tutorial', prompt: tutorialPrompt }) : undefined}
    >
      <div className="flex items-start gap-2">
        <div>
          <h1 className="text-xl font-extrabold text-text-1">{title}</h1>
          {subtitle && <div className="text-sm text-text-3 mt-0.5">{subtitle}</div>}
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
  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
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
    </div>,
    document.body
  )
}

// ── Date Confirm Dialog ───────────────────────────────────────────────────────
// A stronger confirmation modal — the user must type today's date as ddmmyyyy
// before the confirm button becomes active. Used to guard destructive ops like
// clearing the database or wiping and reloading test data.
interface DateConfirmProps {
  title:      string
  message:    React.ReactNode
  confirmLabel?: string
  onConfirm:  () => void
  onCancel:   () => void
  danger?:    boolean
}

export function DateConfirmDialog({
  title,
  message,
  confirmLabel = 'Confirm',
  onConfirm,
  onCancel,
  danger = true,
}: DateConfirmProps) {
  const [value, setValue] = useState('')

  // Compute today's date as ddmmyyyy in the user's local timezone.
  // Local time is intentional: the user is typing what they see on a calendar today.
  const expected = useMemo(() => {
    const d  = new Date()
    const dd = String(d.getDate()).padStart(2, '0')
    const mm = String(d.getMonth() + 1).padStart(2, '0')
    const yy = String(d.getFullYear())
    return `${dd}${mm}${yy}`
  }, [])

  // Human-readable version shown in the placeholder / hint
  const humanHint = useMemo(() => {
    const dd = expected.slice(0, 2)
    const mm = expected.slice(2, 4)
    const yy = expected.slice(4, 8)
    return `${dd}${mm}${yy}`
  }, [expected])

  // Only digits, max 8 chars
  const sanitized = value.replace(/\D/g, '').slice(0, 8)
  const matches   = sanitized === expected

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
      if (e.key === 'Enter' && matches) onConfirm()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onCancel, onConfirm, matches])

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onCancel} />
      <div className="relative bg-surface rounded-xl shadow-modal w-full max-w-md p-6">
        <div className="flex items-start gap-3 mb-4">
          <div className="w-9 h-9 rounded-full bg-red-50 flex items-center justify-center shrink-0">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#dc2626" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 9v2m0 4h.01M10.29 3.86l-8.18 14.14A2 2 0 003.84 21h16.32a2 2 0 001.73-3l-8.18-14.14a2 2 0 00-3.42 0z"/>
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-base font-bold text-text-1 mb-1">{title}</h2>
            <div className="text-sm text-text-2 leading-relaxed">{message}</div>
          </div>
        </div>

        <div className="mb-5">
          <label className="block text-xs font-semibold text-text-2 mb-1.5">
            Type today&apos;s date as <span className="font-mono">ddmmyyyy</span> to confirm
          </label>
          <input
            type="text"
            autoFocus
            inputMode="numeric"
            pattern="\d{8}"
            maxLength={8}
            value={sanitized}
            onChange={e => setValue(e.target.value)}
            placeholder={humanHint}
            className={`w-full px-3 py-2 font-mono text-base rounded border transition-colors tracking-widest
              ${sanitized.length === 0
                ? 'border-border bg-surface text-text-1'
                : matches
                  ? 'border-accent bg-accent-dim/30 text-text-1'
                  : 'border-red-300 bg-red-50 text-red-700'
              }
              focus:outline-none focus:ring-2 focus:ring-accent/30`}
          />
          {sanitized.length > 0 && !matches && (
            <p className="text-red-600 text-xs mt-1.5">
              That isn&apos;t today&apos;s date. Expected 8 digits in <span className="font-mono">ddmmyyyy</span> format.
            </p>
          )}
        </div>

        <div className="flex gap-3 justify-end">
          <button onClick={onCancel} className="btn-ghost px-4 py-2 text-sm">Cancel</button>
          <button
            onClick={onConfirm}
            disabled={!matches}
            className={`${danger ? 'btn-danger' : 'btn-primary'} px-4 py-2 text-sm disabled:opacity-40 disabled:cursor-not-allowed`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}

// ── Form Field ────────────────────────────────────────────────────────────────
interface FieldProps {
  label:     string
  hint?:     string
  error?:    string
  required?: boolean
  children:  React.ReactNode
}

export function Field({ label, hint, error, required, children }: FieldProps) {
  return (
    <div className="mb-4">
      <label className="block text-sm font-semibold text-text-2 mb-1.5">
        {label}{required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      {hint && <p className="text-xs text-text-3 mb-1.5 -mt-1">{hint}</p>}
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
