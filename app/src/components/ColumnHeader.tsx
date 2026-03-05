import { useState, useEffect, useRef } from 'react'
import { SortDir } from '../hooks/useSortFilter'

export interface FilterOption {
  label: string
  value: string
}

interface ColumnHeaderProps<T> {
  label:          string
  field:          keyof T
  sortField:      keyof T
  sortDir:        SortDir
  onSort:         (field: keyof T, dir: SortDir) => void
  filterOptions?: FilterOption[]
  filterValues?:  string[]
  onFilter?:      (values: string[]) => void
  align?:         'left' | 'right'
}

export function ColumnHeader<T>({
  label,
  field,
  sortField,
  sortDir,
  onSort,
  filterOptions,
  filterValues = [] as string[],
  onFilter,
  align = 'left',
}: ColumnHeaderProps<T>) {
  const [open,         setOpen]         = useState(false)
  const [filterSearch, setFilterSearch] = useState('')
  const [dropPos,      setDropPos]      = useState<{ top: number; left: number } | null>(null)
  const ref       = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  const isActive         = sortField === field
  const hasFilter        = filterValues.length > 0
  const hasFilterOptions = !!filterOptions && filterOptions.length > 0

  const visibleOptions = hasFilterOptions
    ? filterOptions!.filter(o => o.label.toLowerCase().includes(filterSearch.toLowerCase()))
    : []

  function openDropdown() {
    if (!ref.current) return
    const r = ref.current.getBoundingClientRect()
    setDropPos({ top: r.bottom + window.scrollY + 4, left: r.left + window.scrollX })
    setOpen(true)
  }

  function toggleValue(value: string) {
    if (!onFilter) return
    if (filterValues.includes(value)) {
      onFilter(filterValues.filter(v => v !== value))
    } else {
      onFilter([...filterValues, value])
    }
  }

  // Close on outside click
  useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
        setFilterSearch('')
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  // Reposition on scroll/resize
  useEffect(() => {
    if (!open) return
    function reposition() {
      if (!ref.current) return
      const r = ref.current.getBoundingClientRect()
      setDropPos({ top: r.bottom + window.scrollY + 4, left: r.left + window.scrollX })
    }
    window.addEventListener('scroll', reposition, true)
    window.addEventListener('resize', reposition)
    return () => { window.removeEventListener('scroll', reposition, true); window.removeEventListener('resize', reposition) }
  }, [open])

  // Auto-focus search when dropdown opens
  useEffect(() => {
    if (open && hasFilterOptions) setTimeout(() => searchRef.current?.focus(), 50)
    if (!open) setFilterSearch('')
  }, [open])

  return (
    <th className={`px-4 py-3 ${align === 'right' ? 'text-right' : 'text-left'}`}>
      <div ref={ref} className={`relative inline-block ${align === 'right' ? 'float-right' : ''}`}>

        {/* Header button */}
        <button
          onClick={() => open ? setOpen(false) : openDropdown()}
          className={`flex items-center gap-1 text-xs font-semibold uppercase tracking-wide transition-colors select-none
            ${isActive || hasFilter ? 'text-accent' : 'text-text-2 hover:text-text-1'}`}
        >
          {label}
          <span className="ml-0.5">
            {isActive
              ? (sortDir === 'asc' ? <ChevronUpIcon size={10} /> : <ChevronDownIcon size={10} />)
              : <ChevronsUpDownIcon size={10} />
            }
          </span>
          {hasFilter && (
            <span className="ml-0.5 px-1 rounded-full bg-accent text-white text-[9px] font-bold leading-4 min-w-[14px] text-center">
              {filterValues.length}
            </span>
          )}
        </button>

        {/* Dropdown — fixed positioning to escape overflow:hidden ancestors */}
        {open && dropPos && (
          <div
            className="w-56 bg-surface border border-border rounded-lg shadow-lg overflow-hidden"
            style={{ position: 'fixed', top: dropPos.top, left: dropPos.left, zIndex: 99999 }}
          >
            {/* Sort section */}
            <div className="px-3 py-1.5 text-xs text-text-3 font-semibold uppercase tracking-wide border-b border-border bg-surface-2">
              Sort
            </div>
            <button
              className={`w-full text-left px-3 py-2 text-sm hover:bg-surface-2 transition-colors flex items-center gap-2
                ${isActive && sortDir === 'asc' ? 'text-accent font-semibold' : 'text-text-1'}`}
              onMouseDown={e => { e.preventDefault(); onSort(field, 'asc'); setOpen(false) }}
            >
              <ChevronUpIcon size={12} /> Ascending
            </button>
            <button
              className={`w-full text-left px-3 py-2 text-sm hover:bg-surface-2 transition-colors flex items-center gap-2
                ${isActive && sortDir === 'desc' ? 'text-accent font-semibold' : 'text-text-1'}`}
              onMouseDown={e => { e.preventDefault(); onSort(field, 'desc'); setOpen(false) }}
            >
              <ChevronDownIcon size={12} /> Descending
            </button>

            {/* Filter section */}
            {hasFilterOptions && onFilter && (
              <>
                <div className="px-3 py-1.5 text-xs text-text-3 font-semibold uppercase tracking-wide border-t border-b border-border bg-surface-2 flex items-center justify-between">
                  <span>Filter</span>
                  {hasFilter && (
                    <button
                      className="text-accent hover:underline font-normal normal-case tracking-normal"
                      onMouseDown={e => { e.preventDefault(); onFilter([]) }}
                    >
                      Clear all
                    </button>
                  )}
                </div>

                {/* Search */}
                <div className="px-2 py-2 border-b border-border">
                  <div className="relative">
                    <SearchIcon className="absolute left-2 top-1/2 -translate-y-1/2 text-text-3" />
                    <input
                      ref={searchRef}
                      type="text"
                      value={filterSearch}
                      onChange={e => setFilterSearch(e.target.value)}
                      onMouseDown={e => e.stopPropagation()}
                      placeholder="Search…"
                      className="w-full pl-7 pr-2 py-1 text-sm bg-surface-2 border border-border rounded-md outline-none focus:border-accent transition-colors"
                    />
                  </div>
                </div>

                {/* Multi-select options — dropdown stays open while selecting */}
                <div className="max-h-52 overflow-y-auto">
                  {visibleOptions.length === 0 ? (
                    <div className="px-3 py-2 text-sm text-text-3 italic">No matches</div>
                  ) : visibleOptions.map(opt => {
                    const checked = filterValues.includes(opt.value)
                    return (
                      <button
                        key={opt.value}
                        className={`w-full text-left px-3 py-2 text-sm hover:bg-surface-2 transition-colors flex items-center gap-2.5
                          ${checked ? 'text-accent' : 'text-text-1'}`}
                        onMouseDown={e => { e.preventDefault(); toggleValue(opt.value) }}
                      >
                        <span className={`w-3.5 h-3.5 rounded border flex-shrink-0 flex items-center justify-center transition-colors
                          ${checked ? 'bg-accent border-accent' : 'border-border'}`}>
                          {checked && <CheckIcon />}
                        </span>
                        <span className="truncate">{opt.label}</span>
                      </button>
                    )
                  })}
                </div>

                {/* Footer */}
                <div className="px-2 py-2 border-t border-border bg-surface-2">
                  <button
                    className="w-full py-1.5 text-xs font-semibold rounded-md bg-accent text-white hover:opacity-90 transition-opacity"
                    onMouseDown={e => { e.preventDefault(); setOpen(false); setFilterSearch('') }}
                  >
                    {hasFilter ? `Apply (${filterValues.length} selected)` : 'Close'}
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </th>
  )
}

//   ── Icons ─────────────────────────────────────────────────────────────────────

function ChevronUpIcon({ size = 16 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="18 15 12 9 6 15"/></svg>
}
function ChevronDownIcon({ size = 16 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="6 9 12 15 18 9"/></svg>
}
function ChevronsUpDownIcon({ size = 16 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="18 15 12 9 6 15" opacity="0.4"/><polyline points="6 9 12 15 18 9" opacity="0.4"/></svg>
}
function SearchIcon({ className = '' }: { className?: string }) {
  return <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className={className}><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
}
function CheckIcon() {
  return <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3.5" strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg>
}
