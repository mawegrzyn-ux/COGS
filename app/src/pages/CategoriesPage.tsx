import { useState, useEffect, useCallback, useMemo } from 'react'
import { useApi } from '../hooks/useApi'
import { PageHeader, Modal, Field, EmptyState, Spinner, ConfirmDialog, Toast } from '../components/ui'

// ── Types ─────────────────────────────────────────────────────────────────────

interface Category {
  id:         number
  name:       string
  type:       'ingredient' | 'recipe'
  group_name: string
  sort_order: number
}

type CatType  = 'ingredient' | 'recipe'
type ToastState = { message: string; type: 'success' | 'error' }

const blankForm = { name: '', group_name: '' }

// ── Page ──────────────────────────────────────────────────────────────────────

export default function CategoriesPage() {
  const [activeType, setActiveType] = useState<CatType>('ingredient')

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="Categories"
        subtitle="Manage ingredient and recipe categories. Groups are for analytics only."
      />

      {/* Type tabs */}
      <div className="flex gap-1 px-6 pt-4 bg-surface border-b border-border">
        {(['ingredient', 'recipe'] as CatType[]).map(t => (
          <button
            key={t}
            onClick={() => setActiveType(t)}
            className={`px-4 py-2.5 text-sm font-semibold rounded-t transition-colors capitalize
              ${activeType === t
                ? 'text-accent border-b-2 border-accent bg-accent-dim/50'
                : 'text-text-3 hover:text-text-1'
              }`}
          >
            {t === 'ingredient' ? 'Ingredient Categories' : 'Recipe Categories'}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-hidden">
        <CategoryManager key={activeType} type={activeType} />
      </div>
    </div>
  )
}

// ── Category Manager ──────────────────────────────────────────────────────────

function CategoryManager({ type }: { type: CatType }) {
  const api = useApi()

  const [categories,     setCategories]     = useState<Category[]>([])
  const [loading,        setLoading]        = useState(true)
  const [selectedGroup,  setSelectedGroup]  = useState<string | null>(null)
  const [toast,          setToast]          = useState<ToastState | null>(null)
  const [confirmDelete,  setConfirmDelete]  = useState<Category | null>(null)

  // Modal state
  const [modal,          setModal]          = useState<false | 'add-group' | 'edit-group' | 'add-cat' | 'edit-cat'>(false)
  const [editingItem,    setEditingItem]    = useState<{ name: string; id?: number } | null>(null)
  const [form,           setForm]           = useState(blankForm)
  const [formError,      setFormError]      = useState('')
  const [saving,         setSaving]         = useState(false)

  // ── Load ────────────────────────────────────────────────────────────────────

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data: Category[] = await api.get(`/categories?type=${type}`)
      setCategories(data || [])
    } catch {
      showToast('Failed to load categories', 'error')
    } finally {
      setLoading(false)
    }
  }, [api, type])

  useEffect(() => { load() }, [load])

  // ── Derived data ─────────────────────────────────────────────────────────────

  const groups = useMemo(() => {
    const names = [...new Set(
      categories
        .filter(c => c.group_name !== 'Unassigned')
        .map(c => c.group_name)
    )].sort()
    return names
  }, [categories])

  const unassigned = useMemo(() =>
    categories.filter(c => c.group_name === 'Unassigned'),
    [categories]
  )

  const groupCats = useMemo(() =>
    selectedGroup
      ? categories.filter(c => c.group_name === selectedGroup)
      : [],
    [categories, selectedGroup]
  )

  // ── Helpers ──────────────────────────────────────────────────────────────────

  const showToast = (message: string, type: 'success' | 'error' = 'success') =>
    setToast({ message, type })

  function openModal(mode: typeof modal, item?: { name: string; id?: number }) {
    setModal(mode)
    setEditingItem(item || null)
    setForm(item ? { name: item.name, group_name: selectedGroup || '' } : blankForm)
    setFormError('')
  }

  // ── Group operations ──────────────────────────────────────────────────────────
  // Groups are just the group_name string — "creating" a group means updating
  // all cats in that group, or just saving the name to use when adding cats.
  // We store the new group name locally and it becomes real when a cat is added.

  async function saveGroup() {
    const name = form.name.trim()
    if (!name) { setFormError('Name is required'); return }
    setSaving(true)
    try {
      if (modal === 'edit-group' && editingItem?.name) {
        // Rename — update all categories in this group
        const toUpdate = categories.filter(c => c.group_name === editingItem.name)
        await Promise.all(toUpdate.map(c =>
          api.put(`/categories/${c.id}`, { name: c.name, group_name: name, sort_order: c.sort_order })
        ))
        if (selectedGroup === editingItem.name) setSelectedGroup(name)
        showToast('Group renamed')
      } else {
        // New group — just select it, it becomes real when a category is added
        setSelectedGroup(name)
        showToast('Group created — add categories to it')
      }
      setModal(false)
      load()
    } catch (err: any) {
      showToast(err.message || 'Save failed', 'error')
    } finally {
      setSaving(false)
    }
  }

  async function deleteGroup(groupName: string) {
    // Move all cats in this group to Unassigned
    const toUpdate = categories.filter(c => c.group_name === groupName)
    try {
      await Promise.all(toUpdate.map(c =>
        api.put(`/categories/${c.id}`, { name: c.name, group_name: 'Unassigned', sort_order: c.sort_order })
      ))
      if (selectedGroup === groupName) setSelectedGroup(null)
      showToast('Group deleted — categories moved to Unassigned')
      load()
    } catch (err: any) {
      showToast(err.message || 'Delete failed', 'error')
    }
  }

  // ── Category operations ───────────────────────────────────────────────────────

  async function saveCat() {
    const name = form.name.trim()
    if (!name) { setFormError('Name is required'); return }
    setSaving(true)
    try {
      if (modal === 'edit-cat' && editingItem?.id) {
        await api.put(`/categories/${editingItem.id}`, {
          name,
          group_name: selectedGroup || 'Unassigned',
          sort_order: 0,
        })
        showToast('Category updated')
      } else {
        await api.post('/categories', {
          name,
          type,
          group_name: selectedGroup || 'Unassigned',
          sort_order: 0,
        })
        showToast('Category added')
      }
      setModal(false)
      load()
    } catch (err: any) {
      showToast(err.message || 'Save failed', 'error')
    } finally {
      setSaving(false)
    }
  }

  async function deleteCat(cat: Category) {
    try {
      await api.delete(`/categories/${cat.id}`)
      showToast('Category deleted')
      load()
    } catch (err: any) {
      showToast(err.message || 'Delete failed', 'error')
    }
  }

  async function moveCatToGroup(cat: Category, groupName: string) {
    try {
      await api.put(`/categories/${cat.id}`, {
        name: cat.name,
        group_name: groupName || 'Unassigned',
        sort_order: cat.sort_order,
      })
      load()
    } catch (err: any) {
      showToast(err.message || 'Move failed', 'error')
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────────

  const label = type === 'ingredient' ? 'Ingredient' : 'Recipe'

  if (loading) return <div className="p-6"><Spinner /></div>

  return (
    <div className="flex h-full overflow-hidden">

      {/* ── Left panel: Groups ── */}
      <div className="w-64 shrink-0 border-r border-border flex flex-col bg-surface">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <span className="text-xs font-bold uppercase tracking-wider text-text-3">Groups</span>
          <button
            className="btn-ghost p-1 text-xs flex items-center gap-1"
            onClick={() => openModal('add-group')}
          >
            <PlusIcon size={12} /> Add
          </button>
        </div>

        <div className="flex-1 overflow-y-auto py-1">
          {groups.length === 0 ? (
            <p className="text-xs text-text-3 italic px-4 py-3">No groups yet.</p>
          ) : (
            groups.map(g => {
              const count = categories.filter(c => c.group_name === g).length
              const active = selectedGroup === g
              return (
                <div
                  key={g}
                  onClick={() => setSelectedGroup(g)}
                  className={`flex items-center gap-2 px-4 py-2.5 cursor-pointer transition-colors group
                    ${active ? 'bg-accent-dim text-accent' : 'hover:bg-surface-2 text-text-1'}`}
                >
                  <span className="flex-1 text-sm font-semibold truncate">{g}</span>
                  <span className={`text-xs px-1.5 py-0.5 rounded-full font-mono
                    ${active ? 'bg-accent/20 text-accent' : 'bg-surface-2 text-text-3'}`}>
                    {count}
                  </span>
                  <div className="hidden group-hover:flex items-center gap-1 shrink-0">
                    <button
                      className="p-0.5 rounded hover:text-accent transition-colors"
                      onClick={e => { e.stopPropagation(); openModal('edit-group', { name: g }) }}
                      title="Rename"
                    >
                      <EditIcon size={11} />
                    </button>
                    <button
                      className="p-0.5 rounded hover:text-red-500 transition-colors"
                      onClick={e => { e.stopPropagation(); deleteGroup(g) }}
                      title="Delete group"
                    >
                      <TrashIcon size={11} />
                    </button>
                  </div>
                </div>
              )
            })
          )}
        </div>

        {/* Unassigned count */}
        {unassigned.length > 0 && (
          <div
            onClick={() => setSelectedGroup(null)}
            className={`flex items-center gap-2 px-4 py-2.5 border-t border-border cursor-pointer transition-colors
              ${selectedGroup === null ? 'bg-yellow-50 text-yellow-700' : 'hover:bg-surface-2 text-text-3'}`}
          >
            <span className="text-xs font-semibold flex-1">Unassigned</span>
            <span className="text-xs px-1.5 py-0.5 rounded-full bg-yellow-100 text-yellow-700 font-mono">
              {unassigned.length}
            </span>
          </div>
        )}
      </div>

      {/* ── Right panel: Categories ── */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b border-border bg-surface">
          <span className="text-sm font-bold text-text-1">
            {selectedGroup === null && unassigned.length > 0
              ? 'Unassigned'
              : selectedGroup
                ? `${label} Categories — ${selectedGroup}`
                : `${label} Categories`
            }
          </span>
          {selectedGroup !== null && (
            <button
              className="btn-primary px-3 py-1.5 text-xs flex items-center gap-1.5"
              onClick={() => openModal('add-cat')}
            >
              <PlusIcon size={12} /> Add Category
            </button>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {selectedGroup === null && unassigned.length > 0 ? (
            // Unassigned panel
            <div>
              <div className="flex items-center gap-2 mb-4 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
                <span className="text-yellow-700 text-sm">
                  These categories were added from Inventory or Recipes. Move them into a group.
                </span>
              </div>
              <div className="space-y-2">
                {unassigned.map(cat => (
                  <div key={cat.id} className="flex items-center gap-3 bg-surface border border-border rounded-lg px-4 py-2.5">
                    <span className="flex-1 text-sm font-semibold text-text-1">{cat.name}</span>
                    <select
                      className="select text-xs"
                      value=""
                      onChange={e => { if (e.target.value) moveCatToGroup(cat, e.target.value) }}
                    >
                      <option value="">Move to…</option>
                      {groups.map(g => <option key={g} value={g}>{g}</option>)}
                    </select>
                    <button
                      className="w-7 h-7 flex items-center justify-center rounded border border-red-200 text-red-400 hover:bg-red-50 hover:text-red-600 transition-colors"
                      onClick={() => setConfirmDelete(cat)}
                    >
                      <TrashIcon size={12} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ) : selectedGroup === null ? (
            <EmptyState
              message="Select a group on the left to view its categories, or add a new group to get started."
              action={
                <button className="btn-primary px-4 py-2 text-sm" onClick={() => openModal('add-group')}>
                  Add Group
                </button>
              }
            />
          ) : groupCats.length === 0 ? (
            <EmptyState
              message={`No categories in "${selectedGroup}" yet.`}
              action={
                <button className="btn-primary px-4 py-2 text-sm" onClick={() => openModal('add-cat')}>
                  Add Category
                </button>
              }
            />
          ) : (
            <div className="space-y-1.5">
              {groupCats.map(cat => (
                <div key={cat.id} className="flex items-center gap-3 bg-surface border border-border rounded-lg px-4 py-2.5 hover:bg-surface-2 transition-colors">
                  <span className="flex-1 text-sm font-semibold text-text-1">{cat.name}</span>
                  <button
                    className="btn-ghost px-2 py-1 text-xs flex items-center gap-1"
                    onClick={() => openModal('edit-cat', { name: cat.name, id: cat.id })}
                  >
                    <EditIcon size={12} /> Edit
                  </button>
                  <button
                    className="w-7 h-7 flex items-center justify-center rounded border border-red-200 text-red-400 hover:bg-red-50 hover:text-red-600 transition-colors"
                    onClick={() => setConfirmDelete(cat)}
                  >
                    <TrashIcon size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Modals ── */}
      {(modal === 'add-group' || modal === 'edit-group') && (
        <Modal
          title={modal === 'edit-group' ? 'Rename Group' : `Add ${label} Group`}
          onClose={() => setModal(false)}
          width="max-w-sm"
        >
          <Field label="Group Name" required error={formError}>
            <input
              className="input w-full"
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              placeholder="e.g. Proteins"
              autoFocus
            />
          </Field>
          <div className="flex gap-3 justify-end pt-2">
            <button className="btn-ghost px-4 py-2 text-sm" onClick={() => setModal(false)}>Cancel</button>
            <button className="btn-primary px-4 py-2 text-sm" onClick={saveGroup} disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </Modal>
      )}

      {(modal === 'add-cat' || modal === 'edit-cat') && (
        <Modal
          title={modal === 'edit-cat' ? `Edit ${label} Category` : `Add ${label} Category`}
          onClose={() => setModal(false)}
          width="max-w-sm"
        >
          <Field label="Category Name" required error={formError}>
            <input
              className="input w-full"
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              placeholder="e.g. Chicken"
              autoFocus
            />
          </Field>
          {selectedGroup && (
            <p className="text-xs text-text-3 -mt-2 mb-4">
              Will be added to group: <span className="font-semibold text-text-2">{selectedGroup}</span>
            </p>
          )}
          <div className="flex gap-3 justify-end pt-2">
            <button className="btn-ghost px-4 py-2 text-sm" onClick={() => setModal(false)}>Cancel</button>
            <button className="btn-primary px-4 py-2 text-sm" onClick={saveCat} disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </Modal>
      )}

      {confirmDelete && (
        <ConfirmDialog
          message={`Delete category "${confirmDelete.name}"? This may affect ingredients or recipes using it.`}
          onConfirm={() => { deleteCat(confirmDelete); setConfirmDelete(null) }}
          onCancel={() => setConfirmDelete(null)}
        />
      )}

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
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
