import { useState, useMemo } from 'react'

export type SortDir = 'asc' | 'desc'

export function useSortFilter<T>(
  items: T[],
  defaultField: keyof T,
  defaultDir: SortDir = 'asc'
) {
  const [sortField, setSortField] = useState<keyof T>(defaultField)
  const [sortDir,   setSortDir]   = useState<SortDir>(defaultDir)
  const [filters,   setFilters]   = useState<Partial<Record<keyof T, string>>>({})

  function setSort(field: keyof T, dir: SortDir) {
    setSortField(field)
    setSortDir(dir)
  }

  function setFilter(field: keyof T, value: string) {
    setFilters(f => ({ ...f, [field]: value }))
  }

  function clearFilters() {
    setFilters({})
  }

  const sorted = useMemo(() => {
    let result = [...items]

    // Apply column filters
    for (const [field, value] of Object.entries(filters)) {
      if (!value) continue
      result = result.filter(item => String((item as any)[field]) === value)
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

  const hasActiveFilters = Object.values(filters).some(v => !!v)

  return { sorted, sortField, sortDir, filters, setSort, setFilter, clearFilters, hasActiveFilters }
}
