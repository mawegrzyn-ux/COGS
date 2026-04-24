import { useState, useEffect, useMemo, useCallback } from 'react'
import { PepperHelpButton } from '../components/ui'
import { useDashboardData, DashboardDataProvider } from '../dashboard/DashboardData'
import { WIDGET_COMPONENTS, WidgetLabelProvider, WidgetEditingProvider } from '../dashboard/widgets'
import { TEMPLATES, WIDGET_REGISTRY, getTemplate, DEFAULT_TEMPLATE_ID } from '../dashboard/templates'
import {
  DashboardConfig, SlotConfig, WidgetId, WidgetSize, WidgetHeight, sizeSpan, heightSpan,
} from '../dashboard/types'

// ── PWA install banner (preserved from old dashboard) ─────────────────────────

function PwaInstallBanner() {
  const [prompt, setPrompt] = useState<any>(null)
  const [dismissed, setDismissed] = useState(() => localStorage.getItem('pwa-banner-dismissed') === '1')
  useEffect(() => {
    const handler = (e: Event) => { e.preventDefault(); setPrompt(e) }
    window.addEventListener('beforeinstallprompt', handler as EventListener)
    return () => window.removeEventListener('beforeinstallprompt', handler as EventListener)
  }, [])
  if (!prompt || dismissed) return null
  async function install() {
    prompt.prompt()
    const { outcome } = await prompt.userChoice
    if (outcome === 'accepted') setPrompt(null)
  }
  function dismiss() { setDismissed(true); localStorage.setItem('pwa-banner-dismissed', '1') }
  return (
    <div className="flex items-center gap-3 bg-accent-dim border border-accent/30 rounded-xl px-4 py-3 text-sm">
      <span className="text-lg flex-shrink-0">📲</span>
      <div className="flex-1 min-w-0">
        <span className="font-semibold text-text-1">Install Menu COGS</span>
        <span className="text-text-2 ml-2">Add to your home screen or desktop for quick access.</span>
      </div>
      <button onClick={install} className="btn-primary px-3 py-1.5 text-xs whitespace-nowrap">Install app</button>
      <button onClick={dismiss} className="text-text-3 hover:text-text-1" title="Dismiss">
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/>
        </svg>
      </button>
    </div>
  )
}

// ── Persistence ───────────────────────────────────────────────────────────────

const STORAGE_KEY = 'cogs-dashboard-config-v1'

function loadConfig(): DashboardConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as DashboardConfig
      if (parsed?.slots && Array.isArray(parsed.slots)) return parsed
    }
  } catch { /* fall through */ }
  const tpl = getTemplate(DEFAULT_TEMPLATE_ID)
  return { templateId: tpl.id, slots: [...tpl.slots] }
}

function saveConfig(cfg: DashboardConfig) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg))
}

// ── Widget chrome (render + edit mode controls) ───────────────────────────────

function WidgetShell({
  slot, index, total, editing, onMove, onRemove, onResize, onRename, onResizeHeight,
  draggingIndex, dragOverIndex, onDragStart, onDragOverSlot, onDragLeaveSlot, onDropSlot, onDragEnd,
}: {
  slot: SlotConfig
  index: number
  total: number
  editing: boolean
  onMove: (from: number, to: number) => void
  onRemove: (idx: number) => void
  onResize: (idx: number, size: WidgetSize) => void
  onRename: (idx: number, label: string) => void
  onResizeHeight: (idx: number, h: WidgetHeight) => void
  draggingIndex: number | null
  dragOverIndex: number | null
  onDragStart: (idx: number) => void
  onDragOverSlot: (idx: number) => void
  onDragLeaveSlot: () => void
  onDropSlot: (idx: number) => void
  onDragEnd: () => void
}) {
  const meta = WIDGET_REGISTRY[slot.widgetId]
  const Component = WIDGET_COMPONENTS[slot.widgetId]
  if (!Component || !meta) return null

  // Resolve the effective row-span: slot override → widget registry default → 1.
  const effectiveRowSpan: WidgetHeight = (slot.rowSpan ?? meta.defaultRowSpan ?? 1)
  const rowSpanClass = heightSpan[effectiveRowSpan]
  const allowedRowSpans = meta.allowedRowSpans ?? [1]

  // Open this widget in a standalone window. Shared localStorage + cookies
  // mean the popped-out window stays authenticated and picks up the user's
  // market selection automatically.
  function popOut() {
    const qs = new URLSearchParams()
    if (slot.customLabel) qs.set('label', slot.customLabel)
    const url = `/widget/${encodeURIComponent(slot.widgetId)}${qs.toString() ? `?${qs}` : ''}`
    window.open(url, `cogs-widget-${slot.widgetId}-${index}`, 'popup=yes,width=900,height=700,resizable=yes,scrollbars=yes')
  }

  const isBeingDragged = draggingIndex === index
  const isDropTarget   = editing && dragOverIndex === index && draggingIndex !== null && draggingIndex !== index

  return (
    <div
      className={`${sizeSpan[slot.size]} ${rowSpanClass} relative group ${
        editing ? 'cursor-grab active:cursor-grabbing' : ''
      } ${isBeingDragged ? 'opacity-40' : ''} ${isDropTarget ? 'ring-2 ring-accent ring-offset-2 ring-offset-surface-2' : ''}`}
      draggable={editing}
      onDragStart={e => {
        if (!editing) return
        e.dataTransfer.effectAllowed = 'move'
        // Firefox requires some data to be set for the drag to start.
        try { e.dataTransfer.setData('text/plain', String(index)) } catch { /* ignore */ }
        onDragStart(index)
      }}
      onDragOver={e => {
        if (!editing || draggingIndex === null) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
        onDragOverSlot(index)
      }}
      onDragLeave={() => {
        if (!editing) return
        onDragLeaveSlot()
      }}
      onDrop={e => {
        if (!editing) return
        e.preventDefault()
        onDropSlot(index)
      }}
      onDragEnd={() => {
        if (!editing) return
        onDragEnd()
      }}
    >
      {editing && (
        <div className="absolute inset-0 rounded-xl border-2 border-dashed border-accent/40 bg-accent-dim/30 z-10 pointer-events-none" />
      )}
      <div className={`h-full relative flex flex-col ${editing ? 'ring-2 ring-accent/20 rounded-xl' : ''}`}>
        {/* The widget renders its own card with its own title. When the user
            has set a custom label, WidgetLabelProvider injects it so the
            widget's internal label is REPLACED (not duplicated). */}
        <WidgetEditingProvider editing={editing}>
          <WidgetLabelProvider label={slot.customLabel}>
            <Component />
          </WidgetLabelProvider>
        </WidgetEditingProvider>

        {/* Pop-out button — fades in on widget hover (Tailwind group-hover
            from the outer div). Hidden in edit mode because the toolbar
            already has its own pop-out button. */}
        {!editing && (
          <button
            onClick={popOut}
            title="Open in a standalone window"
            aria-label="Open widget in a standalone window"
            className="absolute top-2 right-2 z-10 w-7 h-7 rounded bg-surface/80 hover:bg-surface border border-border text-text-2 hover:text-text-1 opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity flex items-center justify-center text-sm shadow-sm"
          >
            ⤢
          </button>
        )}

        {editing && (
          <>
            {/* Rename input — floats at top-left of the editing chrome. The
                custom label replaces the widget's internal title live via the
                WidgetLabelProvider; empty string reverts to the default. */}
            <div className="absolute top-2 left-2 z-20 bg-surface border border-border rounded-lg shadow-sm flex items-center">
              {/* Drag handle — visual hint that the whole tile is draggable. */}
              <span
                className="px-2 py-1 text-text-3 cursor-grab active:cursor-grabbing select-none"
                title="Drag to reorder"
                aria-label="Drag handle"
              >
                ⠿
              </span>
              <input
                type="text"
                value={slot.customLabel ?? ''}
                onChange={e => onRename(index, e.target.value)}
                placeholder={`Rename… (default: ${meta.label})`}
                className="w-56 bg-transparent border-0 focus:outline-none focus:ring-0 rounded-lg px-2 py-1 text-xs text-text-1 placeholder:text-text-3"
                aria-label="Widget label"
                // Stop drag start when focus is in the input so the user can type.
                onDragStart={e => e.preventDefault()}
              />
            </div>

            {/* Editing toolbar — pop-out, reorder, resize, height, remove */}
            <div className="absolute top-2 right-2 z-20 flex items-center gap-1 bg-surface border border-border rounded-lg shadow-sm p-1">
              <button title="Open in a standalone window"
                onClick={popOut}
                className="w-7 h-7 rounded hover:bg-surface-2 text-text-2 text-sm">⤢</button>
              <button title="Move up" disabled={index === 0}
                onClick={() => onMove(index, index - 1)}
                className="w-7 h-7 rounded hover:bg-surface-2 disabled:opacity-30 text-text-2 text-sm">↑</button>
              <button title="Move down" disabled={index === total - 1}
                onClick={() => onMove(index, index + 1)}
                className="w-7 h-7 rounded hover:bg-surface-2 disabled:opacity-30 text-text-2 text-sm">↓</button>
              {meta.allowedSizes.length > 1 && (
                <select
                  value={slot.size}
                  onChange={e => onResize(index, e.target.value as WidgetSize)}
                  className="text-xs border border-border rounded px-1 py-0.5 bg-surface text-text-2"
                  title="Change width"
                >
                  {meta.allowedSizes.map(s => (
                    <option key={s} value={s}>
                      {s === 'sm' ? '¼ W' : s === 'md' ? '½ W' : s === 'lg' ? '¾ W' : 'Full W'}
                    </option>
                  ))}
                </select>
              )}
              {allowedRowSpans.length > 1 && (
                <select
                  value={effectiveRowSpan}
                  onChange={e => onResizeHeight(index, Number(e.target.value) as WidgetHeight)}
                  className="text-xs border border-border rounded px-1 py-0.5 bg-surface text-text-2"
                  title="Change height (row span)"
                >
                  {allowedRowSpans.map(h => (
                    <option key={h} value={h}>{h}× H</option>
                  ))}
                </select>
              )}
              <button title="Remove" onClick={() => onRemove(index)}
                className="w-7 h-7 rounded hover:bg-red-50 text-red-500 text-sm">✕</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ── Add-widget dropdown ───────────────────────────────────────────────────────

function AddWidgetButton({ onAdd, existing }: {
  onAdd: (id: WidgetId) => void
  existing: WidgetId[]
}) {
  const [open, setOpen] = useState(false)
  // Allow adding the same widget more than once (user might want two KPIs showing different periods later).
  // For now, hide ones already on the board to keep it simple.
  const available = Object.values(WIDGET_REGISTRY).filter(m => !existing.includes(m.id))
  return (
    <div className="relative">
      <button onClick={() => setOpen(o => !o)} className="btn-outline text-sm py-1.5 px-3">
        + Add widget
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute top-full right-0 mt-1 w-80 bg-surface border border-border rounded-lg shadow-lg z-50 py-1 max-h-96 overflow-y-auto">
            {available.length === 0 ? (
              <div className="p-4 text-center text-sm text-text-3">All widgets added</div>
            ) : available.map(m => (
              <button key={m.id}
                onClick={() => { onAdd(m.id); setOpen(false) }}
                className="w-full text-left px-3 py-2 hover:bg-surface-2">
                <div className="text-sm font-medium text-text-1">{m.label}</div>
                <div className="text-xs text-text-3">{m.description}</div>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

// ── Main Dashboard ────────────────────────────────────────────────────────────

function DashboardInner() {
  const { loading, refreshing, lastRefresh, refresh } = useDashboardData()
  const [config, setConfig] = useState<DashboardConfig>(() => loadConfig())
  const [editing, setEditing] = useState(false)

  // Drag-and-drop state (edit mode only)
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null)
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null)

  // Persist whenever config changes
  useEffect(() => { saveConfig(config) }, [config])

  const applyTemplate = useCallback((templateId: string) => {
    const tpl = getTemplate(templateId)
    setConfig({ templateId: tpl.id, slots: [...tpl.slots] })
  }, [])

  const moveSlot = useCallback((from: number, to: number) => {
    setConfig(prev => {
      if (to < 0 || to >= prev.slots.length) return prev
      const next = [...prev.slots]
      const [item] = next.splice(from, 1)
      next.splice(to, 0, item)
      return { ...prev, slots: next }
    })
  }, [])

  const removeSlot = useCallback((idx: number) => {
    setConfig(prev => ({ ...prev, slots: prev.slots.filter((_, i) => i !== idx) }))
  }, [])

  const resizeSlot = useCallback((idx: number, size: WidgetSize) => {
    setConfig(prev => ({
      ...prev,
      slots: prev.slots.map((s, i) => i === idx ? { ...s, size } : s),
    }))
  }, [])

  const resizeSlotHeight = useCallback((idx: number, rowSpan: WidgetHeight) => {
    setConfig(prev => ({
      ...prev,
      slots: prev.slots.map((s, i) => i === idx ? { ...s, rowSpan } : s),
    }))
  }, [])

  // Drag-and-drop: mutate slots by moving `from` before `to`.
  const handleDrop = useCallback((toIndex: number) => {
    const from = draggingIndex
    if (from == null || from === toIndex) {
      setDraggingIndex(null)
      setDragOverIndex(null)
      return
    }
    setConfig(prev => {
      const next = [...prev.slots]
      const [item] = next.splice(from, 1)
      // Adjust target for the removed item.
      const adjustedTo = from < toIndex ? toIndex - 1 : toIndex
      next.splice(adjustedTo, 0, item)
      return { ...prev, slots: next }
    })
    setDraggingIndex(null)
    setDragOverIndex(null)
  }, [draggingIndex])

  // Rename stores as trimmed string; empty string clears the override so the
  // widget falls back to its registry label.
  const renameSlot = useCallback((idx: number, label: string) => {
    setConfig(prev => ({
      ...prev,
      slots: prev.slots.map((s, i) =>
        i === idx
          ? { ...s, customLabel: label.trim() ? label : undefined }
          : s
      ),
    }))
  }, [])

  const addWidget = useCallback((id: WidgetId) => {
    const meta = WIDGET_REGISTRY[id]
    setConfig(prev => ({ ...prev, slots: [...prev.slots, { widgetId: id, size: meta.defaultSize }] }))
  }, [])

  const resetToTemplate = useCallback(() => {
    if (!confirm('Reset dashboard to the default layout for this template?')) return
    applyTemplate(config.templateId)
  }, [applyTemplate, config.templateId])

  const existingIds = useMemo(() => config.slots.map(s => s.widgetId), [config.slots])
  const now = lastRefresh.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

  return (
    <div className="min-h-screen bg-surface-2">
      <main className="max-w-7xl mx-auto px-6 py-8 space-y-6">
        <PwaInstallBanner />

        {/* Header */}
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-start gap-2">
            <div>
              <h1 className="text-2xl font-bold text-text-1">Dashboard</h1>
              <p className="text-text-3 text-sm mt-0.5">Customise your view with templates and widgets</p>
            </div>
            <PepperHelpButton
              prompt="Walk me through the new configurable Dashboard. Explain templates, how to add widgets, and how the market switcher scopes the data."
              size={14}
            />
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {editing && (
              <>
                <label className="text-xs text-text-3 font-medium uppercase tracking-wide">Template</label>
                <select
                  value={config.templateId}
                  onChange={e => applyTemplate(e.target.value)}
                  className="text-sm border border-border rounded-lg px-2 py-1.5 bg-surface"
                >
                  {TEMPLATES.map(t => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
                <AddWidgetButton onAdd={addWidget} existing={existingIds} />
                <button onClick={resetToTemplate} className="btn-outline text-sm py-1.5 px-3">↺ Reset</button>
              </>
            )}
            <button
              onClick={() => setEditing(e => !e)}
              className={`text-sm py-1.5 px-3 rounded-lg border transition-colors ${
                editing
                  ? 'bg-accent text-white border-accent hover:bg-accent-mid'
                  : 'btn-outline'
              }`}
            >
              {editing ? '✓ Done' : '✎ Customise'}
            </button>
            <button onClick={() => refresh()} disabled={refreshing} className="btn-outline text-sm py-1.5 px-3">
              {refreshing ? 'Refreshing…' : `Updated ${now}`}
            </button>
          </div>
        </div>

        {/* Template description — only shown in edit mode */}
        {editing && (
          <div className="text-xs text-text-3 italic">
            {getTemplate(config.templateId).description}
          </div>
        )}

        {/* Widget grid */}
        {loading && config.slots.length === 0 ? (
          <div className="grid grid-cols-12 gap-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="col-span-12 sm:col-span-6 md:col-span-3 h-28 bg-surface-2 rounded-xl animate-pulse" />
            ))}
          </div>
        ) : config.slots.length === 0 ? (
          <div className="card p-8 text-center text-text-3">
            <p className="text-sm mb-3">This dashboard is empty.</p>
            <AddWidgetButton onAdd={addWidget} existing={existingIds} />
          </div>
        ) : (
          <div
            className="grid grid-cols-12 gap-4"
            style={{
              // Fixed-ish row height with dense flow. "dense" lets smaller
              // widgets backfill gaps left by tall row-span widgets so the
              // grid stays compact rather than leaving holes.
              gridAutoRows: 'minmax(160px, auto)',
              gridAutoFlow: 'row dense',
            }}
          >
            {config.slots.map((slot, i) => (
              <WidgetShell
                key={`${slot.widgetId}-${i}`}
                slot={slot}
                index={i}
                total={config.slots.length}
                editing={editing}
                onMove={moveSlot}
                onRemove={removeSlot}
                onResize={resizeSlot}
                onRename={renameSlot}
                onResizeHeight={resizeSlotHeight}
                draggingIndex={draggingIndex}
                dragOverIndex={dragOverIndex}
                onDragStart={setDraggingIndex}
                onDragOverSlot={setDragOverIndex}
                onDragLeaveSlot={() => setDragOverIndex(prev => prev)} // keep — leave can fire between child elements
                onDropSlot={handleDrop}
                onDragEnd={() => { setDraggingIndex(null); setDragOverIndex(null) }}
              />
            ))}
          </div>
        )}
      </main>
    </div>
  )
}

export default function DashboardPage() {
  return (
    <DashboardDataProvider>
      <DashboardInner />
    </DashboardDataProvider>
  )
}
