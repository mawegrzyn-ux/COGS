import { useState, useEffect, useCallback, useMemo } from 'react'
import { createPortal } from 'react-dom'
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
  recipe_id: number | null; recipe_name?: string
  recipe_yield_qty?: number | null; recipe_yield_unit_abbr?: string | null
  ingredient_id: number | null; ingredient_name?: string
  ingredient_unit_abbr?: string | null
  manual_cost: number | null; price_addon: number; sort_order: number
}
interface ModifierGroup {
  id: number; name: string; display_name?: string | null; description: string | null
  min_select: number; max_select: number; option_count?: number
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
  name: string
  category_id: number | null; category_name: string | null
  description: string | null
  recipe_id: number | null; recipe_name?: string
  ingredient_id: number | null; ingredient_name?: string
  combo_id: number | null; combo_name?: string
  manual_cost: number | null; image_url: string | null; sort_order: number
  modifier_group_count?: number
  markets?: SalesItemMarket[]
  modifier_groups?: { modifier_group_id: number; name: string; sort_order: number }[]
}

// ── Constants ─────────────────────────────────────────────────────────────────
const TYPE_BADGE: Record<string, string> = {
  recipe:     'bg-blue-100 text-blue-700',
  ingredient: 'bg-green-100 text-green-700',
  manual:     'bg-purple-100 text-purple-700',
  combo:      'bg-orange-100 text-orange-700',
  sales_item: 'bg-teal-100 text-teal-700',
}
const TYPE_LABEL: Record<string, string> = { recipe: 'Recipe', ingredient: 'Ingredient', manual: 'Manual', combo: 'Combo', sales_item: 'Sales Item' }

// ── ComboOptionForm ────────────────────────────────────────────────────────────
function ComboOptionForm({ opt, modifierGroups, recipes, ingredients, salesItems, onSave, onClose }: {
  opt: ComboStepOption; modifierGroups: ModifierGroup[]; recipes: Recipe[]; ingredients: Ingredient[]
  salesItems: SalesItem[]
  onSave(opt: ComboStepOption): void; onClose(): void
}) {
  const [form, setForm] = useState({ ...opt, qty: opt.qty ?? 1, sales_item_id: opt.sales_item_id ?? null, display_name: opt.display_name ?? null })
  const [attachedMgIds, setAttachedMgIds] = useState<number[]>((opt.modifier_groups || []).map(m => m.modifier_group_id))
  const [recipeSearch,  setRecipeSearch]  = useState(() => recipes.find(r => r.id === opt.recipe_id)?.name ?? '')
  const [recipeOpen,    setRecipeOpen]    = useState(false)
  const [ingSearch,     setIngSearch]     = useState(() => ingredients.find(i => i.id === opt.ingredient_id)?.name ?? '')
  const [ingOpen,       setIngOpen]       = useState(false)
  const [siSearch,      setSiSearch]      = useState(() => salesItems.find(s => s.id === opt.sales_item_id)?.name ?? '')
  const [siOpen,        setSiOpen]        = useState(false)
  const [saveError, setSaveError] = useState('')
  const filteredRecipes  = useMemo(() => recipes.filter(r => r.name.toLowerCase().includes(recipeSearch.toLowerCase())).slice(0, 50), [recipes, recipeSearch])
  const filteredIngs     = useMemo(() => ingredients.filter(i => i.name.toLowerCase().includes(ingSearch.toLowerCase())).slice(0, 50), [ingredients, ingSearch])
  const filteredSiItems  = useMemo(() => salesItems.filter(s => s.item_type !== 'combo' && s.name.toLowerCase().includes(siSearch.toLowerCase())).slice(0, 50), [salesItems, siSearch])
  const selectedIngredient = useMemo(() =>
    form.item_type === 'ingredient' && form.ingredient_id
      ? ingredients.find(i => i.id === form.ingredient_id) ?? null
      : null,
    [form.item_type, form.ingredient_id, ingredients]
  )

  const handleTypeChange = (t: 'recipe' | 'ingredient' | 'manual' | 'sales_item') => {
    setForm(f => ({ ...f, item_type: t, recipe_id: null, ingredient_id: null, sales_item_id: null, manual_cost: null }))
    setRecipeSearch(''); setIngSearch(''); setSiSearch('')
  }
  const handleSave = () => {
    if (!form.name.trim()) { setSaveError('Name is required'); return }
    if (form.item_type === 'recipe'     && !form.recipe_id)     { setSaveError('Please select a recipe'); return }
    if (form.item_type === 'ingredient' && !form.ingredient_id) { setSaveError('Please select an ingredient'); return }
    if (form.item_type === 'sales_item' && !form.sales_item_id) { setSaveError('Please select a sales item'); return }
    setSaveError('')
    onSave({ ...form, name: form.name.trim(), modifier_groups: attachedMgIds.map(id => ({ modifier_group_id: id, name: modifierGroups.find(m => m.id === id)?.name || '' })) })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md p-5">
        <h3 className="text-base font-semibold mb-4">{opt.id === 0 ? 'Add Option' : 'Edit Option'}</h3>
        <div className="space-y-3">
          <Field label="Name"><input className="input w-full" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} /></Field>
          <Field label="Display name (optional)">
            <input className="input w-full" placeholder="Customer-facing name (leave blank to use internal name)"
              value={form.display_name ?? ''}
              onChange={e => setForm(f => ({ ...f, display_name: e.target.value || null }))} />
          </Field>
          <Field label="Type">
            <select className="input w-full" value={form.item_type} onChange={e => handleTypeChange(e.target.value as 'recipe' | 'ingredient' | 'manual' | 'sales_item')}>
              <option value="manual">Manual cost</option>
              <option value="recipe">Recipe</option>
              <option value="ingredient">Ingredient</option>
              <option value="sales_item">Sales Item</option>
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
          {form.item_type === 'sales_item' && (
            <Field label="Sales Item"><div className="relative">
              <input className="input w-full" placeholder="Search sales items…" value={siSearch}
                onChange={e => { setSiSearch(e.target.value); setSiOpen(true) }}
                onFocus={() => setSiOpen(true)} onBlur={() => setTimeout(() => setSiOpen(false), 150)} autoComplete="off" />
              {siOpen && <div className="absolute top-full left-0 right-0 z-50 bg-white border border-gray-200 rounded-lg shadow-lg mt-0.5 max-h-52 overflow-y-auto">
                {filteredSiItems.length === 0
                  ? <div className="px-3 py-2 text-sm text-gray-400 italic">No sales items match "{siSearch}"</div>
                  : filteredSiItems.map(s => <button key={s.id} type="button"
                      className={`w-full text-left px-3 py-2 text-sm hover:bg-accent-dim flex items-center gap-2 ${form.sales_item_id === s.id ? 'bg-accent-dim font-medium text-accent' : 'text-gray-800'}`}
                      onMouseDown={e => e.preventDefault()}
                      onClick={() => { setForm(f => ({ ...f, sales_item_id: s.id })); setSiSearch(s.name); setSiOpen(false) }}>
                      {form.sales_item_id === s.id && <span className="text-accent text-xs">✓</span>}
                      <span>{s.name}</span>
                      <span className={`ml-auto text-xs px-1.5 py-0.5 rounded shrink-0 ${TYPE_BADGE[s.item_type]}`}>{TYPE_LABEL[s.item_type]}</span>
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
          {(form.item_type === 'recipe' || form.item_type === 'ingredient') && (
            <Field label="Quantity">
              <div className="flex items-center gap-2">
                <input type="number" step="0.0001" min="0.0001" className="input w-32"
                  value={form.qty}
                  onChange={e => setForm(f => ({ ...f, qty: parseFloat(e.target.value) || 1 }))} />
                <span className="text-sm text-gray-500 whitespace-nowrap">
                  {form.item_type === 'recipe'
                    ? 'portion(s)'
                    : (selectedIngredient?.base_unit_abbr || 'units')}
                </span>
              </div>
            </Field>
          )}
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
        <ImageUpload label="Image" value={form.image_url} onChange={url => setForm(f => ({ ...f, image_url: url }))} />
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
// Cost/price fields removed — pricing is managed per-menu in Menu Builder
function ModifierOptionAddForm({ recipes, ingredients, onAdd }: {
  recipes: Recipe[]; ingredients: Ingredient[]
  onAdd(opt: Omit<ModifierOption, 'id' | 'modifier_group_id'>): void
}) {
  const [form, setForm] = useState({
    name: '', item_type: 'manual' as 'recipe' | 'ingredient' | 'manual',
    recipe_id: null as number | null, ingredient_id: null as number | null,
    manual_cost: null as number | null, price_addon: 0, sort_order: 0,
  })
  const [show, setShow] = useState(false)
  if (!show) return <button className="btn btn-xs btn-outline mt-2" onClick={() => setShow(true)}>+ Add Option</button>
  return (
    <tr className="border-t border-dashed border-border bg-accent-dim/30">
      <td className="px-2 py-1.5">
        <input
          className="input input-sm w-full"
          placeholder="Option name"
          value={form.name}
          onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
          onKeyDown={e => { if (e.key === 'Enter' && form.name.trim()) { onAdd(form); setForm({ name: '', item_type: 'manual', recipe_id: null, ingredient_id: null, manual_cost: null, price_addon: 0, sort_order: 0 }); setShow(false) } if (e.key === 'Escape') setShow(false) }}
        />
      </td>
      <td className="px-2 py-1.5">
        <select className="input py-0.5 text-xs w-28" value={form.item_type}
          onChange={e => setForm(f => ({ ...f, item_type: e.target.value as 'recipe' | 'ingredient' | 'manual', recipe_id: null, ingredient_id: null }))}>
          <option value="manual">Manual</option>
          <option value="recipe">Recipe</option>
          <option value="ingredient">Ingredient</option>
        </select>
      </td>
      <td className="px-2 py-1.5">
        {form.item_type === 'recipe' && (
          <select className="input py-0.5 text-xs w-full" value={form.recipe_id ?? ''} onChange={e => setForm(f => ({ ...f, recipe_id: Number(e.target.value) || null }))}>
            <option value="">— Select recipe —</option>
            {recipes.slice(0, 200).map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        )}
        {form.item_type === 'ingredient' && (
          <select className="input py-0.5 text-xs w-full" value={form.ingredient_id ?? ''} onChange={e => setForm(f => ({ ...f, ingredient_id: Number(e.target.value) || null }))}>
            <option value="">— Select ingredient —</option>
            {ingredients.slice(0, 200).map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
          </select>
        )}
        {form.item_type === 'manual' && <span className="text-xs text-text-3 italic">No link</span>}
      </td>
      <td className="px-2 py-1.5">
        <div className="flex gap-1">
          <button className="btn btn-xs btn-primary" disabled={!form.name.trim()}
            onClick={() => { onAdd(form); setForm({ name: '', item_type: 'manual', recipe_id: null, ingredient_id: null, manual_cost: null, price_addon: 0, sort_order: 0 }); setShow(false) }}>Add</button>
          <button className="btn btn-xs btn-ghost" onClick={() => setShow(false)}>✕</button>
        </div>
      </td>
    </tr>
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
      setDeleting(null); showToast('Deleted')
    } catch { showToast('Delete failed') }
  }

  // ── Items tab ──────────────────────────────────────────────────────────────
  const [itemSearch,    setItemSearch]    = useState('')
  const [typeFilter,    setTypeFilter]    = useState<'recipe' | 'ingredient' | 'manual' | 'combo' | ''>('')
  const [selectedSiId,  setSelectedSiId]  = useState<number | null>(null)
  const [siSortField,   setSiSortField]   = useState<string>('name')
  const [siSortDir,     setSiSortDir]     = useState<'asc' | 'desc'>('asc')

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
  const [editingStep,        setEditingStep]        = useState<number | null>(null)
  const [editStepForm,       setEditStepForm]       = useState<{ display_name: string | null; min_select: number; max_select: number; allow_repeat: boolean; auto_select: boolean } | null>(null)
  const [savingStep,         setSavingStep]         = useState(false)
  const [editingOpt,         setEditingOpt]         = useState<ComboStepOption | null>(null)
  const [editingOptStepId,   setEditingOptStepId]   = useState<number | null>(null)
  const [comboModal,         setComboModal]         = useState<'new' | Combo | null>(null)
  const [savingCombo,        setSavingCombo]        = useState(false)
  const [deletingCombo,      setDeletingCombo]      = useState<Combo | null>(null)

  const [duplicatingCombo, setDuplicatingCombo] = useState(false)

  useEffect(() => {
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
      if (comboModal === 'new') {
        const created: Combo = await api.post('/combos', payload)
        setCombos(prev => [...prev, { ...created, step_count: 0 }].sort((a, b) => a.name.localeCompare(b.name)))
        setSelectedComboId(created.id)
        showToast('Combo created')
      } else if (comboModal && typeof comboModal !== 'string') {
        const updated: Combo = await api.put(`/combos/${comboModal.id}`, payload)
        setCombos(prev => prev.map(c => c.id === updated.id ? { ...c, ...updated } : c))
        if (selectedComboId === comboModal.id) setComboDetail(d => d ? { ...d, ...updated } : d)
        showToast('Combo saved')
      }
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

  const startEditStep = (step: ComboStep) => {
    setEditingStep(step.id)
    setEditStepForm({ display_name: step.display_name ?? null, min_select: step.min_select ?? 1, max_select: step.max_select ?? 1, allow_repeat: step.allow_repeat ?? false, auto_select: step.auto_select ?? false })
  }

  const saveStepSettings = async (stepId: number) => {
    if (!editStepForm || !selectedComboId) return
    setSavingStep(true)
    try {
      const step = (comboDetail?.steps || []).find(s => s.id === stepId)
      await api.put(`/combos/${selectedComboId}/steps/${stepId}`, {
        name: step?.name, description: step?.description, sort_order: step?.sort_order ?? 0, ...editStepForm,
      })
      await reloadComboDetail()
      setEditingStep(null); setEditStepForm(null)
    } catch { showToast('Failed to save step') } finally { setSavingStep(false) }
  }

  const deleteComboStep = async (stepId: number) => {
    if (!window.confirm('Delete this step and all its options?') || !selectedComboId) return
    try { await api.delete(`/combos/${selectedComboId}/steps/${stepId}`); await reloadComboDetail() }
    catch { showToast('Failed') }
  }

  const addOption = (stepId: number) => {
    setEditingOpt({ id: 0, combo_step_id: stepId, name: '', display_name: null, item_type: 'manual', recipe_id: null, ingredient_id: null, sales_item_id: null, manual_cost: null, price_addon: 0, qty: 1, sort_order: 0 })
    setEditingOptStepId(stepId)
  }

  const saveOption = async (opt: ComboStepOption) => {
    if (!editingOptStepId || !selectedComboId) return
    try {
      let savedId: number
      if (opt.id === 0) {
        const created: any = await api.post(`/combos/${selectedComboId}/steps/${editingOptStepId}/options`, opt)
        savedId = created.id
      } else {
        await api.put(`/combos/${selectedComboId}/steps/${editingOptStepId}/options/${opt.id}`, opt)
        savedId = opt.id
      }
      // Persist modifier group assignments separately
      const mgIds = (opt.modifier_groups || []).map(m => m.modifier_group_id)
      await api.put(`/combos/${selectedComboId}/steps/${editingOptStepId}/options/${savedId}/modifier-groups`, { modifier_group_ids: mgIds })
      await reloadComboDetail(); setEditingOpt(null)
    } catch { showToast('Failed to save option') }
  }

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
  const [expandedSiMg,  setExpandedSiMg]  = useState<Set<number>>(new Set())
  const [siMgData,      setSiMgData]      = useState<Record<number, { modifier_group_id: number; name: string; sort_order: number }[]>>({})
  const [siMgLoading,   setSiMgLoading]   = useState<Set<number>>(new Set())
  const [siMgAddOpen,   setSiMgAddOpen]   = useState<number | null>(null)
  const [siMgAddPos,    setSiMgAddPos]    = useState<{ top: number; left: number } | null>(null)

  const toggleSiMg = async (siId: number) => {
    setExpandedSiMg(prev => {
      const next = new Set(prev)
      if (next.has(siId)) { next.delete(siId); setSiMgAddOpen(null); return next }
      next.add(siId)
      return next
    })
    if (!(siId in siMgData)) {
      setSiMgLoading(prev => new Set([...prev, siId]))
      try {
        const full: SalesItem = await api.get(`/sales-items/${siId}`)
        setSiMgData(prev => ({ ...prev, [siId]: full.modifier_groups || [] }))
      } catch { /* ignore */ }
      finally { setSiMgLoading(prev => { const n = new Set(prev); n.delete(siId); return n }) }
    }
  }

  const saveSiModifiers = async (siId: number, groups: { modifier_group_id: number; name: string; sort_order: number }[]) => {
    try {
      await api.put(`/sales-items/${siId}/modifier-groups`, { modifier_group_ids: groups.map(g => g.modifier_group_id) })
      setSiMgData(prev => ({ ...prev, [siId]: groups }))
      setSalesItems(prev => prev.map(s => s.id === siId ? { ...s, modifier_group_count: groups.length } : s))
    } catch { showToast('Failed to save modifiers') }
  }

  const removeSiModifier = (siId: number, mgId: number) => {
    const current = siMgData[siId] || []
    saveSiModifiers(siId, current.filter(g => g.modifier_group_id !== mgId))
  }

  const addSiModifier = (siId: number, mg: ModifierGroup) => {
    const current = siMgData[siId] || []
    if (current.some(g => g.modifier_group_id === mg.id)) return
    saveSiModifiers(siId, [...current, { modifier_group_id: mg.id, name: mg.name, sort_order: current.length }])
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
  const [editMg,          setEditMg]          = useState<ModifierGroup | null>(null)
  const [newMgForm,       setNewMgForm]       = useState({ name: '', display_name: '', min_select: 0, max_select: 1 })
  const [mgSaving,        setMgSaving]        = useState(false)
  const [editingOption,   setEditingOption]   = useState<{
    groupId: number; optId: number
    form: { name: string; item_type: 'recipe' | 'ingredient' | 'manual'; recipe_id: number | null; ingredient_id: number | null }
  } | null>(null)

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
      setNewMgForm({ name: '', display_name: '', min_select: 0, max_select: 1 })
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

  const duplicateMg = async (mg: ModifierGroup) => {
    try {
      const created = await api.post(`/modifier-groups/${mg.id}/duplicate`, {})
      setModifierGroups(prev => [...prev, created])
      showToast(`"${created.name}" created`)
    } catch { showToast('Failed to duplicate') }
  }

  const addMgOption = async (groupId: number, opt: Omit<ModifierOption, 'id' | 'modifier_group_id'>) => {
    try {
      await api.post(`/modifier-groups/${groupId}/options`, opt)
      // Re-fetch to get joined data (yield qty/unit for recipes, base unit for ingredients)
      const opts = await api.get(`/modifier-groups/${groupId}/options`).catch(() => null)
      if (opts) setExpandedOptions(prev => ({ ...prev, [groupId]: opts }))
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

  const saveOptEdit = async () => {
    if (!editingOption) return
    const { groupId, optId, form } = editingOption
    try {
      await api.put(`/modifier-groups/${groupId}/options/${optId}`, { ...form, price_addon: 0, sort_order: 0 })
      // Re-fetch options to get fresh joined data (recipe_yield_qty, unit abbrs, etc.)
      const opts = await api.get(`/modifier-groups/${groupId}/options`).catch(() => null)
      if (opts) setExpandedOptions(prev => ({ ...prev, [groupId]: opts }))
      setEditingOption(null)
    } catch { showToast('Failed to save') }
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
        </div>
        <div className="flex gap-1">
          {(['items', 'combos', 'modifiers'] as const).map(t => (
            <button key={t} onClick={() => setActiveTab(t)}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${activeTab === t ? 'border-accent text-accent' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
              {t === 'items' ? 'Sales Items' : t === 'combos' ? 'Combos' : 'Modifiers'}
              {t === 'items' && nonComboItems.length > 0 && <span className="ml-1.5 text-xs bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded-full">{nonComboItems.length}</span>}
              {t === 'combos' && combos.length > 0 && <span className="ml-1.5 text-xs bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded-full">{combos.length}</span>}
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
              <span className="text-sm text-gray-400 self-center ml-auto">{nonComboItems.length} item{nonComboItems.length !== 1 ? 's' : ''}</span>
            </div>

            {nonComboItems.length === 0 ? (
              <div className="py-16 text-center text-sm text-gray-400">No sales items yet. Click "+ New Sales Item" to create one.</div>
            ) : (
              <div className="card overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 bg-gray-50">
                      <th className="px-4 py-2.5 text-left font-semibold text-gray-600 w-[28%]">
                        <button className="flex items-center gap-1 hover:text-accent" onClick={() => toggleSort('name')}>
                          Name {siSortField === 'name' ? (siSortDir === 'asc' ? '▲' : '▼') : <span className="text-gray-300">⇅</span>}
                        </button>
                      </th>
                      <th className="px-4 py-2.5 text-left font-semibold text-gray-600 w-[12%]">
                        <button className="flex items-center gap-1 hover:text-accent" onClick={() => toggleSort('item_type')}>
                          Type {siSortField === 'item_type' ? (siSortDir === 'asc' ? '▲' : '▼') : <span className="text-gray-300">⇅</span>}
                        </button>
                      </th>
                      <th className="px-4 py-2.5 text-left font-semibold text-gray-600 w-[18%]">
                        <button className="flex items-center gap-1 hover:text-accent" onClick={() => toggleSort('category_name')}>
                          Category {siSortField === 'category_name' ? (siSortDir === 'asc' ? '▲' : '▼') : <span className="text-gray-300">⇅</span>}
                        </button>
                      </th>
                      <th className="px-4 py-2.5 text-left font-semibold text-gray-600 w-[25%]">Linked To</th>
                      <th className="px-4 py-2.5 text-left font-semibold text-gray-600 w-[10%]">Markets</th>
                      <th className="px-4 py-2.5 w-[7%]" />
                    </tr>
                  </thead>
                  <tbody>
                    {nonComboItems.map(si => {
                      const mkt = marketsDisplay(si)
                      return (
                        <tr key={si.id}
                          className={`border-b border-gray-100 hover:bg-gray-50 group cursor-pointer ${selectedSiId === si.id ? 'bg-accent-dim/20' : ''}`}
                          onClick={() => setSelectedSiId(si.id)}>
                          <td className="px-4 py-2.5 font-medium text-gray-900">{si.name}</td>
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
                            <div className="flex items-center gap-1.5">
                              <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                <button className="text-red-400 hover:text-red-600 px-1 text-base leading-none" title="Delete" onClick={() => setDeleting(si)}>⊘</button>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>{/* end left scroll area */}

          {selectedSiId !== null && (() => {
            const si = salesItems.find(s => s.id === selectedSiId)
            if (!si) return null
            const panelMgGroups    = siMgData[selectedSiId] ?? []
            const panelMgIsLoading = siMgLoading.has(selectedSiId)
            const mkt = marketsDisplay(si)
            const unassignedMgs = modifierGroups.filter(mg => !panelMgGroups.some(a => a.modifier_group_id === mg.id))
            return (
              <div className="w-80 flex-shrink-0 border-l border-border bg-white flex flex-col">
                {/* Panel header */}
                <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                  <span className="font-semibold text-text-1 text-sm truncate flex-1 min-w-0">{si.name}</span>
                  <button className="ml-2 text-text-3 hover:text-text-1 flex-shrink-0" onClick={() => setSelectedSiId(null)} title="Close">✕</button>
                </div>
                {/* Panel body */}
                <div className="flex-1 overflow-y-auto p-4 space-y-4">
                  {/* Type + category */}
                  <div className="flex flex-wrap gap-2 items-center">
                    <span className={`text-xs px-2 py-0.5 rounded font-medium ${TYPE_BADGE[si.item_type]}`}>{TYPE_LABEL[si.item_type]}</span>
                    {si.category_name && <span className="text-xs text-text-2 bg-gray-100 px-2 py-0.5 rounded">{si.category_name}</span>}
                    <span className={`text-xs px-2 py-0.5 rounded font-medium ${mkt.color}`}>{mkt.label}</span>
                  </div>

                  {/* Linked item */}
                  {si.item_type === 'recipe' && si.recipe_name && (
                    <div>
                      <p className="text-xs font-medium text-text-3 uppercase tracking-wide mb-1">Recipe</p>
                      <p className="text-sm text-text-1">{si.recipe_name}</p>
                    </div>
                  )}
                  {si.item_type === 'ingredient' && si.ingredient_name && (
                    <div>
                      <p className="text-xs font-medium text-text-3 uppercase tracking-wide mb-1">Ingredient</p>
                      <p className="text-sm text-text-1">{si.ingredient_name}</p>
                    </div>
                  )}
                  {si.item_type === 'combo' && si.combo_name && (
                    <div>
                      <p className="text-xs font-medium text-text-3 uppercase tracking-wide mb-1">Combo</p>
                      <p className="text-sm text-text-1">{si.combo_name}</p>
                    </div>
                  )}
                  {si.item_type === 'manual' && si.manual_cost != null && (
                    <div>
                      <p className="text-xs font-medium text-text-3 uppercase tracking-wide mb-1">Cost (USD)</p>
                      <p className="text-sm font-mono text-text-1">${Number(si.manual_cost).toFixed(4)}</p>
                    </div>
                  )}

                  {/* Modifier groups */}
                  <div>
                    <p className="text-xs font-medium text-text-3 uppercase tracking-wide mb-2">Modifier Groups</p>
                    {!siMgData[selectedSiId] && !panelMgIsLoading && (
                      <button className="text-xs text-accent hover:underline" onClick={() => toggleSiMg(selectedSiId)}>Load modifier groups</button>
                    )}
                    {panelMgIsLoading && <span className="text-xs text-text-3">Loading…</span>}
                    {siMgData[selectedSiId] && (
                      <div className="flex flex-wrap gap-1.5">
                        {panelMgGroups.length === 0 && <span className="text-xs text-text-3 italic">None assigned</span>}
                        {panelMgGroups.map(mg => (
                          <span key={mg.modifier_group_id}
                            className="inline-flex items-center gap-1 text-xs bg-blue-100 text-blue-800 border border-blue-200 px-2 py-0.5 rounded-full">
                            {mg.name}
                            <button className="ml-0.5 text-blue-400 hover:text-blue-700 font-bold leading-none" title={`Remove ${mg.name}`}
                              onClick={() => removeSiModifier(selectedSiId, mg.modifier_group_id)}>×</button>
                          </span>
                        ))}
                        {/* Add modifier dropdown */}
                        {unassignedMgs.length > 0 && (
                          <div className="relative inline-block">
                            <button
                              className="text-xs px-2 py-0.5 rounded-full border border-dashed border-accent text-accent hover:bg-accent-dim transition-colors"
                              onClick={e => {
                                const rect = (e.currentTarget as HTMLButtonElement).getBoundingClientRect()
                                setSiMgAddPos({ top: rect.bottom + 4, left: rect.left })
                                setSiMgAddOpen(siMgAddOpen === selectedSiId ? null : selectedSiId)
                              }}
                            >+ Add</button>
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
                      </div>
                    )}
                  </div>
                </div>

                {/* Panel footer actions */}
                <div className="px-4 py-3 border-t border-border flex gap-2">
                  <button className="btn btn-sm btn-primary flex-1"
                    onClick={() => { setSiModal(si as SalesItem); setNewComboMode(false) }}>
                    Edit
                  </button>
                  <button className="btn btn-sm btn-danger"
                    onClick={() => { setDeleting(si as SalesItem); setSelectedSiId(null) }}>
                    Delete
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
                    <button className="btn btn-sm btn-outline" onClick={() => setComboModal(comboDetail)}>Edit</button>
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
                    {(comboDetail.steps || []).map(step => (
                      <div key={step.id} className="border border-gray-200 rounded">
                        {/* Step header row */}
                        <div className="flex items-center justify-between px-3 py-2 cursor-pointer bg-gray-50 hover:bg-gray-100"
                          onClick={() => setExpandedStep(expandedStep === step.id ? null : step.id)}>
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-xs text-gray-400">{expandedStep === step.id ? '▼' : '▶'}</span>
                            <span className="text-sm font-medium text-gray-800">{step.name}</span>
                            <span className="text-xs text-gray-400">({(step.options || []).length} option{(step.options || []).length !== 1 ? 's' : ''})</span>
                            {/* Min/max/repeat summary badges */}
                            <span className="text-xs bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded" title="Min choices">min {step.min_select ?? 1}</span>
                            <span className="text-xs bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded" title="Max choices">max {step.max_select ?? 1}</span>
                            {step.allow_repeat && <span className="text-xs bg-amber-50 text-amber-600 px-1.5 py-0.5 rounded" title="Same option can be chosen multiple times">repeat ✓</span>}
                            {step.auto_select && <span className="text-xs bg-green-50 text-green-600 px-1.5 py-0.5 rounded" title="Option is auto-selected">auto ✓</span>}
                          </div>
                          <div className="flex gap-1" onClick={e => e.stopPropagation()}>
                            <button className="btn btn-xs btn-outline" title="Step settings"
                              onClick={() => { startEditStep(step); setExpandedStep(step.id) }}>⚙</button>
                            <button className="btn btn-xs btn-primary" onClick={() => { addOption(step.id); setExpandedStep(step.id) }}>+ Option</button>
                            <button className="btn btn-xs btn-danger" onClick={() => deleteComboStep(step.id)}>×</button>
                          </div>
                        </div>

                        {/* Step settings inline editor */}
                        {editingStep === step.id && editStepForm && (
                          <div className="px-4 py-3 bg-blue-50 border-b border-blue-100 flex flex-wrap items-center gap-4"
                            onClick={e => e.stopPropagation()}>
                            <div className="flex items-center gap-1.5">
                              <label className="text-xs font-medium text-gray-600 whitespace-nowrap">Display name</label>
                              <input className="input py-0.5 text-sm w-40" placeholder="Customer-facing name…"
                                value={editStepForm.display_name ?? ''}
                                onChange={e => setEditStepForm(f => f ? { ...f, display_name: e.target.value || null } : f)} />
                            </div>
                            <div className="flex items-center gap-1.5">
                              <label className="text-xs font-medium text-gray-600 whitespace-nowrap">Min choices</label>
                              <input type="number" min="0" className="input py-0.5 w-16 text-sm"
                                value={editStepForm.min_select}
                                onChange={e => setEditStepForm(f => f ? { ...f, min_select: Math.max(0, Number(e.target.value)) } : f)} />
                            </div>
                            <div className="flex items-center gap-1.5">
                              <label className="text-xs font-medium text-gray-600 whitespace-nowrap">Max choices</label>
                              <input type="number" min="1" className="input py-0.5 w-16 text-sm"
                                value={editStepForm.max_select}
                                onChange={e => setEditStepForm(f => f ? { ...f, max_select: Math.max(1, Number(e.target.value)) } : f)} />
                            </div>
                            <label className="flex items-center gap-1.5 text-xs font-medium text-gray-600 cursor-pointer select-none">
                              <input type="checkbox" checked={editStepForm.allow_repeat}
                                onChange={e => setEditStepForm(f => f ? { ...f, allow_repeat: e.target.checked } : f)} />
                              Allow same option multiple times
                            </label>
                            {(step.options || []).length === 1 && (
                              <label className="flex items-center gap-1.5 text-xs font-medium text-gray-600 cursor-pointer select-none">
                                <input type="checkbox" checked={editStepForm.auto_select}
                                  onChange={e => setEditStepForm(f => f ? { ...f, auto_select: e.target.checked } : f)} />
                                Auto-select this option
                              </label>
                            )}
                            <div className="flex gap-1.5 ml-auto">
                              <button className="btn btn-xs btn-primary" disabled={savingStep} onClick={() => saveStepSettings(step.id)}>
                                {savingStep ? '…' : 'Save'}
                              </button>
                              <button className="btn btn-xs btn-ghost" onClick={() => { setEditingStep(null); setEditStepForm(null) }}>Cancel</button>
                            </div>
                          </div>
                        )}

                        {/* Options list */}
                        {expandedStep === step.id && (
                          <div className="p-2 space-y-1">
                            {(step.options || []).length === 0 && <p className="text-xs text-gray-400 px-1">No options yet.</p>}
                            {(step.options || []).map(opt => (
                              <div key={opt.id} className="flex items-center gap-2 px-2 py-1.5 text-sm rounded hover:bg-gray-50">
                                <span className={`text-xs px-1.5 py-0.5 rounded shrink-0 ${TYPE_BADGE[opt.item_type]}`}>{TYPE_LABEL[opt.item_type]}</span>
                                <span className="font-medium text-gray-800">{opt.name}</span>
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
                                {/* Modifier group badges */}
                                {(opt.modifier_groups || []).length > 0 && (
                                  <div className="flex flex-wrap gap-1 ml-1">
                                    {(opt.modifier_groups || []).map(mg => (
                                      <span key={mg.modifier_group_id} className="text-xs bg-purple-50 text-purple-600 border border-purple-200 px-1.5 py-0.5 rounded" title="Modifier group">
                                        {mg.name}
                                      </span>
                                    ))}
                                  </div>
                                )}
                                <div className="flex gap-1 shrink-0">
                                  <button className="btn btn-xs btn-outline" onClick={() => { setEditingOpt(opt); setEditingOptStepId(step.id) }}>✎</button>
                                  <button className="text-xs text-red-400 hover:text-red-600 px-1" onClick={() => deleteOption(step.id, opt.id)}>×</button>
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

          </div>{/* end flex flex-1 min-h-0 wrapper */}
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
              <input className="input flex-1" placeholder="Display name (optional)" value={newMgForm.display_name}
                onChange={e => setNewMgForm(f => ({ ...f, display_name: e.target.value }))} />
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
                        <input className="input input-sm w-40" placeholder="Display name (optional)" value={editMg.display_name ?? ''} onChange={e => setEditMg(m => m ? { ...m, display_name: e.target.value || null } : m)} />
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
                      <button className="btn btn-xs btn-outline" title="Duplicate this modifier group and all its options" onClick={() => duplicateMg(g)}>⧉ Duplicate</button>
                      <button className="btn btn-xs btn-danger" onClick={() => deleteMg(g)}>Delete</button>
                    </div>
                  )}
                </div>
                {expandedMgId === g.id && (
                  <div className="border-t border-border">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-surface-2 border-b border-border text-xs text-text-3 uppercase tracking-wide">
                          <th className="px-3 py-2 text-left font-semibold">Name</th>
                          <th className="px-3 py-2 text-left font-semibold">Type</th>
                          <th className="px-3 py-2 text-left font-semibold">Linked Item</th>
                          <th className="px-3 py-2 w-16"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {(expandedOptions[g.id] || []).length === 0 && editingOption?.groupId !== g.id && (
                          <tr><td colSpan={4} className="px-3 py-3 text-xs text-text-3 text-center italic">No options yet — add one below.</td></tr>
                        )}
                        {(expandedOptions[g.id] || []).map(opt => {
                          const isEditingThis = editingOption?.groupId === g.id && editingOption?.optId === opt.id
                          if (isEditingThis) {
                            const ef = editingOption!.form
                            return (
                              <tr key={opt.id} className="border-b border-border bg-accent-dim/20">
                                <td className="px-2 py-1.5">
                                  <input className="input input-sm w-full" value={ef.name}
                                    onChange={e => setEditingOption(eo => eo ? { ...eo, form: { ...eo.form, name: e.target.value } } : eo)} />
                                </td>
                                <td className="px-2 py-1.5">
                                  <select className="input py-0.5 text-xs w-28" value={ef.item_type}
                                    onChange={e => setEditingOption(eo => eo ? { ...eo, form: { ...eo.form, item_type: e.target.value as 'recipe' | 'ingredient' | 'manual', recipe_id: null, ingredient_id: null } } : eo)}>
                                    <option value="manual">Manual</option>
                                    <option value="recipe">Recipe</option>
                                    <option value="ingredient">Ingredient</option>
                                  </select>
                                </td>
                                <td className="px-2 py-1.5">
                                  {ef.item_type === 'recipe' && (
                                    <select className="input py-0.5 text-xs w-full" value={ef.recipe_id ?? ''}
                                      onChange={e => setEditingOption(eo => eo ? { ...eo, form: { ...eo.form, recipe_id: Number(e.target.value) || null } } : eo)}>
                                      <option value="">— Select —</option>
                                      {recipes.slice(0, 200).map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                                    </select>
                                  )}
                                  {ef.item_type === 'ingredient' && (
                                    <select className="input py-0.5 text-xs w-full" value={ef.ingredient_id ?? ''}
                                      onChange={e => setEditingOption(eo => eo ? { ...eo, form: { ...eo.form, ingredient_id: Number(e.target.value) || null } } : eo)}>
                                      <option value="">— Select —</option>
                                      {ingredients.slice(0, 200).map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
                                    </select>
                                  )}
                                  {ef.item_type === 'manual' && <span className="text-xs text-text-3">—</span>}
                                </td>
                                <td className="px-2 py-1.5">
                                  <div className="flex gap-1">
                                    <button className="btn btn-xs btn-primary" onClick={saveOptEdit}>✓</button>
                                    <button className="btn btn-xs btn-ghost" onClick={() => setEditingOption(null)}>✕</button>
                                  </div>
                                </td>
                              </tr>
                            )
                          }
                          const recipeName     = opt.recipe_name     ?? recipes.find(r => r.id === opt.recipe_id)?.name
                          const ingredientName = opt.ingredient_name ?? ingredients.find(i => i.id === opt.ingredient_id)?.name
                          return (
                            <tr key={opt.id} className="border-b border-border last:border-0 hover:bg-surface-2/50">
                              <td className="px-3 py-2 font-medium text-text-1">{opt.name}</td>
                              <td className="px-3 py-2">
                                <span className={`text-xs px-1.5 py-0.5 rounded ${TYPE_BADGE[opt.item_type]}`}>{TYPE_LABEL[opt.item_type]}</span>
                              </td>
                              <td className="px-3 py-2 text-xs text-text-2">
                                {opt.item_type === 'recipe' && (
                                  recipeName
                                    ? <span className="flex items-center gap-1.5">
                                        <span>{recipeName}</span>
                                        {opt.recipe_yield_qty != null && (
                                          <span className="text-text-3 font-mono">
                                            · {Number(opt.recipe_yield_qty)}{opt.recipe_yield_unit_abbr ? ` ${opt.recipe_yield_unit_abbr}` : ' ptn'}
                                          </span>
                                        )}
                                      </span>
                                    : <span className="text-text-3">#{opt.recipe_id}</span>
                                )}
                                {opt.item_type === 'ingredient' && (
                                  ingredientName
                                    ? <span className="flex items-center gap-1.5">
                                        <span>{ingredientName}</span>
                                        {opt.ingredient_unit_abbr && (
                                          <span className="text-text-3 font-mono">· {opt.ingredient_unit_abbr}</span>
                                        )}
                                      </span>
                                    : <span className="text-text-3">#{opt.ingredient_id}</span>
                                )}
                                {opt.item_type === 'manual' && <span className="text-text-3">—</span>}
                              </td>
                              <td className="px-3 py-1.5">
                                <div className="flex gap-1 justify-end">
                                  <button
                                    className="w-6 h-6 flex items-center justify-center rounded border border-border text-text-3 hover:border-accent hover:text-accent transition-colors text-xs"
                                    title="Edit"
                                    onClick={() => setEditingOption({ groupId: g.id, optId: opt.id, form: { name: opt.name, item_type: opt.item_type, recipe_id: opt.recipe_id, ingredient_id: opt.ingredient_id } })}
                                  >✎</button>
                                  <button
                                    className="w-6 h-6 flex items-center justify-center rounded border border-red-200 text-red-400 hover:bg-red-50 transition-colors text-xs"
                                    title="Delete"
                                    onClick={() => deleteMgOption(g.id, opt.id)}
                                  >×</button>
                                </div>
                              </td>
                            </tr>
                          )
                        })}
                        <ModifierOptionAddForm recipes={recipes} ingredients={ingredients} onAdd={opt => addMgOption(g.id, opt)} />
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Modals ─────────────────────────────────────────────────────────────── */}

      {/* Sales Item create/edit */}
      {siModal !== null && (
        <SalesItemModal
          mode={siModal === 'new' ? 'new' : 'edit'}
          initial={siModal === 'new' ? null : siModal as SalesItem}
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

      {/* Combo create/edit modal */}
      {comboModal !== null && (
        <ComboFormModal
          mode={comboModal === 'new' ? 'new' : 'edit'}
          initial={comboModal === 'new' ? null : comboModal as Combo}
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

      {editingOpt && (
        <ComboOptionForm opt={editingOpt} modifierGroups={modifierGroups} recipes={recipes} ingredients={ingredients} salesItems={salesItems}
          onSave={saveOption} onClose={() => setEditingOpt(null)} />
      )}

      {toast && <Toast message={toast.msg} onClose={() => setToast(null)} />}
    </div>
  )
}
