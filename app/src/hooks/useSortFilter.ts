import { useState, useMemo } from 'react'

export type SortDir = 'asc' | 'desc'

type Filters<T> = Partial<Record<keyof T, string[]>>

export function useSortFilter<T>(
  items: T[],
  defaultField: keyof T,
  defaultDir: SortDir = 'asc'
) {
  const [sortField, setSortField] = useState<keyof T>(defaultField)
  const [sortDir,   setSortDir]   = useState<SortDir>(defaultDir)
  const [filters,   setFilters]   = useState<Filters<T>>({})

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

  function getFilter(field: keyof T): string[] {
    return filters[field] ?? []
  }

  const sorted = useMemo(() => {
    let result = [...items]

    for (const [field, values] of Object.entries(filters) as [string, string[] | undefined][]) {
      if (!values || values.length === 0) continue
      result = result.filter(item => values.includes(String((item as any)[field])))
    }

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

  const hasActiveFilters = Object.values(filters).some((v): v is string[] => !!v && v.length > 0)

  return { sorted, sortField, sortDir, getFilter, setSort, setFilter, clearFilters, hasActiveFilters }
}
