import { useState, useEffect } from 'react'

// ── Platform detection ─────────────────────────────────────────────────────────

type Platform = 'ios' | 'android' | 'chrome-desktop' | 'edge-desktop' | 'safari-mac' | 'other'

function detectPlatform(): Platform {
  if (typeof navigator === 'undefined') return 'other'
  const ua = navigator.userAgent

  const isIOS     = /iPhone|iPad|iPod/i.test(ua)
  const isAndroid = /Android/i.test(ua)
  const isSafari  = /Safari/i.test(ua) && !/Chrome/i.test(ua)
  const isChrome  = /Chrome/i.test(ua) && !/Edg/i.test(ua)
  const isEdge    = /Edg\//i.test(ua)
  const isMac     = /Macintosh/i.test(ua)
  const isMobile  = isIOS || isAndroid

  if (isIOS)                      return 'ios'
  if (isAndroid)                  return 'android'
  if (isEdge && !isMobile)        return 'edge-desktop'
  if (isChrome && !isMobile)      return 'chrome-desktop'
  if (isSafari && isMac)          return 'safari-mac'
  return 'chrome-desktop'          // sensible default
}

function isAlreadyInstalled(): boolean {
  if (typeof window === 'undefined') return false
  return window.matchMedia('(display-mode: standalone)').matches
    || (window.navigator as { standalone?: boolean }).standalone === true
}

// ── Step list component ────────────────────────────────────────────────────────

function Steps({ items }: { items: { icon: string; text: string }[] }) {
  return (
    <ol className="space-y-3 mt-4">
      {items.map((item, i) => (
        <li key={i} className="flex items-start gap-3">
          <span className="flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold text-white mt-0.5"
            style={{ background: 'var(--accent)' }}>
            {i + 1}
          </span>
          <span className="text-sm text-text-1 leading-relaxed">
            <span className="mr-1">{item.icon}</span>
            <span dangerouslySetInnerHTML={{ __html: item.text }} />
          </span>
        </li>
      ))}
    </ol>
  )
}

// ── Browser tab definitions ────────────────────────────────────────────────────

const TABS: { id: Platform | 'edge-desktop'; label: string; emoji: string }[] = [
  { id: 'chrome-desktop', label: 'Chrome',      emoji: '🌐' },
  { id: 'edge-desktop',   label: 'Edge',         emoji: '🔷' },
  { id: 'ios',            label: 'iPhone / iPad', emoji: '🍎' },
  { id: 'android',        label: 'Android',      emoji: '🤖' },
  { id: 'safari-mac',     label: 'Safari Mac',   emoji: '🧭' },
]

const STEPS: Record<string, { icon: string; text: string }[]> = {
  'chrome-desktop': [
    { icon: '🔍', text: 'Look for the <strong>install icon</strong> (⊕ or a screen with a down-arrow) at the right of the address bar.' },
    { icon: '🖱️', text: 'Click it, then click <strong>"Install"</strong> in the popup.' },
    { icon: '✅', text: 'Menu COGS opens as a standalone app — no browser bars, works from your taskbar.' },
    { icon: '💡', text: 'Don\'t see the icon? Open the <strong>3-dot menu (⋮)</strong> → <strong>"Save and share"</strong> → <strong>"Install page as app…"</strong>' },
  ],
  'edge-desktop': [
    { icon: '🔍', text: 'Look for the <strong>app install icon</strong> (phone with down-arrow) at the right of the address bar.' },
    { icon: '🖱️', text: 'Click it, then click <strong>"Install"</strong>.' },
    { icon: '✅', text: 'Menu COGS will appear in your Start menu and taskbar as a standalone app.' },
    { icon: '💡', text: 'Alternatively: open the <strong>3-dot menu (…)</strong> → <strong>"Apps"</strong> → <strong>"Install this site as an app"</strong>.' },
  ],
  'ios': [
    { icon: '📋', text: 'Open <strong>Safari</strong> on your iPhone or iPad — PWA install is only supported in Safari on iOS.' },
    { icon: '📤', text: 'Tap the <strong>Share button</strong> (the box with an arrow pointing up) at the bottom of the screen.' },
    { icon: '📜', text: 'Scroll down in the share sheet and tap <strong>"Add to Home Screen"</strong>.' },
    { icon: '✏️', text: 'Edit the name if you like, then tap <strong>"Add"</strong> in the top right.' },
    { icon: '✅', text: 'A Menu COGS icon appears on your home screen. It opens full-screen without the Safari bar.' },
  ],
  'android': [
    { icon: '🌐', text: 'Open this site in <strong>Chrome</strong> on your Android device.' },
    { icon: '🔔', text: 'Chrome may show a banner at the bottom — tap <strong>"Install"</strong> or <strong>"Add to Home screen"</strong>.' },
    { icon: '💡', text: 'If no banner appears, tap the <strong>3-dot menu (⋮)</strong> in the top right.' },
    { icon: '📲', text: 'Tap <strong>"Add to Home screen"</strong> or <strong>"Install app"</strong>, then confirm.' },
    { icon: '✅', text: 'Menu COGS appears on your home screen and opens as a standalone app.' },
  ],
  'safari-mac': [
    { icon: '🖥️', text: 'PWA support on macOS Safari requires <strong>macOS Sonoma (14)</strong> or later.' },
    { icon: '📁', text: 'Click the <strong>File menu</strong> in the menu bar at the top of the screen.' },
    { icon: '🖱️', text: 'Select <strong>"Add to Dock"</strong>.' },
    { icon: '✅', text: 'Menu COGS is added to your Dock and opens as a standalone app.' },
    { icon: '💡', text: 'On macOS Ventura or earlier, Safari doesn\'t support PWA install — use <strong>Chrome or Edge</strong> instead.' },
  ],
  'other': [
    { icon: '🌐', text: 'For the best install experience, open Menu COGS in <strong>Chrome</strong> or <strong>Edge</strong>.' },
    { icon: '🔍', text: 'Look for an <strong>install icon</strong> in the address bar, or open the browser menu and look for <strong>"Install app"</strong> or <strong>"Add to Home screen"</strong>.' },
    { icon: '✅', text: 'Once installed, Menu COGS runs as a standalone app with no browser chrome.' },
  ],
}

// ── Main modal ─────────────────────────────────────────────────────────────────

interface Props {
  onClose: () => void
}

export default function PwaInstallModal({ onClose }: Props) {
  const [activePlatform, setActivePlatform] = useState<Platform>('chrome-desktop')
  const [alreadyInstalled, setAlreadyInstalled] = useState(false)

  useEffect(() => {
    setActivePlatform(detectPlatform())
    setAlreadyInstalled(isAlreadyInstalled())
  }, [])

  const steps = STEPS[activePlatform] ?? STEPS['other']

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.45)' }}
      onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-surface rounded-2xl shadow-2xl w-full max-w-lg flex flex-col max-h-[90vh]"
        style={{ border: '1px solid var(--border)' }}>

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b"
          style={{ borderColor: 'var(--border)' }}>
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center"
              style={{ background: 'var(--accent-dim)' }}>
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24"
                fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="5" y="2" width="14" height="20" rx="2" ry="2"/>
                <line x1="12" y1="18" x2="12.01" y2="18"/>
              </svg>
            </div>
            <div>
              <h2 className="text-base font-bold text-text-1">Install Menu COGS</h2>
              <p className="text-xs text-text-3">Add to your home screen or desktop</p>
            </div>
          </div>
          <button onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-surface-2 text-text-3 hover:text-text-1 transition-colors">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        {/* Already installed banner */}
        {alreadyInstalled && (
          <div className="mx-6 mt-4 px-4 py-3 rounded-xl text-sm font-medium flex items-center gap-2"
            style={{ background: 'var(--accent-dim)', color: 'var(--accent-dark)' }}>
            <span>✅</span>
            <span>You're already running Menu COGS as an installed app!</span>
          </div>
        )}

        {/* Browser tabs */}
        <div className="px-6 pt-4">
          <p className="text-xs text-text-3 mb-2 font-medium uppercase tracking-wider">Select your browser / device</p>
          <div className="flex flex-wrap gap-1.5">
            {TABS.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActivePlatform(tab.id as Platform)}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors"
                style={activePlatform === tab.id
                  ? { background: 'var(--accent)', color: '#fff' }
                  : { background: 'var(--surface-2)', color: 'var(--text-2)', border: '1px solid var(--border)' }
                }
              >
                {tab.emoji} {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* Steps */}
        <div className="px-6 pb-6 pt-2 overflow-y-auto">
          <Steps items={steps} />
        </div>

        {/* Footer tip */}
        <div className="px-6 pb-5">
          <div className="rounded-xl px-4 py-3 text-xs text-text-3"
            style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
            <strong className="text-text-2">Why install?</strong> Faster launch, full-screen view, works from your home screen or desktop — no browser address bar in the way.
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Trigger link (re-exported for convenience) ─────────────────────────────────

interface TriggerProps {
  onClick: () => void
  className?: string
}

export function PwaInstallLink({ onClick, className = '' }: TriggerProps) {
  // Hide if already installed
  const [hidden, setHidden] = useState(false)
  useEffect(() => { setHidden(isAlreadyInstalled()) }, [])
  if (hidden) return null

  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 text-xs transition-colors ${className}`}
    >
      <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24"
        fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="5" y="2" width="14" height="20" rx="2" ry="2"/>
        <line x1="12" y1="18" x2="12.01" y2="18"/>
      </svg>
      Install as app
    </button>
  )
}
