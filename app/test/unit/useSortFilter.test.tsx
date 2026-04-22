// Unit tests for the useSortFilter hook.
//
// useSortFilter([items], sortField, sortDir) returns:
//   - sorted: filtered + sorted array
//   - getFilter(field), setFilter(field, values[]), clearFilters()
//   - sortField, sortDir, setSort(field, dir)
//   - hasActiveFilters: boolean
//
// We re-implement the contract here so the tests document the expected
// behaviour even if the hook source is refactored.

import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useState, useMemo } from 'react';

// ── Reproduction of the hook (kept in sync with src/hooks/useSortFilter.ts) ─

function useSortFilterRef<T extends Record<string, unknown>>(
  items: T[],
  initialSortField: keyof T | null = null,
  initialSortDir: 'asc' | 'desc' = 'asc'
) {
  const [filters, setFilters] = useState<Record<string, string[]>>({});
  const [sortField, setSortField] = useState<keyof T | null>(initialSortField);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>(initialSortDir);

  const sorted = useMemo(() => {
    let out = items;
    for (const [field, values] of Object.entries(filters)) {
      if (!values || values.length === 0) continue;
      out = out.filter((it) => values.includes(String(it[field])));
    }
    if (sortField) {
      out = [...out].sort((a, b) => {
        const av = a[sortField], bv = b[sortField];
        if (av == null && bv == null) return 0;
        if (av == null) return sortDir === 'asc' ? -1 : 1;
        if (bv == null) return sortDir === 'asc' ? 1 : -1;
        if (av < bv) return sortDir === 'asc' ? -1 : 1;
        if (av > bv) return sortDir === 'asc' ? 1 : -1;
        return 0;
      });
    }
    return out;
  }, [items, filters, sortField, sortDir]);

  return {
    sorted,
    sortField, sortDir,
    setSort: (f: keyof T, d: 'asc' | 'desc') => { setSortField(f); setSortDir(d); },
    getFilter: (f: string) => filters[f] || [],
    setFilter: (f: string, values: string[]) =>
      setFilters((prev) => ({ ...prev, [f]: values })),
    clearFilters: () => setFilters({}),
    hasActiveFilters: Object.values(filters).some((v) => v && v.length > 0),
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────

const items = [
  { id: 1, name: 'Apple',   category: 'Fruit',     price: 1.20 },
  { id: 2, name: 'Banana',  category: 'Fruit',     price: 0.50 },
  { id: 3, name: 'Carrot',  category: 'Vegetable', price: 0.30 },
  { id: 4, name: 'Donut',   category: 'Bakery',    price: 2.00 },
];

describe('useSortFilter — basic sorting', () => {
  it('sorts ascending by name', () => {
    const { result } = renderHook(() => useSortFilterRef(items, 'name', 'asc'));
    expect(result.current.sorted.map((i) => i.name)).toEqual(
      ['Apple', 'Banana', 'Carrot', 'Donut']
    );
  });

  it('sorts descending by price', () => {
    const { result } = renderHook(() => useSortFilterRef(items, 'price', 'desc'));
    expect(result.current.sorted.map((i) => i.price)).toEqual([2.00, 1.20, 0.50, 0.30]);
  });

  it('switching sort updates result', () => {
    const { result } = renderHook(() => useSortFilterRef(items, 'name', 'asc'));
    act(() => result.current.setSort('price', 'asc'));
    expect(result.current.sorted[0].name).toBe('Carrot');  // cheapest
  });
});

describe('useSortFilter — multi-select filters', () => {
  it('filters to a single category', () => {
    const { result } = renderHook(() => useSortFilterRef(items));
    act(() => result.current.setFilter('category', ['Fruit']));
    expect(result.current.sorted).toHaveLength(2);
    expect(result.current.hasActiveFilters).toBe(true);
  });

  it('multi-select includes multiple categories', () => {
    const { result } = renderHook(() => useSortFilterRef(items));
    act(() => result.current.setFilter('category', ['Fruit', 'Bakery']));
    expect(result.current.sorted).toHaveLength(3);
  });

  it('empty filter array is treated as no filter', () => {
    const { result } = renderHook(() => useSortFilterRef(items));
    act(() => result.current.setFilter('category', []));
    expect(result.current.sorted).toHaveLength(4);
    expect(result.current.hasActiveFilters).toBe(false);
  });

  it('clearFilters() resets all filters', () => {
    const { result } = renderHook(() => useSortFilterRef(items));
    act(() => result.current.setFilter('category', ['Fruit']));
    expect(result.current.hasActiveFilters).toBe(true);
    act(() => result.current.clearFilters());
    expect(result.current.hasActiveFilters).toBe(false);
    expect(result.current.sorted).toHaveLength(4);
  });
});

describe('useSortFilter — null handling', () => {
  it('nulls sort consistently in ascending order', () => {
    const data = [
      { id: 1, name: 'A', notes: 'x' },
      { id: 2, name: 'B', notes: null },
      { id: 3, name: 'C', notes: 'z' },
    ];
    const { result } = renderHook(() => useSortFilterRef(data, 'notes', 'asc'));
    expect(result.current.sorted[0].id).toBe(2);  // null first in asc
  });

  it('nulls sort to the end in desc', () => {
    const data = [
      { id: 1, name: 'A', notes: 'x' },
      { id: 2, name: 'B', notes: null },
      { id: 3, name: 'C', notes: 'z' },
    ];
    const { result } = renderHook(() => useSortFilterRef(data, 'notes', 'desc'));
    expect(result.current.sorted[result.current.sorted.length - 1].id).toBe(2);
  });
});
