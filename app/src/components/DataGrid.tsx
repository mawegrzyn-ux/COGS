/**
 * DataGrid — reusable spreadsheet-style editable grid
 *
 * FIX: All cell sub-components are defined OUTSIDE DataGrid so React never
 * unmounts/remounts them on parent re-renders (which caused focus loss on
 * every keystroke when they were nested functions inside DataGrid).
 */

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'

// ── Public types ──────────────────────────────────────────────────────────────

export interface GridOption {
  value:  string
  label:  string
  sub?:   string
  group?: string
}

export type GridColumnType = 'text' | 'number' | 'select' | 'combo' | 'derived'

export interface GridColumn<T extends Record<string, any>> {
  key:      keyof T | string
  header:   string
  type:     GridColumnType
  editable: boolean

  sortable?:      boolean
  filterable?:    boolean
  filterOptions?: GridOption[]

  options?: GridOption[] | ((row: T) => GridOption[])
  derive?:  (row: Partial<T>) => string

  min?:  number
  max?:  number
  step?: number

  align?:       'left' | 'right'
  minWidth?:    number
  placeholder?: string | ((row: Partial<T>) => string)
  mono?:        boolean
  className?:   string
  visible?:     boolean
}

export type GridSaveState = 'idle' | 'saving' | 'saved' | 'error'

export type DraftRow<T> = T & {
  _key:       string
  _saveState: GridSaveState
  _orig?:     T
}

export interface DataGridProps<T extends Record<string, any>> {
  columns:        GridColumn<T>[]
  rows:           T[]
  keyField:       keyof T
  onSave:         (draft: Partial<T>, isNew: boolean) => Promise<T>
  onEdit?:        (row: T) => void
  onDelete?:      (row: T) => void
  renderActions?: (row: T) => React.ReactNode
  onSaved?:       (row: T, isNew: boolean) => void
  showToast?:     (msg: string, type?: 'success' | 'error') => void
  hint?:          string
  hintRight?:     string
  showActions?:   boolean
  gridId?:        string
  className?:     string
}

// ── Cell prop interfaces ──────────────────────────────────────────────────────

interface CellProps<T extends Record<string, any>> {
  draft:     DraftRow<T>
  col:       GridColumn<T>
  gridId:    string
  onChange:  (rowKey: string, field: string, value: any) => void
  onBlur:    (draft: DraftRow<T>) => void
  onKeyDown: (e: React.KeyboardEvent, draft: DraftRow<T>, col: GridColumn<T>) => void
}

interface ComboCellProps<T extends Record<string, any>> extends CellProps<T> {
  focusNext: (rowKey: string, colKey: string, reverse?: boolean) => void
}

// ── TextCell ──────────────────────────────────────────────────────────────────

function TextCell<T extends Record<string, any>>({ draft, col, gridId, onChange, onBlur, onKeyDown }: CellProps<T>) {
  const ph = typeof col.placeholder === 'function'
    ? col.placeholder(draft as unknown as Partial<T>)
    : (col.placeholder ?? '')
  return (
    <input
      {...{ [`data-${gridId}-row`]: draft._key, [`data-${gridId}-field`]: String(col.key) }}
      className={`dg-cell-input${col.mono ? ' font-mono' : ''}`}
      type="text"
      value={(draft as any)[col.key] ?? ''}
      onChange={e => onChange(draft._key, col.key as string, e.target.value)}
      onBlur={() => onBlur(draft)}
      onKeyDown={e => onKeyDown(e, draft, col)}
      placeholder={ph}
      spellCheck={false}
      autoComplete="off"
    />
  )
}

// ── NumberCell ────────────────────────────────────────────────────────────────

function NumberCell<T extends Record<string, any>>({ draft, col, gridId, onChange, onBlur, onKeyDown }: CellProps<T>) {
  const ph = typeof col.placeholder === 'function'
    ? col.placeholder(draft as unknown as Partial<T>)
    : (col.placeholder ?? '')
  return (
    <input
      {...{ [`data-${gridId}-row`]: draft._key, [`data-${gridId}-field`]: String(col.key) }}
      className={`dg-cell-input font-mono${col.className ? ` ${col.className}` : ''}`}
      type="number"
      value={(draft as any)[col.key] ?? ''}
      onChange={e => onChange(draft._key, col.key as string, e.target.value)}
      onBlur={() => onBlur(draft)}
      onKeyDown={e => onKeyDown(e, draft, col)}
      min={col.min}
      max={col.max}
      step={col.step ?? 'any'}
      placeholder={ph}
    />
  )
}

// ── SelectCell ────────────────────────────────────────────────────────────────

function SelectCell<T extends Record<string, any>>({ draft, col, gridId, onChange, onBlur, onKeyDown }: CellProps<T>) {
  const opts   = typeof col.options === 'function' ? col.options(draft as unknown as T) : (col.options ?? [])
  const groups = opts.reduce<Record<string, GridOption[]>>((acc, o) => {
    const g = o.group ?? '__none__'
    if (!acc[g]) acc[g] = []
    acc[g].push(o)
    return acc
  }, {})
  const hasGroups = Object.keys(groups).some(g => g !== '__none__')

  return (
    <select
      {...{ [`data-${gridId}-row`]: draft._key, [`data-${gridId}-field`]: String(col.key) }}
      className="dg-cell-input"
      value={(draft as any)[col.key] ?? ''}
      onChange={e => onChange(draft._key, col.key as string, e.target.value)}
      onBlur={() => onBlur(draft)}
      onKeyDown={e => onKeyDown(e as any, draft, col)}
    >
      <option value="">—</option>
      {hasGroups
        ? Object.entries(groups).map(([g, gopts]) =>
            g === '__none__'
              ? gopts.map(o => <option key={o.value} value={o.value}>{o.label}</option>)
              : <optgroup key={g} label={g}>{gopts.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</optgroup>
          )
        : opts.map(o => <option key={o.value} value={o.value}>{o.label}</option>)
      }
    </select>
  )
}

// ── ComboCell ─────────────────────────────────────────────────────────────────

function ComboCell<T extends Record<string, any>>({
  draft, col, gridId, onChange, onBlur, onKeyDown, focusNext,
}: ComboCellProps<T>) {
  const [open,   setOpen]   = useState(false)
  const [search, setSearch] = useState('')
  const ref = useRef<HTMLDivElement>(null)

  const opts    = typeof col.options === 'function' ? col.options(draft as unknown as T) : (col.options ?? [])
  const current = opts.find(o => o.value === String((draft as any)[col.key] ?? ''))
  const filtered = useMemo(
    () => opts.filter(o => `${o.label} ${o.sub ?? ''}`.toLowerCase().includes(search.toLowerCase())),
    [opts, search]
  )
  const ph = typeof col.placeholder === 'function'
    ? col.placeholder(draft as unknown as Partial<T>)
    : (col.placeholder ?? '')

  useEffect(() => {
    function h(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false); setSearch('')
      }
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  return (
    <div ref={ref} className="relative">
      <input
        {...{ [`data-${gridId}-row`]: draft._key, [`data-${gridId}-field`]: String(col.key) }}
        className="dg-cell-input"
        value={open ? search : (current?.label ?? '')}
        onChange={e => { setSearch(e.target.value); setOpen(true) }}
        onFocus={() => { setOpen(true); setSearch('') }}
        onBlur={() => { setTimeout(() => { setOpen(false); setSearch('') }, 150); onBlur(draft) }}
        onKeyDown={e => {
          if (e.key === 'Enter' && open && filtered.length > 0) {
            e.preventDefault()
            onChange(draft._key, col.key as string, filtered[0].value)
            setOpen(false); setSearch('')
            focusNext(draft._key, String(col.key), false)
          } else if (e.key === 'Tab' || e.key === 'Escape') {
            if (e.key === 'Escape') { setOpen(false); setSearch('') }
            onKeyDown(e, draft, col)
          }
        }}
        placeholder={ph}
        autoComplete="off"
      />
      {open && (
        <div className="absolute z-50 top-full left-0 min-w-[200px] max-h-56 overflow-y-auto mt-0.5 bg-surface border border-border rounded-lg shadow-lg" style={{ zIndex: 9999 }}>
          {filtered.length === 0
            ? <div className="px-3 py-2 text-sm text-text-3">No results</div>
            : filtered.map(o => (
              <button key={o.value} type="button"
                className={`w-full text-left px-3 py-1.5 text-sm hover:bg-surface-2 transition-colors
                  ${o.value === String((draft as any)[col.key]) ? 'text-accent font-semibold' : 'text-text-1'}`}
                onMouseDown={e => {
                  e.preventDefault()
                  onChange(draft._key, col.key as string, o.value)
                  setOpen(false); setSearch('')
                }}
              >
                {o.label}{o.sub && <span className="text-text-3 ml-1.5 text-xs">({o.sub})</span>}
              </button>
            ))
          }
        </div>
      )}
    </div>
  )
}

// ── DerivedCell ───────────────────────────────────────────────────────────────

function DerivedCell<T extends Record<string, any>>({ draft, col }: { draft: DraftRow<T>; col: GridColumn<T> }) {
  const value = col.derive ? col.derive(draft as unknown as Partial<T>) : '—'
  return (
    <span className={`px-3 py-2 block text-sm${col.mono ? ' font-mono' : ''}${col.align === 'right' ? ' text-right' : ''}`}>
      {value}
    </span>
  )
}

// ── DataGrid ──────────────────────────────────────────────────────────────────

export function DataGrid<T extends Record<string, any>>({
  columns, rows, keyField,
  onSave, onEdit, onDelete, renderActions, onSaved,
  showToast, hint, hintRight,
  showActions = true, gridId = 'grid', className = '',
}: DataGridProps<T>) {

  // ── Sort & filter ───────────────────────────────────────────────────────────

  const [sortField,  setSortField]  = useState<string | null>(null)
  const [sortDir,    setSortDir]    = useState<'asc' | 'desc'>('asc')
  const [filters,    setFilters]    = useState<Record<string, string>>({})
  const [openFilter, setOpenFilter] = useState<string | null>(null)

  function toggleSort(colKey: string) {
    if (sortField === colKey) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortField(colKey); setSortDir('asc') }
  }
  function applyFilter(colKey: string, value: string) {
    setFilters(f => value ? { ...f, [colKey]: value } : Object.fromEntries(Object.entries(f).filter(([k]) => k !== colKey)))
    setOpenFilter(null)
  }
  function clearAllFilters() { setFilters({}); setOpenFilter(null) }

  const processedRows = useMemo(() => {
    let result = [...rows]
    Object.entries(filters).forEach(([key, val]) => {
      if (!val) return
      result = result.filter(r => String(r[key] ?? '') === val)
    })
    if (sortField) {
      result.sort((a, b) => {
        const av = a[sortField] ?? '', bv = b[sortField] ?? ''
        const an = Number(av), bn = Number(bv)
        const cmp = (!isNaN(an) && !isNaN(bn) && av !== '' && bv !== '')
          ? an - bn
          : String(av).localeCompare(String(bv), undefined, { sensitivity: 'base' })
        return sortDir === 'asc' ? cmp : -cmp
      })
    }
    return result
  }, [rows, filters, sortField, sortDir])

  // ── Drafts ──────────────────────────────────────────────────────────────────

  const columnsRef = useRef(columns)
  columnsRef.current = columns

  const makeGhost = useCallback((): DraftRow<T> => {
    const base: Record<string, any> = { _key: '', _saveState: 'idle' }
    columnsRef.current.forEach(col => { if (col.editable) base[col.key as string] = '' })
    return base as unknown as DraftRow<T>
  }, [])

  const buildDrafts = useCallback((data: T[]): DraftRow<T>[] => {
    const result: DraftRow<T>[] = data.map(row => ({
      ...row, _key: String(row[keyField]), _saveState: 'idle' as GridSaveState, _orig: row,
    }))
    result.push(makeGhost())
    return result
  }, [keyField, makeGhost])

  const [drafts, setDrafts] = useState<DraftRow<T>[]>(() => buildDrafts(processedRows))

  // Keep a stable ref so handlers always see current drafts
  const draftsRef = useRef(drafts)
  draftsRef.current = drafts

  useEffect(() => {
    setDrafts(prev => {
      const ghost      = prev.find(d => d._key === '')
      const next       = buildDrafts(processedRows)
      const ghostDirty = ghost && columnsRef.current.some(c => c.editable && String((ghost as any)[c.key] ?? '') !== '')
      if (ghostDirty) next[next.length - 1] = ghost!
      return next
    })
  }, [processedRows, buildDrafts])

  // ── Stable updaters ─────────────────────────────────────────────────────────

  // handleChange is stable — cells call this on every keystroke
  const handleChange = useCallback((rowKey: string, field: string, value: any) => {
    setDrafts(ds => ds.map(d => d._key === rowKey ? ({ ...d, [field]: value } as DraftRow<T>) : d))
  }, [])

  const updDraft = useCallback((key: string, patch: Record<string, any>) => {
    setDrafts(ds => ds.map(d => d._key === key ? ({ ...d, ...patch } as DraftRow<T>) : d))
  }, [])

  // ── Cell focus ──────────────────────────────────────────────────────────────

  const focusCell = useCallback((rowKey: string, colKey: string) => {
    const el = document.querySelector<HTMLElement>(
      `[data-${gridId}] [data-${gridId}-row="${rowKey}"][data-${gridId}-field="${colKey}"]`
    )
    if (el) { el.focus(); (el as HTMLInputElement).select?.() }
  }, [gridId])

  const allCellEls = useCallback(() =>
    Array.from(document.querySelectorAll<HTMLElement>(
      `[data-${gridId}] [data-${gridId}-row][data-${gridId}-field]`
    )).map(el => ({
      rowKey: el.getAttribute(`data-${gridId}-row`)!,
      colKey: el.getAttribute(`data-${gridId}-field`)!,
      el,
    }))
  , [gridId])

  const focusNext = useCallback((rowKey: string, colKey: string, reverse = false) => {
    const all  = allCellEls()
    const idx  = all.findIndex(c => c.rowKey === rowKey && c.colKey === colKey)
    const next = all[reverse ? idx - 1 : idx + 1]
    if (next) { next.el.focus(); (next.el as HTMLInputElement).select?.() }
  }, [allCellEls])

  // ── Save ────────────────────────────────────────────────────────────────────

  const saveRow = useCallback(async (draft: DraftRow<T>): Promise<boolean> => {
    const rec: Record<string, any> = {}
    columnsRef.current.forEach(col => {
      if (col.editable) rec[col.key as string] = (draft as any)[col.key]
    })
    const payload = rec as unknown as Partial<T>

    updDraft(draft._key, { _saveState: 'saving' })
    const isNew = draft._key === ''

    try {
      const saved  = await onSave(payload, isNew)
      const newKey = String(saved[keyField])

      if (isNew) {
        setDrafts(ds => {
          const next = ds.map(d =>
            d._key === ''
              ? ({ ...saved, _key: newKey, _saveState: 'saved' as GridSaveState, _orig: saved } as unknown as DraftRow<T>)
              : d
          )
          next.push(makeGhost())
          return next
        })
      } else {
        updDraft(draft._key, { ...(saved as unknown as Record<string, any>), _saveState: 'saved', _orig: saved })
      }

      setTimeout(() => {
        setDrafts(ds => ds.map(d => d._key === newKey && d._saveState === 'saved' ? { ...d, _saveState: 'idle' } : d))
      }, 700)

      onSaved?.(saved, isNew)
      return true
    } catch (err: any) {
      showToast?.(err?.message || 'Save failed', 'error')
      updDraft(draft._key, { _saveState: 'error' })
      setTimeout(() => updDraft(draft._key, { _saveState: 'idle' }), 2000)
      return false
    }
  }, [onSave, keyField, onSaved, showToast, updDraft, makeGhost])

  // ── Keyboard ────────────────────────────────────────────────────────────────

  const handleKeyDown = useCallback(async (
    e: React.KeyboardEvent, draft: DraftRow<T>, col: GridColumn<T>
  ) => {
    const editCols = columnsRef.current.filter(c => c.editable && c.type !== 'derived')
    const colIdx   = editCols.findIndex(c => c.key === col.key)
    const isLast   = colIdx === editCols.length - 1
    const isFirst  = colIdx === 0
    const isGhost  = draft._key === ''

    if (e.key === 'Tab') {
      e.preventDefault()
      if (isLast && !e.shiftKey) {
        const ok = await saveRow(draft)
        if (isGhost && ok) setTimeout(() => focusCell('', String(editCols[0].key)), 50)
        else focusNext(draft._key, String(col.key), false)
      } else if (isFirst && e.shiftKey && !isGhost) {
        saveRow(draft); focusNext(draft._key, String(col.key), true)
      } else {
        focusNext(draft._key, String(col.key), e.shiftKey)
      }
    }

    if (e.key === 'Enter') {
      e.preventDefault()
      await saveRow(draft)
      const cur  = draftsRef.current
      const idx  = cur.findIndex(d => d._key === draft._key)
      const next = cur[idx + 1]
      if (next) focusCell(next._key, String(editCols[0].key))
    }

    if (e.key === 'Escape') {
      e.preventDefault()
      if (isGhost) {
        setDrafts(ds => ds.map(d => d._key === '' ? makeGhost() : d))
      } else if (draft._orig) {
        updDraft(draft._key, { ...(draft._orig as Record<string, any>), _saveState: 'idle' })
      }
      ;(e.target as HTMLElement).blur()
    }
  }, [saveRow, focusCell, focusNext, updDraft, makeGhost])

  // ── Blur auto-save ──────────────────────────────────────────────────────────

  const handleBlur = useCallback((draft: DraftRow<T>) => {
    if (draft._key === '') return
    setTimeout(() => {
      const grid    = document.querySelector(`[data-${gridId}]`)
      const focused = document.activeElement
      if (!grid || !focused || !grid.contains(focused)) return
      if ((focused as HTMLElement).getAttribute(`data-${gridId}-row`) === draft._key) return
      saveRow(draft)
    }, 150)
  }, [saveRow, gridId])

  // ── Render ──────────────────────────────────────────────────────────────────

  const visibleCols       = columns.filter(c => c.visible !== false)
  const activeFilterCount = Object.keys(filters).length
  const cellHandlers      = { gridId, onChange: handleChange, onBlur: handleBlur, onKeyDown: handleKeyDown }

  function renderCell(draft: DraftRow<T>, col: GridColumn<T>) {
    if (!col.editable || col.type === 'derived') return <DerivedCell<T> draft={draft} col={col} />
    if (col.type === 'text')   return <TextCell<T>   {...cellHandlers} draft={draft} col={col} />
    if (col.type === 'number') return <NumberCell<T> {...cellHandlers} draft={draft} col={col} />
    if (col.type === 'select') return <SelectCell<T> {...cellHandlers} draft={draft} col={col} />
    if (col.type === 'combo')  return <ComboCell<T>  {...cellHandlers} draft={draft} col={col} focusNext={focusNext} />
    return null
  }

  function HeaderCell({ col }: { col: GridColumn<T> }) {
    const colKey    = String(col.key)
    const isSorted  = sortField === colKey
    const canSort   = col.sortable !== false && col.type !== 'derived'
    const canFilter = col.filterable === true && (col.filterOptions?.length ?? 0) > 0
    const activeVal = filters[colKey]
    const filterRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
      if (openFilter !== colKey) return
      function h(e: MouseEvent) {
        if (filterRef.current && !filterRef.current.contains(e.target as Node)) setOpenFilter(null)
      }
      document.addEventListener('mousedown', h)
      return () => document.removeEventListener('mousedown', h)
    }, [openFilter, colKey])

    return (
      <th
        className={`px-0 py-0 text-xs font-semibold uppercase tracking-wide text-text-2 whitespace-nowrap select-none ${col.align === 'right' ? 'text-right' : 'text-left'}`}
        style={col.minWidth ? { minWidth: col.minWidth } : undefined}
      >
        <div className={`flex items-center gap-0.5 px-3 py-2.5 ${col.align === 'right' ? 'justify-end' : ''}`}>
          <button type="button" tabIndex={-1}
            className={`flex items-center gap-1.5 transition-colors min-w-0 ${canSort ? 'hover:text-text-1 cursor-pointer' : 'cursor-default'} ${isSorted ? 'text-accent' : ''}`}
            onClick={() => canSort && toggleSort(colKey)}
          >
            <span className="truncate">{col.header}</span>
            {canSort && (
              <span className="flex flex-col gap-[2px] shrink-0">
                <SortArrow up active={isSorted && sortDir === 'asc'} />
                <SortArrow up={false} active={isSorted && sortDir === 'desc'} />
              </span>
            )}
          </button>
          {canFilter && (
            <div ref={filterRef} className="relative shrink-0">
              <button type="button" tabIndex={-1}
                onClick={() => setOpenFilter(openFilter === colKey ? null : colKey)}
                className={`w-5 h-5 flex items-center justify-center rounded transition-colors ml-0.5 ${activeVal ? 'text-accent bg-accent-dim' : 'text-text-3 hover:text-text-1 hover:bg-surface-2'}`}
                title={activeVal ? `Filtered: ${col.filterOptions?.find(o => o.value === activeVal)?.label ?? activeVal}` : 'Filter column'}
              >
                <FilterIcon size={11} filled={!!activeVal} />
              </button>
              {openFilter === colKey && (
                <div className="absolute z-50 top-full left-0 mt-1 min-w-[160px] bg-surface border border-border rounded-lg shadow-xl overflow-hidden" style={{ zIndex: 9999 }}>
                  <div className="px-3 py-1.5 border-b border-border text-xs text-text-3 font-semibold uppercase tracking-wide">{col.header}</div>
                  <button type="button" className={`w-full text-left px-3 py-2 text-sm hover:bg-surface-2 transition-colors ${!activeVal ? 'text-accent font-semibold' : 'text-text-2'}`} onMouseDown={e => { e.preventDefault(); applyFilter(colKey, '') }}>All</button>
                  {col.filterOptions!.map(opt => (
                    <button key={opt.value} type="button"
                      className={`w-full text-left px-3 py-2 text-sm hover:bg-surface-2 transition-colors ${activeVal === opt.value ? 'text-accent font-semibold' : 'text-text-1'}`}
                      onMouseDown={e => { e.preventDefault(); applyFilter(colKey, opt.value) }}
                    >{opt.label}</button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </th>
    )
  }

  function GridRow({ draft }: { draft: DraftRow<T> }) {
    const isGhost = draft._key === ''
    const orig    = draft._orig
    const rowClass = [
      'border-b border-border last:border-0 transition-colors group',
      draft._saveState === 'saving' ? 'opacity-50 pointer-events-none' : '',
      draft._saveState === 'saved'  ? 'dg-row-saved' : '',
      draft._saveState === 'error'  ? 'dg-row-error' : '',
      isGhost ? 'opacity-40 hover:opacity-100 transition-opacity' : 'hover:bg-surface-2/50',
    ].filter(Boolean).join(' ')

    return (
      <tr className={rowClass}>
        {visibleCols.map(col => (
          <td key={String(col.key)}
            className={['p-0 relative overflow-visible', col.align === 'right' ? 'text-right' : '', col.className ?? ''].filter(Boolean).join(' ')}
            style={col.minWidth ? { minWidth: col.minWidth } : undefined}
          >
            {renderCell(draft, col)}
          </td>
        ))}
        {showActions && (
          <td className="px-2 py-1">
            {isGhost ? (
              <span className="text-xs text-text-3 whitespace-nowrap">↵ new row</span>
            ) : orig ? (
              <div className="flex gap-1 justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                {onEdit   && <button className="w-7 h-7 flex items-center justify-center rounded hover:bg-surface-2 text-text-3 hover:text-accent transition-colors" title="Edit"   onClick={() => onEdit(orig)}><EditIcon  size={12}/></button>}
                {onDelete && <button className="w-7 h-7 flex items-center justify-center rounded border border-red-200 text-red-400 hover:bg-red-50 hover:text-red-600 transition-colors" title="Delete" onClick={() => onDelete(orig)}><TrashIcon size={12}/></button>}
                {renderActions?.(orig)}
              </div>
            ) : null}
          </td>
        )}
      </tr>
    )
  }

  return (
    <div
      {...{ [`data-${gridId}`]: '' }}
      className={`bg-surface border border-border rounded-xl overflow-visible ${className}`}
    >
      <div className="flex items-center gap-3 px-4 py-2 border-b border-border bg-surface-2 rounded-t-xl text-xs text-text-3 flex-wrap">
        <span className="font-semibold text-text-2">{hint ?? 'Spreadsheet mode'}</span>
        <span><Kbd>Tab</Kbd> next cell</span>
        <span><Kbd>Enter</Kbd> save &amp; next row</span>
        <span><Kbd>Esc</Kbd> cancel</span>
        {activeFilterCount > 0 && (
          <span className="flex items-center gap-1.5 text-accent font-semibold">
            <FilterIcon size={10} filled />
            {activeFilterCount} filter{activeFilterCount > 1 ? 's' : ''} active ·{' '}
            <button type="button" className="underline hover:no-underline text-text-3 hover:text-text-1 font-normal" onClick={clearAllFilters}>clear all</button>
          </span>
        )}
        {hintRight && <span className="ml-auto opacity-60">{hintRight}</span>}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-surface-2 border-b border-border">
              {visibleCols.map(col => <HeaderCell key={String(col.key)} col={col} />)}
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

      <style>{`
        [data-${gridId}] .dg-cell-input {
          display: block; width: 100%;
          padding: 8px 10px;
          background: transparent; border: none; outline: none;
          font-size: 13px; color: inherit; font-family: inherit;
        }
        [data-${gridId}] .dg-cell-input:focus {
          background: rgba(46,90,40,.06);
          box-shadow: inset 0 0 0 2px var(--color-accent,#2d6a4f);
          border-radius: 4px;
        }
        [data-${gridId}] .dg-cell-input::placeholder { color: var(--color-text-3,#9ca3af); font-weight: 400; }
        [data-${gridId}] .dg-row-saved td { animation: dgSaveFlash .65s ease; }
        [data-${gridId}] .dg-row-error td { box-shadow: inset 0 0 0 2px #e53e3e; }
        @keyframes dgSaveFlash { 0% { background: rgba(46,90,40,.18); } 100% { background: transparent; } }
      `}</style>
    </div>
  )
}

// ── GridToggleButton ──────────────────────────────────────────────────────────

export function GridToggleButton({
  active, onToggle, label = 'Grid Edit',
}: { active: boolean; onToggle: () => void; label?: string }) {
  return (
    <button onClick={onToggle}
      className={`flex items-center gap-2 px-3 py-2 text-sm font-semibold rounded-lg border transition-colors
        ${active ? 'bg-accent text-white border-accent' : 'border-border text-text-2 hover:border-accent hover:text-accent'}`}
    >
      <GridIcon size={14} />{label}
    </button>
  )
}

// ── Icons ─────────────────────────────────────────────────────────────────────

function SortArrow({ up, active }: { up: boolean; active: boolean }) {
  return (
    <svg width="7" height="4" viewBox="0 0 7 4" fill="currentColor" className={`transition-opacity ${active ? 'opacity-100 text-accent' : 'opacity-30'}`}>
      {up ? <path d="M3.5 0L7 4H0z"/> : <path d="M3.5 4L0 0h7z"/>}
    </svg>
  )
}
function FilterIcon({ size = 12, filled = false }: { size?: number; filled?: boolean }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>
}
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
  return <kbd className="inline-flex items-center justify-center px-1.5 py-0.5 rounded border border-border bg-surface text-text-2 text-xs font-mono">{children}</kbd>
}
