/**
 * DataGrid — reusable spreadsheet-style editable grid
 *
 * Usage:
 *
 *   const columns: GridColumn<MyRow>[] = [
 *     { key: 'name',     header: 'Name',     type: 'text',   editable: true },
 *     { key: 'unit_id',  header: 'Unit',     type: 'select', editable: true, options: unitOpts },
 *     { key: 'category', header: 'Category', type: 'combo',  editable: true, options: catOpts },
 *     { key: 'ppbu',     header: 'Per Unit', type: 'derived', editable: false,
 *         derive: row => row.price && row.qty ? (row.price / row.qty).toFixed(4) : '—' },
 *   ]
 *
 *   <DataGrid
 *     columns={columns}
 *     rows={myRows}
 *     keyField="id"
 *     onSave={async (draft, isNew) => { ... return savedRow }}
 *     onEdit={row => openModal(row)}
 *     onDelete={row => confirmDelete(row)}
 *   />
 *
 * Each row must have a unique string/number `keyField` value.
 * New rows are ghost rows with keyField === '' (empty string).
 */

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'

// ── Public types ──────────────────────────────────────────────────────────────

export interface GridOption {
  value: string
  label: string
  sub?:  string        // secondary label shown in combo dropdown
  group?: string       // optgroup label (select only)
}

export type GridColumnType = 'text' | 'number' | 'select' | 'combo' | 'derived'

export interface GridColumn<T extends Record<string, any>> {
  /** Unique key — must match a property on T (or be a virtual key for derived cols) */
  key:      keyof T | string
  header:   string
  type:     GridColumnType
  editable: boolean

  // For 'select' and 'combo'
  options?: GridOption[] | ((row: T) => GridOption[])

  // For 'derived' — computed from the current draft row (not saved to DB)
  derive?: (row: Partial<T>) => string

  // For 'number'
  min?:  number
  max?:  number
  step?: number

  // Display hints
  align?:      'left' | 'right'
  minWidth?:   number
  placeholder?: string | ((row: Partial<T>) => string)
  mono?:       boolean   // use monospace font
  className?:  string    // extra class on the cell td

  // Whether to show this column in read-only view (default true)
  visible?: boolean
}

export type GridSaveState = 'idle' | 'saving' | 'saved' | 'error'

/** Internal draft row — keyed row data + save state */
interface DraftRow<T> {
  _key:       string          // '' for ghost rows
  _saveState: GridSaveState
  _orig?:     T               // original data for Esc revert
  [field: string]: any
}

export interface DataGridProps<T extends Record<string, any>> {
  /** Column definitions */
  columns:   GridColumn<T>[]

  /** Data rows — each must have a unique value at `keyField` */
  rows:      T[]

  /** Which field is the primary key (must be string | number) */
  keyField:  keyof T

  /**
   * Called on Tab-from-last-cell, Enter, or blur-away-from-row.
   * Return the saved row (with its real key populated for new rows).
   * Throw to show an error state.
   */
  onSave:    (draft: Partial<T>, isNew: boolean) => Promise<T>

  /** Called when the Edit action button is clicked */
  onEdit?:   (row: T) => void

  /** Called when the Delete action button is clicked */
  onDelete?: (row: T) => void

  /** Optional extra column rendered after the standard action buttons */
  renderActions?: (row: T) => React.ReactNode

  /** Called after a row is successfully saved */
  onSaved?:  (row: T, isNew: boolean) => void

  /** Show toast messages */
  showToast?: (msg: string, type?: 'success' | 'error') => void

  /** Hint shown at the top of the grid (overrides default) */
  hint?: string

  /** Extra hint shown at right of hint bar */
  hintRight?: string

  /** Whether to show the Edit / Delete action buttons (default true) */
  showActions?: boolean

  /** Unique identifier for data-* attributes (default 'grid') */
  gridId?: string

  className?: string
}

// ── DataGrid ──────────────────────────────────────────────────────────────────

export function DataGrid<T extends Record<string, any>>({
  columns,
  rows,
  keyField,
  onSave,
  onEdit,
  onDelete,
  renderActions,
  onSaved,
  showToast,
  hint,
  hintRight,
  showActions = true,
  gridId = 'grid',
  className = '',
}: DataGridProps<T>) {

  // ── Draft rows ──────────────────────────────────────────────────────────────

  const buildDrafts = useCallback((data: T[]): DraftRow<T>[] => {
    const drafts: DraftRow<T>[] = data.map(row => ({
      ...row,
      _key:       String(row[keyField]),
      _saveState: 'idle' as GridSaveState,
      _orig:      row,
    }))
    drafts.push(makeGhost())
    return drafts
  }, [keyField])

  const [drafts, setDrafts] = useState<DraftRow<T>[]>(() => buildDrafts(rows))

  useEffect(() => { setDrafts(buildDrafts(rows)) }, [rows, buildDrafts])

  function makeGhost(): DraftRow<T> {
    const base: DraftRow<T> = { _key: '', _saveState: 'idle' }
    columns.forEach(col => { if (col.editable) (base as any)[col.key] = '' })
    return base
  }

  function updDraft(key: string, patch: Partial<DraftRow<T>>) {
    setDrafts(ds => ds.map(d => d._key === key ? { ...d, ...patch } : d))
  }

  // ── Editable columns (in tab order) ────────────────────────────────────────

  const editableCols = useMemo(
    () => columns.filter(c => c.editable && c.type !== 'derived'),
    [columns]
  )

  // ── Save ───────────────────────────────────────────────────────────────────

  async function saveRow(draft: DraftRow<T>): Promise<boolean> {
    // Extract only editable field values for the payload
    const payload: Partial<T> = {}
    columns.forEach(col => {
      if (col.editable) (payload as any)[col.key] = (draft as any)[col.key]
    })

    updDraft(draft._key, { _saveState: 'saving' })
    const isNew = draft._key === ''

    try {
      const saved = await onSave(payload, isNew)
      const newKey = String(saved[keyField])

      if (isNew) {
        setDrafts(ds => {
          const updated = ds.map(d =>
            d._key === ''
              ? { ...saved, _key: newKey, _saveState: 'saved' as GridSaveState, _orig: saved }
              : d
          )
          updated.push(makeGhost())
          return updated
        })
      } else {
        updDraft(draft._key, { ...saved, _saveState: 'saved', _orig: saved })
      }

      setTimeout(() => {
        setDrafts(ds => ds.map(d =>
          d._key === newKey && d._saveState === 'saved'
            ? { ...d, _saveState: 'idle' }
            : d
        ))
      }, 700)

      onSaved?.(saved, isNew)
      return true
    } catch (err: any) {
      showToast?.(err?.message || 'Save failed', 'error')
      updDraft(draft._key, { _saveState: 'error' })
      setTimeout(() => updDraft(draft._key, { _saveState: 'idle' }), 2000)
      return false
    }
  }

  // ── Cell focus helpers ──────────────────────────────────────────────────────

  const attrKey   = `data-${gridId}-row`
  const attrField = `data-${gridId}-field`

  function getCellEl(rowKey: string, colKey: string): HTMLElement | null {
    return document.querySelector<HTMLElement>(
      `[data-${gridId}] [${attrKey}="${rowKey}"][${attrField}="${String(colKey)}"]`
    )
  }

  function allCellEls(): { rowKey: string; colKey: string; el: HTMLElement }[] {
    return Array.from(
      document.querySelectorAll<HTMLElement>(
        `[data-${gridId}] [${attrKey}][${attrField}]`
      )
    ).map(el => ({
      rowKey: el.getAttribute(attrKey)!,
      colKey: el.getAttribute(attrField)!,
      el,
    }))
  }

  function focusCell(rowKey: string, colKey: string) {
    const el = getCellEl(rowKey, colKey)
    if (el) { el.focus(); (el as HTMLInputElement).select?.() }
  }

  function focusNext(rowKey: string, colKey: string, reverse = false) {
    const all = allCellEls()
    const idx = all.findIndex(c => c.rowKey === rowKey && c.colKey === String(colKey))
    const next = all[reverse ? idx - 1 : idx + 1]
    if (next) { next.el.focus(); (next.el as HTMLInputElement).select?.() }
  }

  // ── Keyboard handler ────────────────────────────────────────────────────────

  async function handleKeyDown(
    e: React.KeyboardEvent,
    draft: DraftRow<T>,
    col: GridColumn<T>
  ) {
    const colIdx  = editableCols.findIndex(c => c.key === col.key)
    const isLast  = colIdx === editableCols.length - 1
    const isFirst = colIdx === 0
    const isGhost = draft._key === ''

    if (e.key === 'Tab') {
      e.preventDefault()
      if (isLast && !e.shiftKey) {
        const ok = await saveRow(draft)
        if (isGhost && ok) {
          setTimeout(() => focusCell('', String(editableCols[0].key)), 50)
        } else {
          focusNext(draft._key, String(col.key), false)
        }
      } else if (isFirst && e.shiftKey && !isGhost) {
        saveRow(draft)
        focusNext(draft._key, String(col.key), true)
      } else {
        focusNext(draft._key, String(col.key), e.shiftKey)
      }
    }

    if (e.key === 'Enter') {
      e.preventDefault()
      await saveRow(draft)
      const draftIdx = drafts.findIndex(d => d._key === draft._key)
      const next = drafts[draftIdx + 1]
      if (next) focusCell(next._key, String(editableCols[0].key))
    }

    if (e.key === 'Escape') {
      e.preventDefault()
      if (isGhost) {
        setDrafts(ds => ds.map(d => d._key === '' ? makeGhost() : d))
      } else if (draft._orig) {
        updDraft(draft._key, {
          ...draft._orig,
          _saveState: 'idle',
        })
      }
      ;(e.target as HTMLElement).blur()
    }
  }

  // ── Blur auto-save ──────────────────────────────────────────────────────────

  function handleBlur(draft: DraftRow<T>) {
    if (draft._key === '') return
    setTimeout(() => {
      const grid = document.querySelector(`[data-${gridId}]`)
      if (!grid) return
      const focused = document.activeElement
      if (!focused || !grid.contains(focused)) return
      if ((focused as HTMLElement).getAttribute(attrKey) === draft._key) return
      saveRow(draft)
    }, 150)
  }

  // ── Cell renderers ──────────────────────────────────────────────────────────

  function TextCell({ draft, col }: { draft: DraftRow<T>; col: GridColumn<T> }) {
    const attrs = {
      [attrKey]:   draft._key,
      [attrField]: String(col.key),
    }
    const ph = typeof col.placeholder === 'function'
      ? col.placeholder(draft as Partial<T>)
      : col.placeholder ?? ''

    return (
      <input
        {...attrs}
        className={`dg-cell-input${col.mono ? ' font-mono' : ''}`}
        type="text"
        value={(draft as any)[col.key] ?? ''}
        onChange={e => updDraft(draft._key, { [col.key]: e.target.value } as any)}
        onBlur={() => handleBlur(draft)}
        onKeyDown={e => handleKeyDown(e, draft, col)}
        placeholder={ph}
        spellCheck={false}
        autoComplete="off"
      />
    )
  }

  function NumberCell({ draft, col }: { draft: DraftRow<T>; col: GridColumn<T> }) {
    const attrs = {
      [attrKey]:   draft._key,
      [attrField]: String(col.key),
    }
    const ph = typeof col.placeholder === 'function'
      ? col.placeholder(draft as Partial<T>)
      : col.placeholder ?? ''

    return (
      <input
        {...attrs}
        className={`dg-cell-input font-mono${col.className ? ` ${col.className}` : ''}`}
        type="number"
        value={(draft as any)[col.key] ?? ''}
        onChange={e => updDraft(draft._key, { [col.key]: e.target.value } as any)}
        onBlur={() => handleBlur(draft)}
        onKeyDown={e => handleKeyDown(e, draft, col)}
        min={col.min}
        max={col.max}
        step={col.step ?? 'any'}
        placeholder={ph}
      />
    )
  }

  function SelectCell({ draft, col }: { draft: DraftRow<T>; col: GridColumn<T> }) {
    const opts = typeof col.options === 'function' ? col.options(draft as T) : (col.options ?? [])
    const attrs = {
      [attrKey]:   draft._key,
      [attrField]: String(col.key),
    }

    // Group by col.group if present
    const groups = opts.reduce<Record<string, GridOption[]>>((acc, o) => {
      const g = o.group ?? '__none__'
      if (!acc[g]) acc[g] = []
      acc[g].push(o)
      return acc
    }, {})
    const hasGroups = Object.keys(groups).some(g => g !== '__none__')

    return (
      <select
        {...attrs}
        className="dg-cell-input"
        value={(draft as any)[col.key] ?? ''}
        onChange={e => updDraft(draft._key, { [col.key]: e.target.value } as any)}
        onBlur={() => handleBlur(draft)}
        onKeyDown={e => handleKeyDown(e as any, draft, col)}
      >
        <option value="">—</option>
        {hasGroups
          ? Object.entries(groups).map(([g, gopts]) => (
            g === '__none__'
              ? gopts.map(o => <option key={o.value} value={o.value}>{o.label}</option>)
              : <optgroup key={g} label={g}>
                  {gopts.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </optgroup>
          ))
          : opts.map(o => <option key={o.value} value={o.value}>{o.label}</option>)
        }
      </select>
    )
  }

  function ComboCell({ draft, col }: { draft: DraftRow<T>; col: GridColumn<T> }) {
    const [open,   setOpen]   = useState(false)
    const [search, setSearch] = useState('')
    const ref = useRef<HTMLDivElement>(null)

    const opts = typeof col.options === 'function' ? col.options(draft as T) : (col.options ?? [])
    const current = opts.find(o => o.value === String((draft as any)[col.key] ?? ''))
    const display = current?.label ?? ''

    const filtered = useMemo(() =>
      opts.filter(o =>
        `${o.label} ${o.sub ?? ''}`.toLowerCase().includes(search.toLowerCase())
      )
    , [opts, search])

    useEffect(() => {
      function handler(e: MouseEvent) {
        if (ref.current && !ref.current.contains(e.target as Node)) {
          setOpen(false); setSearch('')
        }
      }
      document.addEventListener('mousedown', handler)
      return () => document.removeEventListener('mousedown', handler)
    }, [])

    const attrs = {
      [attrKey]:   draft._key,
      [attrField]: String(col.key),
    }
    const ph = typeof col.placeholder === 'function'
      ? col.placeholder(draft as Partial<T>)
      : col.placeholder ?? 'Search…'

    return (
      <div ref={ref} className="relative">
        <input
          {...attrs}
          className="dg-cell-input"
          value={open ? search : display}
          onChange={e => { setSearch(e.target.value); setOpen(true) }}
          onFocus={() => { setOpen(true); setSearch('') }}
          onBlur={() => {
            setTimeout(() => { setOpen(false); setSearch('') }, 150)
            handleBlur(draft)
          }}
          onKeyDown={e => {
            // Enter selects first match; other keys go to grid handler
            if (e.key === 'Enter' && open && filtered.length > 0) {
              e.preventDefault()
              const first = filtered[0]
              updDraft(draft._key, { [col.key]: first.value } as any)
              setOpen(false); setSearch('')
              focusNext(draft._key, String(col.key), false)
            } else if (e.key !== 'Tab') {
              // Let Tab fall through to grid handler
              return
            } else {
              handleKeyDown(e, draft, col)
            }
          }}
          placeholder={ph}
          autoComplete="off"
          style={{ minWidth: col.minWidth }}
        />
        {open && (
          <div
            className="absolute z-50 top-full left-0 min-w-[200px] max-h-56 overflow-y-auto mt-0.5 bg-surface border border-border rounded-lg shadow-lg"
            style={{ zIndex: 9999 }}
          >
            {filtered.length === 0 ? (
              <div className="px-3 py-2 text-sm text-text-3">No results</div>
            ) : filtered.map(o => (
              <button
                key={o.value}
                type="button"
                className={`w-full text-left px-3 py-1.5 text-sm hover:bg-surface-2 transition-colors
                  ${o.value === String((draft as any)[col.key]) ? 'text-accent font-semibold' : 'text-text-1'}`}
                onMouseDown={e => {
                  e.preventDefault()
                  updDraft(draft._key, { [col.key]: o.value } as any)
                  setOpen(false); setSearch('')
                }}
              >
                {o.label}
                {o.sub && <span className="text-text-3 ml-1.5 text-xs">({o.sub})</span>}
              </button>
            ))}
          </div>
        )}
      </div>
    )
  }

  function DerivedCell({ draft, col }: { draft: DraftRow<T>; col: GridColumn<T> }) {
    const value = col.derive ? col.derive(draft as Partial<T>) : '—'
    return (
      <span className={`px-3 py-2 block text-sm${col.mono ? ' font-mono' : ''}${col.align === 'right' ? ' text-right' : ''}`}>
        {value}
      </span>
    )
  }

  function renderCell(draft: DraftRow<T>, col: GridColumn<T>) {
    if (!col.editable || col.type === 'derived') return <DerivedCell draft={draft} col={col} />
    if (col.type === 'text')   return <TextCell   draft={draft} col={col} />
    if (col.type === 'number') return <NumberCell draft={draft} col={col} />
    if (col.type === 'select') return <SelectCell draft={draft} col={col} />
    if (col.type === 'combo')  return <ComboCell  draft={draft} col={col} />
    return null
  }

  // ── Row ─────────────────────────────────────────────────────────────────────

  function GridRow({ draft }: { draft: DraftRow<T> }) {
    const isGhost = draft._key === ''
    const orig    = draft._orig as T | undefined

    const rowClass = [
      'border-b border-border last:border-0 transition-colors group',
      draft._saveState === 'saving' ? 'opacity-50 pointer-events-none' : '',
      draft._saveState === 'saved'  ? 'dg-row-saved' : '',
      draft._saveState === 'error'  ? 'dg-row-error' : '',
      isGhost
        ? 'opacity-40 hover:opacity-100 transition-opacity'
        : 'hover:bg-surface-2/50',
    ].filter(Boolean).join(' ')

    return (
      <tr className={rowClass}>
        {columns
          .filter(c => c.visible !== false)
          .map(col => (
            <td
              key={String(col.key)}
              className={[
                'p-0 relative overflow-visible',
                col.align === 'right' ? 'text-right' : '',
                col.minWidth ? '' : '',
                col.className ?? '',
              ].filter(Boolean).join(' ')}
              style={col.minWidth ? { minWidth: col.minWidth } : undefined}
            >
              {renderCell(draft, col)}
            </td>
          ))
        }

        {showActions && (
          <td className="px-2 py-1">
            {isGhost ? (
              <span className="text-xs text-text-3 whitespace-nowrap">↵ new row</span>
            ) : orig ? (
              <div className="flex gap-1 justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                {onEdit && (
                  <button
                    className="w-7 h-7 flex items-center justify-center rounded hover:bg-surface-2 text-text-3 hover:text-accent transition-colors"
                    title="Edit"
                    onClick={() => onEdit(orig)}
                  >
                    <EditIcon size={12} />
                  </button>
                )}
                {onDelete && (
                  <button
                    className="w-7 h-7 flex items-center justify-center rounded border border-red-200 text-red-400 hover:bg-red-50 hover:text-red-600 transition-colors"
                    title="Delete"
                    onClick={() => onDelete(orig)}
                  >
                    <TrashIcon size={12} />
                  </button>
                )}
                {renderActions?.(orig)}
              </div>
            ) : null}
          </td>
        )}
      </tr>
    )
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  const visibleCols = columns.filter(c => c.visible !== false)

  return (
    <div
      {...{ [`data-${gridId}`]: '' }}
      className={`bg-surface border border-border rounded-xl overflow-visible ${className}`}
    >
      {/* Hint bar */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-border bg-surface-2 rounded-t-xl text-xs text-text-3 flex-wrap">
        <span className="font-semibold text-text-2">
          {hint ?? 'Spreadsheet mode — edit cells directly.'}
        </span>
        <span><Kbd>Tab</Kbd> next cell</span>
        <span><Kbd>Enter</Kbd> save &amp; next row</span>
        <span><Kbd>Esc</Kbd> cancel</span>
        {hintRight && (
          <span className="ml-auto opacity-60">{hintRight}</span>
        )}
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-surface-2 border-b border-border text-left">
              {visibleCols.map(col => (
                <th
                  key={String(col.key)}
                  className={`px-3 py-2.5 text-xs font-semibold uppercase tracking-wide text-text-2 whitespace-nowrap
                    ${col.align === 'right' ? 'text-right' : ''}`}
                  style={col.minWidth ? { minWidth: col.minWidth } : undefined}
                >
                  {col.header}
                </th>
              ))}
              {showActions && <th className="w-20" />}
            </tr>
          </thead>
          <tbody>
            {drafts.map((draft, i) => (
              <GridRow key={draft._key || `ghost-${i}`} draft={draft} />
            ))}
          </tbody>
        </table>
      </div>

      {/* Scoped styles */}
      <style>{`
        [data-${gridId}] .dg-cell-input {
          display: block;
          width: 100%;
          padding: 8px 10px;
          background: transparent;
          border: none;
          outline: none;
          font-size: 13px;
          color: inherit;
          font-family: inherit;
        }
        [data-${gridId}] .dg-cell-input:focus {
          background: rgba(46, 90, 40, .06);
          box-shadow: inset 0 0 0 2px var(--color-accent, #2d6a4f);
          border-radius: 4px;
        }
        [data-${gridId}] .dg-cell-input::placeholder {
          color: var(--color-text-3, #9ca3af);
          font-weight: 400;
        }
        [data-${gridId}] .dg-row-saved td {
          animation: dgSaveFlash 0.65s ease;
        }
        [data-${gridId}] .dg-row-error td {
          box-shadow: inset 0 0 0 2px #e53e3e;
        }
        @keyframes dgSaveFlash {
          0%   { background: rgba(46, 90, 40, .18); }
          100% { background: transparent; }
        }
      `}</style>
    </div>
  )
}

// ── Convenience toggle button ─────────────────────────────────────────────────
// Drop this next to your search bar to toggle grid mode.

export function GridToggleButton({
  active,
  onToggle,
  label = 'Grid Edit',
}: {
  active:    boolean
  onToggle:  () => void
  label?:    string
}) {
  return (
    <button
      onClick={onToggle}
      className={`flex items-center gap-2 px-3 py-2 text-sm font-semibold rounded-lg border transition-colors
        ${active
          ? 'bg-accent text-white border-accent'
          : 'border-border text-text-2 hover:border-accent hover:text-accent'
        }`}
    >
      <GridIcon size={14} />
      {label}
    </button>
  )
}

// ── Icons ─────────────────────────────────────────────────────────────────────

function EditIcon({ size = 14 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
}
function TrashIcon({ size = 14 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6M10 11v6M14 11v6M9 6V4h6v2"/></svg>
}
function GridIcon({ size = 14 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>
}
function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex items-center justify-center px-1.5 py-0.5 rounded border border-border bg-surface text-text-2 text-xs font-mono">
      {children}
    </kbd>
  )
}
