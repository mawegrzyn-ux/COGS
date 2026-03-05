import { useState, useMemo } from 'react'

export type SortDir = 'asc' | 'desc'

export function useSortFilter<T>(
  items: T[],
  defaultField: keyof T,
  defaultDir: SortDir = 'asc'
) {
  const [sortField, setSortField] = useState<keyof T>(defaultField)
  const [sortDir,   setSortDir]   = useState<SortDir>(defaultDir)
  const [filters,   setFilters]   = useState<Partial<Record<keyof T, string[]>>>({})

  function setSort(field: keyof T, dir: SortDir) {
    setSortField(field)
    setSortDir(dir)
  }

  function setFilter(field: keyof T, values: string[]) {
    setFilters(f => ({ ...f, [field]: values }))
  }

  function clearFilters() {
    setFilters({})
  }

  const sorted = useMemo(() => {
    let result = [...items]

    // Apply column filters — row must match ALL active filters
    for (const [field, values] of Object.entries(filters)) {
      if (!values || values.length === 0) continue
      result = result.filter(item => (values as string[]).includes(String((item as any)[field])))
    }

    // Apply sort
    result.sort((a, b) => {
      const av = (a as any)[sortField]
      const bv = (b as any)[sortField]
      const an = Number(av)
      const bn = Number(bv)
      const cmp = (!isNaN(an) && !isNaN(bn))
        ? an - bn
        : String(av ?? '').localeCompare(String(bv ?? ''))
      return sortDir === 'asc' ? cmp : -cmp
    })

    return result
  }, [items, sortField, sortDir, filters])

  const hasActiveFilters = Object.values(filters).some(v => v && v.length > 0)

  return { sorted, sortField, sortDir, filters, setSort, setFilter, clearFilters, hasActiveFilters }
}
