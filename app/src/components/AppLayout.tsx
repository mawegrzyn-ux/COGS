import React, { useState, useEffect, useCallback, useRef } from 'react'
import { Outlet } from 'react-router-dom'
import Sidebar from './Sidebar'
import AiChat, { type PepperMode } from './AiChat'
import { useIsMobile, useKeyboardInset } from '../hooks/useIsMobile'
import MediaLibrary from './MediaLibrary'
import MarketSwitcher from './MarketSwitcher'
import CurrencySwitcher from './CurrencySwitcher'
import LanguageSwitcher from './LanguageSwitcher'

const PANEL_WIDTH_KEY   = 'pepper-panel-width'
const MIN_PANEL_WIDTH   = 280
const MAX_PANEL_WIDTH   = 700
const DEFAULT_PANEL_W   = 390

const PANEL_HEIGHT_KEY  = 'pepper-panel-height'
const MIN_PANEL_HEIGHT  = 200
const MAX_PANEL_HEIGHT_PCT = 0.6   // 60% of viewport
const DEFAULT_PANEL_H   = 300

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
  const isMobile      = useIsMobile()
  const keyboardInset = useKeyboardInset()

  const [ctxMenu,         setCtxMenu]         = useState<ContextMenuState | null>(null)
  // Mobile forces 'docked-bottom' which we then render as a full-viewport
  // sheet — left/right docks make no sense on a 5-inch screen. The stored
  // preference is preserved so desktop users keep their chosen dock mode
  // when they go back to desktop.
  const [pepperMode,      setPepperMode]      = useState<PepperMode>(() => {
    const stored = localStorage.getItem('pepper-mode')
    // Migrate old 'float' to 'docked-right'
    if (!stored || stored === 'float') return 'docked-right'
    return stored as PepperMode
  })
  const [pepperOpen,      setPepperOpen]      = useState(false)
  const [mediaOpen,       setMediaOpen]       = useState(false)
  const [panelWidth, setPanelWidth] = useState<number>(() =>
    parseInt(localStorage.getItem(PANEL_WIDTH_KEY) || String(DEFAULT_PANEL_W), 10)
  )
  const [panelHeight, setPanelHeight] = useState<number>(() =>
    parseInt(localStorage.getItem(PANEL_HEIGHT_KEY) || String(DEFAULT_PANEL_H), 10)
  )
  const panelWidthRef   = useRef(panelWidth)
  const panelHeightRef  = useRef(panelHeight)
  const pepperModeRef   = useRef(pepperMode)
  useEffect(() => { panelWidthRef.current  = panelWidth },  [panelWidth])
  useEffect(() => { panelHeightRef.current = panelHeight }, [panelHeight])
  useEffect(() => { pepperModeRef.current  = pepperMode },  [pepperMode])

  const handleModeChange = useCallback((m: PepperMode) => {
    setPepperMode(m)
    setPepperOpen(true)
    localStorage.setItem('pepper-mode', m)
  }, [])

  // ── Docked panel resize drag ───────────────────────────────────────────────
  const startPanelResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    const startX = e.clientX
    const startW = panelWidthRef.current
    const side   = pepperModeRef.current

    function onMove(ev: MouseEvent) {
      // docked-left: drag right edge → moving right increases width
      // docked-right: drag left edge → moving left increases width
      const dx    = side === 'docked-left' ? ev.clientX - startX : startX - ev.clientX
      const newW  = Math.max(MIN_PANEL_WIDTH, Math.min(MAX_PANEL_WIDTH, startW + dx))
      panelWidthRef.current = newW
      setPanelWidth(newW)
    }
    function onUp() {
      localStorage.setItem(PANEL_WIDTH_KEY, String(panelWidthRef.current))
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup',   onUp)
    }

    document.body.style.cursor     = 'col-resize'
    document.body.style.userSelect = 'none'
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup',   onUp)
  }, [])

  // ── Bottom panel resize drag ────────────────────────────────────────────────
  const startBottomResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    const startY = e.clientY
    const startH = panelHeightRef.current
    const maxH   = Math.floor(window.innerHeight * MAX_PANEL_HEIGHT_PCT)

    function onMove(ev: MouseEvent) {
      // Dragging up → panel grows taller
      const dy   = startY - ev.clientY
      const newH = Math.max(MIN_PANEL_HEIGHT, Math.min(maxH, startH + dy))
      panelHeightRef.current = newH
      setPanelHeight(newH)
    }
    function onUp() {
      localStorage.setItem(PANEL_HEIGHT_KEY, String(panelHeightRef.current))
      document.body.style.cursor     = ''
      document.body.style.userSelect = ''
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup',   onUp)
    }

    document.body.style.cursor     = 'row-resize'
    document.body.style.userSelect = 'none'
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup',   onUp)
  }, [])

  const handleContextMenu = useCallback((e: MouseEvent) => {
    // If a React onContextMenu handler already claimed this event (called e.preventDefault()),
    // bail out — let that component's own context menu show (e.g. ME row Edit/Delete menu)
    if (e.defaultPrevented) return

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

  const isBottom = pepperMode === 'docked-bottom'
  const showPepper = pepperOpen

  const pepperToggle = useCallback(() => setPepperOpen(o => !o), [])

  // Expose the current Pepper dock dimensions as CSS custom properties on the
  // document root so any widget that enters a fullscreen mode (e.g. MarketMap)
  // can respect them and avoid covering the chat panel. Values update live as
  // the user resizes or toggles Pepper.
  //
  // Usage from a fullscreen overlay:
  //   inset: 0 var(--pepper-right) var(--pepper-bottom) var(--pepper-left);
  useEffect(() => {
    const root = document.documentElement.style
    const leftPx   = showPepper && pepperMode === 'docked-left'   ? `${panelWidth}px`  : '0px'
    const rightPx  = showPepper && pepperMode === 'docked-right'  ? `${panelWidth}px`  : '0px'
    const bottomPx = showPepper && pepperMode === 'docked-bottom' ? `${panelHeight}px` : '0px'
    root.setProperty('--pepper-left',   leftPx)
    root.setProperty('--pepper-right',  rightPx)
    root.setProperty('--pepper-bottom', bottomPx)
    return () => {
      root.removeProperty('--pepper-left')
      root.removeProperty('--pepper-right')
      root.removeProperty('--pepper-bottom')
    }
  }, [showPepper, pepperMode, panelWidth, panelHeight])

  // ── Keyboard shortcut: Ctrl+Shift+P (or Cmd+Shift+P) → open/focus Pepper ──
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'p') {
        e.preventDefault()
        if (!pepperOpen) {
          setPepperOpen(true) // opening auto-focuses via AiChat useEffect
        } else {
          // Already open — dispatch focus event so AiChat re-focuses the textarea
          window.dispatchEvent(new CustomEvent('pepper-focus'))
        }
      }
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [pepperOpen])

  /*
    Layout approach for preserving AiChat across mode switches (never unmount):

    For docked-left / docked-right:
      Outer flex row: sidebar | [pepper order:1] | main-col order:2 | [pepper order:3]
      The single AiChat wrapper uses `order` to position itself before or after main.

    For docked-bottom:
      The main-col becomes a flex-col containing: <main> + <pepper-bottom-slot>.
      The AiChat wrapper is placed inside the main-col using order:2 (below main@1).

    The key: AiChat is always rendered inside one consistent wrapper div that is always
    mounted. Only CSS properties (order, width/height, display) change — no unmount.
  */

  // Pepper wrapper position depends on mode.
  // On mobile (< sm breakpoint) we render Pepper as a full-viewport fixed
  // overlay regardless of the user's stored dock mode — phones are too
  // narrow for a side-docked panel. The sheet rides up above the sidebar /
  // main content with z-50. `keyboardInset` keeps the chat input above
  // the on-screen keyboard via visualViewport.
  const pepperWrapperStyle: React.CSSProperties = isMobile
    ? (showPepper
        ? {
            position:    'fixed',
            inset:       0,
            bottom:      keyboardInset,
            zIndex:      50,
            background:  'var(--surface)',
          }
        : { display: 'none' })
    : isBottom
    ? {
        order:       2,       // after main inside the column
        height:      showPepper ? panelHeight : 0,
        width:       '100%',
        borderColor: 'var(--border)',
      }
    : {
        order:       pepperMode === 'docked-left' ? 1 : 3,
        width:       showPepper ? panelWidth : 0,
        borderColor: 'var(--border)',
      }

  const pepperWrapperClass = [
    'relative flex-shrink-0 print:hidden',
    !isMobile && showPepper && pepperMode === 'docked-left'  ? 'border-r' : '',
    !isMobile && showPepper && pepperMode === 'docked-right' ? 'border-l' : '',
    !isMobile && showPepper && isBottom                      ? 'border-t' : '',
    !showPepper                                              ? 'overflow-hidden' : '',
  ].filter(Boolean).join(' ')

  return (
    <div className="flex h-screen overflow-hidden bg-surface-2">
      <div className="print:hidden flex flex-col self-stretch">
        <Sidebar />
      </div>

      {/*
        Inner content area — flex-row for left/right modes, flex-col for bottom mode.
        AiChat wrapper and main are always siblings; CSS order repositions them.
      */}
      <div className={`flex flex-1 min-w-0 ${isBottom ? 'flex-col' : 'flex-row'}`}>
        {/* Main content — order:2 in row mode (left=1, right=3), order:1 in col mode */}
        <main className="flex-1 overflow-y-auto min-w-0 flex flex-col" style={{ order: isBottom ? 1 : 2 }}>
          {/* Thin top bar — global Market + Display Currency + Language switchers,
              each prefixed with a label so the role of every dropdown is obvious. */}
          <div className="flex-shrink-0 flex items-center justify-end gap-4 px-6 py-2 border-b border-border bg-surface print:hidden">
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-medium text-text-3 hidden sm:inline">Market</span>
              <MarketSwitcher />
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-medium text-text-3 hidden sm:inline">Show prices in</span>
              <CurrencySwitcher />
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-medium text-text-3 hidden sm:inline">Language</span>
              <LanguageSwitcher />
            </div>
          </div>
          <div className="flex-1 min-h-0">
            <Outlet />
          </div>
        </main>

        {/*
          Single always-mounted AiChat wrapper — CSS order + width/height change position.
          Component never unmounts on mode switch, preserving conversation state.
        */}
        <div className={pepperWrapperClass} style={pepperWrapperStyle}>
          <AiChat
            mode={pepperMode}
            onModeChange={handleModeChange}
            pepperOpen={pepperOpen}
            onToggle={pepperToggle}
            isMobile={isMobile}
          />

          {/* Resize handles — desktop only. On mobile the sheet is full-viewport
              so there's nothing to resize. */}
          {!isMobile && pepperMode === 'docked-left' && showPepper && (
            <div
              onMouseDown={startPanelResize}
              className="absolute top-0 right-0 h-full z-20 flex items-center justify-center group"
              style={{ width: 6, cursor: 'col-resize' }}
              title="Drag to resize"
            >
              <div className="w-0.5 h-12 rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                style={{ background: 'var(--accent)' }} />
            </div>
          )}

          {/* Resize handle — left edge (docked-right) */}
          {!isMobile && pepperMode === 'docked-right' && showPepper && (
            <div
              onMouseDown={startPanelResize}
              className="absolute top-0 left-0 h-full z-20 flex items-center justify-center group"
              style={{ width: 6, cursor: 'col-resize' }}
              title="Drag to resize"
            >
              <div className="w-0.5 h-12 rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                style={{ background: 'var(--accent)' }} />
            </div>
          )}

          {/* Resize handle — top edge (docked-bottom) */}
          {!isMobile && isBottom && showPepper && (
            <div
              onMouseDown={startBottomResize}
              className="absolute top-0 left-0 w-full z-20 flex justify-center items-center group"
              style={{ height: 6, cursor: 'row-resize' }}
              title="Drag to resize"
            >
              <div className="h-0.5 w-12 rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                style={{ background: 'var(--accent)' }} />
            </div>
          )}
        </div>
      </div>

      {ctxMenu && (
        <PepperContextMenu
          state={ctxMenu}
          onAsk={handleAsk}
          onScreenshotAsk={handleScreenshotAsk}
          onClose={() => setCtxMenu(null)}
        />
      )}

      {/* Global Media Library modal — triggered from sidebar button */}
      <MediaLibrary
        open={mediaOpen}
        onClose={() => setMediaOpen(false)}
      />

      {/* ── Pepper floating tongue tab ──────────────────────────────────────── */}
      <button
        onClick={pepperToggle}
        className={[
          'pepper-tongue pepper-ui fixed z-50 flex items-center gap-1.5 rounded-t-lg shadow-lg border border-b-0 transition-all duration-200 cursor-pointer select-none print:hidden',
          pepperOpen
            ? 'bg-accent text-white border-accent shadow-accent/20'
            : 'bg-surface text-accent border-border hover:bg-accent-dim hover:shadow-md',
        ].join(' ')}
        style={{
          bottom: 0,
          left: '50%',
          transform: 'translateX(-50%)',
          padding: '10px 28px 6px 20px',
          fontSize: 24,
        }}
        title={pepperOpen ? 'Close Pepper' : 'Open Pepper'}
      >
        {/* Pepper icon */}
        <svg viewBox="-100 -100 200 200" width="28" height="28" xmlns="http://www.w3.org/2000/svg" className="shrink-0">
          <circle cx="0" cy="0" r="66" fill="currentColor"/>
          <g fill="currentColor">
            {[0,60,120,180,240,300].map(deg => (
              <rect key={deg} x="-10" y="-82" width="20" height="22" rx="4" transform={`rotate(${deg})`}/>
            ))}
          </g>
          <circle cx="0" cy="0" r="44" fill={pepperOpen ? 'var(--accent)' : 'var(--surface)'}/>
          <circle cx="0" cy="0" r="26" fill="currentColor"/>
        </svg>
        <span className="font-semibold tracking-wide" style={{ lineHeight: 1 }}>Pepper</span>
      </button>
    </div>
  )
}
