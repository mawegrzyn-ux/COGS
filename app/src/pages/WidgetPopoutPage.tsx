import { useParams, useSearchParams } from 'react-router-dom'
import { DashboardDataProvider } from '../dashboard/DashboardData'
import { WIDGET_COMPONENTS, WidgetLabelProvider } from '../dashboard/widgets'
import { WIDGET_REGISTRY } from '../dashboard/templates'
import { WidgetId } from '../dashboard/types'

// Renders a single dashboard widget in a minimal standalone layout, intended
// for use from `window.open('/widget/<id>')` inside a small popup. Shares
// auth + market selection with the launching window (same origin, same
// localStorage + cookies). No sidebar, no Pepper dock — just the widget.
export default function WidgetPopoutPage() {
  const { widgetId } = useParams<{ widgetId: string }>()
  const [searchParams] = useSearchParams()
  const customLabel = searchParams.get('label')

  const id = widgetId as WidgetId | undefined
  const meta = id ? WIDGET_REGISTRY[id] : null
  const Component = id ? WIDGET_COMPONENTS[id] : null

  if (!id || !meta || !Component) {
    return (
      <div className="min-h-screen bg-surface-2 flex items-center justify-center p-6">
        <div className="card p-6 max-w-md text-center">
          <h1 className="text-lg font-bold text-text-1 mb-2">Unknown widget</h1>
          <p className="text-sm text-text-3">
            No widget registered under the id <code className="text-xs bg-surface-2 px-1 rounded">{widgetId}</code>.
          </p>
          <button
            onClick={() => window.close()}
            className="btn-outline mt-4 text-sm px-4 py-1.5"
          >
            Close window
          </button>
        </div>
      </div>
    )
  }

  const title = customLabel?.trim() || meta.label
  document.title = `${title} — Menu COGS`

  return (
    <DashboardDataProvider>
      <div className="min-h-screen bg-surface-2 flex flex-col">
        <header className="bg-surface border-b border-border px-4 py-2 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-xs font-semibold uppercase tracking-wider text-text-3">Widget</span>
            <span className="text-sm font-semibold text-text-1 truncate">{title}</span>
            {customLabel && customLabel !== meta.label && (
              <span className="text-[10px] font-medium text-text-3 px-1.5 py-0.5 rounded bg-surface-2 border border-border">
                {meta.label}
              </span>
            )}
          </div>
          <button
            onClick={() => window.close()}
            className="text-xs text-text-3 hover:text-text-1 px-2 py-1 rounded hover:bg-surface-2 transition-colors"
            title="Close window"
            aria-label="Close window"
          >
            ✕ Close
          </button>
        </header>

        <main className="flex-1 p-4 overflow-auto">
          <div className="h-full">
            <WidgetLabelProvider label={customLabel}>
              <Component />
            </WidgetLabelProvider>
          </div>
        </main>
      </div>
    </DashboardDataProvider>
  )
}
