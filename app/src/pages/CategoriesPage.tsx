import { useState, useEffect, useCallback, useMemo } from 'react'
import { useApi } from '../hooks/useApi'
import { PageHeader, Modal, Field, EmptyState, Spinner, ConfirmDialog, Toast } from '../components/ui'
import TranslationEditor from '../components/TranslationEditor'

// ── Types ─────────────────────────────────────────────────────────────────────

interface CategoryGroup {
  id:             number
  name:           string
  sort_order:     number
  category_count: number
}

interface Category {
  id:               number
  name:             string
  sort_order:       number
  group_id:         number | null
  group_name:       string | null
  for_ingredients:  boolean
  for_recipes:      boolean
  for_sales_items:  boolean
}

type ToastState = { message: string; type: 'success' | 'error' }

const blankCatForm = {
  name: '', group_id: '' as number | '',
  for_ingredients: false, for_recipes: false, for_sales_items: false,
  sort_order: 0,
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function CategoriesPage() {
  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="Categories"
        subtitle="Manage categories and groups. Categories can be shared across inventory, recipes, and sales items."
        tutorialPrompt="How do Categories and Groups work in COGS Manager? Explain the new group/category structure with scope flags."
      />
      <div className="flex-1 overflow-hidden">
        <CategoryManager />
      </div>
    </div>
  )
}

// ── Category Manager ──────────────────────────────────────────────────────────

function CategoryManager() {
  const api = useApi()

  const [groups,          setGroups]          = useState<CategoryGroup[]>([])
  const [categories,      setCategories]      = useState<Category[]>([])
  const [loading,         setLoading]         = useState(true)
  const [selectedGroupId, setSelectedGroupId] = useState<number | null | 'ungrouped'>(null)
  const [toast,           setToast]           = useState<ToastState | null>(null)

  // Group modal state
  const [groupModal,      setGroupModal]      = useState<false | 'new' | CategoryGroup>(false)
  const [groupName,       setGroupName]       = useState('')
  const [groupSaving,     setGroupSaving]     = useState(false)
  const [groupNameError,  setGroupNameError]  = useState('')

  // Category modal state
  const [catModal,        setCatModal]        = useState<false | 'new' | Category>(false)
  const [catForm,         setCatForm]         = useState(blankCatForm)
  const [catSaving,       setCatSaving]       = useState(false)
  const [catFormError,    setCatFormError]    = useState('')

  // Inline edit state
  const [editingCatId,   setEditingCatId]   = useState<number | null>(null)
  const [editingName,    setEditingName]    = useState('')
  const [editingGroupId, setEditingGroupId] = useState<number | ''>('')
  const [inlineSaving,   setInlineSaving]   = useState(false)

  // Scope filter — narrows the right-panel list by scope flag within the
  // currently-selected group. 'all' = no filter; others are mutually exclusive.
  const [scopeFilter, setScopeFilter] = useState<'all' | 'ingredients' | 'recipes' | 'sales'>('all')

  // Confirm deletes
  const [confirmDeleteGroup, setConfirmDeleteGroup] = useState<CategoryGroup | null>(null)
  const [confirmDeleteCat,   setConfirmDeleteCat]   = useState<Category | null>(null)

  // ── Drag-drop state ──────────────────────────────────────────────────────────
  // `dragCatId`       — which category row is currently being dragged
  // `dragOverRowId`   — which category row is hovered for reordering
  // `dragOverGroupId` — which group (or 'ungrouped') is hovered for a move
  // Native HTML5 DnD — no extra dependency.
  const [dragCatId,       setDragCatId]       = useState<number | null>(null)
  const [dragOverRowId,   setDragOverRowId]   = useState<number | null>(null)
  const [dragOverGroupId, setDragOverGroupId] = useState<number | 'ungrouped' | null>(null)

  // ── Load ────────────────────────────────────────────────────────────────────

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [g, c] = await Promise.all([
        api.get('/category-groups') as Promise<CategoryGroup[]>,
        api.get('/categories')      as Promise<Category[]>,
      ])
      setGroups(g || [])
      setCategories(c || [])
    } catch {
      showToast('Failed to load categories', 'error')
    } finally {
      setLoading(false)
    }
  }, [api])

  useEffect(() => { load() }, [load])

  // Auto-select a sensible default on first load so users never land on an
  // empty-state screen. Preference order:
  //   1. If any ungrouped categories exist → open the "No Group" bucket
  //      (imported categories land here by default — prior UX hid them below
  //      the groups list and users thought they had disappeared).
  //   2. Otherwise open the first group if there is one.
  useEffect(() => {
    if (loading) return
    if (selectedGroupId !== null) return
    if (categories.some(c => c.group_id === null)) {
      setSelectedGroupId('ungrouped')
    } else if (groups.length) {
      setSelectedGroupId(groups[0].id)
    }
  }, [loading, categories, groups, selectedGroupId])

  // ── Derived ──────────────────────────────────────────────────────────────────

  const ungroupedCats = useMemo(() =>
    categories.filter(c => c.group_id === null),
    [categories]
  )

  const visibleCats = useMemo(() => {
    let list: Category[]
    if (selectedGroupId === 'ungrouped') list = ungroupedCats
    else if (selectedGroupId === null) list = []
    else list = categories.filter(c => c.group_id === selectedGroupId)

    if (scopeFilter !== 'all') {
      list = list.filter(c =>
        scopeFilter === 'ingredients' ? c.for_ingredients :
        scopeFilter === 'recipes'     ? c.for_recipes :
                                         c.for_sales_items
      )
    }

    // Always sort by (sort_order ASC, id ASC). Without this, optimistic
    // reorder updates change sort_order in state but the UI keeps the old
    // array order (initial fetch order), so drags appear to do nothing.
    return [...list].sort((a, b) =>
      a.sort_order - b.sort_order || a.id - b.id
    )
  }, [categories, selectedGroupId, ungroupedCats, scopeFilter])

  const showToast = (message: string, type: 'success' | 'error' = 'success') =>
    setToast({ message, type })

  // ── Group operations ─────────────────────────────────────────────────────────

  function openGroupModal(g?: CategoryGroup) {
    setGroupModal(g || 'new')
    setGroupName(g?.name ?? '')
    setGroupNameError('')
  }

  async function saveGroup() {
    const name = groupName.trim()
    if (!name) { setGroupNameError('Name is required'); return }
    setGroupSaving(true)
    try {
      if (groupModal !== 'new' && groupModal !== false) {
        const updated: CategoryGroup = await api.put(`/category-groups/${groupModal.id}`, { name, sort_order: groupModal.sort_order })
        setGroups(prev => prev.map(g => g.id === updated.id ? updated : g))
        showToast('Group renamed.')
      } else {
        const created: CategoryGroup = await api.post('/category-groups', { name })
        setGroups(prev => [...prev, created])
        setSelectedGroupId(created.id)
        showToast('Group created.')
      }
      setGroupModal(false)
    } catch (e: unknown) {
      const msg = (e as { message?: string })?.message
      showToast(msg?.includes('already exists') ? 'A group with that name already exists.' : (msg || 'Save failed.'), 'error')
    } finally {
      setGroupSaving(false)
    }
  }

  async function deleteGroup(g: CategoryGroup) {
    try {
      await api.delete(`/category-groups/${g.id}`)
      setGroups(prev => prev.filter(x => x.id !== g.id))
      setCategories(prev => prev.map(c => c.group_id === g.id ? { ...c, group_id: null, group_name: null } : c))
      if (selectedGroupId === g.id) setSelectedGroupId(null)
      showToast('Group deleted — categories are now ungrouped.')
    } catch (e: unknown) {
      showToast((e as { message?: string })?.message || 'Delete failed.', 'error')
    }
  }

  // ── Category operations ───────────────────────────────────────────────────────

  function openCatModal(cat?: Category) {
    setCatModal(cat || 'new')
    setCatForm(cat ? {
      name: cat.name,
      group_id: cat.group_id ?? '',
      for_ingredients: cat.for_ingredients,
      for_recipes: cat.for_recipes,
      for_sales_items: cat.for_sales_items,
      sort_order: cat.sort_order,
    } : {
      ...blankCatForm,
      group_id: typeof selectedGroupId === 'number' ? selectedGroupId : '',
    })
    setCatFormError('')
  }

  async function saveCat() {
    const name = catForm.name.trim()
    if (!name) { setCatFormError('Name is required'); return }
    if (!catForm.for_ingredients && !catForm.for_recipes && !catForm.for_sales_items) {
      setCatFormError('Select at least one scope (Ingredients, Recipes, or Sales Items).'); return
    }
    setCatSaving(true)
    try {
      const body = {
        name,
        group_id: catForm.group_id || null,
        for_ingredients: catForm.for_ingredients,
        for_recipes: catForm.for_recipes,
        for_sales_items: catForm.for_sales_items,
        sort_order: catForm.sort_order,
      }
      if (catModal !== 'new' && catModal !== false) {
        const updated: Category = await api.put(`/categories/${catModal.id}`, body)
        setCategories(prev => prev.map(c => c.id === updated.id ? updated : c))
        showToast('Category updated.')
      } else {
        const created: Category = await api.post('/categories', body)
        setCategories(prev => [...prev, created])
        // Update group count locally
        if (created.group_id) {
          setGroups(prev => prev.map(g => g.id === created.group_id ? { ...g, category_count: g.category_count + 1 } : g))
        }
        showToast('Category created.')
      }
      setCatModal(false)
    } catch (e: unknown) {
      showToast((e as { message?: string })?.message || 'Save failed.', 'error')
    } finally {
      setCatSaving(false)
    }
  }

  async function deleteCat(cat: Category) {
    try {
      await api.delete(`/categories/${cat.id}`)
      setCategories(prev => prev.filter(c => c.id !== cat.id))
      if (cat.group_id) {
        setGroups(prev => prev.map(g => g.id === cat.group_id ? { ...g, category_count: Math.max(0, g.category_count - 1) } : g))
      }
      showToast('Category deleted.')
    } catch (e: unknown) {
      showToast((e as { message?: string })?.message || 'Delete failed.', 'error')
    }
  }

  // ── Toggle a scope flag inline ────────────────────────────────────────────────

  async function toggleFlag(cat: Category, flag: 'for_ingredients' | 'for_recipes' | 'for_sales_items') {
    const updated = { ...cat, [flag]: !cat[flag] }
    // Need at least one flag
    if (!updated.for_ingredients && !updated.for_recipes && !updated.for_sales_items) {
      showToast('A category must have at least one scope.', 'error'); return
    }
    try {
      const saved: Category = await api.put(`/categories/${cat.id}`, {
        name: cat.name, group_id: cat.group_id, sort_order: cat.sort_order,
        for_ingredients: updated.for_ingredients,
        for_recipes:     updated.for_recipes,
        for_sales_items: updated.for_sales_items,
      })
      setCategories(prev => prev.map(c => c.id === saved.id ? saved : c))
    } catch { showToast('Failed to update scope.', 'error') }
  }

  // ── Inline edit ──────────────────────────────────────────────────────────────

  function startInlineEdit(cat: Category) {
    setEditingCatId(cat.id)
    setEditingName(cat.name)
    setEditingGroupId(cat.group_id ?? '')
  }

  function cancelInlineEdit() {
    setEditingCatId(null)
    setEditingName('')
    setEditingGroupId('')
  }

  async function saveInlineEdit(cat: Category) {
    const name = editingName.trim()
    if (!name) return
    if (name === cat.name && (editingGroupId || null) === cat.group_id) {
      cancelInlineEdit(); return
    }
    setInlineSaving(true)
    try {
      const newGroupId = editingGroupId || null
      const saved: Category = await api.put(`/categories/${cat.id}`, {
        name,
        group_id:        newGroupId,
        for_ingredients: cat.for_ingredients,
        for_recipes:     cat.for_recipes,
        for_sales_items: cat.for_sales_items,
        sort_order:      cat.sort_order,
      })
      // Update group counts if group changed
      if (newGroupId !== cat.group_id) {
        setGroups(prev => prev.map(g => {
          if (g.id === cat.group_id)  return { ...g, category_count: Math.max(0, g.category_count - 1) }
          if (g.id === newGroupId)    return { ...g, category_count: g.category_count + 1 }
          return g
        }))
      }
      setCategories(prev => prev.map(c => c.id === saved.id ? saved : c))
      cancelInlineEdit()
      showToast('Category updated.')
    } catch (e: unknown) {
      showToast((e as { message?: string })?.message || 'Save failed.', 'error')
    } finally {
      setInlineSaving(false)
    }
  }

  // ── Drag-drop: reorder within list + move between groups ────────────────────

  // Persist a new order of categories. Each row gets sort_order = its index
  // in the array, and optionally a new group_id. Optimistic UI update with
  // rollback on failure.
  async function persistReorder(reindexed: Category[], targetGroupId: number | null | 'ungrouped' | null) {
    const snapshot = categories
    // Merge the reindexed subset back into the full list
    const reindexedMap = new Map(reindexed.map((c, i) => [c.id, { ...c, sort_order: i, group_id: targetGroupId === 'ungrouped' ? null : (typeof targetGroupId === 'number' ? targetGroupId : c.group_id) }]))
    const next = categories.map(c => reindexedMap.get(c.id) ?? c)
    setCategories(next)
    try {
      await api.post('/categories/reorder',
        reindexed.map((c, i) => ({
          id: c.id,
          group_id: targetGroupId === 'ungrouped' ? null : (typeof targetGroupId === 'number' ? targetGroupId : c.group_id),
          sort_order: i,
        }))
      )
    } catch {
      setCategories(snapshot)
      showToast('Failed to save new order.', 'error')
    }
  }

  // Drop a category onto another category in the right panel → reorder.
  async function handleDropOnRow(targetCatId: number) {
    const fromId = dragCatId
    setDragCatId(null); setDragOverRowId(null); setDragOverGroupId(null)
    if (fromId == null || fromId === targetCatId) return

    const from = categories.find(c => c.id === fromId)
    const to   = categories.find(c => c.id === targetCatId)
    if (!from || !to) return

    // Only reorder within the same logical group (including ungrouped). Moving
    // across groups should happen via the group sidebar drop target, not a row.
    if ((from.group_id ?? null) !== (to.group_id ?? null)) return

    // Same group → compute reindex. Pull `from` out, splice into `to`'s slot.
    const bucket  = categories.filter(c => (c.group_id ?? null) === (to.group_id ?? null))
                              .sort((a, b) => a.sort_order - b.sort_order)
    const without = bucket.filter(c => c.id !== fromId)
    const idx     = without.findIndex(c => c.id === targetCatId)
    const next    = [...without.slice(0, idx), from, ...without.slice(idx)]

    const groupTarget = (to.group_id ?? 'ungrouped') as number | 'ungrouped'
    await persistReorder(next, groupTarget)
    showToast('Order updated.')
  }

  // Drop a category onto a group sidebar item → move to that group, appended
  // to the end.
  async function handleDropOnGroup(targetGroup: number | 'ungrouped') {
    const fromId = dragCatId
    setDragCatId(null); setDragOverRowId(null); setDragOverGroupId(null)
    if (fromId == null) return

    const from = categories.find(c => c.id === fromId)
    if (!from) return

    const currentGroup = from.group_id ?? 'ungrouped'
    if (currentGroup === targetGroup) return

    // Append to end of target bucket.
    const bucket   = categories.filter(c => {
      const g = c.group_id ?? 'ungrouped'
      return g === targetGroup && c.id !== fromId
    }).sort((a, b) => a.sort_order - b.sort_order)
    const next     = [...bucket, from]
    const newGroupId = targetGroup === 'ungrouped' ? null : targetGroup

    await persistReorder(next, targetGroup)

    // Locally update group counts (optimistic reorder call above already
    // patched group_id in the list state).
    setGroups(prev => prev.map(g => {
      if (typeof currentGroup === 'number' && g.id === currentGroup) return { ...g, category_count: Math.max(0, g.category_count - 1) }
      if (newGroupId && g.id === newGroupId) return { ...g, category_count: g.category_count + 1 }
      return g
    }))
    // Auto-follow the category to its new group for better UX.
    setSelectedGroupId(targetGroup)
    showToast(newGroupId ? 'Moved to group.' : 'Moved to No Group.')
  }

  // ── Render ────────────────────────────────────────────────────────────────────

  if (loading) return <div className="p-6"><Spinner /></div>

  return (
    <div className="flex h-full overflow-hidden">

      {/* ── Left panel: Groups ───────────────────────────────────────────────── */}
      <div className="w-64 shrink-0 border-r border-border flex flex-col bg-surface">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <span className="text-xs font-bold uppercase tracking-wider text-text-3">Groups</span>
          <button
            className="btn-ghost p-1 text-xs flex items-center gap-1"
            onClick={() => openGroupModal()}
          >
            <PlusIcon size={12} /> Add
          </button>
        </div>

        <div className="flex-1 overflow-y-auto py-1">
          {/* "No Group" bucket — hoisted to the top and always visible so
              imported categories (which land here with group_id = null) are
              immediately discoverable. Acts as a drop target so users can
              drag categories out of any group back to No Group. */}
          {(() => {
            const active      = selectedGroupId === 'ungrouped'
            const isDropOver  = dragOverGroupId === 'ungrouped' && dragCatId != null
            return (
              <div
                onClick={() => setSelectedGroupId('ungrouped')}
                onDragOver={e => {
                  if (dragCatId == null) return
                  e.preventDefault()
                  e.dataTransfer.dropEffect = 'move'
                  if (dragOverGroupId !== 'ungrouped') setDragOverGroupId('ungrouped')
                }}
                onDragLeave={() => { if (dragOverGroupId === 'ungrouped') setDragOverGroupId(null) }}
                onDrop={e => { e.preventDefault(); handleDropOnGroup('ungrouped') }}
                className={`flex items-center gap-2 px-4 py-2.5 cursor-pointer transition-colors
                  ${active ? 'bg-amber-50 text-amber-700' : 'hover:bg-surface-2 text-text-2'}
                  ${isDropOver ? 'ring-2 ring-inset ring-accent bg-accent-dim' : ''}`}
              >
                <span className="flex-1 text-sm font-semibold">No Group</span>
                <span className={`text-xs px-1.5 py-0.5 rounded-full font-mono shrink-0
                  ${active ? 'bg-amber-100 text-amber-700' : 'bg-surface-2 text-text-3'}`}>
                  {ungroupedCats.length}
                </span>
              </div>
            )
          })()}
          {groups.length > 0 && (
            <div className="mx-4 my-1 border-t border-border" />
          )}
          {groups.length === 0 && ungroupedCats.length === 0 && (
            <p className="text-xs text-text-3 italic px-4 py-3">No groups yet.</p>
          )}
          {groups.map(g => {
            const active     = selectedGroupId === g.id
            const isDropOver = dragOverGroupId === g.id && dragCatId != null
            return (
              <div
                key={g.id}
                onClick={() => setSelectedGroupId(g.id)}
                onDragOver={e => {
                  if (dragCatId == null) return
                  e.preventDefault()
                  e.dataTransfer.dropEffect = 'move'
                  if (dragOverGroupId !== g.id) setDragOverGroupId(g.id)
                }}
                onDragLeave={() => { if (dragOverGroupId === g.id) setDragOverGroupId(null) }}
                onDrop={e => { e.preventDefault(); handleDropOnGroup(g.id) }}
                className={`flex items-center gap-2 px-4 py-2.5 cursor-pointer transition-colors group
                  ${active ? 'bg-accent-dim text-accent' : 'hover:bg-surface-2 text-text-1'}
                  ${isDropOver ? 'ring-2 ring-inset ring-accent bg-accent-dim' : ''}`}
              >
                <span className="flex-1 text-sm font-semibold truncate">{g.name}</span>
                <span className={`text-xs px-1.5 py-0.5 rounded-full font-mono shrink-0
                  ${active ? 'bg-accent/20 text-accent' : 'bg-surface-2 text-text-3'}`}>
                  {g.category_count}
                </span>
                <div className="hidden group-hover:flex items-center gap-1 shrink-0" onClick={e => e.stopPropagation()}>
                  <button
                    className="p-0.5 rounded hover:text-accent transition-colors"
                    onClick={() => openGroupModal(g)}
                    title="Rename"
                  ><EditIcon size={11} /></button>
                  <button
                    className="p-0.5 rounded hover:text-red-500 transition-colors"
                    onClick={() => setConfirmDeleteGroup(g)}
                    title="Delete group"
                  ><TrashIcon size={11} /></button>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* ── Right panel: Categories ──────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b border-border bg-surface shrink-0 gap-4">
          <div className="min-w-0">
            <span className="text-sm font-bold text-text-1">
              {selectedGroupId === 'ungrouped'
                ? 'No Group'
                : selectedGroupId
                  ? (groups.find(g => g.id === selectedGroupId)?.name ?? 'Categories')
                  : 'Categories'}
            </span>
            <p className="text-xs text-text-3 mt-0.5">
              Toggle pills to set scope. <strong>Drag rows</strong> to reorder within this group, or drop onto a group on the left to move.
            </p>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            {/* Scope filter chips */}
            <div className="flex items-center gap-1">
              {([
                { k: 'all',         label: 'All' },
                { k: 'ingredients', label: 'Inventory' },
                { k: 'recipes',     label: 'Recipes' },
                { k: 'sales',       label: 'Sales' },
              ] as const).map(({ k, label }) => {
                const on = scopeFilter === k
                return (
                  <button
                    key={k}
                    onClick={() => setScopeFilter(k)}
                    className={`text-xs px-2.5 py-1 rounded-full font-medium border transition-colors
                      ${on
                        ? 'bg-accent text-white border-accent'
                        : 'bg-surface-2 text-text-3 border-border hover:text-text-1'}`}
                    title={k === 'all' ? 'Show all categories' : `Show only categories scoped to ${label}`}
                  >
                    {label}
                  </button>
                )
              })}
            </div>
            <button
              className="btn-primary px-3 py-1.5 text-xs flex items-center gap-1.5"
              onClick={() => openCatModal()}
            >
              <PlusIcon size={12} /> Add Category
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {selectedGroupId === null ? (
            groups.length === 0 ? (
              <EmptyState
                message="Create a group first, then add categories to it."
                action={
                  <button className="btn-primary px-4 py-2 text-sm" onClick={() => openGroupModal()}>
                    Add Group
                  </button>
                }
              />
            ) : (
              <EmptyState message="Select a group on the left to view its categories." />
            )
          ) : visibleCats.length === 0 ? (
            <EmptyState
              message={selectedGroupId === 'ungrouped' ? 'No ungrouped categories.' : 'No categories in this group yet.'}
              action={
                <button className="btn-primary px-4 py-2 text-sm" onClick={() => openCatModal()}>
                  Add Category
                </button>
              }
            />
          ) : (
            <div className="space-y-1.5">
              {/* Column header hints */}
              <div className="flex items-center gap-3 px-4 pb-1">
                <span className="flex-1 text-xs text-text-3 uppercase tracking-wide font-semibold">Category</span>
                <span className="text-xs text-text-3 w-36 text-left">Group</span>
                <span className="text-xs text-text-3 w-40 text-center">Scope</span>
                <span className="w-16" />
              </div>
              {visibleCats.map(cat => {
                const isEditing   = editingCatId === cat.id
                const isDragging  = dragCatId === cat.id
                const isDropOver  = dragOverRowId === cat.id && dragCatId != null && dragCatId !== cat.id
                return (
                  <div
                    key={cat.id}
                    // Only draggable when not inline-editing — otherwise the
                    // drag gesture conflicts with text selection in the input.
                    draggable={!isEditing}
                    onDragStart={e => {
                      if (isEditing) return
                      e.dataTransfer.effectAllowed = 'move'
                      try { e.dataTransfer.setData('text/plain', String(cat.id)) } catch { /* ignore */ }
                      setDragCatId(cat.id)
                    }}
                    onDragOver={e => {
                      if (dragCatId == null || dragCatId === cat.id) return
                      // Only reorder within same group
                      const from = categories.find(c => c.id === dragCatId)
                      if (!from || (from.group_id ?? null) !== (cat.group_id ?? null)) return
                      e.preventDefault()
                      e.dataTransfer.dropEffect = 'move'
                      if (dragOverRowId !== cat.id) setDragOverRowId(cat.id)
                    }}
                    onDragLeave={() => { if (dragOverRowId === cat.id) setDragOverRowId(null) }}
                    onDrop={e => { e.preventDefault(); handleDropOnRow(cat.id) }}
                    onDragEnd={() => { setDragCatId(null); setDragOverRowId(null); setDragOverGroupId(null) }}
                    className={`flex items-center gap-3 bg-surface border rounded-lg px-4 py-2 hover:bg-surface-2 transition-colors
                      ${isEditing ? 'cursor-text' : 'cursor-grab active:cursor-grabbing'}
                      ${isDragging ? 'opacity-40' : ''}
                      ${isDropOver ? 'border-accent ring-2 ring-accent/40' : 'border-border'}`}
                  >
                    {/* Drag-handle affordance — visual hint that the row is
                        draggable. The whole row is actually the drag source
                        (native HTML5 DnD), so this is just a dot-grip icon. */}
                    {!isEditing && (
                      <span className="text-text-3 select-none text-xs opacity-60 shrink-0" aria-hidden>⠿</span>
                    )}

                    {/* Name — editable inline */}
                    {isEditing ? (
                      <input
                        className="input flex-1 text-sm py-1"
                        value={editingName}
                        onChange={e => setEditingName(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') saveInlineEdit(cat); if (e.key === 'Escape') cancelInlineEdit() }}
                        autoFocus
                      />
                    ) : (
                      <span
                        className="flex-1 text-sm font-semibold text-text-1 cursor-text hover:text-accent transition-colors"
                        title="Click to edit name"
                        onClick={() => startInlineEdit(cat)}
                      >{cat.name}</span>
                    )}

                    {/* Group — dropdown inline */}
                    {isEditing ? (
                      <select
                        className="input text-xs py-1 w-36"
                        value={editingGroupId}
                        onChange={e => setEditingGroupId(e.target.value ? Number(e.target.value) : '')}
                      >
                        <option value="">— No Group —</option>
                        {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                      </select>
                    ) : (
                      <span
                        className="w-36 text-xs text-text-3 truncate cursor-pointer hover:text-accent transition-colors"
                        title="Click to change group"
                        onClick={() => startInlineEdit(cat)}
                      >
                        {cat.group_name || <span className="italic opacity-60">No group</span>}
                      </span>
                    )}

                    {/* Scope toggle pills */}
                    <div className="flex items-center gap-1.5 shrink-0 w-40 justify-center">
                      <ScopePill
                        label="Inventory"
                        active={cat.for_ingredients}
                        colour="blue"
                        onClick={() => toggleFlag(cat, 'for_ingredients')}
                      />
                      <ScopePill
                        label="Recipes"
                        active={cat.for_recipes}
                        colour="green"
                        onClick={() => toggleFlag(cat, 'for_recipes')}
                      />
                      <ScopePill
                        label="Sales"
                        active={cat.for_sales_items}
                        colour="purple"
                        onClick={() => toggleFlag(cat, 'for_sales_items')}
                      />
                    </div>

                    {/* Actions */}
                    {isEditing ? (
                      <div className="flex items-center gap-1 shrink-0 w-16 justify-end">
                        <button
                          className="w-6 h-6 flex items-center justify-center rounded bg-accent text-white hover:bg-accent-mid transition-colors disabled:opacity-50"
                          onClick={() => saveInlineEdit(cat)}
                          disabled={inlineSaving || !editingName.trim()}
                          title="Save"
                        ><CheckIcon size={12} /></button>
                        <button
                          className="w-6 h-6 flex items-center justify-center rounded hover:bg-surface-2 text-text-3 transition-colors"
                          onClick={cancelInlineEdit}
                          title="Cancel"
                        ><XIcon size={12} /></button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1 shrink-0 w-16 justify-end">
                        <button
                          className="w-6 h-6 flex items-center justify-center rounded hover:bg-surface-2 text-text-3 hover:text-accent transition-colors"
                          onClick={() => openCatModal(cat)}
                          title="Edit (full form)"
                        ><EditIcon size={12} /></button>
                        <button
                          className="w-6 h-6 flex items-center justify-center rounded border border-red-200 text-red-400 hover:bg-red-50 transition-colors"
                          onClick={() => setConfirmDeleteCat(cat)}
                          title="Delete category"
                        ><TrashIcon size={12} /></button>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* ── Group modal ──────────────────────────────────────────────────────── */}
      {groupModal !== false && (
        <Modal
          title={groupModal === 'new' ? 'New Group' : 'Rename Group'}
          onClose={() => setGroupModal(false)}
          width="max-w-sm"
        >
          <Field label="Group Name" required error={groupNameError}>
            <input
              className="input w-full"
              value={groupName}
              onChange={e => setGroupName(e.target.value)}
              placeholder="e.g. Proteins, Beverages…"
              autoFocus
              onKeyDown={e => { if (e.key === 'Enter') saveGroup() }}
            />
          </Field>
          <div className="flex gap-3 justify-end pt-2">
            <button className="btn-ghost px-4 py-2 text-sm" onClick={() => setGroupModal(false)}>Cancel</button>
            <button className="btn-primary px-4 py-2 text-sm" onClick={saveGroup} disabled={groupSaving}>
              {groupSaving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </Modal>
      )}

      {/* ── Category modal ───────────────────────────────────────────────────── */}
      {catModal !== false && (
        <Modal
          title={catModal === 'new' ? 'New Category' : 'Edit Category'}
          onClose={() => setCatModal(false)}
          width="max-w-sm"
        >
          <div className="space-y-4">
            <Field label="Name" required error={catFormError}>
              <input
                className="input w-full"
                value={catForm.name}
                onChange={e => setCatForm(f => ({ ...f, name: e.target.value }))}
                placeholder="e.g. Chicken, Dairy, Burgers…"
                autoFocus
              />
            </Field>

            <Field label="Group">
              <select
                className="input w-full"
                value={catForm.group_id}
                onChange={e => setCatForm(f => ({ ...f, group_id: e.target.value ? Number(e.target.value) : '' }))}
              >
                <option value="">— No Group —</option>
                {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
            </Field>

            <Field label="Appears in">
              <div className="flex flex-col gap-2 pt-0.5">
                {([
                  { key: 'for_ingredients', label: 'Inventory (Ingredients)', colour: 'blue' },
                  { key: 'for_recipes',     label: 'Recipes',                 colour: 'green' },
                  { key: 'for_sales_items', label: 'Sales Items',             colour: 'purple' },
                ] as const).map(({ key, label }) => (
                  <label key={key} className="flex items-center gap-2.5 cursor-pointer">
                    <input
                      type="checkbox"
                      className="w-4 h-4 accent-accent"
                      checked={catForm[key]}
                      onChange={e => setCatForm(f => ({ ...f, [key]: e.target.checked }))}
                    />
                    <span className="text-sm text-text-1">{label}</span>
                  </label>
                ))}
              </div>
            </Field>

            {/* Translations — only for existing categories */}
            {catModal !== 'new' && typeof catModal === 'object' && catModal?.id != null && (
              <TranslationEditor
                entityType="category"
                entityId={catModal.id}
                fields={['name']}
                compact
              />
            )}
          </div>

          <div className="flex gap-3 justify-end pt-4">
            <button className="btn-ghost px-4 py-2 text-sm" onClick={() => setCatModal(false)}>Cancel</button>
            <button className="btn-primary px-4 py-2 text-sm" onClick={saveCat} disabled={catSaving}>
              {catSaving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </Modal>
      )}

      {/* Confirm deletes */}
      {confirmDeleteGroup && (
        <ConfirmDialog
          message={`Delete group "${confirmDeleteGroup.name}"? Its ${confirmDeleteGroup.category_count} categories will become ungrouped.`}
          onConfirm={() => { deleteGroup(confirmDeleteGroup); setConfirmDeleteGroup(null) }}
          onCancel={() => setConfirmDeleteGroup(null)}
        />
      )}
      {confirmDeleteCat && (
        <ConfirmDialog
          message={`Delete category "${confirmDeleteCat.name}"? Items using it will become uncategorised.`}
          onConfirm={() => { deleteCat(confirmDeleteCat); setConfirmDeleteCat(null) }}
          onCancel={() => setConfirmDeleteCat(null)}
        />
      )}

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  )
}

// ── Scope pill ────────────────────────────────────────────────────────────────

function ScopePill({ label, active, colour, onClick }: {
  label: string; active: boolean
  colour: 'blue' | 'green' | 'purple'
  onClick(): void
}) {
  const colours = {
    blue:   active ? 'bg-blue-100   text-blue-700   border-blue-300'   : 'bg-surface-2 text-text-3 border-border',
    green:  active ? 'bg-green-100  text-green-700  border-green-300'  : 'bg-surface-2 text-text-3 border-border',
    purple: active ? 'bg-purple-100 text-purple-700 border-purple-300' : 'bg-surface-2 text-text-3 border-border',
  }
  return (
    <button
      onClick={onClick}
      className={`text-xs border px-2 py-0.5 rounded-full font-medium transition-colors ${colours[colour]}`}
      title={`Toggle ${label} scope`}
    >
      {label}
    </button>
  )
}

// ── Icons ─────────────────────────────────────────────────────────────────────

function PlusIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
      <path d="M12 5v14M5 12h14"/>
    </svg>
  )
}

function EditIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/>
      <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
    </svg>
  )
}

function TrashIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <polyline points="3 6 5 6 21 6"/>
      <path d="M19 6l-1 14H6L5 6M10 11v6M14 11v6M9 6V4h6v2"/>
    </svg>
  )
}

function CheckIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12"/>
    </svg>
  )
}

function XIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
      <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
    </svg>
  )
}
