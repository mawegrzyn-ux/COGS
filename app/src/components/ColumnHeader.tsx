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
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const isActive  = sortField === field
  const hasFilter = !!filterValue && filterValue !== ''

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  return (
    <th className={`px-4 py-3 ${align === 'right' ? 'text-right' : 'text-left'}`}>
      <div ref={ref} className={`relative inline-block ${align === 'right' ? 'float-right' : ''}`}>
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

        {open && (
          <div className="absolute z-50 top-full left-0 mt-1 w-44 bg-surface border border-border rounded-lg shadow-lg overflow-hidden">
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

            {filterOptions && filterOptions.length > 0 && onFilter && (
              <>
                <div className="px-3 py-1.5 text-xs text-text-3 font-semibold uppercase tracking-wide border-t border-b border-border bg-surface-2">
                  Filter
                </div>
                <button
                  className={`w-full text-left px-3 py-2 text-sm hover:bg-surface-2 transition-colors
                    ${!filterValue ? 'text-accent font-semibold' : 'text-text-1'}`}
                  onMouseDown={e => { e.preventDefault(); onFilter(''); setOpen(false) }}
                >
                  All
                </button>
                {filterOptions.map(opt => (
                  <button
                    key={opt.value}
                    className={`w-full text-left px-3 py-2 text-sm hover:bg-surface-2 transition-colors
                      ${filterValue === opt.value ? 'text-accent font-semibold' : 'text-text-1'}`}
                    onMouseDown={e => { e.preventDefault(); onFilter(opt.value); setOpen(false) }}
                  >
                    {opt.label}
                  </button>
                ))}
              </>
            )}
          </div>
        )}
      </div>
    </th>
  )
}

// ── Icons (self-contained so ColumnHeader has no external icon deps) ───────────

function ChevronUpIcon({ size = 16 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="18 15 12 9 6 15"/></svg>
}

function ChevronDownIcon({ size = 16 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="6 9 12 15 18 9"/></svg>
}

function ChevronsUpDownIcon({ size = 16 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="18 15 12 9 6 15" opacity="0.4"/><polyline points="6 9 12 15 18 9" opacity="0.4"/></svg>
}
