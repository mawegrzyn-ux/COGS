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
  filterValue?:   string
  onFilter?:      (value: string) => void
  align?:         'left' | 'right'
}

export function ColumnHeader<T>({
  label,
  field,
  sortField,
  sortDir,
  onSort,
  filterOptions,
  filterValue,
  onFilter,
  align = 'left',
}: ColumnHeaderProps<T>) {
  const [open,         setOpen]         = useState(false)
  const [filterSearch, setFilterSearch] = useState('')
  const ref       = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  const isActive  = sortField === field
  const hasFilter = !!filterValue && filterValue !== ''
  const hasFilterOptions = !!filterOptions && filterOptions.length > 0

  const visibleOptions = hasFilterOptions
    ? filterOptions!.filter(o => o.label.toLowerCase().includes(filterSearch.toLowerCase()))
    : []

  // Close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
        setFilterSearch('')
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  // Auto-focus search input when dropdown opens
  useEffect(() => {
    if (open && hasFilterOptions) {
      setTimeout(() => searchRef.current?.focus(), 50)
    }
    if (!open) setFilterSearch('')
  }, [open])

  return (
    <th className={`px-4 py-3 ${align === 'right' ? 'text-right' : 'text-left'}`}>
      <div ref={ref} className={`relative inline-block ${align === 'right' ? 'float-right' : ''}`}>

        {/* Header button */}
        <button
          onClick={() => setOpen(o => !o)}
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
          {hasFilter && <span className="w-1.5 h-1.5 rounded-full bg-accent inline-block ml-0.5" />}
        </button>

        {/* Dropdown */}
        {open && (
          <div className="absolute z-50 top-full left-0 mt-1 w-52 bg-surface border border-border rounded-lg shadow-lg overflow-hidden">

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
                <div className="px-3 py-1.5 text-xs text-text-3 font-semibold uppercase tracking-wide border-t border-b border-border bg-surface-2">
                  Filter
                </div>

                {/* Search input */}
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

                {/* Options list */}
                <div className="max-h-44 overflow-y-auto">
                  <button
                    className={`w-full text-left px-3 py-2 text-sm hover:bg-surface-2 transition-colors
                      ${!filterValue ? 'text-accent font-semibold' : 'text-text-1'}`}
                    onMouseDown={e => { e.preventDefault(); onFilter(''); setOpen(false); setFilterSearch('') }}
                  >
                    All
                  </button>
                  {visibleOptions.length === 0 ? (
                    <div className="px-3 py-2 text-sm text-text-3 italic">No matches</div>
                  ) : visibleOptions.map(opt => (
                    <button
                      key={opt.value}
                      className={`w-full text-left px-3 py-2 text-sm hover:bg-surface-2 transition-colors
                        ${filterValue === opt.value ? 'text-accent font-semibold' : 'text-text-1'}`}
                      onMouseDown={e => { e.preventDefault(); onFilter(opt.value); setOpen(false); setFilterSearch('') }}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </th>
  )
}

// ── Icons (self-contained so ColumnHeader has no external icon deps) ──────────

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
