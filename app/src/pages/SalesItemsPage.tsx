import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useApi } from '../hooks/useApi'
import { Field, Spinner, Modal, Toast } from '../components/ui'
import TranslationEditor from '../components/TranslationEditor'
import ImageUpload from '../components/ImageUpload'

// ── Types ─────────────────────────────────────────────────────────────────────
interface Country    { id: number; name: string }
interface Recipe     { id: number; name: string; category_name: string | null; yield_unit_abbr?: string | null }
interface Ingredient { id: number; name: string; base_unit_abbr: string | null }
interface SalesItemMarket { country_id: number; country_name: string; is_active: boolean }

interface ModifierOption {
  id: number; modifier_group_id: number; name: string; display_name?: string | null
  item_type: 'recipe' | 'ingredient' | 'manual'
  recipe_id: number | null; recipe_name?: string
  recipe_yield_qty?: number | null; recipe_yield_unit_abbr?: string | null
  ingredient_id: number | null; ingredient_name?: string
  ingredient_unit_abbr?: string | null
  manual_cost: number | null; price_addon: number; sort_order: number; qty: number
  image_url?: string | null
}
interface ModifierGroup {
  id: number; name: string; display_name?: string | null; description: string | null
  min_select: number; max_select: number; allow_repeat_selection?: boolean; default_auto_show?: boolean; option_count?: number
  options?: ModifierOption[]
}
interface ComboStepOption {
  id: number; combo_step_id: number; name: string; display_name?: string | null
  item_type: 'recipe' | 'ingredient' | 'manual' | 'sales_item'
  recipe_id: number | null; recipe_name?: string
  ingredient_id: number | null; ingredient_name?: string; ingredient_unit_abbr?: string
  sales_item_id: number | null; sales_item_name?: string; sales_item_type?: string
  manual_cost: number | null; price_addon: number; qty: number; sort_order: number
  modifier_groups?: { modifier_group_id: number; name: string }[]
}
interface ComboStep {
  id: number; combo_id: number; name: string; display_name?: string | null
  description: string | null; sort_order: number
  min_select: number; max_select: number; allow_repeat: boolean; auto_select: boolean
  options?: ComboStepOption[]
}
interface Combo {
  id: number; name: string; description: string | null
  category_id: number | null; category_name: string | null
  image_url: string | null; sort_order: number
  step_count?: number; steps?: ComboStep[]
}
interface SalesItem {
  id: number
  item_type: 'recipe' | 'ingredient' | 'manual' | 'combo'
  name: string; display_name?: string | null
  category_id: number | null; category_name: string | null
  description: string | null
  recipe_id: number | null; recipe_name?: string; recipe_yield_unit_abbr?: string | null
  ingredient_id: number | null; ingredient_name?: string; ingredient_base_unit_abbr?: string | null
  combo_id: number | null; combo_name?: string
  manual_cost: number | null; image_url: string | null; sort_order: number
  qty: number
  modifier_group_count?: number
  markets?: SalesItemMarket[]
  modifier_groups?: { modifier_group_id: number; name: string; sort_order: number; min_select?: number; auto_show?: boolean | null }[]
}

// ── Combo panel edit target ────────────────────────────────────────────────────
type ComboEditTarget =
  | { type: 'combo';  combo: Combo }
  | { type: 'step';   step: ComboStep }
  | { type: 'option'; stepId: number; opt: ComboStepOption }
  | null

// ── Modifier group panel edit target ──────────────────────────────────────────
type MgEditTarget =
  | { type: 'group';  group: ModifierGroup }
  | { type: 'option'; groupId: number; opt: ModifierOption | null }
  | null

// ── Constants ─────────────────────────────────────────────────────────────────
const TYPE_BADGE: Record<string, string> = {
  recipe:     'bg-blue-100 text-blue-700',
  ingredient: 'bg-green-100 text-green-700',
  manual:     'bg-purple-100 text-purple-700',
  combo:      'bg-orange-100 text-orange-700',
  sales_item: 'bg-teal-100 text-teal-700',
}
const TYPE_LABEL: Record<string, string> = { recipe: 'Recipe', ingredient: 'Ingredient', manual: 'Manual', combo: 'Combo', sales_item: 'Sales Item' }

// ── ComboFormModal ─────────────────────────────────────────────────────────────
function ComboFormModal({ mode, initial, onSave, saving, onClose }: {
  mode: 'new' | 'edit'; initial: Combo | null
  onSave(payload: Partial<Combo>): Promise<void>; saving: boolean; onClose(): void
}) {
  const api = useApi()
  const [categories, setCategories] = useState<{id: number; name: string}[]>([])
  useEffect(() => {
    api.get('/categories?for_sales_items=true')
      .then((d: any[]) => setCategories((d || []).map((c: any) => ({ id: c.id, name: c.name })).sort((a: any, b: any) => a.name.localeCompare(b.name))))
      .catch(() => {})
  }, [api])

  const [form, setForm] = useState({
    name:        initial?.name        ?? '',
    description: initial?.description ?? '',
    category_id: initial?.category_id ? String(initial.category_id) : '',
    image_url:   initial?.image_url   ?? null as string | null,
    sort_order:  initial?.sort_order  ?? 0,
  })

  return (
    <Modal title={mode === 'new' ? 'New Combo' : 'Edit Combo'} onClose={onClose}>
      <div className="space-y-3 p-1">
        <Field label="Name *">
          <input className="input w-full" value={form.name} autoFocus
            onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
        </Field>
        <Field label="Category">
          <select className="input w-full" value={form.category_id}
            onChange={e => setForm(f => ({ ...f, category_id: e.target.value }))}>
            <option value="">No category…</option>
            {categories.map(c => <option key={c.id} value={String(c.id)}>{c.name}</option>)}
          </select>
        </Field>
        <Field label="Description">
          <textarea className="input w-full" rows={2} value={form.description}
            onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
        </Field>
        <ImageUpload label="Image" value={form.image_url} onChange={url => setForm(f => ({ ...f, image_url: url }))} formKey="sales_item" />
      </div>
      <div className="flex justify-end gap-2 mt-4">
        <button className="btn btn-outline" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" disabled={!form.name.trim() || saving}
          onClick={() => onSave({ ...form, name: form.name.trim(), category_id: Number(form.category_id) || null, description: form.description.trim() || null })}>
          {saving ? 'Saving…' : mode === 'new' ? 'Create' : 'Save'}
        </button>
      </div>
    </Modal>
  )
}

// ── SalesItemModal ─────────────────────────────────────────────────────────────
function SalesItemModal({ mode, initial, defaultType, recipes, ingredients, combos, onSave, saving, onClose }: {
  mode: 'new' | 'edit'; initial: SalesItem | null; defaultType?: SalesItem['item_type']
  recipes: Recipe[]; ingredients: Ingredient[]; combos: Combo[]
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
    combo_id: initial?.combo_id ?? null as number | null,
    manual_cost: initial?.manual_cost ?? null as number | null,
    image_url: initial?.image_url ?? null as string | null,
    sort_order: initial?.sort_order ?? 0,
  })
  const [recipeSearch, setRecipeSearch] = useState(initial?.recipe_name ?? '')
  const [recipeOpen,   setRecipeOpen]   = useState(false)
  const [ingSearch,    setIngSearch]    = useState(initial?.ingredient_name ?? '')
  const [ingOpen,      setIngOpen]      = useState(false)
  const [comboSearch,  setComboSearch]  = useState(initial?.combo_name ?? '')
  const [comboOpen,    setComboOpen]    = useState(false)
  const filteredRecipes = useMemo(() => recipes.filter(r => r.name.toLowerCase().includes(recipeSearch.toLowerCase())).slice(0, 50), [recipes, recipeSearch])
  const filteredIngs    = useMemo(() => ingredients.filter(i => i.name.toLowerCase().includes(ingSearch.toLowerCase())).slice(0, 50), [ingredients, ingSearch])
  const filteredCombos  = useMemo(() => combos.filter(c => c.name.toLowerCase().includes(comboSearch.toLowerCase())).slice(0, 50), [combos, comboSearch])

  const handleSave = () => {
    if (!form.name.trim()) return
    onSave({
      ...form, name: form.name.trim(),
      category_id: Number(form.category_id) || null,
      description: form.description.trim() || null,
      recipe_id:    form.item_type === 'recipe'     ? form.recipe_id    : null,
      ingredient_id: form.item_type === 'ingredient' ? form.ingredient_id : null,
      combo_id:     form.item_type === 'combo'      ? form.combo_id     : null,
      manual_cost:  form.item_type === 'manual'     ? form.manual_cost  : null,
    })
  }

  return (
    <Modal title={mode === 'new' ? 'New Sales Item' : 'Edit Sales Item'} onClose={onClose}>
      <div className="space-y-3 p-1">
        <Field label="Name *"><input className="input w-full" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} autoFocus /></Field>
        <Field label="Item Type">
          <div className="flex gap-2 flex-wrap">
            {(['recipe', 'ingredient', 'manual', 'combo'] as const).map(t => (
              <button key={t} className={`btn btn-sm ${form.item_type === t ? 'btn-primary' : 'btn-outline'}`}
                onClick={() => setForm(f => ({ ...f, item_type: t, recipe_id: null, ingredient_id: null, combo_id: null }))}>
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
        {form.item_type === 'combo' && (
          <Field label="Combo">
            <div className="relative">
              <input className="input w-full" placeholder="Search combos…" value={comboSearch}
                onChange={e => { setComboSearch(e.target.value); setComboOpen(true) }}
                onFocus={() => setComboOpen(true)} onBlur={() => setTimeout(() => setComboOpen(false), 150)} autoComplete="off" />
              {comboOpen && <div className="absolute top-full left-0 right-0 z-50 bg-white border border-gray-200 rounded-lg shadow-lg mt-0.5 max-h-52 overflow-y-auto">
                {filteredCombos.length === 0
                  ? <div className="px-3 py-2 text-sm text-gray-400 italic">{combos.length === 0 ? 'No combos yet — create one in the Combos tab first' : `No combos match "${comboSearch}"`}</div>
                  : filteredCombos.map(c => <button key={c.id} type="button"
                      className={`w-full text-left px-3 py-2 text-sm hover:bg-accent-dim flex items-center gap-2 ${form.combo_id === c.id ? 'bg-accent-dim font-medium text-accent' : 'text-gray-800'}`}
                      onMouseDown={e => e.preventDefault()}
                      onClick={() => { setForm(f => ({ ...f, combo_id: c.id })); setComboSearch(c.name); setComboOpen(false) }}>
                      {form.combo_id === c.id && <span className="text-accent text-xs">✓</span>}
                      <span>{c.name}</span>
                      {c.step_count !== undefined && <span className="ml-auto text-xs text-gray-400 shrink-0">{c.step_count} step{c.step_count !== 1 ? 's' : ''}</span>}
                    </button>)}
              </div>}
            </div>
          </Field>
        )}
        {form.item_type === 'manual' && (
          <Field label="Manual Cost (USD per portion)">
            <input type="number" step="0.0001" min="0" className="input w-full" value={form.manual_cost ?? ''}
              onChange={e => setForm(f => ({ ...f, manual_cost: parseFloat(e.target.value) || null }))} />
          </Field>
        )}
        <Field label="Category">
          <select className="input w-full" value={form.category_id} onChange={e => setForm(f => ({ ...f, category_id: e.target.value }))}>
            <option value="">No category…</option>
            {siCategories.map(c => <option key={c.id} value={String(c.id)}>{c.name}</option>)}
          </select>
        </Field>
        <Field label="Description">
          <textarea className="input w-full" rows={2} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
        </Field>
        <ImageUpload label="Image" value={form.image_url} onChange={url => setForm(f => ({ ...f, image_url: url }))} formKey="sales_item" />
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

// ── Main SalesItemsPage ────────────────────────────────────────────────────────
export default function SalesItemsPage() {
  const api = useApi()
  const [activeTab, setActiveTab] = useState<'items' | 'combos' | 'modifiers'>('items')

  // ── Shared data ────────────────────────────────────────────────────────────
  const [salesItems,     setSalesItems]     = useState<SalesItem[]>([])
  const [combos,         setCombos]         = useState<Combo[]>([])
  const [modifierGroups, setModifierGroups] = useState<ModifierGroup[]>([])
  const [countries,      setCountries]      = useState<Country[]>([])
  const [recipes,        setRecipes]        = useState<Recipe[]>([])
  const [ingredients,    setIngredients]    = useState<Ingredient[]>([])
  const [siCategories,   setSiCategories]   = useState<{id: number; name: string}[]>([])
  const [loading,        setLoading]        = useState(true)
  const [toast,          setToast]          = useState<{msg: string} | null>(null)
  const showToast = (msg: string) => setToast({ msg })

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [items, combosData, groups, c, r, i] = await Promise.all([
        api.get('/sales-items?include_inactive=true'),
        api.get('/combos'),
        api.get('/modifier-groups'),
        api.get('/countries'),
        api.get('/recipes'),
        api.get('/ingredients'),
      ])
      setSalesItems(items || [])
      setCombos(combosData || [])
      setModifierGroups(groups || [])
      setCountries(c || [])
      setRecipes(r || [])
      setIngredients(i || [])
    } finally { setLoading(false) }
  }, [api])

  useEffect(() => { load() }, [load])
  useEffect(() => {
    api.get('/categories?for_sales_items=true')
      .then((d: any[]) => setSiCategories((d || []).map((c: any) => ({ id: c.id, name: c.name })).sort((a: any, b: any) => a.name.localeCompare(b.name))))
      .catch(() => {})
  }, [api])

  // ── Create / edit / delete ─────────────────────────────────────────────────
  const [siModal,       setSiModal]       = useState<'new' | null>(null)
  const [newComboMode,  setNewComboMode]  = useState(false)
  const [saving,        setSaving]        = useState(false)
  const [deleting,      setDeleting]      = useState<SalesItem | null>(null)

  const saveSalesItem = async (payload: Partial<SalesItem>) => {
    setSaving(true)
    try {
      const created: SalesItem = await api.post('/sales-items', payload)
      // Default to all markets (global visibility)
      if (countries.length > 0) {
        await api.put(`/sales-items/${created.id}/markets`, { country_ids: countries.map(c => c.id) })
      }
      const full: SalesItem = await api.get(`/sales-items/${created.id}`)
      setSalesItems(prev => [...prev, full].sort((a, b) => a.name.localeCompare(b.name)))
      showToast('Sales Item created')
      setSiModal(null); setNewComboMode(false)
    } catch { showToast('Save failed') } finally { setSaving(false) }
  }

  const deleteSalesItem = async () => {
    if (!deleting) return
    try {
      await api.delete(`/sales-items/${deleting.id}`)
      setSalesItems(prev => prev.filter(s => s.id !== deleting.id))
      setDeleting(null); showToast('Deleted')
    } catch { showToast('Delete failed') }
  }

  // ── Items tab ──────────────────────────────────────────────────────────────
  const [itemSearch,    setItemSearch]    = useState('')
  const [typeFilter,    setTypeFilter]    = useState<'recipe' | 'ingredient' | 'manual' | 'combo' | ''>('')
  const [selectedSiId,  setSelectedSiId]  = useState<number | null>(null)
  const [siSortField,   setSiSortField]   = useState<string>('name')
  const [siSortDir,     setSiSortDir]     = useState<'asc' | 'desc'>('asc')
  const [bulkSelected,  setBulkSelected]  = useState<Set<number>>(new Set())
  const [bulkCategoryId, setBulkCategoryId] = useState<string>('')
  const [bulkMarkets,   setBulkMarkets]   = useState<number[]>([])
  const [bulkMgId,      setBulkMgId]      = useState<number | ''>('')
  const [bulkApplying,  setBulkApplying]  = useState(false)

  // ── Panel edit form ─────────────────────────────────────────────────────────
  type PanelForm = {
    name: string; display_name: string | null; category_id: string; description: string
    item_type: SalesItem['item_type']
    recipe_id: number | null; ingredient_id: number | null
    combo_id: number | null; manual_cost: number | null
    image_url: string | null; qty: number
  }
  const blankPanelForm = (si: SalesItem): PanelForm => ({
    name:          si.name,
    display_name:  si.display_name  ?? null,
    category_id:   si.category_id ? String(si.category_id) : '',
    description:   si.description ?? '',
    item_type:     si.item_type,
    recipe_id:     si.recipe_id     ?? null,
    ingredient_id: si.ingredient_id ?? null,
    combo_id:      si.combo_id      ?? null,
    manual_cost:   si.manual_cost   ?? null,
    image_url:     si.image_url     ?? null,
    qty:           si.qty ?? 1,
  })
  const [panelForm,        setPanelForm]        = useState<PanelForm | null>(null)
  const [panelSaving,      setPanelSaving]      = useState(false)
  const [panelRecipeSearch,  setPanelRecipeSearch]  = useState('')
  const [panelRecipeOpen,    setPanelRecipeOpen]    = useState(false)
  const [panelIngSearch,     setPanelIngSearch]     = useState('')
  const [panelIngOpen,       setPanelIngOpen]       = useState(false)
  const [panelComboSearch,   setPanelComboSearch]   = useState('')
  const [panelComboOpen,     setPanelComboOpen]     = useState(false)
  const [panelMarkets,     setPanelMarkets]     = useState<number[]>([])
  const [panelMktSaving,   setPanelMktSaving]   = useState(false)
  const [panelTab,         setPanelTab]         = useState<'details' | 'markets' | 'modifiers' | 'translations'>('details')

  // Populate form when selection changes
  useEffect(() => {
    if (!selectedSiId) { setPanelForm(null); return }
    const si = salesItems.find(s => s.id === selectedSiId)
    if (!si) return
    const f = blankPanelForm(si)
    setPanelForm(f)
    setPanelMarkets((si.markets || []).filter(m => m.is_active).map(m => m.country_id))
    setPanelRecipeSearch(si.recipe_name     ?? '')
    setPanelIngSearch(si.ingredient_name    ?? '')
    setPanelComboSearch(si.combo_name       ?? '')
    setPanelRecipeOpen(false); setPanelIngOpen(false); setPanelComboOpen(false)
    setPanelTab('details')
  }, [selectedSiId]) // eslint-disable-line react-hooks/exhaustive-deps

  const togglePanelMarket = async (countryId: number) => {
    if (!selectedSiId || panelMktSaving) return
    const newIds = panelMarkets.includes(countryId)
      ? panelMarkets.filter(id => id !== countryId)
      : [...panelMarkets, countryId]
    setPanelMarkets(newIds)
    setPanelMktSaving(true)
    try {
      await api.put(`/sales-items/${selectedSiId}/markets`, { country_ids: newIds })
      setSalesItems(prev => prev.map(s => s.id === selectedSiId
        ? { ...s, markets: (s.markets || []).map(m => ({ ...m, is_active: newIds.includes(m.country_id) })) }
        : s
      ))
    } catch { showToast('Failed to update markets') } finally { setPanelMktSaving(false) }
  }

  const savePanelItem = async () => {
    if (!selectedSiId || !panelForm || !panelForm.name.trim()) return
    setPanelSaving(true)
    try {
      const payload = {
        ...panelForm,
        name:          panelForm.name.trim(),
        display_name:  panelForm.display_name?.trim() || null,
        category_id:   Number(panelForm.category_id) || null,
        description:   panelForm.description.trim() || null,
        recipe_id:     panelForm.item_type === 'recipe'      ? panelForm.recipe_id     : null,
        ingredient_id: panelForm.item_type === 'ingredient'  ? panelForm.ingredient_id : null,
        combo_id:      panelForm.item_type === 'combo'       ? panelForm.combo_id      : null,
        manual_cost:   panelForm.item_type === 'manual'      ? panelForm.manual_cost   : null,
        qty:           panelForm.qty ?? 1,
      }
      const updated: SalesItem = await api.put(`/sales-items/${selectedSiId}`, payload)
      setSalesItems(prev => prev.map(s => s.id === selectedSiId ? { ...s, ...updated } : s))
      showToast('Sales Item saved')
    } catch { showToast('Save failed') } finally { setPanelSaving(false) }
  }

  const toggleSort = (field: string) => {
    if (siSortField === field) {
      setSiSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSiSortField(field)
      setSiSortDir('asc')
    }
  }

  const nonComboItems = useMemo(() => {
    const filtered = salesItems.filter(si => {
      if (typeFilter && si.item_type !== typeFilter) return false
      if (itemSearch && !si.name.toLowerCase().includes(itemSearch.toLowerCase()) && !(si.category_name || '').toLowerCase().includes(itemSearch.toLowerCase())) return false
      return true
    })
    return [...filtered].sort((a, b) => {
      let cmp = 0
      if (siSortField === 'name')          cmp = a.name.localeCompare(b.name)
      else if (siSortField === 'item_type') cmp = (TYPE_LABEL[a.item_type] || '').localeCompare(TYPE_LABEL[b.item_type] || '')
      else if (siSortField === 'category_name') cmp = (a.category_name || '').localeCompare(b.category_name || '')
      return siSortDir === 'asc' ? cmp : -cmp
    })
  }, [salesItems, typeFilter, itemSearch, siSortField, siSortDir])

  const marketsDisplay = (item: SalesItem) => {
    const active = (item.markets || []).filter(m => m.is_active)
    if (active.length === 0 || active.length === countries.length) return { label: 'Global', color: 'bg-green-100 text-green-700' }
    return { label: `${active.length}/${countries.length}`, color: 'bg-gray-100 text-gray-600' }
  }

  // ── Combos tab ─────────────────────────────────────────────────────────────
  const [selectedComboId,    setSelectedComboId]    = useState<number | null>(null)
  const [comboDetail,        setComboDetail]        = useState<Combo | null>(null)
  const [comboDetailLoading, setComboDetailLoading] = useState(false)
  const [expandedStep,       setExpandedStep]       = useState<number | null>(null)
  const [comboModal,         setComboModal]         = useState<'new' | null>(null)
  // ── Combo side panel ─────────────────────────────────────────────────────
  const [comboPanelWidth,    setComboPanelWidth]    = useState(360)
  const [comboEditTarget,    setComboEditTarget]    = useState<ComboEditTarget>(null)
  const [comboPanelSaving,   setComboPanelSaving]   = useState(false)
  const [comboPanelOptTab,   setComboPanelOptTab]   = useState<'details' | 'modifiers'>('details')
  const [cpComboForm,        setCpComboForm]        = useState<{ name: string; description: string; category_id: string; image_url: string | null } | null>(null)
  const [cpStepForm,         setCpStepForm]         = useState<{ name: string; display_name: string | null; min_select: number; max_select: number; allow_repeat: boolean; auto_select: boolean } | null>(null)
  const [cpOptForm,          setCpOptForm]          = useState<ComboStepOption | null>(null)
  const [cpOptMgIds,         setCpOptMgIds]         = useState<number[]>([])
  const [cpOptRecipeSearch,  setCpOptRecipeSearch]  = useState('')
  const [cpOptIngSearch,     setCpOptIngSearch]     = useState('')
  const [cpOptSiSearch,      setCpOptSiSearch]      = useState('')
  const [cpOptRecipeOpen,    setCpOptRecipeOpen]    = useState(false)
  const [cpOptIngOpen,       setCpOptIngOpen]       = useState(false)
  const [cpOptSiOpen,        setCpOptSiOpen]        = useState(false)
  const [cpOptMgOpen,        setCpOptMgOpen]        = useState(false)
  const [savingCombo,        setSavingCombo]        = useState(false)
  const [deletingCombo,      setDeletingCombo]      = useState<Combo | null>(null)

  const [duplicatingCombo, setDuplicatingCombo] = useState(false)

  useEffect(() => {
    // Reset panel state whenever the selected combo changes
    setComboEditTarget(null)
    setExpandedStep(null)
    setCpComboForm(null)
    setCpStepForm(null)
    setCpOptForm(null)
    if (!selectedComboId) { setComboDetail(null); return }
    setComboDetailLoading(true)
    api.get(`/combos/${selectedComboId}`)
      .then((d: Combo) => setComboDetail(d))
      .catch(() => setComboDetail(null))
      .finally(() => setComboDetailLoading(false))
  }, [selectedComboId, api])

  const reloadComboDetail = useCallback(async () => {
    if (!selectedComboId) return
    const updated: Combo = await api.get(`/combos/${selectedComboId}`)
    setComboDetail(updated)
    setCombos(prev => prev.map(c => c.id === selectedComboId ? { ...c, step_count: (updated.steps || []).length } : c))
  }, [selectedComboId, api])

  const saveCombo = async (payload: Partial<Combo>) => {
    setSavingCombo(true)
    try {
      const created: Combo = await api.post('/combos', payload)
      setCombos(prev => [...prev, { ...created, step_count: 0 }].sort((a, b) => a.name.localeCompare(b.name)))
      setSelectedComboId(created.id)
      showToast('Combo created')
      setComboModal(null)
    } catch { showToast('Save failed') } finally { setSavingCombo(false) }
  }

  const deleteComboItem = async () => {
    if (!deletingCombo) return
    try {
      await api.delete(`/combos/${deletingCombo.id}`)
      setCombos(prev => prev.filter(c => c.id !== deletingCombo.id))
      if (selectedComboId === deletingCombo.id) setSelectedComboId(null)
      setDeletingCombo(null); showToast('Combo deleted')
    } catch { showToast('Delete failed') }
  }

  const addComboStep = async () => {
    const name = window.prompt('Step name (e.g. "Choose your main")')
    if (!name || !selectedComboId) return
    try {
      await api.post(`/combos/${selectedComboId}/steps`, {
        name: name.trim(), sort_order: (comboDetail?.steps || []).length,
        min_select: 1, max_select: 1, allow_repeat: false,
      })
      await reloadComboDetail()
    } catch { showToast('Failed to add step') }
  }

  const deleteComboStep = async (stepId: number) => {
    if (!window.confirm('Delete this step and all its options?') || !selectedComboId) return
    try { await api.delete(`/combos/${selectedComboId}/steps/${stepId}`); await reloadComboDetail() }
    catch { showToast('Failed') }
  }

  const duplicateComboStep = async (stepId: number) => {
    if (!selectedComboId) return
    try { await api.post(`/combos/${selectedComboId}/steps/${stepId}/duplicate`, {}); await reloadComboDetail() }
    catch { showToast('Failed to duplicate step') }
  }

  const reorderComboStep = async (stepIdx: number, direction: 'up' | 'down') => {
    if (!comboDetail || !selectedComboId) return
    const steps = [...(comboDetail.steps || [])]
    const targetIdx = direction === 'up' ? stepIdx - 1 : stepIdx + 1
    if (targetIdx < 0 || targetIdx >= steps.length) return
    ;[steps[stepIdx], steps[targetIdx]] = [steps[targetIdx], steps[stepIdx]]
    const updated = steps.map((s, i) => ({ ...s, sort_order: i }))
    setComboDetail(d => d ? { ...d, steps: updated } : d)
    try {
      await Promise.all([
        api.put(`/combos/${selectedComboId}/steps/${updated[stepIdx].id}`, { ...updated[stepIdx] }),
        api.put(`/combos/${selectedComboId}/steps/${updated[targetIdx].id}`, { ...updated[targetIdx] }),
      ])
    } catch {
      showToast('Failed to reorder')
      reloadComboDetail()
    }
  }

  // Populate panel forms when the edit target changes
  useEffect(() => {
    setComboPanelOptTab('details')
    if (!comboEditTarget) { setCpComboForm(null); setCpStepForm(null); setCpOptForm(null); return }
    if (comboEditTarget.type === 'combo') {
      const c = comboEditTarget.combo
      setCpComboForm({ name: c.name, description: c.description ?? '', category_id: c.category_id ? String(c.category_id) : '', image_url: c.image_url ?? null })
      setCpStepForm(null); setCpOptForm(null)
    } else if (comboEditTarget.type === 'step') {
      const s = comboEditTarget.step
      setCpStepForm({ name: s.name, display_name: s.display_name ?? null, min_select: s.min_select ?? 1, max_select: s.max_select ?? 1, allow_repeat: s.allow_repeat ?? false, auto_select: s.auto_select ?? false })
      setCpComboForm(null); setCpOptForm(null)
    } else if (comboEditTarget.type === 'option') {
      const o = comboEditTarget.opt
      setCpOptForm({ ...o })
      setCpOptMgIds((o.modifier_groups || []).map(m => m.modifier_group_id))
      setCpOptRecipeSearch(o.recipe_name ?? '')
      setCpOptIngSearch(o.ingredient_name ?? '')
      setCpOptSiSearch(o.sales_item_name ?? '')
      setCpOptRecipeOpen(false); setCpOptIngOpen(false); setCpOptSiOpen(false); setCpOptMgOpen(false)
      setCpComboForm(null); setCpStepForm(null)
    }
  }, [comboEditTarget]) // eslint-disable-line react-hooks/exhaustive-deps

  const saveComboPanelItem = async () => {
    if (!comboEditTarget || comboPanelSaving) return
    setComboPanelSaving(true)
    try {
      if (comboEditTarget.type === 'combo' && cpComboForm) {
        const payload = { ...cpComboForm, category_id: Number(cpComboForm.category_id) || null, description: cpComboForm.description.trim() || null }
        const updated: Combo = await api.put(`/combos/${comboEditTarget.combo.id}`, payload)
        setCombos(prev => prev.map(c => c.id === updated.id ? { ...c, ...updated } : c))
        setComboDetail(d => d ? { ...d, ...updated } : d)
        showToast('Combo saved')
      } else if (comboEditTarget.type === 'step' && cpStepForm && selectedComboId) {
        const step = comboEditTarget.step
        await api.put(`/combos/${selectedComboId}/steps/${step.id}`, { name: cpStepForm.name, description: step.description, sort_order: step.sort_order ?? 0, display_name: cpStepForm.display_name, min_select: cpStepForm.min_select, max_select: cpStepForm.max_select, allow_repeat: cpStepForm.allow_repeat, auto_select: cpStepForm.auto_select })
        await reloadComboDetail()
        setComboEditTarget(null)
        showToast('Step saved')
      } else if (comboEditTarget.type === 'option' && cpOptForm && selectedComboId) {
        const { stepId, opt } = comboEditTarget
        const payload = { ...cpOptForm }
        let savedId: number
        if (opt.id === 0) {
          const created: any = await api.post(`/combos/${selectedComboId}/steps/${stepId}/options`, payload)
          savedId = created.id
        } else {
          await api.put(`/combos/${selectedComboId}/steps/${stepId}/options/${opt.id}`, payload)
          savedId = opt.id
        }
        await api.put(`/combos/${selectedComboId}/steps/${stepId}/options/${savedId}/modifier-groups`, { modifier_group_ids: cpOptMgIds })
        await reloadComboDetail()
        setComboEditTarget(null)
        showToast('Option saved')
      }
    } catch { showToast('Save failed') } finally { setComboPanelSaving(false) }
  }

  const startComboPanelResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    const startX = e.clientX
    const startW = comboPanelWidth
    const onMove = (ev: MouseEvent) => setComboPanelWidth(Math.max(280, Math.min(600, startW - (ev.clientX - startX))))
    const onUp = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp) }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [comboPanelWidth])

  const deleteOption = async (stepId: number, optId: number) => {
    if (!window.confirm('Delete this option?') || !selectedComboId) return
    try { await api.delete(`/combos/${selectedComboId}/steps/${stepId}/options/${optId}`); await reloadComboDetail() }
    catch { showToast('Failed') }
  }

  const duplicateCombo = async () => {
    if (!selectedComboId || duplicatingCombo) return
    setDuplicatingCombo(true)
    try {
      const created: any = await api.post(`/combos/${selectedComboId}/duplicate`, {})
      setCombos(prev => [...prev, created])
      setSelectedComboId(created.id)
      showToast('Combo duplicated')
    } catch { showToast('Failed to duplicate combo') } finally { setDuplicatingCombo(false) }
  }

  // ── Sales Item — modifier group assignment ────────────────────────────────
  const [siMgData,      setSiMgData]      = useState<Record<number, { modifier_group_id: number; name: string; sort_order: number; min_select?: number; auto_show?: boolean | null }[]>>({})
  const [siMgLoading,   setSiMgLoading]   = useState<Set<number>>(new Set())
  const [siMgAddOpen,   setSiMgAddOpen]   = useState<number | null>(null)
  const [siMgAddPos,    setSiMgAddPos]    = useState<{ top: number; left: number } | null>(null)

  const toggleSiMg = async (siId: number) => {
    if (!(siId in siMgData)) {
      setSiMgLoading(prev => new Set([...prev, siId]))
      try {
        const full: SalesItem = await api.get(`/sales-items/${siId}`)
        setSiMgData(prev => ({ ...prev, [siId]: full.modifier_groups || [] }))
      } catch { /* ignore */ }
      finally { setSiMgLoading(prev => { const n = new Set(prev); n.delete(siId); return n }) }
    }
  }

  const saveSiModifiers = async (siId: number, groups: { modifier_group_id: number; name: string; sort_order: number; min_select?: number; auto_show?: boolean | null }[]) => {
    try {
      await api.put(`/sales-items/${siId}/modifier-groups`, {
        groups: groups.map(g => ({ modifier_group_id: g.modifier_group_id, auto_show: g.auto_show !== false }))
      })
      setSiMgData(prev => ({ ...prev, [siId]: groups }))
      setSalesItems(prev => prev.map(s => s.id === siId ? { ...s, modifier_group_count: groups.length } : s))
    } catch { showToast('Failed to save modifiers') }
  }

  const toggleAutoShow = (siId: number, mgId: number, newVal: boolean) => {
    const current = siMgData[siId] || []
    saveSiModifiers(siId, current.map(g => g.modifier_group_id === mgId ? { ...g, auto_show: newVal } : g))
  }

  const removeSiModifier = (siId: number, mgId: number) => {
    const current = siMgData[siId] || []
    saveSiModifiers(siId, current.filter(g => g.modifier_group_id !== mgId))
  }

  const addSiModifier = (siId: number, mg: ModifierGroup) => {
    const current = siMgData[siId] || []
    if (current.some(g => g.modifier_group_id === mg.id)) return
    saveSiModifiers(siId, [...current, { modifier_group_id: mg.id, name: mg.name, sort_order: current.length, min_select: mg.min_select, auto_show: null }])
    setSiMgAddOpen(null)
  }

  // Auto-load modifier groups when a sales item is selected in the panel
  useEffect(() => {
    if (selectedSiId && !siMgData[selectedSiId] && !siMgLoading.has(selectedSiId)) {
      toggleSiMg(selectedSiId)
    }
  }, [selectedSiId])

  // ── Modifiers tab ──────────────────────────────────────────────────────────
  const [expandedMgId,    setExpandedMgId]    = useState<number | null>(null)
  const [expandedOptions, setExpandedOptions] = useState<Record<number, ModifierOption[]>>({})
  const [newMgForm,       setNewMgForm]       = useState({ name: '', display_name: '', min_select: 0, max_select: 1, allow_repeat_selection: false })
  const [mgSaving,        setMgSaving]        = useState(false)
  const [showNewMgModal,  setShowNewMgModal]  = useState(false)
  const [mgEditTarget,    setMgEditTarget]    = useState<MgEditTarget>(null)
  const [mgPanelWidth,    setMgPanelWidth]    = useState(360)
  const [mgPanelSaving,   setMgPanelSaving]   = useState(false)
  const [mpGroupForm,     setMpGroupForm]     = useState<{ name: string; display_name: string; min_select: number; max_select: number; allow_repeat_selection: boolean; default_auto_show?: boolean | null } | null>(null)
  const [mpOptForm,       setMpOptForm]       = useState<{ name: string; display_name: string; item_type: 'recipe' | 'ingredient' | 'manual'; recipe_id: number | null; ingredient_id: number | null; manual_cost: number | null; qty: number; sort_order: number; image_url: string | null } | null>(null)
  const [mpOptRecipeSearch, setMpOptRecipeSearch] = useState('')
  const [mpOptIngSearch,    setMpOptIngSearch]    = useState('')
  const [mpOptRecipeOpen,   setMpOptRecipeOpen]   = useState(false)
  const [mpOptIngOpen,      setMpOptIngOpen]      = useState(false)

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
      const created = await api.post('/modifier-groups', { ...newMgForm, display_name: newMgForm.display_name || null })
      setModifierGroups(prev => [...prev, { ...created, option_count: 0 }])
      setNewMgForm({ name: '', display_name: '', min_select: 0, max_select: 1, allow_repeat_selection: false })
    } catch { showToast('Failed') } finally { setMgSaving(false) }
  }

  const deleteMg = async (mg: ModifierGroup) => {
    if (!window.confirm(`Delete modifier group "${mg.name}"?`)) return
    try { await api.delete(`/modifier-groups/${mg.id}`); setModifierGroups(prev => prev.filter(g => g.id !== mg.id)); if (expandedMgId === mg.id) setExpandedMgId(null) }
    catch { showToast('Failed') }
  }

  const duplicateMg = async (mg: ModifierGroup) => {
    try {
      const created = await api.post(`/modifier-groups/${mg.id}/duplicate`, {})
      setModifierGroups(prev => [...prev, created])
      showToast(`"${created.name}" created`)
    } catch { showToast('Failed to duplicate') }
  }


  const deleteMgOption = async (groupId: number, optId: number) => {
    try {
      await api.delete(`/modifier-groups/${groupId}/options/${optId}`)
      setExpandedOptions(prev => ({ ...prev, [groupId]: (prev[groupId] || []).filter(o => o.id !== optId) }))
      setModifierGroups(prev => prev.map(g => g.id === groupId ? { ...g, option_count: Math.max(0, (g.option_count || 1) - 1) } : g))
    } catch { showToast('Failed') }
  }

  const mgPanelWidthRef = useRef(mgPanelWidth)
  useEffect(() => { mgPanelWidthRef.current = mgPanelWidth }, [mgPanelWidth])

  useEffect(() => {
    if (!mgEditTarget) { setMpGroupForm(null); setMpOptForm(null); return }
    if (mgEditTarget.type === 'group') {
      const g = (mgEditTarget as { type: 'group'; group: ModifierGroup }).group
      setMpGroupForm({ name: g.name, display_name: g.display_name ?? '', min_select: g.min_select, max_select: g.max_select, allow_repeat_selection: g.allow_repeat_selection ?? false, default_auto_show: g.default_auto_show ?? true })
      setMpOptForm(null)
    } else {
      const { opt } = mgEditTarget as { type: 'option'; groupId: number; opt: ModifierOption | null }
      setMpGroupForm(null)
      if (opt) {
        setMpOptForm({ name: opt.name, display_name: opt.display_name ?? '', item_type: opt.item_type, recipe_id: opt.recipe_id, ingredient_id: opt.ingredient_id, manual_cost: opt.manual_cost, qty: opt.qty ?? 1, sort_order: opt.sort_order, image_url: opt.image_url ?? null })
        setMpOptRecipeSearch(opt.recipe_name ?? '')
        setMpOptIngSearch(opt.ingredient_name ?? '')
      } else {
        setMpOptForm({ name: '', display_name: '', item_type: 'manual', recipe_id: null, ingredient_id: null, manual_cost: null, qty: 1, sort_order: 0, image_url: null })
        setMpOptRecipeSearch('')
        setMpOptIngSearch('')
      }
      setMpOptRecipeOpen(false); setMpOptIngOpen(false)
    }
  }, [mgEditTarget])

  const startMgPanelResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    const startX = e.clientX
    const startW = mgPanelWidthRef.current
    function onMove(ev: MouseEvent) {
      const dx = startX - ev.clientX
      const newW = Math.max(280, Math.min(600, startW + dx))
      mgPanelWidthRef.current = newW
      setMgPanelWidth(newW)
    }
    function onUp() {
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [])

  const saveMgPanelItem = async () => {
    if (!mgEditTarget) return
    setMgPanelSaving(true)
    try {
      if (mgEditTarget.type === 'group' && mpGroupForm) {
        const g = (mgEditTarget as { type: 'group'; group: ModifierGroup }).group
        await api.put(`/modifier-groups/${g.id}`, { ...g, ...mpGroupForm, display_name: mpGroupForm.display_name || null })
        const merged = { ...mpGroupForm, display_name: mpGroupForm.display_name || null, default_auto_show: mpGroupForm.default_auto_show ?? undefined }
        setModifierGroups(prev => prev.map(mg => mg.id === g.id ? { ...mg, ...merged } : mg))
        setMgEditTarget({ type: 'group', group: { ...g, ...merged } })
        showToast('Group saved')
      } else if (mgEditTarget.type === 'option' && mpOptForm) {
        const { groupId, opt } = mgEditTarget as { type: 'option'; groupId: number; opt: ModifierOption | null }
        const payload = { ...mpOptForm, display_name: mpOptForm.display_name || null, price_addon: 0 }
        if (opt && opt.id) {
          await api.put(`/modifier-groups/${groupId}/options/${opt.id}`, payload)
        } else {
          await api.post(`/modifier-groups/${groupId}/options`, payload)
          setModifierGroups(prev => prev.map(g => g.id === groupId ? { ...g, option_count: (g.option_count || 0) + 1 } : g))
        }
        const opts = await api.get(`/modifier-groups/${groupId}/options`).catch(() => null)
        if (opts) setExpandedOptions(prev => ({ ...prev, [groupId]: opts }))
        setMgEditTarget(null)
        showToast(opt?.id ? 'Option saved' : 'Option added')
      }
    } catch { showToast('Failed to save') }
    finally { setMgPanelSaving(false) }
  }

  const reorderMgOption = async (groupId: number, optIdx: number, direction: 'up' | 'down') => {
    const opts = [...(expandedOptions[groupId] || [])]
    const targetIdx = direction === 'up' ? optIdx - 1 : optIdx + 1
    if (targetIdx < 0 || targetIdx >= opts.length) return
    ;[opts[optIdx], opts[targetIdx]] = [opts[targetIdx], opts[optIdx]]
    const updated = opts.map((o, i) => ({ ...o, sort_order: i }))
    setExpandedOptions(prev => ({ ...prev, [groupId]: updated }))
    try {
      await Promise.all([
        api.put(`/modifier-groups/${groupId}/options/${updated[optIdx].id}`, { ...updated[optIdx], price_addon: updated[optIdx].price_addon || 0 }),
        api.put(`/modifier-groups/${groupId}/options/${updated[targetIdx].id}`, { ...updated[targetIdx], price_addon: updated[targetIdx].price_addon || 0 }),
      ])
    } catch {
      showToast('Failed to reorder')
      const orig = await api.get(`/modifier-groups/${groupId}/options`).catch(() => null)
      if (orig) setExpandedOptions(prev => ({ ...prev, [groupId]: orig }))
    }
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
          {activeTab === 'items' && (
            <button className="btn btn-primary" onClick={() => { setNewComboMode(false); setSiModal('new') }}>+ New Sales Item</button>
          )}
          {activeTab === 'combos' && (
            <button className="btn btn-primary" onClick={() => setComboModal('new')}>+ New Combo</button>
          )}
          {activeTab === 'modifiers' && (
            <button className="btn btn-primary" onClick={() => setShowNewMgModal(true)}>+ New Modifier Group</button>
          )}
        </div>
        <div className="flex gap-1">
          {(['items', 'combos', 'modifiers'] as const).map(t => (
            <button key={t} onClick={() => setActiveTab(t)}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${activeTab === t ? 'border-accent text-accent' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
              {t === 'items' ? 'Sales Items' : t === 'combos' ? 'Combos' : 'Modifiers'}
              {t === 'items' && nonComboItems.length > 0 && <span className="ml-1.5 text-xs bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded-full">{nonComboItems.length}</span>}
              {t === 'combos' && combos.length > 0 && <span className="ml-1.5 text-xs bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded-full">{combos.length}</span>}
              {t === 'modifiers' && modifierGroups.length > 0 && <span className="ml-1.5 text-xs bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded-full">{modifierGroups.length}</span>}
            </button>
          ))}
        </div>
      </div>

      {/* ── ITEMS TAB ─────────────────────────────────────────────────────────── */}
      {activeTab === 'items' && (
        <div className="flex flex-1 min-h-0">
          <div className="flex-1 overflow-auto p-5">
            <div className="flex gap-2 mb-4">
              <input className="input input-sm w-64" placeholder="Search by name or category…" value={itemSearch} onChange={e => setItemSearch(e.target.value)} />
              <select className="input py-1 text-xs" value={typeFilter} onChange={e => setTypeFilter(e.target.value as typeof typeFilter)}>
                <option value="">All Types</option>
                <option value="recipe">Recipe</option>
                <option value="ingredient">Ingredient</option>
                <option value="combo">Combo</option>
                <option value="manual">Manual</option>
              </select>
              {bulkSelected.size > 0 && (
                <button className="text-xs text-text-3 hover:text-text-1 transition-colors ml-1"
                  onClick={() => setBulkSelected(new Set())}>
                  Clear {bulkSelected.size} selected
                </button>
              )}
              <span className="text-sm text-gray-400 self-center ml-auto">{nonComboItems.length} item{nonComboItems.length !== 1 ? 's' : ''}</span>
            </div>

            {nonComboItems.length === 0 ? (
              <div className="py-16 text-center text-sm text-gray-400">No sales items yet. Click "+ New Sales Item" to create one.</div>
            ) : (
              <div className="card overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 bg-gray-50">
                      <th className="px-3 py-2.5 w-8 text-left">
                        <input type="checkbox"
                          checked={nonComboItems.length > 0 && nonComboItems.every(s => bulkSelected.has(s.id))}
                          onChange={e => {
                            if (e.target.checked) setBulkSelected(new Set(nonComboItems.map(s => s.id)))
                            else setBulkSelected(new Set())
                          }} />
                      </th>
                      <th className="px-4 py-2.5 text-left font-semibold text-gray-600 w-[26%]">
                        <button className="flex items-center gap-1 hover:text-accent" onClick={() => toggleSort('name')}>
                          Name {siSortField === 'name' ? (siSortDir === 'asc' ? '▲' : '▼') : <span className="text-gray-300">⇅</span>}
                        </button>
                      </th>
                      <th className="px-4 py-2.5 text-left font-semibold text-gray-600 w-[11%]">
                        <button className="flex items-center gap-1 hover:text-accent" onClick={() => toggleSort('item_type')}>
                          Type {siSortField === 'item_type' ? (siSortDir === 'asc' ? '▲' : '▼') : <span className="text-gray-300">⇅</span>}
                        </button>
                      </th>
                      <th className="px-4 py-2.5 text-left font-semibold text-gray-600 w-[17%]">
                        <button className="flex items-center gap-1 hover:text-accent" onClick={() => toggleSort('category_name')}>
                          Category {siSortField === 'category_name' ? (siSortDir === 'asc' ? '▲' : '▼') : <span className="text-gray-300">⇅</span>}
                        </button>
                      </th>
                      <th className="px-4 py-2.5 text-left font-semibold text-gray-600 w-[23%]">Linked To</th>
                      <th className="px-4 py-2.5 text-left font-semibold text-gray-600 w-[9%]">Markets</th>
                      <th className="px-4 py-2.5 w-[7%]" />
                    </tr>
                  </thead>
                  <tbody>
                    {nonComboItems.map(si => {
                      const mkt = marketsDisplay(si)
                      const isBulkChecked = bulkSelected.has(si.id)
                      return (
                        <tr key={si.id}
                          className={`border-b border-gray-100 group cursor-pointer transition-colors ${isBulkChecked ? 'bg-blue-50' : selectedSiId === si.id ? 'bg-accent-dim' : 'hover:bg-gray-50'}`}
                          onClick={() => setSelectedSiId(si.id)}>
                          <td className="px-3 py-2.5" onClick={e => e.stopPropagation()}>
                            <input type="checkbox" checked={isBulkChecked}
                              onChange={e => setBulkSelected(prev => {
                                const next = new Set(prev)
                                e.target.checked ? next.add(si.id) : next.delete(si.id)
                                return next
                              })} />
                          </td>
                          <td className={`px-4 py-2.5 font-medium ${isBulkChecked ? 'text-blue-700' : selectedSiId === si.id ? 'text-accent border-l-2 border-accent' : 'text-gray-900'}`}>{si.name}</td>
                          <td className="px-4 py-2.5"><span className={`text-xs px-2 py-0.5 rounded font-medium ${TYPE_BADGE[si.item_type]}`}>{TYPE_LABEL[si.item_type]}</span></td>
                          <td className="px-4 py-2.5 text-gray-500">{si.category_name || <span className="text-gray-300">—</span>}</td>
                          <td className="px-4 py-2.5 text-gray-500 text-xs">
                            {si.item_type === 'recipe'     && (si.recipe_name     || <span className="text-gray-300">—</span>)}
                            {si.item_type === 'ingredient' && (si.ingredient_name || <span className="text-gray-300">—</span>)}
                            {si.item_type === 'combo'      && (si.combo_name      || <span className="text-gray-300">—</span>)}
                            {si.item_type === 'manual'     && (si.manual_cost != null ? `$${Number(si.manual_cost).toFixed(4)}` : <span className="text-gray-300">—</span>)}
                          </td>
                          <td className="px-4 py-2.5"><span className={`text-xs px-2 py-0.5 rounded font-medium ${mkt.color}`}>{mkt.label}</span></td>
                          <td className="px-4 py-2.5" onClick={e => e.stopPropagation()}>
                            <button
                              className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded text-red-300 hover:text-red-600 hover:bg-red-50"
                              title="Delete"
                              onClick={() => setDeleting(si)}>
                              <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/>
                              </svg>
                            </button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>{/* end left scroll area */}

          {/* ── BULK ACTION PANEL ── */}
          {bulkSelected.size > 0 && (() => {
            const bulkIds = [...bulkSelected]
            const applyBulkCategory = async () => {
              setBulkApplying(true)
              try {
                await api.post('/sales-items/bulk/category', { item_ids: bulkIds, category_id: Number(bulkCategoryId) || null })
                const catName = siCategories.find(c => String(c.id) === bulkCategoryId)?.name ?? null
                setSalesItems(prev => prev.map(s => bulkSelected.has(s.id) ? { ...s, category_id: Number(bulkCategoryId) || null, category_name: catName } : s))
                showToast(`Category updated for ${bulkIds.length} item${bulkIds.length !== 1 ? 's' : ''}`)
              } catch { showToast('Failed to update category') } finally { setBulkApplying(false) }
            }
            const applyBulkMarkets = async () => {
              setBulkApplying(true)
              try {
                await api.post('/sales-items/bulk/markets', { item_ids: bulkIds, country_ids: bulkMarkets })
                setSalesItems(prev => prev.map(s => {
                  if (!bulkSelected.has(s.id)) return s
                  const newMarkets = countries.map(c => ({ country_id: c.id, country_name: c.name, is_active: bulkMarkets.includes(c.id) }))
                  return { ...s, markets: newMarkets }
                }))
                showToast(`Markets updated for ${bulkIds.length} item${bulkIds.length !== 1 ? 's' : ''}`)
              } catch { showToast('Failed to update markets') } finally { setBulkApplying(false) }
            }
            const applyBulkModifier = async () => {
              if (!bulkMgId) return
              setBulkApplying(true)
              try {
                const result: any = await api.post('/sales-items/bulk/add-modifier', { item_ids: bulkIds, modifier_group_id: bulkMgId })
                showToast(`Modifier added to ${result.added ?? bulkIds.length} item${bulkIds.length !== 1 ? 's' : ''}`)
                setBulkMgId('')
                // Invalidate cached modifier data for affected items
                setSiMgData(prev => {
                  const next = { ...prev }
                  bulkIds.forEach(id => { delete next[id] })
                  return next
                })
              } catch { showToast('Failed to add modifier') } finally { setBulkApplying(false) }
            }
            return (
              <div className="w-80 flex-shrink-0 border-l border-border bg-white flex flex-col">
                {/* Bulk panel header */}
                <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-blue-50">
                  <div>
                    <span className="font-semibold text-blue-800 text-sm">{bulkSelected.size} item{bulkSelected.size !== 1 ? 's' : ''} selected</span>
                    <p className="text-xs text-blue-600 mt-0.5">Apply changes to all selected items</p>
                  </div>
                  <button className="text-blue-400 hover:text-blue-700 flex-shrink-0 ml-2" onClick={() => setBulkSelected(new Set())} title="Clear selection">✕</button>
                </div>
                <div className="flex-1 overflow-y-auto p-4 space-y-5">

                  {/* Set Category */}
                  <div>
                    <p className="text-xs font-semibold text-text-3 uppercase tracking-wide mb-2">Set Category</p>
                    <select className="input w-full text-sm mb-2" value={bulkCategoryId}
                      onChange={e => setBulkCategoryId(e.target.value)}>
                      <option value="">— No category —</option>
                      {siCategories.map(c => <option key={c.id} value={String(c.id)}>{c.name}</option>)}
                    </select>
                    <button className="btn btn-primary btn-sm w-full" disabled={bulkApplying}
                      onClick={applyBulkCategory}>
                      {bulkApplying ? 'Applying…' : 'Apply Category'}
                    </button>
                  </div>

                  <hr className="border-border" />

                  {/* Set Markets */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-xs font-semibold text-text-3 uppercase tracking-wide">Set Market Visibility</p>
                      <div className="flex gap-2">
                        <button className="text-xs text-accent hover:underline" onClick={() => setBulkMarkets(countries.map(c => c.id))}>All</button>
                        <span className="text-text-3 text-xs">·</span>
                        <button className="text-xs text-accent hover:underline" onClick={() => setBulkMarkets([])}>None</button>
                      </div>
                    </div>
                    <div className="space-y-1.5 mb-2">
                      {countries.map(c => (
                        <label key={c.id} className="flex items-center gap-2 text-sm cursor-pointer select-none">
                          <input type="checkbox" checked={bulkMarkets.includes(c.id)}
                            onChange={e => setBulkMarkets(prev => e.target.checked ? [...prev, c.id] : prev.filter(id => id !== c.id))} />
                          <span className="text-text-2">{c.name}</span>
                        </label>
                      ))}
                    </div>
                    <button className="btn btn-primary btn-sm w-full" disabled={bulkApplying}
                      onClick={applyBulkMarkets}>
                      {bulkApplying ? 'Applying…' : 'Apply Markets'}
                    </button>
                  </div>

                  <hr className="border-border" />

                  {/* Add Modifier Group */}
                  <div>
                    <p className="text-xs font-semibold text-text-3 uppercase tracking-wide mb-2">Add Modifier Group</p>
                    <select className="input w-full text-sm mb-2" value={String(bulkMgId)}
                      onChange={e => setBulkMgId(e.target.value ? Number(e.target.value) : '')}>
                      <option value="">Select a modifier group…</option>
                      {modifierGroups.map(mg => <option key={mg.id} value={String(mg.id)}>{mg.name}</option>)}
                    </select>
                    <button className="btn btn-primary btn-sm w-full" disabled={bulkApplying || !bulkMgId}
                      onClick={applyBulkModifier}>
                      {bulkApplying ? 'Applying…' : 'Add to Selected'}
                    </button>
                  </div>

                </div>
              </div>
            )
          })()}

          {bulkSelected.size === 0 && selectedSiId !== null && (() => {
            const si = salesItems.find(s => s.id === selectedSiId)
            if (!si) return null
            const panelMgGroups    = siMgData[selectedSiId] ?? []
            const panelMgIsLoading = siMgLoading.has(selectedSiId)
            const unassignedMgs = modifierGroups.filter(mg => !panelMgGroups.some(a => a.modifier_group_id === mg.id))
            return (
              <div className="w-80 flex-shrink-0 border-l border-border bg-white flex flex-col">
                {/* Panel header */}
                <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                  <span className="font-semibold text-text-1 text-sm truncate flex-1 min-w-0">{si.name}</span>
                  <button className="ml-2 text-text-3 hover:text-text-1 flex-shrink-0" onClick={() => setSelectedSiId(null)} title="Close">✕</button>
                </div>

                {/* Panel tab bar */}
                <div className="flex border-b border-border bg-white shrink-0">
                  {(['details', 'markets', 'modifiers', 'translations'] as const).map(t => (
                    <button key={t} onClick={() => setPanelTab(t)}
                      className={`flex-1 py-2 text-xs font-medium transition-colors border-b-2 ${panelTab === t ? 'border-accent text-accent' : 'border-transparent text-text-3 hover:text-text-1'}`}>
                      {t === 'details' ? 'Details' : t === 'markets' ? 'Markets' : t === 'modifiers' ? 'Modifiers' : 'Translations'}
                    </button>
                  ))}
                </div>

                {/* Panel body */}
                {panelForm && (
                  <div className="flex-1 overflow-y-auto">

                  {/* ── DETAILS TAB ── */}
                  {panelTab === 'details' && (
                  <div className="p-4 space-y-3">

                    {/* Name */}
                    <div>
                      <label className="text-xs font-semibold text-text-3 uppercase tracking-wide block mb-1">Name *</label>
                      <input className="input w-full text-sm" value={panelForm.name}
                        onChange={e => setPanelForm(f => f ? { ...f, name: e.target.value } : f)} />
                    </div>

                    {/* Display Name */}
                    <div>
                      <label className="text-xs font-semibold text-text-3 uppercase tracking-wide block mb-1">Display Name <span className="font-normal normal-case text-text-3">(customer-facing)</span></label>
                      <input className="input w-full text-sm" placeholder="Leave blank to use name"
                        value={panelForm.display_name ?? ''}
                        onChange={e => setPanelForm(f => f ? { ...f, display_name: e.target.value || null } : f)} />
                    </div>

                    {/* Item Type */}
                    <div>
                      <label className="text-xs font-semibold text-text-3 uppercase tracking-wide block mb-1">Type</label>
                      <div className="flex gap-1 flex-wrap">
                        {(['recipe', 'ingredient', 'manual', 'combo'] as const).map(t => (
                          <button key={t}
                            className={`text-xs px-2.5 py-1 rounded font-medium border transition-colors ${panelForm.item_type === t ? 'bg-accent text-white border-accent' : 'border-border text-text-2 hover:border-accent hover:text-accent'}`}
                            onClick={() => setPanelForm(f => f ? { ...f, item_type: t, recipe_id: null, ingredient_id: null, combo_id: null } : f)}>
                            {t.charAt(0).toUpperCase() + t.slice(1)}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Linked item */}
                    {panelForm.item_type === 'recipe' && (
                      <div className="relative">
                        <label className="text-xs font-semibold text-text-3 uppercase tracking-wide block mb-1">Recipe</label>
                        <input className="input w-full text-sm" placeholder="Search recipes…" value={panelRecipeSearch}
                          onChange={e => { setPanelRecipeSearch(e.target.value); setPanelRecipeOpen(true) }}
                          onFocus={() => setPanelRecipeOpen(true)}
                          onBlur={() => setTimeout(() => setPanelRecipeOpen(false), 150)} autoComplete="off" />
                        {panelRecipeOpen && (
                          <div className="absolute top-full left-0 right-0 z-50 bg-white border border-gray-200 rounded-lg shadow-lg mt-0.5 max-h-44 overflow-y-auto">
                            {recipes.filter(r => r.name.toLowerCase().includes(panelRecipeSearch.toLowerCase())).slice(0, 40).map(r => (
                              <button key={r.id} type="button" onMouseDown={e => e.preventDefault()}
                                className={`w-full text-left px-3 py-1.5 text-sm hover:bg-accent-dim flex items-center gap-2 ${panelForm.recipe_id === r.id ? 'bg-accent-dim font-medium text-accent' : 'text-gray-800'}`}
                                onClick={() => { setPanelForm(f => f ? { ...f, recipe_id: r.id } : f); setPanelRecipeSearch(r.name); setPanelRecipeOpen(false) }}>
                                {panelForm.recipe_id === r.id && <span className="text-accent text-xs">✓</span>}
                                <span>{r.name}</span>
                                {r.category_name && <span className="ml-auto text-xs text-gray-400 shrink-0">{r.category_name}</span>}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                    {panelForm.item_type === 'ingredient' && (
                      <div className="relative">
                        <label className="text-xs font-semibold text-text-3 uppercase tracking-wide block mb-1">Ingredient</label>
                        <input className="input w-full text-sm" placeholder="Search ingredients…" value={panelIngSearch}
                          onChange={e => { setPanelIngSearch(e.target.value); setPanelIngOpen(true) }}
                          onFocus={() => setPanelIngOpen(true)}
                          onBlur={() => setTimeout(() => setPanelIngOpen(false), 150)} autoComplete="off" />
                        {panelIngOpen && (
                          <div className="absolute top-full left-0 right-0 z-50 bg-white border border-gray-200 rounded-lg shadow-lg mt-0.5 max-h-44 overflow-y-auto">
                            {ingredients.filter(i => i.name.toLowerCase().includes(panelIngSearch.toLowerCase())).slice(0, 40).map(i => (
                              <button key={i.id} type="button" onMouseDown={e => e.preventDefault()}
                                className={`w-full text-left px-3 py-1.5 text-sm hover:bg-accent-dim flex items-center gap-2 ${panelForm.ingredient_id === i.id ? 'bg-accent-dim font-medium text-accent' : 'text-gray-800'}`}
                                onClick={() => { setPanelForm(f => f ? { ...f, ingredient_id: i.id } : f); setPanelIngSearch(i.name); setPanelIngOpen(false) }}>
                                {panelForm.ingredient_id === i.id && <span className="text-accent text-xs">✓</span>}
                                <span>{i.name}</span>
                                {i.base_unit_abbr && <span className="ml-auto text-xs text-gray-400 shrink-0">{i.base_unit_abbr}</span>}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                    {panelForm.item_type === 'combo' && (
                      <div className="relative">
                        <label className="text-xs font-semibold text-text-3 uppercase tracking-wide block mb-1">Combo</label>
                        <input className="input w-full text-sm" placeholder="Search combos…" value={panelComboSearch}
                          onChange={e => { setPanelComboSearch(e.target.value); setPanelComboOpen(true) }}
                          onFocus={() => setPanelComboOpen(true)}
                          onBlur={() => setTimeout(() => setPanelComboOpen(false), 150)} autoComplete="off" />
                        {panelComboOpen && (
                          <div className="absolute top-full left-0 right-0 z-50 bg-white border border-gray-200 rounded-lg shadow-lg mt-0.5 max-h-44 overflow-y-auto">
                            {combos.filter(c => c.name.toLowerCase().includes(panelComboSearch.toLowerCase())).slice(0, 40).map(c => (
                              <button key={c.id} type="button" onMouseDown={e => e.preventDefault()}
                                className={`w-full text-left px-3 py-1.5 text-sm hover:bg-accent-dim flex items-center gap-2 ${panelForm.combo_id === c.id ? 'bg-accent-dim font-medium text-accent' : 'text-gray-800'}`}
                                onClick={() => { setPanelForm(f => f ? { ...f, combo_id: c.id } : f); setPanelComboSearch(c.name); setPanelComboOpen(false) }}>
                                {panelForm.combo_id === c.id && <span className="text-accent text-xs">✓</span>}
                                <span>{c.name}</span>
                                {c.step_count !== undefined && <span className="ml-auto text-xs text-gray-400 shrink-0">{c.step_count} step{c.step_count !== 1 ? 's' : ''}</span>}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                    {panelForm.item_type === 'manual' && (
                      <div>
                        <label className="text-xs font-semibold text-text-3 uppercase tracking-wide block mb-1">Cost (USD per portion)</label>
                        <input type="number" step="0.0001" min="0" className="input w-full text-sm font-mono"
                          value={panelForm.manual_cost ?? ''}
                          onChange={e => setPanelForm(f => f ? { ...f, manual_cost: parseFloat(e.target.value) || null } : f)} />
                      </div>
                    )}

                    {/* Qty + unit */}
                    {panelForm.item_type !== 'manual' && (() => {
                      const unitLabel =
                        panelForm.item_type === 'recipe'
                          ? (si.recipe_yield_unit_abbr ?? null)
                          : panelForm.item_type === 'ingredient'
                          ? (si.ingredient_base_unit_abbr ?? null)
                          : panelForm.item_type === 'combo'
                          ? 'each'
                          : null
                      return (
                        <div>
                          <label className="text-xs font-semibold text-text-3 uppercase tracking-wide block mb-1">Quantity</label>
                          <div className="flex items-center gap-2">
                            <input type="number" step="0.01" min="0.01" className="input text-sm font-mono w-28"
                              value={panelForm.qty}
                              onChange={e => setPanelForm(f => f ? { ...f, qty: parseFloat(e.target.value) || 1 } : f)} />
                            {unitLabel && <span className="text-xs text-text-3 font-medium">{unitLabel}</span>}
                          </div>
                        </div>
                      )
                    })()}

                    {/* Category */}
                    <div>
                      <label className="text-xs font-semibold text-text-3 uppercase tracking-wide block mb-1">Category</label>
                      <select className="input w-full text-sm" value={panelForm.category_id}
                        onChange={e => setPanelForm(f => f ? { ...f, category_id: e.target.value } : f)}>
                        <option value="">No category…</option>
                        {siCategories.map(c => <option key={c.id} value={String(c.id)}>{c.name}</option>)}
                      </select>
                    </div>

                    {/* Description */}
                    <div>
                      <label className="text-xs font-semibold text-text-3 uppercase tracking-wide block mb-1">Description</label>
                      <textarea className="input w-full text-sm" rows={2} value={panelForm.description}
                        onChange={e => setPanelForm(f => f ? { ...f, description: e.target.value } : f)} />
                    </div>

                    {/* Image */}
                    <ImageUpload label="Image" value={panelForm.image_url} onChange={url => setPanelForm(f => f ? { ...f, image_url: url } : f)} formKey="sales_item" />
                  </div>
                  )}{/* end details tab */}

                  {/* ── MARKETS TAB ── */}
                  {panelTab === 'markets' && (
                  <div className="p-4">
                    <div className="flex items-center gap-2 mb-3">
                      <p className="text-xs font-semibold text-text-3 uppercase tracking-wide flex-1">Market Availability</p>
                      {panelMktSaving && <span className="text-xs text-text-3">saving…</span>}
                      {countries.length > 0 && (
                        <div className="flex gap-2">
                          <button className="text-xs text-accent hover:underline disabled:opacity-40"
                            disabled={panelMktSaving || panelMarkets.length === countries.length}
                            onClick={() => countries.forEach(c => { if (!panelMarkets.includes(c.id)) togglePanelMarket(c.id) })}>
                            All
                          </button>
                          <span className="text-text-3 text-xs">·</span>
                          <button className="text-xs text-accent hover:underline disabled:opacity-40"
                            disabled={panelMktSaving || panelMarkets.length === 0}
                            onClick={() => countries.forEach(c => { if (panelMarkets.includes(c.id)) togglePanelMarket(c.id) })}>
                            None
                          </button>
                        </div>
                      )}
                    </div>
                    {countries.length === 0 && <p className="text-xs text-text-3 italic">No markets configured</p>}
                    <div className="space-y-2">
                      {countries.map(country => (
                        <label key={country.id} className="flex items-center gap-2 text-sm cursor-pointer select-none">
                          <input type="checkbox"
                            checked={panelMarkets.includes(country.id)}
                            onChange={() => togglePanelMarket(country.id)}
                            disabled={panelMktSaving} />
                          <span className="text-text-2">{country.name}</span>
                          {panelMarkets.includes(country.id) && <span className="ml-auto text-xs text-green-600 font-medium">Active</span>}
                        </label>
                      ))}
                    </div>
                    <p className="text-xs text-text-3 mt-4 italic">Changes are saved automatically.</p>
                  </div>
                  )}{/* end markets tab */}

                  {/* ── MODIFIERS TAB ── */}
                  {panelTab === 'modifiers' && (
                  <div className="p-4">
                    {!siMgData[selectedSiId] && !panelMgIsLoading && (
                      <button className="text-xs text-accent hover:underline" onClick={() => toggleSiMg(selectedSiId)}>Load modifier groups</button>
                    )}
                    {panelMgIsLoading && <span className="text-xs text-text-3">Loading…</span>}
                    {siMgData[selectedSiId] && (
                      <>
                        {panelMgGroups.length === 0 && (
                          <p className="text-xs text-text-3 italic mb-3">No modifier groups assigned.</p>
                        )}
                        <div className="space-y-1.5 mb-3">
                          {panelMgGroups.map(mg => (
                            <div key={mg.modifier_group_id}
                              className="flex items-center justify-between gap-2 px-2.5 py-1.5 bg-blue-50 border border-blue-100 rounded text-xs">
                              <span className="font-medium text-blue-800 flex-1 min-w-0 truncate">{mg.name}</span>
                              <div className="flex items-center gap-1 shrink-0">
                                {(mg.min_select === 0 || mg.min_select === undefined) && (
                                  <button
                                    onClick={e => { e.stopPropagation(); toggleAutoShow(selectedSiId, mg.modifier_group_id, !mg.auto_show) }}
                                    title={mg.auto_show !== false ? 'Shown automatically in POS' : 'Hidden in POS (optional — tap to add)'}
                                    className={`p-1 rounded transition-colors ${mg.auto_show !== false ? 'text-accent hover:text-accent-mid' : 'text-gray-300 hover:text-gray-500'}`}>
                                    {mg.auto_show !== false ? (
                                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                                    ) : (
                                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                                    )}
                                  </button>
                                )}
                                <button className="text-blue-300 hover:text-red-500 transition-colors" title={`Remove ${mg.name}`}
                                  onClick={() => removeSiModifier(selectedSiId, mg.modifier_group_id)}>
                                  <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/>
                                  </svg>
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                        {unassignedMgs.length > 0 && (
                          <div className="relative inline-block">
                            <button
                              className="text-xs px-2 py-0.5 rounded-full border border-dashed border-accent text-accent hover:bg-accent-dim transition-colors"
                              onClick={e => {
                                const rect = (e.currentTarget as HTMLButtonElement).getBoundingClientRect()
                                setSiMgAddPos({ top: rect.bottom + 4, left: rect.left })
                                setSiMgAddOpen(siMgAddOpen === selectedSiId ? null : selectedSiId)
                              }}
                            >+ Add Modifier Group</button>
                            {siMgAddOpen === selectedSiId && siMgAddPos && createPortal(
                              <>
                                <div className="fixed inset-0 z-[99998]" onClick={() => setSiMgAddOpen(null)} />
                                <div className="bg-white border border-border rounded shadow-xl max-h-52 overflow-y-auto min-w-[240px]"
                                  style={{ position: 'fixed', top: siMgAddPos.top, left: siMgAddPos.left, zIndex: 99999 }}>
                                  {unassignedMgs.map(mg => (
                                    <button key={mg.id} className="w-full text-left px-3 py-2 text-xs hover:bg-accent-dim flex items-center justify-between gap-2"
                                      onClick={() => { addSiModifier(selectedSiId, mg); setSiMgAddOpen(null) }}>
                                      <span className="font-medium">{mg.name}</span>
                                      <span className="text-text-3 shrink-0">{mg.option_count ?? 0} opts · {mg.min_select}–{mg.max_select}</span>
                                    </button>
                                  ))}
                                  <button className="w-full text-left px-3 py-2 text-xs text-text-3 border-t border-border hover:bg-gray-50"
                                    onClick={() => setSiMgAddOpen(null)}>Cancel</button>
                                </div>
                              </>,
                              document.body
                            )}
                          </div>
                        )}
                        <p className="text-xs text-text-3 mt-4 italic">Changes are saved automatically.</p>
                      </>
                    )}
                  </div>
                  )}{/* end modifiers tab */}

                  {/* ── TRANSLATIONS TAB ── */}
                  {panelTab === 'translations' && (
                    <div className="p-4">
                      <TranslationEditor
                        entityType="sales_item"
                        entityId={selectedSiId}
                        fields={['name', 'display_name', 'description']}
                      />
                    </div>
                  )}

                  </div>
                )}

                {/* Panel footer */}
                <div className="px-4 py-3 border-t border-border flex gap-2 items-center">
                  {panelTab === 'details' && (
                    <button className="btn btn-sm btn-primary flex-1"
                      disabled={panelSaving || !panelForm?.name.trim()}
                      onClick={savePanelItem}>
                      {panelSaving ? 'Saving…' : 'Save'}
                    </button>
                  )}
                  {panelTab !== 'details' && (
                    <span className="flex-1 text-xs text-text-3 italic">Changes saved automatically</span>
                  )}
                  <button
                    className="p-2 rounded text-red-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                    title="Delete this sales item"
                    onClick={() => { setDeleting(si as SalesItem); setSelectedSiId(null) }}>
                    <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/>
                    </svg>
                  </button>
                </div>
              </div>
            )
          })()}
        </div>
      )}

      {/* ── COMBOS TAB ──────────────────────────────────────────────────────── */}
      {activeTab === 'combos' && (
        <div className="flex flex-1 min-h-0">
          <aside className="w-64 flex-shrink-0 border-r border-gray-200 flex flex-col bg-white">
            <div className="flex-1 overflow-y-auto">
              {combos.length === 0 && <div className="py-8 text-center text-sm text-gray-400">No combos yet. Click "+ New Combo" to create one.</div>}
              {combos.map(combo => (
                <button key={combo.id} onClick={() => setSelectedComboId(combo.id)}
                  className={`w-full text-left px-3 py-2.5 border-b border-gray-100 hover:bg-gray-50 transition-colors ${selectedComboId === combo.id ? 'bg-accent-dim' : ''}`}>
                  <div className="font-medium text-sm text-gray-900">{combo.name}</div>
                  <div className="text-xs text-gray-400 mt-0.5">
                    {combo.step_count ?? 0} step{combo.step_count !== 1 ? 's' : ''}
                    {combo.category_name && ` · ${combo.category_name}`}
                  </div>
                </button>
              ))}
            </div>
          </aside>

          <div className="flex flex-1 min-h-0">
          {/* ── Main scroll area ─────────────────────────────────────────────── */}
          <div className="flex-1 overflow-y-auto bg-gray-50 p-5">
            {!selectedComboId && <div className="flex items-center justify-center h-full text-sm text-gray-400">Select a combo to configure its steps.</div>}
            {selectedComboId && comboDetailLoading && <div className="flex items-center justify-center h-full"><Spinner /></div>}
            {selectedComboId && !comboDetailLoading && comboDetail && (
              <div className="max-w-2xl">
                <div className="flex items-center justify-between mb-5">
                  <div>
                    <h2 className="text-lg font-bold text-gray-900">{comboDetail.name}</h2>
                    {comboDetail.category_name && <p className="text-sm text-gray-500">{comboDetail.category_name}</p>}
                    {comboDetail.description && <p className="text-sm text-gray-400 mt-0.5">{comboDetail.description}</p>}
                  </div>
                  <div className="flex gap-2">
                    <button className="btn btn-sm btn-outline" onClick={() => setComboEditTarget({ type: 'combo', combo: comboDetail })}>Edit</button>
                    <button className="btn btn-sm btn-outline text-xs" disabled={duplicatingCombo} onClick={duplicateCombo}
                      title="Duplicate this combo with all its steps and options">
                      {duplicatingCombo ? '…' : 'Duplicate'}
                    </button>
                    <button className="btn btn-sm btn-danger text-xs" onClick={() => setDeletingCombo(comboDetail)}>Delete</button>
                  </div>
                </div>

                {/* Combo Steps */}
                <section className="card p-4">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-semibold text-gray-700">Combo Steps</h3>
                    <button className="btn btn-sm btn-primary text-xs" onClick={addComboStep}>+ Add Step</button>
                  </div>
                  {(comboDetail.steps || []).length === 0 && <p className="text-sm text-gray-400">No steps yet.</p>}
                  <div className="space-y-2">
                    {(comboDetail.steps || []).map((step, stepIdx) => (
                      <div key={step.id} className={`border rounded transition-colors ${comboEditTarget?.type === 'step' && (comboEditTarget as { type: 'step'; step: ComboStep }).step.id === step.id ? 'border-accent' : 'border-gray-200'}`}>
                        {/* Step header row — click to expand + open step in side panel */}
                        <div className="flex items-center justify-between px-3 py-2 cursor-pointer bg-gray-50 hover:bg-gray-100 rounded-t"
                          onClick={() => {
                            if (expandedStep === step.id) {
                              setExpandedStep(null)
                              if (comboEditTarget?.type === 'step' && (comboEditTarget as { type: 'step'; step: ComboStep }).step.id === step.id) {
                                setComboEditTarget(null)
                              }
                            } else {
                              setExpandedStep(step.id)
                              setComboEditTarget({ type: 'step', step })
                            }
                          }}>
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-xs text-gray-400">{expandedStep === step.id ? '▼' : '▶'}</span>
                            <span className="text-sm font-medium text-gray-800">{step.name}</span>
                            {step.display_name && <span className="text-xs text-gray-400 italic">"{step.display_name}"</span>}
                            <span className="text-xs text-gray-400">({(step.options || []).length} option{(step.options || []).length !== 1 ? 's' : ''})</span>
                            <span className="text-xs bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded" title="Min choices">min {step.min_select ?? 1}</span>
                            <span className="text-xs bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded" title="Max choices">max {step.max_select ?? 1}</span>
                            {step.allow_repeat && <span className="text-xs bg-amber-50 text-amber-600 px-1.5 py-0.5 rounded" title="Same option can be chosen multiple times">repeat ✓</span>}
                            {step.auto_select && <span className="text-xs bg-green-50 text-green-600 px-1.5 py-0.5 rounded" title="Option is auto-selected">auto ✓</span>}
                            <button className="text-xs text-accent hover:text-accent-dark px-1.5 py-0.5 rounded hover:bg-accent-dim transition-colors"
                              onClick={e => { e.stopPropagation(); setExpandedStep(step.id); setComboEditTarget({ type: 'option', stepId: step.id, opt: { id: 0, combo_step_id: step.id, name: '', display_name: null, item_type: 'manual', recipe_id: null, ingredient_id: null, sales_item_id: null, manual_cost: null, price_addon: 0, qty: 1, sort_order: (step.options || []).length } }) }}>
                              + Add Option
                            </button>
                          </div>
                          {/* Step action icons — sort ↑↓, duplicate, trash */}
                          <div className="flex items-center gap-0.5" onClick={e => e.stopPropagation()}>
                            <button className="p-1 rounded text-gray-400 hover:text-gray-600 hover:bg-gray-200 transition-colors disabled:opacity-30" title="Move up"
                              disabled={stepIdx === 0} onClick={() => reorderComboStep(stepIdx, 'up')}>
                              <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 15l-6-6-6 6"/></svg>
                            </button>
                            <button className="p-1 rounded text-gray-400 hover:text-gray-600 hover:bg-gray-200 transition-colors disabled:opacity-30" title="Move down"
                              disabled={stepIdx === (comboDetail.steps || []).length - 1} onClick={() => reorderComboStep(stepIdx, 'down')}>
                              <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6"/></svg>
                            </button>
                            <button className="p-1 rounded text-gray-400 hover:text-gray-600 hover:bg-gray-200 transition-colors ml-0.5" title="Duplicate step"
                              onClick={() => duplicateComboStep(step.id)}>
                              <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>
                              </svg>
                            </button>
                            <button className="p-1 rounded text-red-400 hover:text-red-600 hover:bg-red-50 transition-colors" title="Delete step"
                              onClick={() => deleteComboStep(step.id)}>
                              <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/>
                              </svg>
                            </button>
                          </div>
                        </div>

                        {/* Options list */}
                        {expandedStep === step.id && (
                          <div className="p-2 space-y-1">
                            {(step.options || []).length === 0 && <p className="text-xs text-gray-400 px-1">No options yet — click "+ Add Option" above.</p>}
                            {(step.options || []).map(opt => (
                              <div key={opt.id} className={`group flex items-center gap-2 px-2 py-1.5 text-sm rounded cursor-pointer transition-colors ${comboEditTarget?.type === 'option' && (comboEditTarget as { type: 'option'; stepId: number; opt: ComboStepOption }).opt.id === opt.id ? 'bg-accent-dim/40' : 'hover:bg-gray-50'}`}
                                onClick={() => setComboEditTarget({ type: 'option', stepId: step.id, opt })}>
                                <span className="font-medium text-gray-800 truncate">{opt.display_name || opt.name}</span>
                                {opt.display_name && <span className="text-xs text-gray-400 italic shrink-0">({opt.name})</span>}
                                <span className={`text-xs px-1.5 py-0.5 rounded shrink-0 ${TYPE_BADGE[opt.item_type]}`}>{TYPE_LABEL[opt.item_type]}</span>
                                {opt.recipe_name && (
                                  <span className="text-xs text-gray-400 shrink-0">
                                    → {opt.recipe_name} · <span className="text-gray-500 font-medium">{Number(opt.qty ?? 1)}</span> ptn
                                  </span>
                                )}
                                {opt.ingredient_name && (
                                  <span className="text-xs text-gray-400 shrink-0">
                                    → {opt.ingredient_name} · <span className="text-gray-500 font-medium">{Number(opt.qty ?? 1)}</span>{opt.ingredient_unit_abbr ? ` ${opt.ingredient_unit_abbr}` : ''}
                                  </span>
                                )}
                                {opt.sales_item_name && (
                                  <span className="text-xs text-gray-400 shrink-0 flex items-center gap-1">
                                    → {opt.sales_item_name}
                                    {opt.sales_item_type && <span className={`text-xs px-1 py-0.5 rounded ${TYPE_BADGE[opt.sales_item_type] || ''}`}>{TYPE_LABEL[opt.sales_item_type] || opt.sales_item_type}</span>}
                                  </span>
                                )}
                                {opt.item_type === 'manual' && opt.manual_cost != null && <span className="text-xs text-gray-400 shrink-0">${Number(opt.manual_cost).toFixed(4)}</span>}
                                {(opt.modifier_groups || []).length > 0 && (
                                  <div className="flex flex-wrap gap-1 ml-1">
                                    {(opt.modifier_groups || []).map(mg => (
                                      <span key={mg.modifier_group_id} className="text-xs bg-purple-50 text-purple-600 border border-purple-200 px-1.5 py-0.5 rounded">{mg.name}</span>
                                    ))}
                                  </div>
                                )}
                                <div className="flex gap-1 shrink-0 ml-auto" onClick={e => e.stopPropagation()}>
                                  <button className="p-1 rounded text-red-400 hover:text-red-600 hover:bg-red-50 transition-colors opacity-0 group-hover:opacity-100"
                                    title="Delete option" onClick={() => deleteOption(step.id, opt.id)}>
                                    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                      <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/>
                                    </svg>
                                  </button>
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

          {/* ── Drag handle ───────────────────────────────────────────────────── */}
          {comboEditTarget && (
            <div onMouseDown={startComboPanelResize}
              className="w-1 hover:w-1.5 bg-border hover:bg-accent cursor-col-resize flex-shrink-0 transition-all" />
          )}

          {/* ── Right edit panel ──────────────────────────────────────────────── */}
          {comboEditTarget && (
            <div className="flex-shrink-0 border-l border-border bg-white flex flex-col overflow-hidden" style={{ width: comboPanelWidth }}>
              {/* Panel header */}
              <div className="flex items-center justify-between px-4 py-3 border-b border-border flex-shrink-0">
                <span className="font-semibold text-text-1 text-sm">
                  {comboEditTarget.type === 'combo'  && 'Edit Combo'}
                  {comboEditTarget.type === 'step'   && `Edit Step: ${(comboEditTarget as { type: 'step'; step: ComboStep }).step.name}`}
                  {comboEditTarget.type === 'option' && ((comboEditTarget as { type: 'option'; stepId: number; opt: ComboStepOption }).opt.id === 0 ? 'Add Option' : `Edit Option: ${(comboEditTarget as { type: 'option'; stepId: number; opt: ComboStepOption }).opt.name}`)}
                </span>
                <button className="text-text-3 hover:text-text-1 flex-shrink-0 ml-2" onClick={() => setComboEditTarget(null)} title="Close">✕</button>
              </div>

              {/* Tab bar — only for option editing */}
              {comboEditTarget.type === 'option' && (
                <div className="flex border-b border-border bg-white flex-shrink-0">
                  {(['details', 'modifiers'] as const).map(t => (
                    <button key={t} onClick={() => setComboPanelOptTab(t)}
                      className={`flex-1 py-2 text-xs font-medium transition-colors border-b-2 ${comboPanelOptTab === t ? 'border-accent text-accent' : 'border-transparent text-text-3 hover:text-text-1'}`}>
                      {t === 'details' ? 'Details' : 'Modifiers'}
                    </button>
                  ))}
                </div>
              )}

              {/* Panel body */}
              <div className="flex-1 overflow-y-auto p-4 space-y-3">

                {/* ── COMBO FORM ─────────────────────────────────────────────── */}
                {comboEditTarget.type === 'combo' && cpComboForm && (
                  <>
                    <div>
                      <label className="text-xs font-semibold text-text-3 uppercase tracking-wide block mb-1">Name *</label>
                      <input className="input w-full text-sm" value={cpComboForm.name}
                        onChange={e => setCpComboForm(f => f ? { ...f, name: e.target.value } : f)} />
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-text-3 uppercase tracking-wide block mb-1">Category</label>
                      <select className="input w-full text-sm" value={cpComboForm.category_id}
                        onChange={e => setCpComboForm(f => f ? { ...f, category_id: e.target.value } : f)}>
                        <option value="">No category…</option>
                        {siCategories.map(c => <option key={c.id} value={String(c.id)}>{c.name}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-text-3 uppercase tracking-wide block mb-1">Description</label>
                      <textarea className="input w-full text-sm" rows={3} value={cpComboForm.description}
                        onChange={e => setCpComboForm(f => f ? { ...f, description: e.target.value } : f)} />
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-text-3 uppercase tracking-wide block mb-1">Image URL</label>
                      <input className="input w-full text-sm" placeholder="https://…" value={cpComboForm.image_url ?? ''}
                        onChange={e => setCpComboForm(f => f ? { ...f, image_url: e.target.value || null } : f)} />
                      {cpComboForm.image_url && (
                        <img src={cpComboForm.image_url} alt="" className="mt-2 w-full max-h-32 object-contain rounded border border-border" onError={e => (e.currentTarget.style.display = 'none')} />
                      )}
                    </div>
                  </>
                )}

                {/* ── STEP FORM ──────────────────────────────────────────────── */}
                {comboEditTarget.type === 'step' && cpStepForm && (
                  <>
                    <div>
                      <label className="text-xs font-semibold text-text-3 uppercase tracking-wide block mb-1">Step Name *</label>
                      <input className="input w-full text-sm" value={cpStepForm.name}
                        onChange={e => setCpStepForm(f => f ? { ...f, name: e.target.value } : f)} />
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-text-3 uppercase tracking-wide block mb-1">Display Name <span className="font-normal normal-case">(customer-facing)</span></label>
                      <input className="input w-full text-sm" placeholder="Leave blank to use step name"
                        value={cpStepForm.display_name ?? ''}
                        onChange={e => setCpStepForm(f => f ? { ...f, display_name: e.target.value || null } : f)} />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-xs font-semibold text-text-3 uppercase tracking-wide block mb-1">Min Choices</label>
                        <input type="number" min="0" className="input w-full text-sm" value={cpStepForm.min_select}
                          onChange={e => setCpStepForm(f => f ? { ...f, min_select: Math.max(0, Number(e.target.value)) } : f)} />
                      </div>
                      <div>
                        <label className="text-xs font-semibold text-text-3 uppercase tracking-wide block mb-1">Max Choices</label>
                        <input type="number" min="1" className="input w-full text-sm" value={cpStepForm.max_select}
                          onChange={e => setCpStepForm(f => f ? { ...f, max_select: Math.max(1, Number(e.target.value)) } : f)} />
                      </div>
                    </div>
                    <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
                      <input type="checkbox" checked={cpStepForm.allow_repeat}
                        onChange={e => setCpStepForm(f => f ? { ...f, allow_repeat: e.target.checked } : f)} />
                      <span className="text-text-2">Allow same option multiple times</span>
                    </label>
                    <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
                      <input type="checkbox" checked={cpStepForm.auto_select}
                        onChange={e => setCpStepForm(f => f ? { ...f, auto_select: e.target.checked } : f)} />
                      <span className="text-text-2">Auto-select (single-option step)</span>
                    </label>
                  </>
                )}

                {/* ── OPTION FORM ────────────────────────────────────────────── */}
                {comboEditTarget.type === 'option' && cpOptForm && (() => {
                  const filteredRecs = recipes.filter(r => r.name.toLowerCase().includes(cpOptRecipeSearch.toLowerCase())).slice(0, 50)
                  const filteredIngs = ingredients.filter(i => i.name.toLowerCase().includes(cpOptIngSearch.toLowerCase())).slice(0, 50)
                  const filteredSis  = salesItems.filter(s => s.item_type !== 'combo' && s.name.toLowerCase().includes(cpOptSiSearch.toLowerCase())).slice(0, 50)
                  return (
                    <>{comboPanelOptTab === 'details' && (<>
                      <div>
                        <label className="text-xs font-semibold text-text-3 uppercase tracking-wide block mb-1">Name *</label>
                        <input className="input w-full text-sm" value={cpOptForm.name}
                          onChange={e => setCpOptForm(f => f ? { ...f, name: e.target.value } : f)} />
                      </div>
                      <div>
                        <label className="text-xs font-semibold text-text-3 uppercase tracking-wide block mb-1">Display Name <span className="font-normal normal-case">(customer-facing)</span></label>
                        <input className="input w-full text-sm" placeholder="Leave blank to use name"
                          value={cpOptForm.display_name ?? ''}
                          onChange={e => setCpOptForm(f => f ? { ...f, display_name: e.target.value || null } : f)} />
                      </div>
                      <div>
                        <label className="text-xs font-semibold text-text-3 uppercase tracking-wide block mb-1">Type</label>
                        <select className="input w-full text-sm" value={cpOptForm.item_type}
                          onChange={e => {
                            setCpOptForm(f => f ? { ...f, item_type: e.target.value as ComboStepOption['item_type'], recipe_id: null, ingredient_id: null, sales_item_id: null, manual_cost: null } : f)
                            setCpOptRecipeSearch(''); setCpOptIngSearch(''); setCpOptSiSearch('')
                          }}>
                          <option value="manual">Manual cost</option>
                          <option value="recipe">Recipe</option>
                          <option value="ingredient">Ingredient</option>
                          <option value="sales_item">Sales Item</option>
                        </select>
                      </div>

                      {cpOptForm.item_type === 'recipe' && (
                        <div className="relative">
                          <label className="text-xs font-semibold text-text-3 uppercase tracking-wide block mb-1">Recipe</label>
                          <input className="input w-full text-sm" placeholder="Search recipes…" value={cpOptRecipeSearch}
                            onChange={e => { setCpOptRecipeSearch(e.target.value); setCpOptRecipeOpen(true) }}
                            onFocus={() => setCpOptRecipeOpen(true)}
                            onBlur={() => setTimeout(() => setCpOptRecipeOpen(false), 150)} autoComplete="off" />
                          {cpOptRecipeOpen && (
                            <div className="absolute top-full left-0 right-0 z-50 bg-white border border-gray-200 rounded-lg shadow-lg mt-0.5 max-h-44 overflow-y-auto">
                              {filteredRecs.length === 0 ? <div className="px-3 py-2 text-sm text-gray-400 italic">No matches</div>
                                : filteredRecs.map(r => (
                                  <button key={r.id} type="button" onMouseDown={e => e.preventDefault()}
                                    className={`w-full text-left px-3 py-1.5 text-sm hover:bg-accent-dim flex items-center gap-2 ${cpOptForm.recipe_id === r.id ? 'bg-accent-dim font-medium text-accent' : ''}`}
                                    onClick={() => { setCpOptForm(f => f ? { ...f, recipe_id: r.id } : f); setCpOptRecipeSearch(r.name); setCpOptRecipeOpen(false) }}>
                                    {cpOptForm.recipe_id === r.id && <span className="text-accent text-xs">✓</span>}
                                    <span>{r.name}</span>
                                    {r.category_name && <span className="ml-auto text-xs text-gray-400 shrink-0">{r.category_name}</span>}
                                  </button>
                                ))}
                            </div>
                          )}
                        </div>
                      )}

                      {cpOptForm.item_type === 'ingredient' && (
                        <div className="relative">
                          <label className="text-xs font-semibold text-text-3 uppercase tracking-wide block mb-1">Ingredient</label>
                          <input className="input w-full text-sm" placeholder="Search ingredients…" value={cpOptIngSearch}
                            onChange={e => { setCpOptIngSearch(e.target.value); setCpOptIngOpen(true) }}
                            onFocus={() => setCpOptIngOpen(true)}
                            onBlur={() => setTimeout(() => setCpOptIngOpen(false), 150)} autoComplete="off" />
                          {cpOptIngOpen && (
                            <div className="absolute top-full left-0 right-0 z-50 bg-white border border-gray-200 rounded-lg shadow-lg mt-0.5 max-h-44 overflow-y-auto">
                              {filteredIngs.length === 0 ? <div className="px-3 py-2 text-sm text-gray-400 italic">No matches</div>
                                : filteredIngs.map(i => (
                                  <button key={i.id} type="button" onMouseDown={e => e.preventDefault()}
                                    className={`w-full text-left px-3 py-1.5 text-sm hover:bg-accent-dim flex items-center gap-2 ${cpOptForm.ingredient_id === i.id ? 'bg-accent-dim font-medium text-accent' : ''}`}
                                    onClick={() => { setCpOptForm(f => f ? { ...f, ingredient_id: i.id } : f); setCpOptIngSearch(i.name); setCpOptIngOpen(false) }}>
                                    {cpOptForm.ingredient_id === i.id && <span className="text-accent text-xs">✓</span>}
                                    <span>{i.name}</span>
                                    {i.base_unit_abbr && <span className="ml-auto text-xs text-gray-400 shrink-0">{i.base_unit_abbr}</span>}
                                  </button>
                                ))}
                            </div>
                          )}
                        </div>
                      )}

                      {cpOptForm.item_type === 'sales_item' && (
                        <div className="relative">
                          <label className="text-xs font-semibold text-text-3 uppercase tracking-wide block mb-1">Sales Item</label>
                          <input className="input w-full text-sm" placeholder="Search sales items…" value={cpOptSiSearch}
                            onChange={e => { setCpOptSiSearch(e.target.value); setCpOptSiOpen(true) }}
                            onFocus={() => setCpOptSiOpen(true)}
                            onBlur={() => setTimeout(() => setCpOptSiOpen(false), 150)} autoComplete="off" />
                          {cpOptSiOpen && (
                            <div className="absolute top-full left-0 right-0 z-50 bg-white border border-gray-200 rounded-lg shadow-lg mt-0.5 max-h-44 overflow-y-auto">
                              {filteredSis.length === 0 ? <div className="px-3 py-2 text-sm text-gray-400 italic">No matches</div>
                                : filteredSis.map(s => (
                                  <button key={s.id} type="button" onMouseDown={e => e.preventDefault()}
                                    className={`w-full text-left px-3 py-1.5 text-sm hover:bg-accent-dim flex items-center gap-2 ${cpOptForm.sales_item_id === s.id ? 'bg-accent-dim font-medium text-accent' : ''}`}
                                    onClick={() => { setCpOptForm(f => f ? { ...f, sales_item_id: s.id } : f); setCpOptSiSearch(s.name); setCpOptSiOpen(false) }}>
                                    {cpOptForm.sales_item_id === s.id && <span className="text-accent text-xs">✓</span>}
                                    <span>{s.name}</span>
                                    <span className={`ml-auto text-xs px-1.5 py-0.5 rounded shrink-0 ${TYPE_BADGE[s.item_type]}`}>{TYPE_LABEL[s.item_type]}</span>
                                  </button>
                                ))}
                            </div>
                          )}
                        </div>
                      )}

                      {cpOptForm.item_type === 'manual' && (
                        <div>
                          <label className="text-xs font-semibold text-text-3 uppercase tracking-wide block mb-1">Manual Cost (USD)</label>
                          <input type="number" step="0.0001" min="0" className="input w-full text-sm"
                            value={cpOptForm.manual_cost ?? ''}
                            onChange={e => setCpOptForm(f => f ? { ...f, manual_cost: parseFloat(e.target.value) || null } : f)} />
                        </div>
                      )}

                      {(cpOptForm.item_type === 'recipe' || cpOptForm.item_type === 'ingredient') && (
                        <div>
                          <label className="text-xs font-semibold text-text-3 uppercase tracking-wide block mb-1">Quantity</label>
                          <div className="flex items-center gap-2">
                            <input type="number" step="0.0001" min="0.0001" className="input w-28 text-sm"
                              value={cpOptForm.qty ?? 1}
                              onChange={e => setCpOptForm(f => f ? { ...f, qty: parseFloat(e.target.value) || 1 } : f)} />
                            <span className="text-sm text-gray-500">{cpOptForm.item_type === 'recipe' ? 'portion(s)' : 'units'}</span>
                          </div>
                        </div>
                      )}

                    </>)}{/* end details tab */}
                      {comboPanelOptTab === 'modifiers' && (
                        <div className="space-y-3">
                          {cpOptMgIds.length === 0 && (
                            <p className="text-xs text-text-3 italic">No modifier groups assigned.</p>
                          )}
                          <div className="space-y-1.5">
                            {cpOptMgIds.map(mgId => {
                              const mg = modifierGroups.find(m => m.id === mgId)
                              if (!mg) return null
                              return (
                                <div key={mgId} className="flex items-center justify-between gap-2 px-2.5 py-1.5 bg-blue-50 border border-blue-100 rounded text-xs">
                                  <span className="font-medium text-blue-800">{mg.name}</span>
                                  <button className="text-blue-300 hover:text-red-500 transition-colors" title={`Remove ${mg.name}`}
                                    onClick={() => setCpOptMgIds(ids => ids.filter(id => id !== mgId))}>
                                    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                      <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/>
                                    </svg>
                                  </button>
                                </div>
                              )
                            })}
                          </div>
                          {modifierGroups.filter(mg => !cpOptMgIds.includes(mg.id)).length > 0 && (
                            <div className="relative inline-block">
                              <button
                                className="text-xs px-2 py-0.5 rounded-full border border-dashed border-accent text-accent hover:bg-accent-dim transition-colors"
                                onClick={e => { const rect = (e.currentTarget as HTMLButtonElement).getBoundingClientRect(); setSiMgAddPos({ top: rect.bottom + 4, left: rect.left }); setCpOptMgOpen(o => !o) }}>
                                + Add Modifier Group
                              </button>
                              {cpOptMgOpen && siMgAddPos && createPortal(
                                <>
                                  <div className="fixed inset-0 z-[99998]" onClick={() => setCpOptMgOpen(false)} />
                                  <div className="bg-white border border-border rounded shadow-xl max-h-52 overflow-y-auto min-w-[240px]"
                                    style={{ position: 'fixed', top: siMgAddPos.top, left: siMgAddPos.left, zIndex: 99999 }}>
                                    {modifierGroups.filter(mg => !cpOptMgIds.includes(mg.id)).map(mg => (
                                      <button key={mg.id} className="w-full text-left px-3 py-2 text-xs hover:bg-accent-dim flex items-center justify-between gap-2"
                                        onClick={() => { setCpOptMgIds(ids => [...ids, mg.id]); setCpOptMgOpen(false) }}>
                                        <span className="font-medium">{mg.name}</span>
                                        <span className="text-text-3 shrink-0">{mg.option_count ?? 0} opts · {mg.min_select}–{mg.max_select}</span>
                                      </button>
                                    ))}
                                    <button className="w-full text-left px-3 py-2 text-xs text-text-3 border-t border-border hover:bg-gray-50"
                                      onClick={() => setCpOptMgOpen(false)}>Cancel</button>
                                  </div>
                                </>,
                                document.body
                              )}
                            </div>
                          )}
                          <p className="text-xs text-text-3 italic">Click Save to persist modifier group changes.</p>
                        </div>
                      )}
                    </>
                  )
                })()}
              </div>

              {/* Panel footer */}
              <div className="flex-shrink-0 border-t border-border px-4 py-3 flex gap-2">
                <button className="btn btn-primary flex-1 text-sm" disabled={comboPanelSaving} onClick={saveComboPanelItem}>
                  {comboPanelSaving ? 'Saving…' : 'Save'}
                </button>
                <button className="btn btn-ghost text-sm" onClick={() => setComboEditTarget(null)}>Cancel</button>
              </div>
            </div>
          )}

          </div>{/* end flex flex-1 min-h-0 wrapper */}
        </div>
      )}

      {/* ── MODIFIERS TAB ─────────────────────────────────────────────────────── */}
      {activeTab === 'modifiers' && (
        <div className="flex flex-1 min-h-0 overflow-hidden">
          {/* Main group list */}
          <div className="flex-1 overflow-auto p-5">
            {modifierGroups.length === 0 && (
              <p className="text-sm text-center text-gray-400 py-12">No modifier groups yet. Click "+ New Modifier Group" to create one.</p>
            )}
            <div className="space-y-2 max-w-3xl">
              {modifierGroups.map(g => (
                <div key={g.id} className={`card overflow-hidden transition-colors ${mgEditTarget?.type === 'group' && (mgEditTarget as { type: 'group'; group: ModifierGroup }).group.id === g.id ? 'ring-1 ring-accent' : ''}`}>
                  {/* Group header */}
                  <div className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-gray-50"
                    onClick={() => {
                      if (expandedMgId === g.id && mgEditTarget?.type === 'group' && (mgEditTarget as any).group.id === g.id) {
                        setExpandedMgId(null); setMgEditTarget(null)
                      } else {
                        toggleMg(g.id)
                        setMgEditTarget({ type: 'group', group: g })
                      }
                    }}>
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-gray-400">{expandedMgId === g.id ? '▼' : '▶'}</span>
                      <span className="font-medium text-gray-900">{g.name}</span>
                      {g.display_name && <span className="text-xs text-gray-400 italic">"{g.display_name}"</span>}
                      <span className="text-xs text-gray-400">min {g.min_select} · max {g.max_select}</span>
                      {g.option_count !== undefined && (
                        <span className="text-xs bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">
                          {g.option_count} opt{g.option_count !== 1 ? 's' : ''}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-0.5" onClick={e => e.stopPropagation()}>
                      <button className="p-1.5 rounded text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors" title="Duplicate modifier group"
                        onClick={() => duplicateMg(g)}>
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>
                        </svg>
                      </button>
                      <button className="p-1.5 rounded text-red-400 hover:text-red-600 hover:bg-red-50 transition-colors" title="Delete modifier group"
                        onClick={() => deleteMg(g)}>
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/>
                        </svg>
                      </button>
                    </div>
                  </div>

                  {/* Options table */}
                  {expandedMgId === g.id && (
                    <div className="border-t border-border">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="bg-surface-2 border-b border-border text-xs text-text-3 uppercase tracking-wide">
                            <th className="px-1 py-2 w-6"></th>
                            <th className="px-3 py-2 text-left font-semibold">Name</th>
                            <th className="px-3 py-2 text-left font-semibold">Type</th>
                            <th className="px-3 py-2 text-left font-semibold">Linked Item</th>
                            <th className="px-2 py-2 w-8"></th>
                          </tr>
                        </thead>
                        <tbody>
                          {(expandedOptions[g.id] || []).length === 0 && (
                            <tr><td colSpan={5} className="px-3 py-3 text-xs text-text-3 text-center italic">No options yet.</td></tr>
                          )}
                          {(expandedOptions[g.id] || []).map((opt, optIdx) => {
                            const opts = expandedOptions[g.id] || []
                            const isActive = mgEditTarget?.type === 'option' && (mgEditTarget as { type: 'option'; groupId: number; opt: ModifierOption | null }).groupId === g.id && (mgEditTarget as any).opt?.id === opt.id
                            return (
                              <tr key={opt.id}
                                className={`border-b border-border last:border-0 cursor-pointer transition-colors ${isActive ? 'bg-accent-dim/40' : 'hover:bg-surface-2/50'}`}
                                onClick={() => setMgEditTarget({ type: 'option', groupId: g.id, opt })}>
                                {/* Sort arrows */}
                                <td className="px-1 py-2" onClick={e => e.stopPropagation()}>
                                  <div className="flex flex-col">
                                    <button className="p-0.5 text-text-3 hover:text-text-1 disabled:opacity-20" disabled={optIdx === 0}
                                      onClick={() => reorderMgOption(g.id, optIdx, 'up')} title="Move up">
                                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 15l-6-6-6 6"/></svg>
                                    </button>
                                    <button className="p-0.5 text-text-3 hover:text-text-1 disabled:opacity-20" disabled={optIdx === opts.length - 1}
                                      onClick={() => reorderMgOption(g.id, optIdx, 'down')} title="Move down">
                                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M6 9l6 6 6-6"/></svg>
                                    </button>
                                  </div>
                                </td>
                                <td className="px-3 py-2 font-medium text-text-1">{opt.name}</td>
                                <td className="px-3 py-2">
                                  <span className={`text-xs px-1.5 py-0.5 rounded ${TYPE_BADGE[opt.item_type]}`}>{TYPE_LABEL[opt.item_type]}</span>
                                </td>
                                <td className="px-3 py-2 text-xs text-text-2">
                                  {opt.item_type === 'recipe' && (
                                    opt.recipe_name
                                      ? <span className="flex items-center gap-1.5">
                                          <span>{opt.recipe_name}</span>
                                          <span className="text-text-3 font-mono">· {Number(opt.qty ?? 1)} {opt.recipe_yield_unit_abbr || 'ptn'}</span>
                                        </span>
                                      : <span className="text-text-3">#{opt.recipe_id}</span>
                                  )}
                                  {opt.item_type === 'ingredient' && (
                                    opt.ingredient_name
                                      ? <span className="flex items-center gap-1.5">
                                          <span>{opt.ingredient_name}</span>
                                          <span className="text-text-3 font-mono">· {Number(opt.qty ?? 1)} {opt.ingredient_unit_abbr || ''}</span>
                                        </span>
                                      : <span className="text-text-3">#{opt.ingredient_id}</span>
                                  )}
                                  {opt.item_type === 'manual' && <span className="text-text-3">—</span>}
                                </td>
                                <td className="px-2 py-2" onClick={e => e.stopPropagation()}>
                                  <button className="p-1 rounded text-red-400 hover:text-red-600 hover:bg-red-50 transition-colors" title="Delete option"
                                    onClick={() => deleteMgOption(g.id, opt.id)}>
                                    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                      <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/>
                                    </svg>
                                  </button>
                                </td>
                              </tr>
                            )
                          })}
                          <tr>
                            <td colSpan={5} className="px-3 py-2">
                              <button className="btn btn-xs btn-outline"
                                onClick={() => setMgEditTarget({ type: 'option', groupId: g.id, opt: null })}>
                                + Add Option
                              </button>
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Resize handle */}
          {mgEditTarget && (
            <div onMouseDown={startMgPanelResize}
              className="w-1 hover:w-1.5 bg-border hover:bg-accent cursor-col-resize flex-shrink-0 transition-all" />
          )}

          {/* Side panel */}
          {mgEditTarget && (
            <div className="flex-shrink-0 border-l border-border bg-surface flex flex-col overflow-hidden"
              style={{ width: mgPanelWidth }}>
              {/* Panel header */}
              <div className="flex-shrink-0 flex items-center justify-between px-4 py-3 border-b border-border">
                <h3 className="text-sm font-semibold text-text-1 truncate">
                  {mgEditTarget.type === 'group'
                    ? `Edit Group: ${(mgEditTarget as { type: 'group'; group: ModifierGroup }).group.name}`
                    : (mgEditTarget as { type: 'option'; groupId: number; opt: ModifierOption | null }).opt?.id
                      ? `Edit Option: ${(mgEditTarget as any).opt.name}`
                      : 'Add Option'}
                </h3>
                <button onClick={() => setMgEditTarget(null)} className="p-1 rounded hover:bg-surface-2 text-text-3 hover:text-text-1 shrink-0">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
                </button>
              </div>

              {/* Panel body */}
              <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
                {mgEditTarget.type === 'group' && mpGroupForm && (
                  <>
                    <div>
                      <label className="text-xs font-semibold text-text-3 uppercase tracking-wide block mb-1">Name <span className="text-red-500">*</span></label>
                      <input className="input w-full text-sm" value={mpGroupForm.name}
                        onChange={e => setMpGroupForm(f => f ? { ...f, name: e.target.value } : f)} />
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-text-3 uppercase tracking-wide block mb-1">Display Name (customer-facing)</label>
                      <input className="input w-full text-sm" placeholder="Leave blank to use name"
                        value={mpGroupForm.display_name}
                        onChange={e => setMpGroupForm(f => f ? { ...f, display_name: e.target.value } : f)} />
                    </div>
                    <div className="flex gap-3">
                      <div className="flex-1">
                        <label className="text-xs font-semibold text-text-3 uppercase tracking-wide block mb-1">Min Select</label>
                        <input type="number" min="0" className="input w-full text-sm"
                          value={mpGroupForm.min_select}
                          onChange={e => setMpGroupForm(f => f ? { ...f, min_select: Number(e.target.value) } : f)} />
                      </div>
                      <div className="flex-1">
                        <label className="text-xs font-semibold text-text-3 uppercase tracking-wide block mb-1">Max Select</label>
                        <input type="number" min="1" className="input w-full text-sm"
                          value={mpGroupForm.max_select}
                          onChange={e => setMpGroupForm(f => f ? { ...f, max_select: Number(e.target.value) } : f)} />
                      </div>
                    </div>
                    <label className="flex items-center gap-2 mt-1 p-2 bg-surface-2 rounded-lg border border-border cursor-pointer">
                      <input type="checkbox" checked={mpGroupForm.allow_repeat_selection}
                        onChange={e => setMpGroupForm(f => f ? { ...f, allow_repeat_selection: e.target.checked } : f)} className="rounded" />
                      <div>
                        <span className="text-xs font-medium text-text-1">Allow repeat selection</span>
                        <p className="text-[10px] text-text-3">Same option can be selected multiple times (e.g. extra toppings)</p>
                      </div>
                    </label>
                    {Number(mpGroupForm.min_select) === 0 && (
                      <label className="flex items-center gap-2 mt-1 p-2 bg-surface-2 rounded-lg border border-border cursor-pointer">
                        <input type="checkbox" checked={mpGroupForm.default_auto_show ?? true}
                          onChange={e => setMpGroupForm(f => f ? { ...f, default_auto_show: e.target.checked } : f)} className="rounded" />
                        <div>
                          <span className="text-xs font-medium text-text-1">Show automatically in POS</span>
                          <p className="text-[10px] text-text-3">When off, this modifier appears as an optional button in the POS. Can be overridden per sales item.</p>
                        </div>
                      </label>
                    )}
                  </>
                )}

                {mgEditTarget.type === 'option' && mpOptForm && (
                  <>
                    <div>
                      <label className="text-xs font-semibold text-text-3 uppercase tracking-wide block mb-1">Name <span className="text-red-500">*</span></label>
                      <input className="input w-full text-sm" value={mpOptForm.name}
                        onChange={e => setMpOptForm(f => f ? { ...f, name: e.target.value } : f)} />
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-text-3 uppercase tracking-wide block mb-1">Display Name (customer-facing)</label>
                      <input className="input w-full text-sm" placeholder="Leave blank to use name"
                        value={mpOptForm.display_name}
                        onChange={e => setMpOptForm(f => f ? { ...f, display_name: e.target.value } : f)} />
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-text-3 uppercase tracking-wide block mb-1">Type</label>
                      <select className="input w-full text-sm" value={mpOptForm.item_type}
                        onChange={e => setMpOptForm(f => f ? { ...f, item_type: e.target.value as 'recipe' | 'ingredient' | 'manual', recipe_id: null, ingredient_id: null } : f)}>
                        <option value="manual">Manual</option>
                        <option value="recipe">Recipe</option>
                        <option value="ingredient">Ingredient</option>
                      </select>
                    </div>
                    {mpOptForm.item_type === 'recipe' && (
                      <div>
                        <label className="text-xs font-semibold text-text-3 uppercase tracking-wide block mb-1">Recipe</label>
                        <div className="relative">
                          <input className="input w-full text-sm" placeholder="Search recipes…"
                            value={mpOptRecipeSearch}
                            onChange={e => { setMpOptRecipeSearch(e.target.value); setMpOptRecipeOpen(true) }}
                            onFocus={() => setMpOptRecipeOpen(true)}
                            onBlur={() => setTimeout(() => setMpOptRecipeOpen(false), 150)} />
                          {mpOptRecipeOpen && (
                            <div className="absolute top-full left-0 right-0 z-50 bg-white border border-gray-200 rounded-lg shadow-lg mt-0.5 max-h-44 overflow-y-auto">
                              {recipes.filter(r => r.name.toLowerCase().includes(mpOptRecipeSearch.toLowerCase())).slice(0, 50).map(r => (
                                <button key={r.id} className="w-full text-left px-3 py-2 text-sm hover:bg-accent-dim flex items-center justify-between gap-2"
                                  onMouseDown={() => { setMpOptForm(f => f ? { ...f, recipe_id: r.id } : f); setMpOptRecipeSearch(r.name); setMpOptRecipeOpen(false) }}>
                                  <span className="font-medium">{r.name}</span>
                                  {r.category_name && <span className="text-xs text-text-3 shrink-0">{r.category_name}</span>}
                                </button>
                              ))}
                              {recipes.filter(r => r.name.toLowerCase().includes(mpOptRecipeSearch.toLowerCase())).length === 0 && (
                                <p className="px-3 py-2 text-xs text-text-3">No matches</p>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                    {mpOptForm.item_type === 'ingredient' && (
                      <div>
                        <label className="text-xs font-semibold text-text-3 uppercase tracking-wide block mb-1">Ingredient</label>
                        <div className="relative">
                          <input className="input w-full text-sm" placeholder="Search ingredients…"
                            value={mpOptIngSearch}
                            onChange={e => { setMpOptIngSearch(e.target.value); setMpOptIngOpen(true) }}
                            onFocus={() => setMpOptIngOpen(true)}
                            onBlur={() => setTimeout(() => setMpOptIngOpen(false), 150)} />
                          {mpOptIngOpen && (
                            <div className="absolute top-full left-0 right-0 z-50 bg-white border border-gray-200 rounded-lg shadow-lg mt-0.5 max-h-44 overflow-y-auto">
                              {ingredients.filter(i => i.name.toLowerCase().includes(mpOptIngSearch.toLowerCase())).slice(0, 50).map(i => (
                                <button key={i.id} className="w-full text-left px-3 py-2 text-sm hover:bg-accent-dim flex items-center justify-between gap-2"
                                  onMouseDown={() => { setMpOptForm(f => f ? { ...f, ingredient_id: i.id } : f); setMpOptIngSearch(i.name); setMpOptIngOpen(false) }}>
                                  <span className="font-medium">{i.name}</span>
                                  {i.base_unit_abbr && <span className="text-xs text-text-3 shrink-0">{i.base_unit_abbr}</span>}
                                </button>
                              ))}
                              {ingredients.filter(i => i.name.toLowerCase().includes(mpOptIngSearch.toLowerCase())).length === 0 && (
                                <p className="px-3 py-2 text-xs text-text-3">No matches</p>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                    {(mpOptForm.item_type === 'recipe' || mpOptForm.item_type === 'ingredient') && (
                      <div>
                        <label className="text-xs font-semibold text-text-3 uppercase tracking-wide block mb-1">Quantity</label>
                        <div className="flex items-center gap-2">
                          <input type="number" step="0.0001" min="0.0001" className="input w-28 text-sm"
                            value={mpOptForm.qty}
                            onChange={e => setMpOptForm(f => f ? { ...f, qty: parseFloat(e.target.value) || 1 } : f)} />
                          <span className="text-sm text-text-3">
                            {mpOptForm.item_type === 'ingredient'
                              ? ingredients.find(i => i.id === mpOptForm.ingredient_id)?.base_unit_abbr || 'units'
                              : 'portion(s)'}
                          </span>
                        </div>
                      </div>
                    )}
                    {mpOptForm.item_type === 'manual' && (
                      <div>
                        <label className="text-xs font-semibold text-text-3 uppercase tracking-wide block mb-1">Manual Cost</label>
                        <input type="number" step="0.01" min="0" className="input w-full text-sm" placeholder="0.00"
                          value={mpOptForm.manual_cost ?? ''}
                          onChange={e => setMpOptForm(f => f ? { ...f, manual_cost: parseFloat(e.target.value) || null } : f)} />
                      </div>
                    )}
                    <ImageUpload label="Photo" value={mpOptForm.image_url}
                      onChange={url => setMpOptForm(f => f ? { ...f, image_url: url } : f)} formKey="modifier_option" />
                  </>
                )}
              </div>

              {/* Panel footer */}
              <div className="flex-shrink-0 border-t border-border px-4 py-3 flex gap-2">
                <button className="btn btn-primary flex-1 text-sm" disabled={mgPanelSaving} onClick={saveMgPanelItem}>
                  {mgPanelSaving ? 'Saving…' : 'Save'}
                </button>
                <button className="btn btn-ghost text-sm" onClick={() => setMgEditTarget(null)}>Cancel</button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Modals ─────────────────────────────────────────────────────────────── */}

      {/* New Modifier Group modal */}
      {showNewMgModal && (
        <Modal title="New Modifier Group" onClose={() => setShowNewMgModal(false)}>
          <div className="space-y-4 p-1">
            <div>
              <label className="text-xs font-semibold text-text-3 uppercase tracking-wide block mb-1">Name <span className="text-red-500">*</span></label>
              <input className="input w-full" placeholder="e.g. Choose Wings Flavor" value={newMgForm.name}
                onChange={e => setNewMgForm(f => ({ ...f, name: e.target.value }))}
                onKeyDown={e => e.key === 'Enter' && newMgForm.name.trim() && createMg().then(() => setShowNewMgModal(false))} autoFocus />
            </div>
            <div>
              <label className="text-xs font-semibold text-text-3 uppercase tracking-wide block mb-1">Display Name (customer-facing)</label>
              <input className="input w-full" placeholder="Leave blank to use name" value={newMgForm.display_name}
                onChange={e => setNewMgForm(f => ({ ...f, display_name: e.target.value }))} />
            </div>
            <div className="flex gap-3">
              <div className="flex-1">
                <label className="text-xs font-semibold text-text-3 uppercase tracking-wide block mb-1">Min Select</label>
                <input type="number" min="0" className="input w-full" value={newMgForm.min_select}
                  onChange={e => setNewMgForm(f => ({ ...f, min_select: Number(e.target.value) }))} />
              </div>
              <div className="flex-1">
                <label className="text-xs font-semibold text-text-3 uppercase tracking-wide block mb-1">Max Select</label>
                <input type="number" min="1" className="input w-full" value={newMgForm.max_select}
                  onChange={e => setNewMgForm(f => ({ ...f, max_select: Number(e.target.value) }))} />
              </div>
            </div>
          </div>
          <div className="flex gap-2 justify-end pt-4 mt-2 border-t border-border">
            <button className="btn btn-ghost" onClick={() => setShowNewMgModal(false)}>Cancel</button>
            <button className="btn btn-primary" disabled={!newMgForm.name.trim() || mgSaving}
              onClick={() => createMg().then(() => { setShowNewMgModal(false); setNewMgForm({ name: '', display_name: '', min_select: 0, max_select: 1, allow_repeat_selection: false }) })}>
              {mgSaving ? 'Creating…' : '+ Create Group'}
            </button>
          </div>
        </Modal>
      )}

      {/* Sales Item create (New only — edit is handled inline by the right panel) */}
      {siModal === 'new' && (
        <SalesItemModal
          mode="new"
          initial={null}
          defaultType={newComboMode ? 'combo' : undefined}
          recipes={recipes} ingredients={ingredients} combos={combos}
          onSave={saveSalesItem} saving={saving}
          onClose={() => { setSiModal(null); setNewComboMode(false) }}
        />
      )}

      {/* Sales Item delete confirm */}
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

      {/* Combo create modal (edit handled by side panel) */}
      {comboModal === 'new' && (
        <ComboFormModal
          mode="new"
          initial={null}
          onSave={saveCombo} saving={savingCombo}
          onClose={() => setComboModal(null)}
        />
      )}

      {/* Combo delete confirm */}
      {deletingCombo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-lg shadow-xl p-6 max-w-sm w-full">
            <h3 className="font-semibold mb-2">Delete combo "{deletingCombo.name}"?</h3>
            <p className="text-sm text-gray-500 mb-4">All steps and options will be removed. Sales items linked to this combo will have their combo link cleared.</p>
            <div className="flex gap-2 justify-end">
              <button className="btn btn-outline" onClick={() => setDeletingCombo(null)}>Cancel</button>
              <button className="btn btn-danger" onClick={deleteComboItem}>Delete</button>
            </div>
          </div>
        </div>
      )}

      {toast && <Toast message={toast.msg} onClose={() => setToast(null)} />}
    </div>
  )
}
