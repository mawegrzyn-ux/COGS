import { useState, useEffect, useCallback, useMemo } from 'react'
import { useApi } from '../hooks/useApi'
import { Field, Spinner, Modal, Toast } from '../components/ui'
import ImageUpload from '../components/ImageUpload'

// ── Types ─────────────────────────────────────────────────────────────────────
interface Country    { id: number; name: string }
interface Recipe     { id: number; name: string; category_name: string | null }
interface Ingredient { id: number; name: string; base_unit_abbr: string | null }
interface SalesItemMarket { country_id: number; country_name: string; is_active: boolean }

interface ModifierOption {
  id: number; modifier_group_id: number; name: string
  item_type: 'recipe' | 'ingredient' | 'manual'
  recipe_id: number | null; ingredient_id: number | null; manual_cost: number | null
  price_addon: number; sort_order: number
}
interface ModifierGroup {
  id: number; name: string; description: string | null
  min_select: number; max_select: number; option_count?: number
  options?: ModifierOption[]
}
interface ComboStepOption {
  id: number; combo_step_id: number; name: string
  item_type: 'recipe' | 'ingredient' | 'manual'
  recipe_id: number | null; recipe_name?: string
  ingredient_id: number | null; ingredient_name?: string
  manual_cost: number | null; price_addon: number; sort_order: number
  modifier_groups?: { modifier_group_id: number; name: string }[]
}
interface ComboStep {
  id: number; sales_item_id: number; name: string
  description: string | null; sort_order: number; options?: ComboStepOption[]
}
interface SalesItem {
  id: number
  item_type: 'recipe' | 'ingredient' | 'manual' | 'combo'
  name: string
  category_id: number | null; category_name: string | null
  description: string | null
  recipe_id: number | null; recipe_name?: string
  ingredient_id: number | null; ingredient_name?: string
  manual_cost: number | null; image_url: string | null; sort_order: number
  markets?: SalesItemMarket[]
  modifier_groups?: { modifier_group_id: number; name: string; sort_order: number }[]
  steps?: ComboStep[]
}

// ── Constants ─────────────────────────────────────────────────────────────────
const TYPE_BADGE: Record<string, string> = {
  recipe:     'bg-blue-100 text-blue-700',
  ingredient: 'bg-green-100 text-green-700',
  manual:     'bg-purple-100 text-purple-700',
  combo:      'bg-orange-100 text-orange-700',
}
const TYPE_LABEL: Record<string, string> = { recipe: 'Recipe', ingredient: 'Ingredient', manual: 'Manual', combo: 'Combo' }

// ── ComboOptionForm ────────────────────────────────────────────────────────────
function ComboOptionForm({ opt, modifierGroups, recipes, ingredients, onSave, onClose }: {
  opt: ComboStepOption; modifierGroups: ModifierGroup[]; recipes: Recipe[]; ingredients: Ingredient[]
  onSave(opt: ComboStepOption): void; onClose(): void
}) {
  const [form, setForm] = useState({ ...opt })
  const [attachedMgIds, setAttachedMgIds] = useState<number[]>((opt.modifier_groups || []).map(m => m.modifier_group_id))
  const [recipeSearch, setRecipeSearch] = useState(() => recipes.find(r => r.id === opt.recipe_id)?.name ?? '')
  const [recipeOpen, setRecipeOpen] = useState(false)
  const [ingSearch, setIngSearch] = useState(() => ingredients.find(i => i.id === opt.ingredient_id)?.name ?? '')
  const [ingOpen, setIngOpen] = useState(false)
  const [saveError, setSaveError] = useState('')
  const filteredRecipes = useMemo(() => recipes.filter(r => r.name.toLowerCase().includes(recipeSearch.toLowerCase())).slice(0, 50), [recipes, recipeSearch])
  const filteredIngs    = useMemo(() => ingredients.filter(i => i.name.toLowerCase().includes(ingSearch.toLowerCase())).slice(0, 50), [ingredients, ingSearch])

  const handleTypeChange = (t: 'recipe' | 'ingredient' | 'manual') => {
    setForm(f => ({ ...f, item_type: t, recipe_id: null, ingredient_id: null, manual_cost: null }))
    setRecipeSearch(''); setIngSearch('')
  }
  const handleSave = () => {
    if (!form.name.trim()) { setSaveError('Name is required'); return }
    if (form.item_type === 'recipe' && !form.recipe_id) { setSaveError('Please select a recipe'); return }
    if (form.item_type === 'ingredient' && !form.ingredient_id) { setSaveError('Please select an ingredient'); return }
    setSaveError('')
    onSave({ ...form, name: form.name.trim(), modifier_groups: attachedMgIds.map(id => ({ modifier_group_id: id, name: modifierGroups.find(m => m.id === id)?.name || '' })) })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md p-5">
        <h3 className="text-base font-semibold mb-4">{opt.id === 0 ? 'Add Option' : 'Edit Option'}</h3>
        <div className="space-y-3">
          <Field label="Name"><input className="input w-full" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} /></Field>
          <Field label="Type">
            <select className="input w-full" value={form.item_type} onChange={e => handleTypeChange(e.target.value as 'recipe' | 'ingredient' | 'manual')}>
              <option value="manual">Manual cost</option>
              <option value="recipe">Recipe</option>
              <option value="ingredient">Ingredient</option>
            </select>
          </Field>
          {form.item_type === 'recipe' && (
            <Field label="Recipe"><div className="relative">
              <input className="input w-full" placeholder="Search recipes…" value={recipeSearch}
                onChange={e => { setRecipeSearch(e.target.value); setRecipeOpen(true) }}
                onFocus={() => setRecipeOpen(true)} onBlur={() => setTimeout(() => setRecipeOpen(false), 150)} autoComplete="off" />
              {recipeOpen && <div className="absolute top-full left-0 right-0 z-50 bg-white border border-gray-200 rounded-lg shadow-lg mt-0.5 max-h-52 overflow-y-auto">
                {filteredRecipes.length === 0
                  ? <div className="px-3 py-2 text-sm text-gray-400 italic">No recipes match "{recipeSearch}"</div>
                  : filteredRecipes.map(r => <button key={r.id} type="button"
                      className={`w-full text-left px-3 py-2 text-sm hover:bg-accent-dim flex items-center gap-2 ${form.recipe_id === r.id ? 'bg-accent-dim font-medium text-accent' : 'text-gray-800'}`}
                      onMouseDown={e => e.preventDefault()}
                      onClick={() => { setForm(f => ({ ...f, recipe_id: r.id })); setRecipeSearch(r.name); setRecipeOpen(false) }}>
                      {form.recipe_id === r.id && <span className="text-accent text-xs">✓</span>}
                      <span>{r.name}</span>
                      {r.category_name && <span className="ml-auto text-xs text-gray-400 shrink-0">{r.category_name}</span>}
                    </button>)}
              </div>}
            </div></Field>
          )}
          {form.item_type === 'ingredient' && (
            <Field label="Ingredient"><div className="relative">
              <input className="input w-full" placeholder="Search ingredients…" value={ingSearch}
                onChange={e => { setIngSearch(e.target.value); setIngOpen(true) }}
                onFocus={() => setIngOpen(true)} onBlur={() => setTimeout(() => setIngOpen(false), 150)} autoComplete="off" />
              {ingOpen && <div className="absolute top-full left-0 right-0 z-50 bg-white border border-gray-200 rounded-lg shadow-lg mt-0.5 max-h-52 overflow-y-auto">
                {filteredIngs.length === 0
                  ? <div className="px-3 py-2 text-sm text-gray-400 italic">No ingredients match "{ingSearch}"</div>
                  : filteredIngs.map(i => <button key={i.id} type="button"
                      className={`w-full text-left px-3 py-2 text-sm hover:bg-accent-dim flex items-center gap-2 ${form.ingredient_id === i.id ? 'bg-accent-dim font-medium text-accent' : 'text-gray-800'}`}
                      onMouseDown={e => e.preventDefault()}
                      onClick={() => { setForm(f => ({ ...f, ingredient_id: i.id })); setIngSearch(i.name); setIngOpen(false) }}>
                      {form.ingredient_id === i.id && <span className="text-accent text-xs">✓</span>}
                      <span>{i.name}</span>
                      {i.base_unit_abbr && <span className="ml-auto text-xs text-gray-400 shrink-0">{i.base_unit_abbr}</span>}
                    </button>)}
              </div>}
            </div></Field>
          )}
          {form.item_type === 'manual' && (
            <Field label="Manual cost (USD)">
              <input type="number" step="0.0001" min="0" className="input w-full" value={form.manual_cost ?? ''}
                onChange={e => setForm(f => ({ ...f, manual_cost: parseFloat(e.target.value) || null }))} />
            </Field>
          )}
          <Field label="Price add-on">
            <input type="number" step="0.01" min="0" className="input w-full" value={form.price_addon}
              onChange={e => setForm(f => ({ ...f, price_addon: parseFloat(e.target.value) || 0 }))} />
          </Field>
          {modifierGroups.length > 0 && (
            <Field label="Modifier Groups">
              <div className="space-y-1">
                {modifierGroups.map(mg => (
                  <label key={mg.id} className="flex items-center gap-1.5 text-sm cursor-pointer">
                    <input type="checkbox" checked={attachedMgIds.includes(mg.id)}
                      onChange={e => setAttachedMgIds(ids => e.target.checked ? [...ids, mg.id] : ids.filter(id => id !== mg.id))} />
                    {mg.name}
                  </label>
                ))}
              </div>
            </Field>
          )}
        </div>
        {saveError && <p className="text-sm text-red-500 mt-3">{saveError}</p>}
        <div className="flex gap-2 justify-end mt-4">
          <button className="btn btn-outline" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSave}>Save</button>
        </div>
      </div>
    </div>
  )
}

// ── SalesItemModal ─────────────────────────────────────────────────────────────
function SalesItemModal({ mode, initial, defaultType, recipes, ingredients, onSave, saving, onClose }: {
  mode: 'new' | 'edit'; initial: SalesItem | null; defaultType?: SalesItem['item_type']
  recipes: Recipe[]; ingredients: Ingredient[]
  onSave(payload: Partial<SalesItem>): Promise<void>; saving: boolean; onClose(): void
}) {
  const api = useApi()
  const [siCategories, setSiCategories] = useState<{id: number; name: string}[]>([])
  useEffect(() => {
    api.get('/categories?for_sales_items=true')
      .then((d: any[]) => setSiCategories((d || []).map((c: any) => ({ id: c.id, name: c.name })).sort((a: any, b: any) => a.name.localeCompare(b.name))))
      .catch(() => {})
  }, [api])

  const [form, setForm] = useState({
    name: initial?.name ?? '',
    category_id: initial?.category_id ? String(initial.category_id) : '',
    description: initial?.description ?? '',
    item_type: initial?.item_type ?? defaultType ?? 'manual' as SalesItem['item_type'],
    recipe_id: initial?.recipe_id ?? null as number | null,
    ingredient_id: initial?.ingredient_id ?? null as number | null,
    manual_cost: initial?.manual_cost ?? null as number | null,
    image_url: initial?.image_url ?? null as string | null,
    sort_order: initial?.sort_order ?? 0,
  })
  const [recipeSearch, setRecipeSearch] = useState(initial?.recipe_name ?? '')
  const [recipeOpen,   setRecipeOpen]   = useState(false)
  const [ingSearch,    setIngSearch]    = useState(initial?.ingredient_name ?? '')
  const [ingOpen,      setIngOpen]      = useState(false)
  const filteredRecipes = useMemo(() => recipes.filter(r => r.name.toLowerCase().includes(recipeSearch.toLowerCase())).slice(0, 50), [recipes, recipeSearch])
  const filteredIngs    = useMemo(() => ingredients.filter(i => i.name.toLowerCase().includes(ingSearch.toLowerCase())).slice(0, 50), [ingredients, ingSearch])

  const handleSave = () => {
    if (!form.name.trim()) return
    onSave({
      ...form, name: form.name.trim(),
      category_id: Number(form.category_id) || null,
      description: form.description.trim() || null,
      recipe_id: form.item_type === 'recipe' ? form.recipe_id : null,
      ingredient_id: form.item_type === 'ingredient' ? form.ingredient_id : null,
      manual_cost: form.item_type === 'manual' ? form.manual_cost : null,
    })
  }

  return (
    <Modal title={mode === 'new' ? 'New Sales Item' : 'Edit Sales Item'} onClose={onClose}>
      <div className="space-y-3 p-1">
        <Field label="Name *"><input className="input w-full" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} autoFocus /></Field>
        <Field label="Item Type">
          <div className="flex gap-2">
            {(['recipe', 'ingredient', 'manual', 'combo'] as const).map(t => (
              <button key={t} className={`btn btn-sm ${form.item_type === t ? 'btn-primary' : 'btn-outline'}`}
                onClick={() => setForm(f => ({ ...f, item_type: t }))}>
                {t.charAt(0).toUpperCase() + t.slice(1)}
              </button>
            ))}
          </div>
        </Field>
        {form.item_type === 'recipe' && (
          <Field label="Recipe"><div className="relative">
            <input className="input w-full" placeholder="Search recipes…" value={recipeSearch}
              onChange={e => { setRecipeSearch(e.target.value); setRecipeOpen(true) }}
              onFocus={() => setRecipeOpen(true)} onBlur={() => setTimeout(() => setRecipeOpen(false), 150)} autoComplete="off" />
            {recipeOpen && <div className="absolute top-full left-0 right-0 z-50 bg-white border border-gray-200 rounded-lg shadow-lg mt-0.5 max-h-52 overflow-y-auto">
              {filteredRecipes.length === 0
                ? <div className="px-3 py-2 text-sm text-gray-400 italic">No recipes match "{recipeSearch}"</div>
                : filteredRecipes.map(r => <button key={r.id} type="button"
                    className={`w-full text-left px-3 py-2 text-sm hover:bg-accent-dim flex items-center gap-2 ${form.recipe_id === r.id ? 'bg-accent-dim font-medium text-accent' : 'text-gray-800'}`}
                    onMouseDown={e => e.preventDefault()}
                    onClick={() => { setForm(f => ({ ...f, recipe_id: r.id })); setRecipeSearch(r.name); setRecipeOpen(false) }}>
                    {form.recipe_id === r.id && <span className="text-accent text-xs">✓</span>}
                    <span>{r.name}</span>
                    {r.category_name && <span className="ml-auto text-xs text-gray-400 shrink-0">{r.category_name}</span>}
                  </button>)}
            </div>}
          </div></Field>
        )}
        {form.item_type === 'ingredient' && (
          <Field label="Ingredient"><div className="relative">
            <input className="input w-full" placeholder="Search ingredients…" value={ingSearch}
              onChange={e => { setIngSearch(e.target.value); setIngOpen(true) }}
              onFocus={() => setIngOpen(true)} onBlur={() => setTimeout(() => setIngOpen(false), 150)} autoComplete="off" />
            {ingOpen && <div className="absolute top-full left-0 right-0 z-50 bg-white border border-gray-200 rounded-lg shadow-lg mt-0.5 max-h-52 overflow-y-auto">
              {filteredIngs.length === 0
                ? <div className="px-3 py-2 text-sm text-gray-400 italic">No ingredients match "{ingSearch}"</div>
                : filteredIngs.map(i => <button key={i.id} type="button"
                    className={`w-full text-left px-3 py-2 text-sm hover:bg-accent-dim flex items-center gap-2 ${form.ingredient_id === i.id ? 'bg-accent-dim font-medium text-accent' : 'text-gray-800'}`}
                    onMouseDown={e => e.preventDefault()}
                    onClick={() => { setForm(f => ({ ...f, ingredient_id: i.id })); setIngSearch(i.name); setIngOpen(false) }}>
                    {form.ingredient_id === i.id && <span className="text-accent text-xs">✓</span>}
                    <span>{i.name}</span>
                    {i.base_unit_abbr && <span className="ml-auto text-xs text-gray-400 shrink-0">{i.base_unit_abbr}</span>}
                  </button>)}
            </div>}
          </div></Field>
        )}
        {form.item_type === 'manual' && (
          <Field label="Manual Cost (USD per portion)">
            <input type="number" step="0.0001" min="0" className="input w-full" value={form.manual_cost ?? ''}
              onChange={e => setForm(f => ({ ...f, manual_cost: parseFloat(e.target.value) || null }))} />
          </Field>
        )}
        {form.item_type === 'combo' && <p className="text-xs text-gray-400">Combo steps are configured after saving.</p>}
        <Field label="Category">
          <select className="input w-full" value={form.category_id} onChange={e => setForm(f => ({ ...f, category_id: e.target.value }))}>
            <option value="">No category…</option>
            {siCategories.map(c => <option key={c.id} value={String(c.id)}>{c.name}</option>)}
          </select>
        </Field>
        <Field label="Description">
          <textarea className="input w-full" rows={2} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
        </Field>
        <ImageUpload label="Image" value={form.image_url} onChange={url => setForm(f => ({ ...f, image_url: url }))} />
      </div>
      <div className="flex justify-end gap-2 mt-4">
        <button className="btn btn-outline" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" disabled={!form.name.trim() || saving} onClick={handleSave}>
          {saving ? 'Saving…' : mode === 'new' ? 'Create' : 'Save'}
        </button>
      </div>
    </Modal>
  )
}

// ── ModifierOptionAddForm ─────────────────────────────────────────────────────
function ModifierOptionAddForm({ recipes, ingredients, onAdd }: {
  recipes: Recipe[]; ingredients: Ingredient[]
  onAdd(opt: Omit<ModifierOption, 'id' | 'modifier_group_id'>): void
}) {
  const [form, setForm] = useState({ name: '', item_type: 'manual' as 'recipe' | 'ingredient' | 'manual', recipe_id: null as number | null, ingredient_id: null as number | null, manual_cost: null as number | null, price_addon: 0, sort_order: 0 })
  const [show, setShow] = useState(false)
  if (!show) return <button className="btn btn-xs btn-outline mt-1" onClick={() => setShow(true)}>+ Add Option</button>
  return (
    <div className="border border-dashed border-gray-200 rounded p-2 mt-1 space-y-1.5">
      <div className="flex gap-1.5">
        <input className="input input-sm flex-1" placeholder="Option name" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
        <select className="input py-1 text-xs w-28" value={form.item_type} onChange={e => setForm(f => ({ ...f, item_type: e.target.value as 'recipe' | 'ingredient' | 'manual' }))}>
          <option value="manual">Manual</option><option value="recipe">Recipe</option><option value="ingredient">Ingredient</option>
        </select>
      </div>
      {form.item_type === 'manual' && <input type="number" step="0.0001" className="input input-sm w-full" placeholder="Cost (USD)" value={form.manual_cost ?? ''} onChange={e => setForm(f => ({ ...f, manual_cost: parseFloat(e.target.value) || null }))} />}
      {form.item_type === 'recipe' && <select className="input py-1 text-xs w-full" value={form.recipe_id ?? ''} onChange={e => setForm(f => ({ ...f, recipe_id: Number(e.target.value) || null }))}><option value="">— Select recipe —</option>{recipes.slice(0, 100).map(r => <option key={r.id} value={r.id}>{r.name}</option>)}</select>}
      {form.item_type === 'ingredient' && <select className="input py-1 text-xs w-full" value={form.ingredient_id ?? ''} onChange={e => setForm(f => ({ ...f, ingredient_id: Number(e.target.value) || null }))}><option value="">— Select ingredient —</option>{ingredients.slice(0, 100).map(i => <option key={i.id} value={i.id}>{i.name}</option>)}</select>}
      <div className="flex gap-1.5">
        <input type="number" step="0.01" className="input input-sm w-28" placeholder="Price add-on" value={form.price_addon} onChange={e => setForm(f => ({ ...f, price_addon: parseFloat(e.target.value) || 0 }))} />
        <button className="btn btn-xs btn-primary" disabled={!form.name.trim()} onClick={() => { onAdd(form); setForm({ name: '', item_type: 'manual', recipe_id: null, ingredient_id: null, manual_cost: null, price_addon: 0, sort_order: 0 }); setShow(false) }}>Add</button>
        <button className="btn btn-xs btn-ghost" onClick={() => setShow(false)}>Cancel</button>
      </div>
    </div>
  )
}

// ── Main SalesItemsPage ────────────────────────────────────────────────────────
export default function SalesItemsPage() {
  const api = useApi()
  const [activeTab, setActiveTab] = useState<'items' | 'combos' | 'modifiers'>('items')

  // ── Shared data ────────────────────────────────────────────────────────────
  const [salesItems,     setSalesItems]     = useState<SalesItem[]>([])
  const [modifierGroups, setModifierGroups] = useState<ModifierGroup[]>([])
  const [countries,      setCountries]      = useState<Country[]>([])
  const [recipes,        setRecipes]        = useState<Recipe[]>([])
  const [ingredients,    setIngredients]    = useState<Ingredient[]>([])
  const [loading,        setLoading]        = useState(true)
  const [toast,          setToast]          = useState<{msg: string} | null>(null)
  const showToast = (msg: string) => setToast({ msg })

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [items, groups, c, r, i] = await Promise.all([
        api.get('/sales-items?include_inactive=true'),
        api.get('/modifier-groups'),
        api.get('/countries'),
        api.get('/recipes'),
        api.get('/ingredients'),
      ])
      setSalesItems(items || [])
      setModifierGroups(groups || [])
      setCountries(c || [])
      setRecipes(r || [])
      setIngredients(i || [])
    } finally { setLoading(false) }
  }, [api])

  useEffect(() => { load() }, [load])

  // ── Create / edit / delete ─────────────────────────────────────────────────
  const [siModal,       setSiModal]       = useState<'new' | SalesItem | null>(null)
  const [newComboMode,  setNewComboMode]  = useState(false)
  const [saving,        setSaving]        = useState(false)
  const [deleting,      setDeleting]      = useState<SalesItem | null>(null)

  const saveSalesItem = async (payload: Partial<SalesItem>) => {
    setSaving(true)
    try {
      if (siModal === 'new') {
        const created: SalesItem = await api.post('/sales-items', payload)
        // Default to all markets (global visibility)
        if (countries.length > 0) {
          await api.put(`/sales-items/${created.id}/markets`, { country_ids: countries.map(c => c.id) })
        }
        const full: SalesItem = await api.get(`/sales-items/${created.id}`)
        setSalesItems(prev => [...prev, full].sort((a, b) => a.name.localeCompare(b.name)))
        showToast('Sales Item created')
      } else if (siModal && typeof siModal !== 'string') {
        const updated: SalesItem = await api.put(`/sales-items/${siModal.id}`, payload)
        setSalesItems(prev => prev.map(s => s.id === updated.id ? { ...s, ...updated } : s))
        if (selectedComboId === siModal.id) {
          const full: SalesItem = await api.get(`/sales-items/${siModal.id}`)
          setComboDetail(full)
        }
        showToast('Sales Item saved')
      }
      setSiModal(null); setNewComboMode(false)
    } catch { showToast('Save failed') } finally { setSaving(false) }
  }

  const deleteSalesItem = async () => {
    if (!deleting) return
    try {
      await api.delete(`/sales-items/${deleting.id}`)
      setSalesItems(prev => prev.filter(s => s.id !== deleting.id))
      if (selectedComboId === deleting.id) setSelectedComboId(null)
      setDeleting(null); showToast('Deleted')
    } catch { showToast('Delete failed') }
  }

  // ── Items tab ──────────────────────────────────────────────────────────────
  const [itemSearch,    setItemSearch]    = useState('')
  const [typeFilter,    setTypeFilter]    = useState<'recipe' | 'ingredient' | 'manual' | ''>('')
  const [editingId,     setEditingId]     = useState<number | null>(null)
  const [editForm,      setEditForm]      = useState<{
    name: string; item_type: 'recipe'|'ingredient'|'manual'; category_id: string
    recipe_id: number|null; ingredient_id: number|null; manual_cost: string
    recipeSearch: string; recipeOpen: boolean; ingSearch: string; ingOpen: boolean
  } | null>(null)
  const [siCategories,  setSiCategories]  = useState<{id: number; name: string}[]>([])
  const [inlineSaving,  setInlineSaving]  = useState(false)

  useEffect(() => {
    api.get('/categories?for_sales_items=true')
      .then((d: any[]) => setSiCategories((d || []).map((c: any) => ({ id: c.id, name: c.name })).sort((a: any, b: any) => a.name.localeCompare(b.name))))
      .catch(() => {})
  }, [api])

  const startEdit = (si: SalesItem) => {
    setEditingId(si.id)
    setEditForm({
      name: si.name, item_type: si.item_type as 'recipe'|'ingredient'|'manual',
      category_id: si.category_id ? String(si.category_id) : '',
      recipe_id: si.recipe_id ?? null, ingredient_id: si.ingredient_id ?? null,
      manual_cost: si.manual_cost != null ? String(si.manual_cost) : '',
      recipeSearch: si.recipe_name ?? '', recipeOpen: false,
      ingSearch: si.ingredient_name ?? '', ingOpen: false,
    })
  }

  const saveInlineEdit = async (id: number) => {
    if (!editForm) return
    setInlineSaving(true)
    try {
      const updated: SalesItem = await api.put(`/sales-items/${id}`, {
        name: editForm.name.trim(), item_type: editForm.item_type,
        category_id: Number(editForm.category_id) || null,
        recipe_id:     editForm.item_type === 'recipe'     ? editForm.recipe_id     : null,
        ingredient_id: editForm.item_type === 'ingredient' ? editForm.ingredient_id : null,
        manual_cost:   editForm.item_type === 'manual'     ? (parseFloat(editForm.manual_cost) || null) : null,
      })
      setSalesItems(prev => prev.map(s => s.id === id ? { ...s, ...updated } : s))
      setEditingId(null); setEditForm(null)
    } catch { showToast('Save failed') } finally { setInlineSaving(false) }
  }

  const nonComboItems = useMemo(() => salesItems.filter(si => {
    if (si.item_type === 'combo') return false
    if (typeFilter && si.item_type !== typeFilter) return false
    if (itemSearch && !si.name.toLowerCase().includes(itemSearch.toLowerCase()) && !(si.category_name || '').toLowerCase().includes(itemSearch.toLowerCase())) return false
    return true
  }), [salesItems, typeFilter, itemSearch])

  const filteredRecipesInline = useMemo(() => recipes.filter(r => r.name.toLowerCase().includes((editForm?.recipeSearch || '').toLowerCase())).slice(0, 50), [recipes, editForm?.recipeSearch])
  const filteredIngsInline    = useMemo(() => ingredients.filter(i => i.name.toLowerCase().includes((editForm?.ingSearch || '').toLowerCase())).slice(0, 50), [ingredients, editForm?.ingSearch])

  const marketsDisplay = (item: SalesItem) => {
    const active = (item.markets || []).filter(m => m.is_active)
    if (active.length === 0 || active.length === countries.length) return { label: 'Global', color: 'bg-green-100 text-green-700' }
    return { label: `${active.length}/${countries.length}`, color: 'bg-gray-100 text-gray-600' }
  }

  // ── Combos tab ─────────────────────────────────────────────────────────────
  const [selectedComboId,     setSelectedComboId]     = useState<number | null>(null)
  const [comboDetail,         setComboDetail]         = useState<SalesItem | null>(null)
  const [comboDetailLoading,  setComboDetailLoading]  = useState(false)
  const [expandedStep,        setExpandedStep]        = useState<number | null>(null)
  const [editingOpt,          setEditingOpt]          = useState<ComboStepOption | null>(null)
  const [editingOptStepId,    setEditingOptStepId]    = useState<number | null>(null)
  const [comboMarketIds,      setComboMarketIds]      = useState<number[]>([])
  const [savingComboMarkets,  setSavingComboMarkets]  = useState(false)
  const comboItems = useMemo(() => salesItems.filter(si => si.item_type === 'combo'), [salesItems])

  useEffect(() => {
    if (!selectedComboId) { setComboDetail(null); return }
    setComboDetailLoading(true)
    api.get(`/sales-items/${selectedComboId}`)
      .then((d: SalesItem) => {
        setComboDetail(d)
        const active = (d.markets || []).filter(m => m.is_active).map(m => m.country_id)
        setComboMarketIds(active.length > 0 ? active : countries.map(c => c.id))
      })
      .catch(() => setComboDetail(null))
      .finally(() => setComboDetailLoading(false))
  }, [selectedComboId, api, countries])

  const reloadComboDetail = useCallback(async () => {
    if (!selectedComboId) return
    const updated: SalesItem = await api.get(`/sales-items/${selectedComboId}`)
    setComboDetail(updated)
    setSalesItems(prev => prev.map(s => s.id === selectedComboId ? { ...s, ...updated } : s))
  }, [selectedComboId, api])

  const saveComboMarkets = async () => {
    if (!selectedComboId) return
    setSavingComboMarkets(true)
    try { await api.put(`/sales-items/${selectedComboId}/markets`, { country_ids: comboMarketIds }); showToast('Market visibility saved') }
    catch { showToast('Failed') } finally { setSavingComboMarkets(false) }
  }

  const addComboStep = async () => {
    const name = window.prompt('Step name (e.g. "Choose your main")')
    if (!name || !selectedComboId) return
    try { await api.post(`/sales-items/${selectedComboId}/steps`, { name: name.trim(), sort_order: comboDetail?.steps?.length || 0 }); await reloadComboDetail() }
    catch { showToast('Failed to add step') }
  }

  const deleteComboStep = async (stepId: number) => {
    if (!window.confirm('Delete this step and all its options?') || !selectedComboId) return
    try { await api.delete(`/sales-items/${selectedComboId}/steps/${stepId}`); await reloadComboDetail() }
    catch { showToast('Failed') }
  }

  const addOption = (stepId: number) => {
    setEditingOpt({ id: 0, combo_step_id: stepId, name: '', item_type: 'manual', recipe_id: null, ingredient_id: null, manual_cost: null, price_addon: 0, sort_order: 0 })
    setEditingOptStepId(stepId)
  }

  const saveOption = async (opt: ComboStepOption) => {
    if (!editingOptStepId || !selectedComboId) return
    try {
      if (opt.id === 0) await api.post(`/sales-items/${selectedComboId}/steps/${editingOptStepId}/options`, opt)
      else await api.put(`/sales-items/${selectedComboId}/steps/${editingOptStepId}/options/${opt.id}`, opt)
      await reloadComboDetail(); setEditingOpt(null)
    } catch { showToast('Failed to save option') }
  }

  const deleteOption = async (stepId: number, optId: number) => {
    if (!window.confirm('Delete this option?') || !selectedComboId) return
    try { await api.delete(`/sales-items/${selectedComboId}/steps/${stepId}/options/${optId}`); await reloadComboDetail() }
    catch { showToast('Failed') }
  }

  // ── Modifiers tab ──────────────────────────────────────────────────────────
  const [expandedMgId,    setExpandedMgId]    = useState<number | null>(null)
  const [expandedOptions, setExpandedOptions] = useState<Record<number, ModifierOption[]>>({})
  const [editMg,          setEditMg]          = useState<ModifierGroup | null>(null)
  const [newMgForm,       setNewMgForm]       = useState({ name: '', min_select: 0, max_select: 1 })
  const [mgSaving,        setMgSaving]        = useState(false)

  const toggleMg = async (id: number) => {
    if (expandedMgId === id) { setExpandedMgId(null); return }
    setExpandedMgId(id)
    if (!expandedOptions[id]) {
      const opts = await api.get(`/modifier-groups/${id}/options`).catch(() => [])
      setExpandedOptions(prev => ({ ...prev, [id]: opts || [] }))
    }
  }

  const createMg = async () => {
    if (!newMgForm.name.trim()) return
    setMgSaving(true)
    try {
      const created = await api.post('/modifier-groups', newMgForm)
      setModifierGroups(prev => [...prev, { ...created, option_count: 0 }])
      setNewMgForm({ name: '', min_select: 0, max_select: 1 })
    } catch { showToast('Failed') } finally { setMgSaving(false) }
  }

  const saveMg = async (mg: ModifierGroup) => {
    setMgSaving(true)
    try { await api.put(`/modifier-groups/${mg.id}`, mg); setModifierGroups(prev => prev.map(g => g.id === mg.id ? { ...g, ...mg } : g)); setEditMg(null) }
    catch { showToast('Failed') } finally { setMgSaving(false) }
  }

  const deleteMg = async (mg: ModifierGroup) => {
    if (!window.confirm(`Delete modifier group "${mg.name}"?`)) return
    try { await api.delete(`/modifier-groups/${mg.id}`); setModifierGroups(prev => prev.filter(g => g.id !== mg.id)); if (expandedMgId === mg.id) setExpandedMgId(null) }
    catch { showToast('Failed') }
  }

  const addMgOption = async (groupId: number, opt: Omit<ModifierOption, 'id' | 'modifier_group_id'>) => {
    try {
      const created = await api.post(`/modifier-groups/${groupId}/options`, opt)
      setExpandedOptions(prev => ({ ...prev, [groupId]: [...(prev[groupId] || []), created] }))
      setModifierGroups(prev => prev.map(g => g.id === groupId ? { ...g, option_count: (g.option_count || 0) + 1 } : g))
    } catch { showToast('Failed') }
  }

  const deleteMgOption = async (groupId: number, optId: number) => {
    try {
      await api.delete(`/modifier-groups/${groupId}/options/${optId}`)
      setExpandedOptions(prev => ({ ...prev, [groupId]: (prev[groupId] || []).filter(o => o.id !== optId) }))
      setModifierGroups(prev => prev.map(g => g.id === groupId ? { ...g, option_count: Math.max(0, (g.option_count || 1) - 1) } : g))
    } catch { showToast('Failed') }
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  if (loading) return <div className="flex-1 flex items-center justify-center"><Spinner /></div>

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-6 pt-5 pb-0 border-b border-gray-200 bg-white">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h1 className="text-xl font-bold text-gray-900">Sales Items</h1>
            <p className="text-sm text-gray-500 mt-0.5">POS catalog — recipes, ingredients, manual items, and combos</p>
          </div>
          {activeTab !== 'modifiers' && (
            <button className="btn btn-primary" onClick={() => { setNewComboMode(activeTab === 'combos'); setSiModal('new') }}>
              + {activeTab === 'combos' ? 'New Combo' : 'New Sales Item'}
            </button>
          )}
        </div>
        <div className="flex gap-1">
          {(['items', 'combos', 'modifiers'] as const).map(t => (
            <button key={t} onClick={() => setActiveTab(t)}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${activeTab === t ? 'border-accent text-accent' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
              {t === 'items' ? 'Sales Items' : t === 'combos' ? 'Combos' : 'Modifiers'}
              {t === 'items' && nonComboItems.length > 0 && <span className="ml-1.5 text-xs bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded-full">{nonComboItems.length}</span>}
              {t === 'combos' && comboItems.length > 0 && <span className="ml-1.5 text-xs bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded-full">{comboItems.length}</span>}
            </button>
          ))}
        </div>
      </div>

      {/* ── ITEMS TAB ─────────────────────────────────────────────────────────── */}
      {activeTab === 'items' && (
        <div className="flex-1 overflow-auto p-5">
          <div className="flex gap-2 mb-4">
            <input className="input input-sm w-64" placeholder="Search by name or category…" value={itemSearch} onChange={e => setItemSearch(e.target.value)} />
            <select className="input py-1 text-xs" value={typeFilter} onChange={e => setTypeFilter(e.target.value as typeof typeFilter)}>
              <option value="">All Types</option>
              <option value="recipe">Recipe</option>
              <option value="ingredient">Ingredient</option>
              <option value="manual">Manual</option>
            </select>
            <span className="text-sm text-gray-400 self-center ml-auto">{nonComboItems.length} item{nonComboItems.length !== 1 ? 's' : ''}</span>
          </div>

          {nonComboItems.length === 0 ? (
            <div className="py-16 text-center text-sm text-gray-400">No sales items yet. Click "+ New Sales Item" to create one.</div>
          ) : (
            <div className="card overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 bg-gray-50">
                    <th className="px-4 py-2.5 text-left font-semibold text-gray-600 w-[28%]">Name</th>
                    <th className="px-4 py-2.5 text-left font-semibold text-gray-600 w-[12%]">Type</th>
                    <th className="px-4 py-2.5 text-left font-semibold text-gray-600 w-[18%]">Category</th>
                    <th className="px-4 py-2.5 text-left font-semibold text-gray-600 w-[25%]">Linked To</th>
                    <th className="px-4 py-2.5 text-left font-semibold text-gray-600 w-[10%]">Markets</th>
                    <th className="px-4 py-2.5 w-[7%]" />
                  </tr>
                </thead>
                <tbody>
                  {nonComboItems.map(si => {
                    const isEditing = editingId === si.id && editForm
                    if (isEditing) {
                      return (
                        <tr key={si.id} className="border-b border-gray-100 bg-accent-dim/40">
                          <td className="px-3 py-2">
                            <input className="input input-sm w-full" value={editForm.name} autoFocus
                              onChange={e => setEditForm(f => f ? { ...f, name: e.target.value } : f)}
                              onKeyDown={e => { if (e.key === 'Escape') { setEditingId(null); setEditForm(null) } else if (e.key === 'Enter') saveInlineEdit(si.id) }} />
                          </td>
                          <td className="px-3 py-2">
                            <select className="input py-1 text-xs" value={editForm.item_type}
                              onChange={e => setEditForm(f => f ? { ...f, item_type: e.target.value as 'recipe'|'ingredient'|'manual', recipe_id: null, ingredient_id: null, recipeSearch: '', ingSearch: '' } : f)}>
                              <option value="recipe">Recipe</option>
                              <option value="ingredient">Ingredient</option>
                              <option value="manual">Manual</option>
                            </select>
                          </td>
                          <td className="px-3 py-2">
                            <select className="input py-1 text-xs w-full" value={editForm.category_id}
                              onChange={e => setEditForm(f => f ? { ...f, category_id: e.target.value } : f)}>
                              <option value="">No category</option>
                              {siCategories.map(c => <option key={c.id} value={String(c.id)}>{c.name}</option>)}
                            </select>
                          </td>
                          <td className="px-3 py-2 relative">
                            {editForm.item_type === 'recipe' && (
                              <div className="relative">
                                <input className="input input-sm w-full" placeholder="Search recipes…" value={editForm.recipeSearch}
                                  onChange={e => setEditForm(f => f ? { ...f, recipeSearch: e.target.value, recipeOpen: true } : f)}
                                  onFocus={() => setEditForm(f => f ? { ...f, recipeOpen: true } : f)}
                                  onBlur={() => setTimeout(() => setEditForm(f => f ? { ...f, recipeOpen: false } : f), 150)} autoComplete="off" />
                                {editForm.recipeOpen && (
                                  <div className="absolute top-full left-0 right-0 z-50 bg-white border border-gray-200 rounded shadow-lg max-h-40 overflow-y-auto">
                                    {filteredRecipesInline.map(r => (
                                      <button key={r.id} type="button" className={`w-full text-left px-3 py-1.5 text-xs hover:bg-accent-dim ${editForm.recipe_id === r.id ? 'bg-accent-dim text-accent font-medium' : ''}`}
                                        onMouseDown={e => e.preventDefault()}
                                        onClick={() => setEditForm(f => f ? { ...f, recipe_id: r.id, recipeSearch: r.name, recipeOpen: false } : f)}>
                                        {r.name}
                                      </button>
                                    ))}
                                  </div>
                                )}
                              </div>
                            )}
                            {editForm.item_type === 'ingredient' && (
                              <div className="relative">
                                <input className="input input-sm w-full" placeholder="Search ingredients…" value={editForm.ingSearch}
                                  onChange={e => setEditForm(f => f ? { ...f, ingSearch: e.target.value, ingOpen: true } : f)}
                                  onFocus={() => setEditForm(f => f ? { ...f, ingOpen: true } : f)}
                                  onBlur={() => setTimeout(() => setEditForm(f => f ? { ...f, ingOpen: false } : f), 150)} autoComplete="off" />
                                {editForm.ingOpen && (
                                  <div className="absolute top-full left-0 right-0 z-50 bg-white border border-gray-200 rounded shadow-lg max-h-40 overflow-y-auto">
                                    {filteredIngsInline.map(i => (
                                      <button key={i.id} type="button" className={`w-full text-left px-3 py-1.5 text-xs hover:bg-accent-dim ${editForm.ingredient_id === i.id ? 'bg-accent-dim text-accent font-medium' : ''}`}
                                        onMouseDown={e => e.preventDefault()}
                                        onClick={() => setEditForm(f => f ? { ...f, ingredient_id: i.id, ingSearch: i.name, ingOpen: false } : f)}>
                                        {i.name}
                                      </button>
                                    ))}
                                  </div>
                                )}
                              </div>
                            )}
                            {editForm.item_type === 'manual' && (
                              <input type="number" step="0.0001" className="input input-sm w-36" placeholder="Cost USD"
                                value={editForm.manual_cost}
                                onChange={e => setEditForm(f => f ? { ...f, manual_cost: e.target.value } : f)} />
                            )}
                          </td>
                          <td className="px-3 py-2 text-xs text-gray-400">{marketsDisplay(si).label}</td>
                          <td className="px-3 py-2">
                            <div className="flex gap-1">
                              <button className="btn btn-xs btn-primary" disabled={inlineSaving} onClick={() => saveInlineEdit(si.id)}>✓</button>
                              <button className="btn btn-xs btn-ghost" onClick={() => { setEditingId(null); setEditForm(null) }}>✗</button>
                            </div>
                          </td>
                        </tr>
                      )
                    }
                    const mkt = marketsDisplay(si)
                    return (
                      <tr key={si.id} className="border-b border-gray-100 hover:bg-gray-50 group">
                        <td className="px-4 py-2.5 font-medium text-gray-900">{si.name}</td>
                        <td className="px-4 py-2.5"><span className={`text-xs px-2 py-0.5 rounded font-medium ${TYPE_BADGE[si.item_type]}`}>{TYPE_LABEL[si.item_type]}</span></td>
                        <td className="px-4 py-2.5 text-gray-500">{si.category_name || <span className="text-gray-300">—</span>}</td>
                        <td className="px-4 py-2.5 text-gray-500 text-xs">
                          {si.item_type === 'recipe' && (si.recipe_name || <span className="text-gray-300">—</span>)}
                          {si.item_type === 'ingredient' && (si.ingredient_name || <span className="text-gray-300">—</span>)}
                          {si.item_type === 'manual' && (si.manual_cost != null ? `$${Number(si.manual_cost).toFixed(4)}` : <span className="text-gray-300">—</span>)}
                        </td>
                        <td className="px-4 py-2.5"><span className={`text-xs px-2 py-0.5 rounded font-medium ${mkt.color}`}>{mkt.label}</span></td>
                        <td className="px-4 py-2.5">
                          <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button className="btn btn-xs btn-outline" title="Edit inline" onClick={() => startEdit(si)}>✎</button>
                            <button className="text-red-400 hover:text-red-600 px-1 text-base leading-none" title="Delete" onClick={() => setDeleting(si)}>⊘</button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── COMBOS TAB ──────────────────────────────────────────────────────── */}
      {activeTab === 'combos' && (
        <div className="flex flex-1 min-h-0">
          <aside className="w-64 flex-shrink-0 border-r border-gray-200 flex flex-col bg-white">
            <div className="flex-1 overflow-y-auto">
              {comboItems.length === 0 && <div className="py-8 text-center text-sm text-gray-400">No combos yet.</div>}
              {comboItems.map(si => (
                <button key={si.id} onClick={() => setSelectedComboId(si.id)}
                  className={`w-full text-left px-3 py-2.5 border-b border-gray-100 hover:bg-gray-50 transition-colors ${selectedComboId === si.id ? 'bg-accent-dim' : ''}`}>
                  <div className="font-medium text-sm text-gray-900">{si.name}</div>
                  {si.category_name && <div className="text-xs text-gray-400 mt-0.5">{si.category_name}</div>}
                </button>
              ))}
            </div>
          </aside>

          <div className="flex-1 overflow-y-auto bg-gray-50 p-5">
            {!selectedComboId && <div className="flex items-center justify-center h-full text-sm text-gray-400">Select a combo to configure its steps.</div>}
            {selectedComboId && comboDetailLoading && <div className="flex items-center justify-center h-full"><Spinner /></div>}
            {selectedComboId && !comboDetailLoading && comboDetail && (
              <div className="max-w-2xl">
                <div className="flex items-center justify-between mb-5">
                  <div>
                    <h2 className="text-lg font-bold text-gray-900">{comboDetail.name}</h2>
                    {comboDetail.category_name && <p className="text-sm text-gray-500">{comboDetail.category_name}</p>}
                  </div>
                  <div className="flex gap-2">
                    <button className="btn btn-sm btn-outline" onClick={() => setSiModal(comboDetail)}>Edit</button>
                    <button className="btn btn-sm btn-danger text-xs" onClick={() => setDeleting(comboDetail)}>Delete</button>
                  </div>
                </div>

                {/* Market Visibility */}
                <section className="card p-4 mb-4">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-semibold text-gray-700">Market Visibility</h3>
                    <button className="btn btn-sm btn-primary text-xs" disabled={savingComboMarkets} onClick={saveComboMarkets}>
                      {savingComboMarkets ? 'Saving…' : 'Save'}
                    </button>
                  </div>
                  {countries.length === 0 ? <p className="text-sm text-gray-400">No markets configured.</p> : (
                    <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                      {countries.map(c => (
                        <label key={c.id} className="flex items-center gap-1.5 text-sm cursor-pointer">
                          <input type="checkbox" checked={comboMarketIds.includes(c.id)}
                            onChange={e => setComboMarketIds(ids => e.target.checked ? [...ids, c.id] : ids.filter(id => id !== c.id))} />
                          {c.name}
                        </label>
                      ))}
                    </div>
                  )}
                </section>

                {/* Combo Steps */}
                <section className="card p-4">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-semibold text-gray-700">Combo Steps</h3>
                    <button className="btn btn-sm btn-primary text-xs" onClick={addComboStep}>+ Add Step</button>
                  </div>
                  {(comboDetail.steps || []).length === 0 && <p className="text-sm text-gray-400">No steps yet.</p>}
                  <div className="space-y-2">
                    {(comboDetail.steps || []).map(step => (
                      <div key={step.id} className="border border-gray-200 rounded">
                        <div className="flex items-center justify-between px-3 py-2 cursor-pointer bg-gray-50 hover:bg-gray-100"
                          onClick={() => setExpandedStep(expandedStep === step.id ? null : step.id)}>
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-gray-400">{expandedStep === step.id ? '▼' : '▶'}</span>
                            <span className="text-sm font-medium text-gray-800">{step.name}</span>
                            <span className="text-xs text-gray-400">({(step.options || []).length} option{(step.options || []).length !== 1 ? 's' : ''})</span>
                          </div>
                          <div className="flex gap-1" onClick={e => e.stopPropagation()}>
                            <button className="btn btn-xs btn-primary" onClick={() => addOption(step.id)}>+ Option</button>
                            <button className="btn btn-xs btn-danger" onClick={() => deleteComboStep(step.id)}>×</button>
                          </div>
                        </div>
                        {expandedStep === step.id && (
                          <div className="p-2 space-y-1">
                            {(step.options || []).length === 0 && <p className="text-xs text-gray-400 px-1">No options yet.</p>}
                            {(step.options || []).map(opt => (
                              <div key={opt.id} className="flex items-center gap-2 px-2 py-1 text-sm rounded hover:bg-gray-50">
                                <span className={`text-xs px-1.5 py-0.5 rounded ${TYPE_BADGE[opt.item_type]}`}>{TYPE_LABEL[opt.item_type]}</span>
                                <span className="flex-1">{opt.name}</span>
                                {opt.recipe_name && <span className="text-xs text-gray-400">→ {opt.recipe_name}</span>}
                                {opt.ingredient_name && <span className="text-xs text-gray-400">→ {opt.ingredient_name}</span>}
                                {opt.item_type === 'manual' && opt.manual_cost != null && <span className="text-xs text-gray-400">${Number(opt.manual_cost).toFixed(4)}</span>}
                                <div className="flex gap-1 ml-auto">
                                  <button className="btn btn-xs btn-outline" onClick={() => { setEditingOpt(opt); setEditingOptStepId(step.id) }}>✎</button>
                                  <button className="text-xs text-red-400 hover:text-red-600" onClick={() => deleteOption(step.id, opt.id)}>×</button>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </section>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── MODIFIERS TAB ─────────────────────────────────────────────────────── */}
      {activeTab === 'modifiers' && (
        <div className="flex-1 overflow-auto p-5 max-w-3xl">
          <div className="card p-4 mb-5">
            <h3 className="text-sm font-semibold text-gray-700 mb-3">New Modifier Group</h3>
            <div className="flex gap-2">
              <input className="input flex-1" placeholder="Group name" value={newMgForm.name}
                onChange={e => setNewMgForm(f => ({ ...f, name: e.target.value }))}
                onKeyDown={e => e.key === 'Enter' && createMg()} />
              <input type="number" className="input w-20" placeholder="Min" title="Min select"
                value={newMgForm.min_select} onChange={e => setNewMgForm(f => ({ ...f, min_select: Number(e.target.value) }))} />
              <input type="number" className="input w-20" placeholder="Max" title="Max select"
                value={newMgForm.max_select} onChange={e => setNewMgForm(f => ({ ...f, max_select: Number(e.target.value) }))} />
              <button className="btn btn-primary" disabled={!newMgForm.name.trim() || mgSaving} onClick={createMg}>+ Create</button>
            </div>
          </div>
          <div className="space-y-2">
            {modifierGroups.length === 0 && <p className="text-sm text-center text-gray-400 py-8">No modifier groups yet.</p>}
            {modifierGroups.map(g => (
              <div key={g.id} className="card overflow-hidden">
                <div className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-gray-50"
                  onClick={() => toggleMg(g.id)}>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-gray-400">{expandedMgId === g.id ? '▼' : '▶'}</span>
                    {editMg?.id === g.id ? (
                      <div className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
                        <input className="input input-sm w-48" value={editMg.name} onChange={e => setEditMg(m => m ? { ...m, name: e.target.value } : m)} />
                        <input type="number" className="input input-sm w-16" value={editMg.min_select} title="Min" onChange={e => setEditMg(m => m ? { ...m, min_select: Number(e.target.value) } : m)} />
                        <input type="number" className="input input-sm w-16" value={editMg.max_select} title="Max" onChange={e => setEditMg(m => m ? { ...m, max_select: Number(e.target.value) } : m)} />
                        <button className="btn btn-xs btn-primary" onClick={() => saveMg(editMg)}>✓</button>
                        <button className="btn btn-xs btn-ghost" onClick={() => setEditMg(null)}>✗</button>
                      </div>
                    ) : (
                      <>
                        <span className="font-medium text-gray-900">{g.name}</span>
                        <span className="text-xs text-gray-400">min {g.min_select} · max {g.max_select}</span>
                        {g.option_count !== undefined && <span className="text-xs bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">{g.option_count} opt{g.option_count !== 1 ? 's' : ''}</span>}
                      </>
                    )}
                  </div>
                  {editMg?.id !== g.id && (
                    <div className="flex gap-1" onClick={e => e.stopPropagation()}>
                      <button className="btn btn-xs btn-outline" onClick={() => setEditMg(g)}>Edit</button>
                      <button className="btn btn-xs btn-danger" onClick={() => deleteMg(g)}>Delete</button>
                    </div>
                  )}
                </div>
                {expandedMgId === g.id && (
                  <div className="border-t border-gray-100 px-4 py-3 bg-gray-50">
                    <div className="space-y-1 mb-2">
                      {(expandedOptions[g.id] || []).length === 0 && <p className="text-xs text-gray-400">No options yet.</p>}
                      {(expandedOptions[g.id] || []).map(opt => (
                        <div key={opt.id} className="flex items-center gap-2 text-sm py-0.5">
                          <span className={`text-xs px-1.5 py-0.5 rounded ${TYPE_BADGE[opt.item_type]}`}>{TYPE_LABEL[opt.item_type]}</span>
                          <span className="flex-1">{opt.name}</span>
                          {opt.price_addon > 0 && <span className="text-xs text-gray-500">+${Number(opt.price_addon).toFixed(2)}</span>}
                          <button className="text-xs text-red-400 hover:text-red-600" onClick={() => deleteMgOption(g.id, opt.id)}>×</button>
                        </div>
                      ))}
                    </div>
                    <ModifierOptionAddForm recipes={recipes} ingredients={ingredients} onAdd={opt => addMgOption(g.id, opt)} />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Modals ─────────────────────────────────────────────────────────────── */}
      {siModal !== null && (
        <SalesItemModal
          mode={siModal === 'new' ? 'new' : 'edit'}
          initial={siModal === 'new' ? null : siModal as SalesItem}
          defaultType={newComboMode ? 'combo' : undefined}
          recipes={recipes} ingredients={ingredients}
          onSave={saveSalesItem} saving={saving}
          onClose={() => { setSiModal(null); setNewComboMode(false) }}
        />
      )}

      {deleting && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-lg shadow-xl p-6 max-w-sm w-full">
            <h3 className="font-semibold mb-2">Delete "{deleting.name}"?</h3>
            <p className="text-sm text-gray-500 mb-4">This action cannot be undone.</p>
            <div className="flex gap-2 justify-end">
              <button className="btn btn-outline" onClick={() => setDeleting(null)}>Cancel</button>
              <button className="btn btn-danger" onClick={deleteSalesItem}>Delete</button>
            </div>
          </div>
        </div>
      )}

      {editingOpt && (
        <ComboOptionForm opt={editingOpt} modifierGroups={modifierGroups} recipes={recipes} ingredients={ingredients}
          onSave={saveOption} onClose={() => setEditingOpt(null)} />
      )}

      {toast && <Toast msg={toast.msg} onClose={() => setToast(null)} />}
    </div>
  )
}
