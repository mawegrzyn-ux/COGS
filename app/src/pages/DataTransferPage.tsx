import { useState, useEffect, useCallback, useRef } from 'react'
import { useApi } from '../hooks/useApi'
import { useAuth0 } from '@auth0/auth0-react'
import { Spinner } from '../components/ui'

const API_BASE = import.meta.env.VITE_API_URL || '/api'

interface TableInfo {
  name: string
  group: string
  rows: number
  exists: boolean
}

interface ImportDetail {
  table: string
  rows_imported: number
  rows_in_file: number
  status: string
}

type Phase = 'idle' | 'exporting' | 'importing' | 'done'

export default function DataTransferPage() {
  const api = useApi()
  const { getAccessTokenSilently } = useAuth0()
  const [tables, setTables] = useState<TableInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [phase, setPhase] = useState<Phase>('idle')
  const [toast, setToast] = useState<{ msg: string; type: 'ok' | 'err' } | null>(null)

  // Export state
  const [exportCompact, setExportCompact] = useState(false)
  const [selectedGroups, setSelectedGroups] = useState<Set<string>>(new Set())

  // Import state
  const [importFile, setImportFile] = useState<File | null>(null)
  const [importDryRun, setImportDryRun] = useState(false)
  const [importResult, setImportResult] = useState<{
    success: boolean
    dry_run: boolean
    tables_imported: number
    total_rows: number
    details: ImportDetail[]
  } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const flash = useCallback((msg: string, type: 'ok' | 'err' = 'ok') => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 4000)
  }, [])

  useEffect(() => {
    api.get<{ tables: TableInfo[] }>('/data-transfer/tables')
      .then(d => {
        setTables(d.tables)
        const groups = new Set(d.tables.map(t => t.group))
        setSelectedGroups(groups)
      })
      .catch(() => flash('Failed to load table info', 'err'))
      .finally(() => setLoading(false))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const groups = [...new Set(tables.map(t => t.group))]
  const totalRows = tables.reduce((s, t) => s + t.rows, 0)
  const selectedTables = tables.filter(t => selectedGroups.has(t.group))
  const selectedRows = selectedTables.reduce((s, t) => s + t.rows, 0)

  function toggleGroup(g: string) {
    setSelectedGroups(prev => {
      const next = new Set(prev)
      next.has(g) ? next.delete(g) : next.add(g)
      return next
    })
  }

  function selectAll() {
    setSelectedGroups(new Set(groups))
  }

  function selectNone() {
    setSelectedGroups(new Set())
  }

  async function handleExport() {
    setPhase('exporting')
    try {
      let token = ''
      try { token = await getAccessTokenSilently() } catch {}

      const body: Record<string, unknown> = { compact: exportCompact }
      if (selectedGroups.size < groups.length) {
        body.tables = selectedTables.map(t => t.name)
      }

      const res = await fetch(`${API_BASE}/data-transfer/export`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(body),
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: { message: 'Export failed' } }))
        throw new Error(err.error?.message || 'Export failed')
      }

      const disposition = res.headers.get('Content-Disposition') || ''
      const match = disposition.match(/filename="?([^"]+)"?/)
      const filename = match?.[1] || `mcogs-export-${new Date().toISOString().slice(0, 10)}.json`

      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      a.click()
      URL.revokeObjectURL(url)

      flash(`Exported ${selectedTables.length} tables (${(blob.size / 1024 / 1024).toFixed(1)} MB)`)
    } catch (e: any) {
      flash(e.message || 'Export failed', 'err')
    } finally {
      setPhase('idle')
    }
  }

  async function handleImport() {
    if (!importFile) return
    setPhase('importing')
    setImportResult(null)
    try {
      let token = ''
      try { token = await getAccessTokenSilently() } catch {}

      const formData = new FormData()
      formData.append('file', importFile)

      const params = new URLSearchParams()
      if (importDryRun) params.set('dry_run', 'true')

      const res = await fetch(`${API_BASE}/data-transfer/import?${params}`, {
        method: 'POST',
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: formData,
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error?.message || 'Import failed')

      setImportResult(data)
      setPhase('done')
      flash(
        data.dry_run
          ? `Dry run complete — ${data.tables_imported} tables, ${data.total_rows} rows would be imported`
          : `Imported ${data.tables_imported} tables, ${data.total_rows} rows`,
        'ok'
      )
    } catch (e: any) {
      flash(e.message || 'Import failed', 'err')
      setPhase('idle')
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Spinner />
      </div>
    )
  }

  return (
    <div className="p-6 max-w-5xl">
      {/* Toast */}
      {toast && (
        <div className={`fixed top-4 right-4 z-[9999] px-4 py-3 rounded-lg shadow-lg text-sm font-medium text-white
          ${toast.type === 'ok' ? 'bg-green-600' : 'bg-red-600'}`}>
          {toast.msg}
        </div>
      )}

      <div className="mb-6">
        <h2 className="text-lg font-bold text-text-1">Data Transfer</h2>
        <p className="text-sm text-text-3 mt-1">
          Export your entire COGS database for backup or migration to another instance.
          Import a previously exported file to restore or clone data.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* ── Export Card ──────────────────────────────────────── */}
        <div className="card p-5">
          <div className="flex items-center gap-2 mb-4">
            <span className="text-xl">📤</span>
            <h3 className="text-sm font-bold text-text-1">Export</h3>
          </div>

          <p className="text-xs text-text-3 mb-4">
            Download a JSON snapshot of your database. Excludes user accounts, AI logs, and audit history.
          </p>

          {/* Group selection */}
          <div className="mb-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-text-2">Select data groups</span>
              <div className="flex gap-2">
                <button onClick={selectAll} className="text-xs text-accent hover:underline">All</button>
                <button onClick={selectNone} className="text-xs text-accent hover:underline">None</button>
              </div>
            </div>
            <div className="space-y-1 max-h-64 overflow-y-auto">
              {groups.map(g => {
                const groupTables = tables.filter(t => t.group === g)
                const groupRows = groupTables.reduce((s, t) => s + t.rows, 0)
                return (
                  <label
                    key={g}
                    className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-surface-2 cursor-pointer text-sm"
                  >
                    <input
                      type="checkbox"
                      checked={selectedGroups.has(g)}
                      onChange={() => toggleGroup(g)}
                      className="accent-[var(--accent)]"
                    />
                    <span className="flex-1 text-text-1">{g}</span>
                    <span className="text-xs text-text-3">{groupTables.length} tables</span>
                    <span className="text-xs text-text-3 w-16 text-right">{groupRows.toLocaleString()} rows</span>
                  </label>
                )
              })}
            </div>
          </div>

          {/* Options */}
          <label className="flex items-center gap-2 text-xs text-text-2 mb-4 cursor-pointer">
            <input
              type="checkbox"
              checked={exportCompact}
              onChange={e => setExportCompact(e.target.checked)}
              className="accent-[var(--accent)]"
            />
            Compact JSON (smaller file, not human-readable)
          </label>

          {/* Summary + button */}
          <div className="flex items-center justify-between pt-3 border-t border-border">
            <span className="text-xs text-text-3">
              {selectedTables.length} of {tables.length} tables · {selectedRows.toLocaleString()} rows
            </span>
            <button
              onClick={handleExport}
              disabled={phase !== 'idle' || selectedGroups.size === 0}
              className="btn-primary px-4 py-2 text-sm disabled:opacity-50"
            >
              {phase === 'exporting' ? (
                <span className="flex items-center gap-2">
                  <span className="inline-block w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Exporting…
                </span>
              ) : (
                'Download Export'
              )}
            </button>
          </div>
        </div>

        {/* ── Import Card ──────────────────────────────────────── */}
        <div className="card p-5">
          <div className="flex items-center gap-2 mb-4">
            <span className="text-xl">📥</span>
            <h3 className="text-sm font-bold text-text-1">Import</h3>
          </div>

          <p className="text-xs text-text-3 mb-4">
            Upload a previously exported JSON file to restore or clone data.
            <strong className="text-red-600"> This will replace all existing data in the imported tables.</strong>
          </p>

          {/* File picker */}
          <div
            className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors mb-4
              ${importFile ? 'border-accent bg-accent-dim/30' : 'border-border hover:border-accent/50'}`}
            onClick={() => fileRef.current?.click()}
            onDragOver={e => { e.preventDefault(); e.currentTarget.classList.add('border-accent') }}
            onDragLeave={e => e.currentTarget.classList.remove('border-accent')}
            onDrop={e => {
              e.preventDefault()
              e.currentTarget.classList.remove('border-accent')
              const f = e.dataTransfer.files[0]
              if (f && f.name.endsWith('.json')) {
                setImportFile(f)
                setImportResult(null)
              }
            }}
          >
            <input
              ref={fileRef}
              type="file"
              accept=".json"
              className="hidden"
              onChange={e => {
                const f = e.target.files?.[0]
                if (f) {
                  setImportFile(f)
                  setImportResult(null)
                }
              }}
            />
            {importFile ? (
              <div>
                <p className="text-sm font-medium text-text-1">{importFile.name}</p>
                <p className="text-xs text-text-3 mt-1">{(importFile.size / 1024 / 1024).toFixed(2)} MB</p>
                <button
                  onClick={e => { e.stopPropagation(); setImportFile(null); setImportResult(null) }}
                  className="text-xs text-red-500 hover:underline mt-2"
                >
                  Remove
                </button>
              </div>
            ) : (
              <div>
                <p className="text-sm text-text-2">Drop a .json export file here</p>
                <p className="text-xs text-text-3 mt-1">or click to browse</p>
              </div>
            )}
          </div>

          {/* Options */}
          <label className="flex items-center gap-2 text-xs text-text-2 mb-4 cursor-pointer">
            <input
              type="checkbox"
              checked={importDryRun}
              onChange={e => setImportDryRun(e.target.checked)}
              className="accent-[var(--accent)]"
            />
            Dry run (validate without writing — see what would be imported)
          </label>

          {/* Button */}
          <div className="flex items-center justify-end pt-3 border-t border-border">
            <button
              onClick={handleImport}
              disabled={!importFile || phase === 'importing'}
              className={`${importDryRun ? 'btn-outline' : 'btn-danger'} px-4 py-2 text-sm disabled:opacity-50`}
            >
              {phase === 'importing' ? (
                <span className="flex items-center gap-2">
                  <span className="inline-block w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  {importDryRun ? 'Validating…' : 'Importing…'}
                </span>
              ) : importDryRun ? (
                'Validate File'
              ) : (
                'Import & Replace Data'
              )}
            </button>
          </div>

          {/* Import results */}
          {importResult && (
            <div className="mt-4 pt-4 border-t border-border">
              <div className="flex items-center gap-2 mb-3">
                <span className={importResult.success ? 'text-green-600' : 'text-red-600'}>
                  {importResult.success ? '✓' : '✗'}
                </span>
                <span className="text-sm font-semibold text-text-1">
                  {importResult.dry_run ? 'Dry Run Results' : 'Import Complete'}
                </span>
                <span className="text-xs text-text-3 ml-auto">
                  {importResult.tables_imported} tables · {importResult.total_rows.toLocaleString()} rows
                </span>
              </div>
              <div className="max-h-48 overflow-y-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-text-3 border-b border-border">
                      <th className="text-left py-1 font-medium">Table</th>
                      <th className="text-right py-1 font-medium">Rows</th>
                      <th className="text-right py-1 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {importResult.details.map(d => (
                      <tr key={d.table} className="border-b border-border/50">
                        <td className="py-1 text-text-2 font-mono">{d.table.replace('mcogs_', '')}</td>
                        <td className="py-1 text-right text-text-2">{d.rows_imported}</td>
                        <td className="py-1 text-right">
                          <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-medium
                            ${d.status === 'ok' ? 'bg-green-100 text-green-700'
                              : d.status === 'skipped' ? 'bg-yellow-100 text-yellow-700'
                              : 'bg-red-100 text-red-700'}`}>
                            {d.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {importResult.dry_run && importResult.success && (
                <button
                  onClick={() => { setImportDryRun(false); handleImport() }}
                  className="btn-danger px-4 py-2 text-sm mt-3 w-full"
                >
                  Looks good — Import for real
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Table Inventory ────────────────────────────────────── */}
      <div className="card p-5 mt-6">
        <div className="flex items-center gap-2 mb-4">
          <span className="text-xl">🗄️</span>
          <h3 className="text-sm font-bold text-text-1">Table Inventory</h3>
          <span className="text-xs text-text-3 ml-auto">
            {tables.length} tables · {totalRows.toLocaleString()} total rows
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-text-3 border-b border-border">
                <th className="text-left py-2 font-medium">Table</th>
                <th className="text-left py-2 font-medium">Group</th>
                <th className="text-right py-2 font-medium">Rows</th>
                <th className="text-center py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {tables.map(t => (
                <tr key={t.name} className="border-b border-border/50 hover:bg-surface-2">
                  <td className="py-1.5 font-mono text-xs text-text-2">{t.name}</td>
                  <td className="py-1.5 text-xs text-text-3">{t.group}</td>
                  <td className="py-1.5 text-right text-xs text-text-2">{t.rows.toLocaleString()}</td>
                  <td className="py-1.5 text-center">
                    {t.exists ? (
                      <span className="text-green-600 text-xs">✓</span>
                    ) : (
                      <span className="text-yellow-500 text-xs" title="Table not yet created">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
