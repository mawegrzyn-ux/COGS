import { useState, useEffect, useCallback, useRef } from 'react'
import { Outlet } from 'react-router-dom'
import Sidebar from './Sidebar'
import AiChat, { type PepperMode } from './AiChat'

// ── Context menu types ─────────────────────────────────────────────────────────

interface AiContextData {
  type:         string
  value?:       string
  label?:       string
  item?:        string
  price_level?: string
  menu?:        string
  [key: string]: string | undefined
}

interface ContextMenuState {
  x:       number
  y:       number
  context: AiContextData | null  // null = no instrumented element, show screenshot-only menu
}

// ── Prompt builder ─────────────────────────────────────────────────────────────

function buildAskPrompt(ctx: AiContextData): string {
  const v    = ctx.value  ?? ''
  const item = ctx.item   ?? ''
  const pl   = ctx.price_level ?? ''
  const menu = ctx.menu   ?? ''

  switch (ctx.type) {
    case 'cogs_pct': {
      let q = `Explain a COGS% of ${v}`
      if (item) q += ` for "${item}"`
      if (pl)   q += ` (${pl})`
      if (menu) q += ` on the "${menu}" menu`
      q += `. Is this good or bad, what drives it, and how could it be improved?`
      return q
    }
    case 'coverage': {
      return `The price quote coverage is ${v}. What does this mean for COGS accuracy, and what's the best way to improve it?`
    }
    case 'cost_per_portion': {
      let q = `The cost per portion for "${item}" is ${v}`
      if (menu) q += ` on the "${menu}" menu`
      q += `. What factors affect this cost and how does it impact COGS?`
      return q
    }
    case 'menu_cogs': {
      let q = `The "${menu}" menu has a COGS% of ${v}`
      if (pl) q += ` for the ${pl} price level`
      q += `. Is this a healthy margin for a restaurant, and what are the key levers to improve it?`
      return q
    }
    case 'tutorial': {
      // prompt is already fully formed — pass through directly
      return ctx.prompt ?? `How do I use this section?`
    }
    default: {
      const label = ctx.label || ctx.type
      return `Explain this ${label}: ${v}. What does it mean and what should I do about it?`
    }
  }
}

// ── Pepper Context Menu component ──────────────────────────────────────────────

function PepperContextMenu({
  state,
  onAsk,
  onScreenshotAsk,
  onClose,
}: {
  state:           ContextMenuState
  onAsk:           (message: string) => Promise<void>
  onScreenshotAsk: () => Promise<void>
  onClose:         () => void
}) {
  const ref = useRef<HTMLDivElement>(null)

  // Clamp to viewport
  const [pos, setPos] = useState({ x: state.x, y: state.y })
  useEffect(() => {
    if (!ref.current) return
    const rect = ref.current.getBoundingClientRect()
    const vw   = window.innerWidth
    const vh   = window.innerHeight
    setPos({
      x: Math.min(state.x, vw - rect.width  - 8),
      y: Math.min(state.y, vh - rect.height - 8),
    })
  }, [state.x, state.y])

  // Dismiss on outside click or scroll
  useEffect(() => {
    function dismiss(e: MouseEvent | KeyboardEvent | Event) {
      if (e instanceof KeyboardEvent && e.key !== 'Escape') return
      if (e instanceof MouseEvent && ref.current?.contains(e.target as Node)) return
      onClose()
    }
    document.addEventListener('mousedown', dismiss)
    document.addEventListener('keydown',   dismiss)
    window.addEventListener('scroll',      dismiss, true)
    return () => {
      document.removeEventListener('mousedown', dismiss)
      document.removeEventListener('keydown',   dismiss)
      window.removeEventListener('scroll',      dismiss, true)
    }
  }, [onClose])

  const btnClass = "w-full flex items-center gap-2.5 px-3 py-2 text-sm text-text-1 hover:bg-accent-dim hover:text-accent transition-colors text-left"

  return (
    <div
      ref={ref}
      style={{ position: 'fixed', top: pos.y, left: pos.x, zIndex: 99999 }}
      className="pepper-ui bg-surface border border-border rounded-lg shadow-modal py-1 min-w-[180px]"
    >
      {/* Section label */}
      <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-text-3 select-none">
        Pepper AI
      </div>

      {/* Contextual Ask Pepper — only for instrumented elements */}
      {state.context && (
        <button
          className={btnClass}
          onClick={() => { onAsk(buildAskPrompt(state.context!)); onClose() }}
        >
          <svg viewBox="-100 -100 200 200" width="15" height="15" xmlns="http://www.w3.org/2000/svg">
            <circle cx="0" cy="0" r="66" fill="currentColor"/>
            <g fill="currentColor">
              {[0,30,60,90,120,150,180,210,240,270,300,330].map(deg => (
                <rect key={deg} x="-9" y="-80" width="18" height="20" rx="3" transform={`rotate(${deg})`}/>
              ))}
            </g>
            <circle cx="0" cy="0" r="54" fill="var(--accent)"/>
          </svg>
          {state.context.type === 'tutorial' ? 'Ask Pepper — how to use this' : 'Ask Pepper'}
        </button>
      )}

      {/* Screenshot & Ask — always available */}
      <button
        className={btnClass}
        onClick={() => { onScreenshotAsk(); onClose() }}
      >
        {/* camera icon */}
        <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24"
          fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
          <circle cx="12" cy="13" r="4"/>
        </svg>
        Screenshot &amp; Ask Pepper
      </button>
    </div>
  )
}

// ── AppLayout ──────────────────────────────────────────────────────────────────

export default function AppLayout() {
  const [ctxMenu,    setCtxMenu]    = useState<ContextMenuState | null>(null)
  const [pepperMode,  setPepperMode]  = useState<PepperMode>(() =>
    (localStorage.getItem('pepper-mode') as PepperMode) || 'float'
  )

  const handleModeChange = useCallback((m: PepperMode) => {
    setPepperMode(m)
    localStorage.setItem('pepper-mode', m)
  }, [])

  const handleContextMenu = useCallback((e: MouseEvent) => {
    // Don't intercept right-clicks inside input/textarea/contenteditable
    const tag = (e.target as HTMLElement).tagName
    if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement).isContentEditable) return

    // Walk up from event target looking for data-ai-context
    let foundCtx: AiContextData | null = null
    let el = e.target as HTMLElement | null
    while (el && el !== document.body) {
      const raw = el.getAttribute('data-ai-context')
      if (raw) {
        try { foundCtx = JSON.parse(raw) as AiContextData } catch { /* malformed — ignore */ }
        break
      }
      el = el.parentElement
    }

    e.preventDefault()
    setCtxMenu({ x: e.clientX, y: e.clientY, context: foundCtx })
  }, [])

  useEffect(() => {
    document.addEventListener('contextmenu', handleContextMenu)
    return () => document.removeEventListener('contextmenu', handleContextMenu)
  }, [handleContextMenu])

  // Shared screenshot capture helper
  const captureScreenshot = useCallback(async (): Promise<File | null> => {
    try {
      const { default: html2canvas } = await import('html2canvas')
      const mainEl = document.querySelector('main') as HTMLElement
      const canvas = await html2canvas(mainEl || document.body, {
        scale: 0.65,
        useCORS: true,
        logging: false,
        ignoreElements: (el: Element) => el.classList.contains('pepper-ui'),
      })
      return await new Promise<File | null>(resolve => {
        canvas.toBlob(
          blob => resolve(blob ? new File([blob], `page-${Date.now()}.jpg`, { type: 'image/jpeg' }) : null),
          'image/jpeg', 0.82
        )
      })
    } catch { return null }
  }, [])

  // Right-click "Ask Pepper" — sends message + screenshot
  const handleAsk = useCallback(async (message: string) => {
    const screenshotFile = await captureScreenshot()
    window.dispatchEvent(new CustomEvent('pepper-ask', { detail: { message, screenshotFile } }))
  }, [captureScreenshot])

  // Right-click "Screenshot & Ask Pepper" — attaches screenshot, opens panel, lets user type
  const handleScreenshotAsk = useCallback(async () => {
    const screenshotFile = await captureScreenshot()
    window.dispatchEvent(new CustomEvent('pepper-screenshot', { detail: { screenshotFile } }))
  }, [captureScreenshot])

  return (
    <div className="flex h-screen overflow-hidden bg-surface-2">
      <div className="print:hidden flex flex-col self-stretch">
        <Sidebar />
      </div>

      {/* Docked-left panel */}
      {pepperMode === 'docked-left' && (
        <div className="flex-shrink-0 border-r print:hidden" style={{ width: 390, borderColor: 'var(--border)' }}>
          <AiChat mode={pepperMode} onModeChange={handleModeChange} />
        </div>
      )}

      <main className="flex-1 overflow-y-auto min-w-0">
        <Outlet />
      </main>

      {/* Docked-right panel */}
      {pepperMode === 'docked-right' && (
        <div className="flex-shrink-0 border-l print:hidden" style={{ width: 390, borderColor: 'var(--border)' }}>
          <AiChat mode={pepperMode} onModeChange={handleModeChange} />
        </div>
      )}

      {/* Floating panel */}
      {pepperMode === 'float' && (
        <AiChat mode={pepperMode} onModeChange={handleModeChange} />
      )}

      {ctxMenu && (
        <PepperContextMenu
          state={ctxMenu}
          onAsk={handleAsk}
          onScreenshotAsk={handleScreenshotAsk}
          onClose={() => setCtxMenu(null)}
        />
      )}
    </div>
  )
}
