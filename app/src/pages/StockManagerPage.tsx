import { useState, useEffect, useCallback, useMemo } from 'react'
import { useApi } from '../hooks/useApi'
import { usePermissions } from '../hooks/usePermissions'
import { Modal, Field, Spinner, ConfirmDialog } from '../components/ui'

// ── Types ─────────────────────────────────────────────────────────────────────
type ApiType = {
  get: (path: string) => Promise<any>
  post: (path: string, body?: any) => Promise<any>
  put: (path: string, body?: any) => Promise<any>
  patch: (path: string, body?: any) => Promise<any>
  delete: (path: string) => Promise<any>
}

interface Store {
  id: number; location_id: number; name: string; code: string | null
  store_type: string | null; is_store_itself: boolean; is_active: boolean
  notes: string | null; sort_order: number
  location_name?: string; country_name?: string
}

interface StockLevel {
  id: number; store_id: number; ingredient_id: number
  qty_on_hand: number; min_stock_level: number | null; max_stock_level: number | null
  ingredient_name?: string; category_name?: string
  base_unit_abbr?: string; updated_at: string
}

interface StockMovement {
  id: number; store_id: number; ingredient_id: number; movement_type: string
  quantity: number; unit_cost: number | null; reference_type: string | null
  reference_id: number | null; notes: string | null; created_by: string | null
  created_at: string; ingredient_name?: string; store_name?: string
}

interface PurchaseOrder {
  id: number; store_id: number; vendor_id: number; po_number: string
  status: 'draft' | 'submitted' | 'partial' | 'received' | 'cancelled'
  order_date: string; expected_date: string | null; notes: string | null
  template_id: number | null; created_by: string | null; item_count?: number
  store_name?: string; vendor_name?: string; location_name?: string
}

interface POItem {
  id: number; po_id: number; ingredient_id: number; quote_id: number | null
  qty_ordered: number; qty_received: number; unit_price: number
  purchase_unit: string | null; qty_in_base_units: number | null; sort_order: number
  ingredient_name?: string; base_unit_abbr?: string
}

interface GoodsReceived {
  id: number; store_id: number; po_id: number | null; vendor_id: number
  grn_number: string; status: 'draft' | 'confirmed'; received_date: string
  notes: string | null; created_by: string | null; item_count?: number
  store_name?: string; vendor_name?: string; po_number?: string
}

interface GRNItem {
  id: number; grn_id: number; ingredient_id: number; po_item_id: number | null
  qty_received: number; unit_price: number; purchase_unit: string | null
  qty_in_base_units: number | null; sort_order: number
  ingredient_name?: string; base_unit_abbr?: string
}

interface Invoice {
  id: number; store_id: number; vendor_id: number; grn_id: number | null
  invoice_number: string; status: 'draft' | 'pending' | 'approved' | 'paid' | 'disputed'
  invoice_date: string; due_date: string | null; subtotal: number
  tax_amount: number; total: number; currency_code: string | null
  notes: string | null; item_count?: number
  store_name?: string; vendor_name?: string
}

interface InvoiceItem {
  id: number; invoice_id: number; ingredient_id: number | null
  description: string | null; quantity: number; unit_price: number
  line_total: number; sort_order: number; ingredient_name?: string
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
interface _CreditNote {
  id: number; store_id: number; vendor_id: number; invoice_id: number | null
  grn_id: number | null; credit_number: string
  status: 'draft' | 'submitted' | 'approved' | 'applied'
  credit_date: string; reason: string | null; total: number
  store_name?: string; vendor_name?: string
}

interface WasteEntry {
  id: number; store_id: number; ingredient_id: number; reason_code_id: number | null
  quantity: number; unit_cost: number | null; waste_date: string
  notes: string | null; created_by: string | null; created_at: string
  ingredient_name?: string; store_name?: string; reason_name?: string
}

interface WasteReasonCode {
  id: number; name: string; description: string | null; is_active: boolean; sort_order: number
}

interface Transfer {
  id: number; from_store_id: number; to_store_id: number; transfer_number: string
  status: 'pending' | 'in_transit' | 'confirmed' | 'cancelled'
  transfer_date: string; notes: string | null; created_by: string | null
  confirmed_by: string | null; confirmed_at: string | null
  from_store_name?: string; to_store_name?: string; item_count?: number
}

interface TransferItem {
  id: number; transfer_id: number; ingredient_id: number
  qty_sent: number; qty_received: number | null; sort_order: number
  ingredient_name?: string; base_unit_abbr?: string
}

interface Stocktake {
  id: number; store_id: number; stocktake_type: 'full' | 'spot_check'
  status: 'in_progress' | 'completed' | 'approved'
  started_at: string; completed_at: string | null; approved_by: string | null
  notes: string | null; created_by: string | null
  store_name?: string; item_count?: number; variance_count?: number
}

interface StocktakeItem {
  id: number; stocktake_id: number; ingredient_id: number
  expected_qty: number | null; counted_qty: number | null; variance: number | null
  notes: string | null; counted_by: string | null; counted_at: string | null
  ingredient_name?: string; base_unit_abbr?: string
}

interface Location { id: number; name: string; country_name?: string; is_active: boolean }
interface IngredientRef { id: number; name: string; category_name?: string; base_unit_abbr?: string }
interface VendorRef { id: number; name: string; country_name?: string }

// ── Shared helpers ────────────────────────────────────────────────────────────
function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    draft: 'bg-gray-100 text-gray-600',
    pending: 'bg-yellow-50 text-yellow-700',
    submitted: 'bg-blue-50 text-blue-700',
    partial: 'bg-orange-50 text-orange-700',
    received: 'bg-green-50 text-green-700',
    confirmed: 'bg-green-50 text-green-700',
    approved: 'bg-green-50 text-green-700',
    paid: 'bg-emerald-50 text-emerald-700',
    cancelled: 'bg-red-50 text-red-600',
    disputed: 'bg-red-50 text-red-600',
    in_progress: 'bg-blue-50 text-blue-700',
    in_transit: 'bg-blue-50 text-blue-700',
    completed: 'bg-green-50 text-green-700',
    applied: 'bg-emerald-50 text-emerald-700',
  }
  return (
    <span className={`text-xs font-medium px-2 py-0.5 rounded-full whitespace-nowrap ${colors[status] || 'bg-gray-100 text-gray-600'}`}>
      {status.replace(/_/g, ' ')}
    </span>
  )
}

function StockStatusBadge({ qty, min }: { qty: number; min: number | null }) {
  if (qty <= 0) return <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-red-50 text-red-600">Out</span>
  if (min != null && qty < min) return <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-yellow-50 text-yellow-700">Low</span>
  return <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-green-50 text-green-700">OK</span>
}

function fmtDate(d: string | null | undefined) {
  if (!d) return '-'
  try { return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) } catch { return d }
}

function fmtNum(n: number | null | undefined, decimals = 2) {
  if (n == null) return '-'
  return Number(n).toFixed(decimals)
}

const TrashIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
    <path d="M10 11v6" /><path d="M14 11v6" /><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2" />
  </svg>
)

// ── Searchable dropdown helper ────────────────────────────────────────────────
function SearchSelect<T extends { id: number; name: string }>({ items, value, onChange, placeholder, renderSecondary }: {
  items: T[]; value: number | null; onChange: (id: number | null, item: T | null) => void
  placeholder?: string; renderSecondary?: (item: T) => string | null
}) {
  const [search, setSearch] = useState(() => {
    const found = items.find(i => i.id === value)
    return found ? found.name : ''
  })
  const [open, setOpen] = useState(false)
  const filtered = useMemo(() => items.filter(i => i.name.toLowerCase().includes(search.toLowerCase())).slice(0, 50), [items, search])

  useEffect(() => {
    const found = items.find(i => i.id === value)
    setSearch(found ? found.name : '')
  }, [value, items])

  return (
    <div className="relative">
      <input className="input w-full" placeholder={placeholder || 'Search...'} value={search}
        onChange={e => { setSearch(e.target.value); setOpen(true); if (!e.target.value) onChange(null, null) }}
        onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)} autoComplete="off" />
      {open && (
        <div className="absolute top-full left-0 right-0 z-50 bg-white border border-gray-200 rounded-lg shadow-lg mt-0.5 max-h-52 overflow-y-auto">
          {filtered.length === 0
            ? <div className="px-3 py-2 text-sm text-gray-400 italic">No results</div>
            : filtered.map(item => (
                <button key={item.id} type="button"
                  className={`w-full text-left px-3 py-2 text-sm hover:bg-accent-dim flex items-center gap-2 ${value === item.id ? 'bg-accent-dim font-medium text-accent' : 'text-gray-800'}`}
                  onMouseDown={e => e.preventDefault()}
                  onClick={() => { onChange(item.id, item); setSearch(item.name); setOpen(false) }}>
                  {value === item.id && <span className="text-accent text-xs">&#10003;</span>}
                  <span>{item.name}</span>
                  {renderSecondary && renderSecondary(item) && (
                    <span className="ml-auto text-xs text-gray-400 shrink-0">{renderSecondary(item)}</span>
                  )}
                </button>
              ))}
        </div>
      )}
    </div>
  )
}

// ── Empty state ───────────────────────────────────────────────────────────────
function EmptyPanel({ message, action }: { message: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center p-8">
      <p className="text-sm text-text-3 mb-3">{message}</p>
      {action}
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════════
// OverviewTab
// ════════════════════════════════════════════════════════════════════════════════
function OverviewTab({ storeId, api, stores }: { storeId: number | null; api: ApiType; stores: Store[] }) {
  const [levels, setLevels] = useState<StockLevel[]>([])
  const [movements, setMovements] = useState<StockMovement[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const q = storeId ? `?store_id=${storeId}` : ''
      const [lv, mv] = await Promise.all([
        api.get(`/stock-levels${q}`),
        api.get(`/stock-levels/movements${q}&limit=20`.replace('movements&', `movements${q ? '&' : '?'}limit=20`.replace(q + '&', q + '&'))),
      ].map(p => p.catch(() => [])))
      setLevels(lv || [])
      setMovements(mv || [])
    } finally { setLoading(false) }
  }, [api, storeId])

  useEffect(() => { load() }, [load])

  const lowStock = useMemo(() => levels.filter(l => l.min_stock_level != null && l.qty_on_hand < l.min_stock_level), [levels])
  const outOfStock = useMemo(() => levels.filter(l => l.qty_on_hand <= 0), [levels])

  if (loading) return <div className="flex items-center justify-center h-64"><Spinner /></div>

  return (
    <div className="p-6 overflow-y-auto h-full space-y-6">
      {/* KPI cards */}
      <div className="grid grid-cols-4 gap-4">
        <div className="card p-4">
          <div className="text-xs text-text-3 font-medium uppercase tracking-wide">Total Items</div>
          <div className="text-2xl font-bold text-text-1 mt-1">{levels.length}</div>
        </div>
        <div className="card p-4">
          <div className="text-xs text-text-3 font-medium uppercase tracking-wide">Low Stock</div>
          <div className="text-2xl font-bold text-yellow-600 mt-1">{lowStock.length}</div>
        </div>
        <div className="card p-4">
          <div className="text-xs text-text-3 font-medium uppercase tracking-wide">Out of Stock</div>
          <div className="text-2xl font-bold text-red-600 mt-1">{outOfStock.length}</div>
        </div>
        <div className="card p-4">
          <div className="text-xs text-text-3 font-medium uppercase tracking-wide">Stores</div>
          <div className="text-2xl font-bold text-text-1 mt-1">{stores.filter(s => s.is_active).length}</div>
        </div>
      </div>

      {/* Low stock alerts */}
      {lowStock.length > 0 && (
        <div className="card p-4">
          <h3 className="text-sm font-bold text-text-1 mb-3">Low Stock Alerts</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs text-text-3 uppercase tracking-wide border-b border-border">
                <th className="pb-2 pr-4">Ingredient</th><th className="pb-2 pr-4">Category</th>
                <th className="pb-2 pr-4 text-right">On Hand</th><th className="pb-2 pr-4 text-right">Min Level</th>
                <th className="pb-2">Unit</th><th className="pb-2">Status</th>
              </tr></thead>
              <tbody>
                {lowStock.slice(0, 20).map(l => (
                  <tr key={l.id} className="border-b border-border/50 hover:bg-surface-2">
                    <td className="py-2 pr-4 font-medium">{l.ingredient_name}</td>
                    <td className="py-2 pr-4 text-text-3">{l.category_name || '-'}</td>
                    <td className="py-2 pr-4 text-right">{fmtNum(l.qty_on_hand)}</td>
                    <td className="py-2 pr-4 text-right">{fmtNum(l.min_stock_level)}</td>
                    <td className="py-2">{l.base_unit_abbr || '-'}</td>
                    <td className="py-2"><StockStatusBadge qty={l.qty_on_hand} min={l.min_stock_level} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Stock levels grid */}
      <div className="card p-4">
        <h3 className="text-sm font-bold text-text-1 mb-3">Stock Levels {storeId ? `- ${stores.find(s => s.id === storeId)?.name || ''}` : '- All Stores'}</h3>
        {levels.length === 0 ? (
          <p className="text-sm text-text-3 py-4 text-center">No stock levels recorded yet.</p>
        ) : (
          <div className="overflow-x-auto max-h-[400px] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-white z-10"><tr className="text-left text-xs text-text-3 uppercase tracking-wide border-b border-border">
                <th className="pb-2 pr-4">Ingredient</th><th className="pb-2 pr-4">Category</th>
                <th className="pb-2 pr-4 text-right">Qty On Hand</th><th className="pb-2 pr-4">Unit</th>
                <th className="pb-2 pr-4 text-right">Min</th><th className="pb-2 pr-4 text-right">Max</th>
                <th className="pb-2">Status</th>
              </tr></thead>
              <tbody>
                {levels.map(l => (
                  <tr key={l.id} className="border-b border-border/50 hover:bg-surface-2">
                    <td className="py-2 pr-4 font-medium">{l.ingredient_name}</td>
                    <td className="py-2 pr-4 text-text-3">{l.category_name || '-'}</td>
                    <td className="py-2 pr-4 text-right">{fmtNum(l.qty_on_hand)}</td>
                    <td className="py-2 pr-4">{l.base_unit_abbr || '-'}</td>
                    <td className="py-2 pr-4 text-right">{fmtNum(l.min_stock_level)}</td>
                    <td className="py-2 pr-4 text-right">{fmtNum(l.max_stock_level)}</td>
                    <td className="py-2"><StockStatusBadge qty={l.qty_on_hand} min={l.min_stock_level} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Recent movements */}
      <div className="card p-4">
        <h3 className="text-sm font-bold text-text-1 mb-3">Recent Movements</h3>
        {movements.length === 0 ? (
          <p className="text-sm text-text-3 py-4 text-center">No movements recorded yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs text-text-3 uppercase tracking-wide border-b border-border">
                <th className="pb-2 pr-4">Date</th><th className="pb-2 pr-4">Ingredient</th>
                <th className="pb-2 pr-4">Type</th><th className="pb-2 pr-4 text-right">Qty</th>
                <th className="pb-2 pr-4">Store</th><th className="pb-2">Notes</th>
              </tr></thead>
              <tbody>
                {movements.map(m => (
                  <tr key={m.id} className="border-b border-border/50 hover:bg-surface-2">
                    <td className="py-2 pr-4 text-text-3 whitespace-nowrap">{fmtDate(m.created_at)}</td>
                    <td className="py-2 pr-4 font-medium">{m.ingredient_name}</td>
                    <td className="py-2 pr-4"><StatusBadge status={m.movement_type} /></td>
                    <td className="py-2 pr-4 text-right">{fmtNum(m.quantity)}</td>
                    <td className="py-2 pr-4">{m.store_name || '-'}</td>
                    <td className="py-2 text-text-3 truncate max-w-[200px]">{m.notes || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════════
// StoresTab
// ════════════════════════════════════════════════════════════════════════════════
function StoresTab({ api, locations, canWrite, showToast, onStoresChange }: {
  api: ApiType; locations: Location[]; canWrite: boolean
  showToast: (msg: string, type?: 'success' | 'error') => void; onStoresChange: () => void
}) {
  const [stores, setStores] = useState<Store[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedLocationId, setSelectedLocationId] = useState<number | null>(null)
  const [selectedStore, setSelectedStore] = useState<Store | null>(null)
  const [showModal, setShowModal] = useState(false)
  const [editStore, setEditStore] = useState<Store | null>(null)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState<Store | null>(null)
  const [checked, setChecked] = useState<Set<number>>(new Set())

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await api.get('/stock-stores')
      setStores(data || [])
    } finally { setLoading(false) }
  }, [api])

  useEffect(() => { load() }, [load])

  const storesByLocation = useMemo(() => {
    const map = new Map<number, Store[]>()
    for (const s of stores) {
      const arr = map.get(s.location_id) || []
      arr.push(s)
      map.set(s.location_id, arr)
    }
    return map
  }, [stores])

  const visibleStores = useMemo(() => {
    if (!selectedLocationId) return stores
    return stores.filter(s => s.location_id === selectedLocationId)
  }, [stores, selectedLocationId])

  const [form, setForm] = useState({ name: '', code: '', store_type: '', is_store_itself: false, is_active: true, notes: '', sort_order: 0, location_id: '' as string })

  const openNew = () => {
    setForm({ name: '', code: '', store_type: '', is_store_itself: false, is_active: true, notes: '', sort_order: 0, location_id: selectedLocationId ? String(selectedLocationId) : '' })
    setEditStore(null)
    setShowModal(true)
  }

  const openEdit = (s: Store) => {
    setForm({
      name: s.name, code: s.code || '', store_type: s.store_type || '',
      is_store_itself: s.is_store_itself, is_active: s.is_active,
      notes: s.notes || '', sort_order: s.sort_order, location_id: String(s.location_id),
    })
    setEditStore(s)
    setShowModal(true)
  }

  const handleSave = async () => {
    if (!form.name.trim() || !form.location_id) return
    setSaving(true)
    try {
      const payload = {
        ...form, name: form.name.trim(), code: form.code.trim() || null,
        store_type: form.store_type.trim() || null, notes: form.notes.trim() || null,
        location_id: Number(form.location_id),
      }
      if (editStore) {
        await api.put(`/stock-stores/${editStore.id}`, payload)
        showToast('Store updated')
      } else {
        await api.post('/stock-stores', payload)
        showToast('Store created')
      }
      setShowModal(false)
      load()
      onStoresChange()
    } catch (err: any) {
      showToast(err.message || 'Failed to save store', 'error')
    } finally { setSaving(false) }
  }

  const handleDelete = async () => {
    if (!deleting) return
    try {
      await api.delete(`/stock-stores/${deleting.id}`)
      showToast('Store deleted')
      if (selectedStore?.id === deleting.id) setSelectedStore(null)
      setDeleting(null)
      load()
      onStoresChange()
    } catch (err: any) { showToast(err.message || 'Failed to delete', 'error') }
  }

  const handleBulkDelete = async () => {
    if (checked.size === 0) return
    try {
      await Promise.all([...checked].map(id => api.delete(`/stock-stores/${id}`)))
      showToast(`${checked.size} store(s) deleted`)
      setChecked(new Set())
      load()
      onStoresChange()
    } catch (err: any) { showToast(err.message || 'Bulk delete failed', 'error') }
  }

  const toggleCheck = (id: number) => setChecked(prev => {
    const next = new Set(prev)
    next.has(id) ? next.delete(id) : next.add(id)
    return next
  })

  if (loading) return <div className="flex items-center justify-center h-64"><Spinner /></div>

  return (
    <div className="flex h-full">
      {/* Left - locations */}
      <div className="w-56 border-r border-border overflow-y-auto shrink-0 bg-surface">
        <div className="p-3 border-b border-border">
          <h3 className="text-xs font-bold text-text-3 uppercase tracking-wide">Locations</h3>
        </div>
        <button onClick={() => setSelectedLocationId(null)}
          className={`w-full text-left px-3 py-2 text-sm hover:bg-accent-dim transition-colors ${!selectedLocationId ? 'bg-accent-dim text-accent font-medium' : 'text-text-1'}`}>
          All Locations ({stores.length})
        </button>
        {locations.map(loc => (
          <button key={loc.id} onClick={() => setSelectedLocationId(loc.id)}
            className={`w-full text-left px-3 py-2 text-sm hover:bg-accent-dim transition-colors ${selectedLocationId === loc.id ? 'bg-accent-dim text-accent font-medium' : 'text-text-1'}`}>
            {loc.name}
            <span className="ml-1 text-xs text-text-3">({storesByLocation.get(loc.id)?.length || 0})</span>
          </button>
        ))}
      </div>

      {/* Centre - store list */}
      <div className="flex-1 min-w-0 flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-surface shrink-0">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-bold text-text-1">Stores</h3>
            <span className="text-xs text-text-3">({visibleStores.length})</span>
          </div>
          <div className="flex items-center gap-2">
            {checked.size > 0 && canWrite && (
              <button className="btn btn-sm bg-red-600 text-white hover:bg-red-700" onClick={handleBulkDelete}>
                Delete {checked.size} selected
              </button>
            )}
            {canWrite && (
              <button className="btn btn-sm btn-primary" onClick={openNew}>+ New Store</button>
            )}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {visibleStores.length === 0 ? (
            <EmptyPanel message="No stores found." action={canWrite ? <button className="btn btn-sm btn-primary" onClick={openNew}>+ New Store</button> : undefined} />
          ) : (
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-white z-10"><tr className="text-left text-xs text-text-3 uppercase tracking-wide border-b border-border">
                {canWrite && <th className="pl-4 py-2 w-8"><input type="checkbox" checked={checked.size === visibleStores.length && visibleStores.length > 0}
                  onChange={() => setChecked(checked.size === visibleStores.length ? new Set() : new Set(visibleStores.map(s => s.id)))} /></th>}
                <th className="py-2 px-3">Name</th><th className="py-2 px-3">Code</th>
                <th className="py-2 px-3">Type</th><th className="py-2 px-3">Location</th>
                <th className="py-2 px-3">Active</th>
                {canWrite && <th className="py-2 px-3 w-20">Actions</th>}
              </tr></thead>
              <tbody>
                {visibleStores.map(s => (
                  <tr key={s.id}
                    className={`border-b border-border/50 hover:bg-surface-2 cursor-pointer ${selectedStore?.id === s.id ? 'bg-accent-dim' : ''}`}
                    onClick={() => setSelectedStore(s)}>
                    {canWrite && <td className="pl-4 py-2" onClick={e => e.stopPropagation()}>
                      <input type="checkbox" checked={checked.has(s.id)} onChange={() => toggleCheck(s.id)} />
                    </td>}
                    <td className="py-2 px-3 font-medium">{s.name}</td>
                    <td className="py-2 px-3 text-text-3">{s.code || '-'}</td>
                    <td className="py-2 px-3 text-text-3">{s.store_type || '-'}</td>
                    <td className="py-2 px-3">{s.location_name || '-'}</td>
                    <td className="py-2 px-3">
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${s.is_active ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                        {s.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    {canWrite && <td className="py-2 px-3" onClick={e => e.stopPropagation()}>
                      <div className="flex items-center gap-1">
                        <button className="p-1 rounded hover:bg-gray-100 text-text-3 hover:text-accent" onClick={() => openEdit(s)} title="Edit">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
                        </button>
                        <button className="p-1 rounded hover:bg-gray-100 text-text-3 hover:text-red-500" onClick={() => setDeleting(s)} title="Delete">
                          <TrashIcon />
                        </button>
                      </div>
                    </td>}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Right - detail panel */}
      <div className="w-72 border-l border-border overflow-y-auto shrink-0 bg-surface">
        {selectedStore ? (
          <div className="p-4 space-y-4">
            <h3 className="text-sm font-bold text-text-1">{selectedStore.name}</h3>
            <div className="space-y-2 text-sm">
              <div><span className="text-text-3">Code:</span> <span className="font-medium">{selectedStore.code || '-'}</span></div>
              <div><span className="text-text-3">Type:</span> <span className="font-medium">{selectedStore.store_type || '-'}</span></div>
              <div><span className="text-text-3">Location:</span> <span className="font-medium">{selectedStore.location_name || '-'}</span></div>
              <div><span className="text-text-3">Country:</span> <span className="font-medium">{selectedStore.country_name || '-'}</span></div>
              <div><span className="text-text-3">Is Store Itself:</span> <span className="font-medium">{selectedStore.is_store_itself ? 'Yes' : 'No'}</span></div>
              <div><span className="text-text-3">Active:</span> <span className="font-medium">{selectedStore.is_active ? 'Yes' : 'No'}</span></div>
              {selectedStore.notes && <div><span className="text-text-3">Notes:</span><p className="text-text-2 mt-1">{selectedStore.notes}</p></div>}
            </div>
            {canWrite && (
              <div className="flex gap-2 pt-2 border-t border-border">
                <button className="btn btn-sm btn-outline flex-1" onClick={() => openEdit(selectedStore)}>Edit</button>
                <button className="btn btn-sm bg-red-600 text-white hover:bg-red-700" onClick={() => setDeleting(selectedStore)}>Delete</button>
              </div>
            )}
          </div>
        ) : (
          <EmptyPanel message="Select a store to view details." />
        )}
      </div>

      {/* Create/Edit modal */}
      {showModal && (
        <Modal title={editStore ? 'Edit Store' : 'New Store'} onClose={() => setShowModal(false)}>
          <div className="space-y-3">
            <Field label="Location *">
              <select className="input w-full" value={form.location_id} onChange={e => setForm(f => ({ ...f, location_id: e.target.value }))}>
                <option value="">Select location...</option>
                {locations.map(l => <option key={l.id} value={String(l.id)}>{l.name}</option>)}
              </select>
            </Field>
            <Field label="Store Name *">
              <input className="input w-full" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} autoFocus />
            </Field>
            <Field label="Code">
              <input className="input w-full" value={form.code} onChange={e => setForm(f => ({ ...f, code: e.target.value }))} placeholder="e.g. WH-01" />
            </Field>
            <Field label="Store Type">
              <select className="input w-full" value={form.store_type} onChange={e => setForm(f => ({ ...f, store_type: e.target.value }))}>
                <option value="">None</option>
                <option value="dry">Dry Storage</option>
                <option value="chilled">Chilled</option>
                <option value="frozen">Frozen</option>
                <option value="bar">Bar</option>
                <option value="kitchen">Kitchen</option>
              </select>
            </Field>
            <Field label="">
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input type="checkbox" checked={form.is_store_itself} onChange={e => setForm(f => ({ ...f, is_store_itself: e.target.checked }))} />
                Is store itself (this store represents the entire location)
              </label>
            </Field>
            <Field label="">
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input type="checkbox" checked={form.is_active} onChange={e => setForm(f => ({ ...f, is_active: e.target.checked }))} />
                Active
              </label>
            </Field>
            <Field label="Notes">
              <textarea className="input w-full" rows={2} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
            </Field>
          </div>
          <div className="flex justify-end gap-2 mt-4">
            <button className="btn btn-outline" onClick={() => setShowModal(false)}>Cancel</button>
            <button className="btn btn-primary" disabled={!form.name.trim() || !form.location_id || saving} onClick={handleSave}>
              {saving ? 'Saving...' : editStore ? 'Save' : 'Create'}
            </button>
          </div>
        </Modal>
      )}

      {/* Delete confirm */}
      {deleting && (
        <ConfirmDialog
          message={`Delete "${deleting.name}"? This will also remove all stock levels and movements for this store.`}
          onConfirm={handleDelete}
          onCancel={() => setDeleting(null)}
        />
      )}
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════════
// PurchaseOrdersTab
// ════════════════════════════════════════════════════════════════════════════════
function PurchaseOrdersTab({ api, stores, vendors, ingredients, storeId, canWrite, showToast }: {
  api: ApiType; stores: Store[]; vendors: VendorRef[]; ingredients: IngredientRef[]
  storeId: number | null; canWrite: boolean; showToast: (msg: string, type?: 'success' | 'error') => void
}) {
  const [orders, setOrders] = useState<PurchaseOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<PurchaseOrder | null>(null)
  const [items, setItems] = useState<POItem[]>([])
  const [checked, setChecked] = useState<Set<number>>(new Set())
  const [showModal, setShowModal] = useState(false)
  const [saving, setSaving] = useState(false)
  const [statusFilter, setStatusFilter] = useState('')
  const [vendorFilter, setVendorFilter] = useState('')
  const [showItemForm, setShowItemForm] = useState(false)
  const [editItem, setEditItem] = useState<POItem | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const q = storeId ? `?store_id=${storeId}` : ''
      const data = await api.get(`/purchase-orders${q}`)
      setOrders(data || [])
    } finally { setLoading(false) }
  }, [api, storeId])

  useEffect(() => { load() }, [load])

  const loadItems = useCallback(async (poId: number) => {
    try {
      const data = await api.get(`/purchase-orders/${poId}/items`)
      setItems(data || [])
    } catch { setItems([]) }
  }, [api])

  useEffect(() => {
    if (selected) loadItems(selected.id)
    else setItems([])
  }, [selected, loadItems])

  const filteredOrders = useMemo(() => {
    let result = orders
    if (statusFilter) result = result.filter(o => o.status === statusFilter)
    if (vendorFilter) result = result.filter(o => String(o.vendor_id) === vendorFilter)
    return result
  }, [orders, statusFilter, vendorFilter])

  // Form state for new PO
  const [newPO, setNewPO] = useState({ store_id: '', vendor_id: '', notes: '', expected_date: '' })

  const handleCreatePO = async () => {
    if (!newPO.store_id || !newPO.vendor_id) return
    setSaving(true)
    try {
      const created = await api.post('/purchase-orders', {
        store_id: Number(newPO.store_id), vendor_id: Number(newPO.vendor_id),
        notes: newPO.notes.trim() || null,
        expected_date: newPO.expected_date || null,
      })
      showToast('Purchase order created')
      setShowModal(false)
      await load()
      setSelected(created)
    } catch (err: any) { showToast(err.message || 'Failed to create PO', 'error') }
    finally { setSaving(false) }
  }

  const handleStatusChange = async (po: PurchaseOrder, newStatus: string) => {
    try {
      await api.patch(`/purchase-orders/${po.id}`, { status: newStatus })
      showToast(`PO ${po.po_number} updated to ${newStatus}`)
      load()
      if (selected?.id === po.id) setSelected({ ...po, status: newStatus as PurchaseOrder['status'] })
    } catch (err: any) { showToast(err.message || 'Failed to update status', 'error') }
  }

  // Item form
  const [itemForm, setItemForm] = useState({ ingredient_id: null as number | null, qty_ordered: '', unit_price: '', purchase_unit: '' })

  const handleSaveItem = async () => {
    if (!selected || !itemForm.ingredient_id || !itemForm.qty_ordered) return
    setSaving(true)
    try {
      const payload = {
        ingredient_id: itemForm.ingredient_id,
        qty_ordered: Number(itemForm.qty_ordered),
        unit_price: Number(itemForm.unit_price) || 0,
        purchase_unit: itemForm.purchase_unit.trim() || null,
      }
      if (editItem) {
        await api.put(`/purchase-orders/${selected.id}/items/${editItem.id}`, payload)
        showToast('Item updated')
      } else {
        await api.post(`/purchase-orders/${selected.id}/items`, payload)
        showToast('Item added')
      }
      setShowItemForm(false)
      setEditItem(null)
      setItemForm({ ingredient_id: null, qty_ordered: '', unit_price: '', purchase_unit: '' })
      loadItems(selected.id)
    } catch (err: any) { showToast(err.message || 'Failed to save item', 'error') }
    finally { setSaving(false) }
  }

  const handleDeleteItem = async (item: POItem) => {
    if (!selected) return
    try {
      await api.delete(`/purchase-orders/${selected.id}/items/${item.id}`)
      showToast('Item removed')
      loadItems(selected.id)
    } catch (err: any) { showToast(err.message || 'Failed to remove item', 'error') }
  }

  const handleBulkCancel = async () => {
    try {
      await Promise.all([...checked].map(id => api.patch(`/purchase-orders/${id}`, { status: 'cancelled' })))
      showToast(`${checked.size} order(s) cancelled`)
      setChecked(new Set())
      load()
    } catch (err: any) { showToast(err.message || 'Bulk action failed', 'error') }
  }

  const toggleCheck = (id: number) => setChecked(prev => {
    const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next
  })

  if (loading) return <div className="flex items-center justify-center h-64"><Spinner /></div>

  return (
    <div className="flex h-full">
      {/* Left - PO list */}
      <div className="w-72 border-r border-border flex flex-col shrink-0 bg-surface">
        <div className="p-3 border-b border-border space-y-2 shrink-0">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold text-text-3 uppercase tracking-wide">Purchase Orders</h3>
            {canWrite && <button className="btn btn-sm btn-primary text-xs py-1" onClick={() => {
              setNewPO({ store_id: storeId ? String(storeId) : '', vendor_id: '', notes: '', expected_date: '' })
              setShowModal(true)
            }}>+ New PO</button>}
          </div>
          <select className="input w-full text-xs py-1" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
            <option value="">All statuses</option>
            {['draft', 'submitted', 'partial', 'received', 'cancelled'].map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <select className="input w-full text-xs py-1" value={vendorFilter} onChange={e => setVendorFilter(e.target.value)}>
            <option value="">All vendors</option>
            {vendors.map(v => <option key={v.id} value={String(v.id)}>{v.name}</option>)}
          </select>
        </div>
        {checked.size > 0 && canWrite && (
          <div className="p-2 border-b border-border bg-yellow-50 shrink-0">
            <button className="btn btn-sm w-full bg-red-600 text-white hover:bg-red-700 text-xs" onClick={handleBulkCancel}>
              Cancel {checked.size} selected
            </button>
          </div>
        )}
        <div className="flex-1 overflow-y-auto">
          {filteredOrders.length === 0 ? (
            <EmptyPanel message="No purchase orders." />
          ) : filteredOrders.map(po => (
            <div key={po.id}
              className={`px-3 py-2.5 border-b border-border/50 cursor-pointer hover:bg-surface-2 transition-colors ${selected?.id === po.id ? 'bg-accent-dim' : ''}`}
              onClick={() => setSelected(po)}>
              <div className="flex items-center gap-2">
                {canWrite && <input type="checkbox" checked={checked.has(po.id)} onChange={() => toggleCheck(po.id)} onClick={e => e.stopPropagation()} />}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-text-1 truncate">{po.po_number}</span>
                    <StatusBadge status={po.status} />
                  </div>
                  <div className="text-xs text-text-3 mt-0.5 truncate">{po.vendor_name} &middot; {po.store_name}</div>
                  <div className="text-xs text-text-3">{fmtDate(po.order_date)} &middot; {po.item_count ?? 0} items</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Centre - PO detail */}
      <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
        {selected ? (
          <>
            <div className="px-4 py-3 border-b border-border bg-surface shrink-0">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold text-text-1">{selected.po_number}</h3>
                  <div className="text-xs text-text-3 mt-0.5">
                    {selected.vendor_name} &middot; {selected.store_name} &middot; {fmtDate(selected.order_date)}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <StatusBadge status={selected.status} />
                  {canWrite && selected.status === 'draft' && (
                    <button className="btn btn-sm btn-primary text-xs" onClick={() => handleStatusChange(selected, 'submitted')}>Submit</button>
                  )}
                  {canWrite && (selected.status === 'submitted' || selected.status === 'partial') && (
                    <button className="btn btn-sm btn-primary text-xs" onClick={() => handleStatusChange(selected, 'received')}>Mark Received</button>
                  )}
                  {canWrite && selected.status !== 'cancelled' && selected.status !== 'received' && (
                    <button className="btn btn-sm bg-red-600 text-white hover:bg-red-700 text-xs" onClick={() => handleStatusChange(selected, 'cancelled')}>Cancel</button>
                  )}
                </div>
              </div>
              {selected.notes && <p className="text-xs text-text-3 mt-2">{selected.notes}</p>}
              {selected.expected_date && <p className="text-xs text-text-3 mt-1">Expected: {fmtDate(selected.expected_date)}</p>}
            </div>
            <div className="flex-1 overflow-y-auto p-4">
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-xs font-bold text-text-3 uppercase tracking-wide">Line Items ({items.length})</h4>
                {canWrite && selected.status === 'draft' && (
                  <button className="btn btn-sm btn-outline text-xs" onClick={() => {
                    setItemForm({ ingredient_id: null, qty_ordered: '', unit_price: '', purchase_unit: '' })
                    setEditItem(null)
                    setShowItemForm(true)
                  }}>+ Add Item</button>
                )}
              </div>
              {items.length === 0 ? (
                <p className="text-sm text-text-3 text-center py-8">No items yet. Add ingredients to this order.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead><tr className="text-left text-xs text-text-3 uppercase tracking-wide border-b border-border">
                    <th className="pb-2 pr-3">Ingredient</th><th className="pb-2 pr-3 text-right">Qty Ordered</th>
                    <th className="pb-2 pr-3 text-right">Qty Received</th><th className="pb-2 pr-3 text-right">Unit Price</th>
                    <th className="pb-2 pr-3">Unit</th>
                    {canWrite && selected.status === 'draft' && <th className="pb-2 w-16"></th>}
                  </tr></thead>
                  <tbody>
                    {items.map(item => (
                      <tr key={item.id} className="border-b border-border/50 hover:bg-surface-2">
                        <td className="py-2 pr-3 font-medium">{item.ingredient_name}</td>
                        <td className="py-2 pr-3 text-right">{fmtNum(item.qty_ordered)}</td>
                        <td className="py-2 pr-3 text-right">{fmtNum(item.qty_received)}</td>
                        <td className="py-2 pr-3 text-right">{fmtNum(item.unit_price, 4)}</td>
                        <td className="py-2 pr-3">{item.purchase_unit || item.base_unit_abbr || '-'}</td>
                        {canWrite && selected.status === 'draft' && (
                          <td className="py-2">
                            <div className="flex items-center gap-1">
                              <button className="p-1 rounded hover:bg-gray-100 text-text-3 hover:text-accent" onClick={() => {
                                setEditItem(item)
                                setItemForm({
                                  ingredient_id: item.ingredient_id,
                                  qty_ordered: String(item.qty_ordered),
                                  unit_price: String(item.unit_price),
                                  purchase_unit: item.purchase_unit || '',
                                })
                                setShowItemForm(true)
                              }}>
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
                              </button>
                              <button className="p-1 rounded hover:bg-gray-100 text-text-3 hover:text-red-500" onClick={() => handleDeleteItem(item)}>
                                <TrashIcon />
                              </button>
                            </div>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </>
        ) : (
          <EmptyPanel message="Select a purchase order from the list." />
        )}
      </div>

      {/* Right - add item form */}
      {showItemForm && selected && (
        <div className="w-72 border-l border-border overflow-y-auto shrink-0 bg-surface p-4 space-y-3">
          <h3 className="text-sm font-bold text-text-1">{editItem ? 'Edit Item' : 'Add Item'}</h3>
          <Field label="Ingredient *">
            <SearchSelect items={ingredients} value={itemForm.ingredient_id}
              onChange={(id) => setItemForm(f => ({ ...f, ingredient_id: id }))}
              placeholder="Search ingredients..."
              renderSecondary={(i: IngredientRef) => i.base_unit_abbr || null} />
          </Field>
          <Field label="Qty Ordered *">
            <input type="number" step="0.01" min="0" className="input w-full" value={itemForm.qty_ordered}
              onChange={e => setItemForm(f => ({ ...f, qty_ordered: e.target.value }))} />
          </Field>
          <Field label="Unit Price">
            <input type="number" step="0.0001" min="0" className="input w-full" value={itemForm.unit_price}
              onChange={e => setItemForm(f => ({ ...f, unit_price: e.target.value }))} />
          </Field>
          <Field label="Purchase Unit">
            <input className="input w-full" value={itemForm.purchase_unit} placeholder="e.g. case, bag"
              onChange={e => setItemForm(f => ({ ...f, purchase_unit: e.target.value }))} />
          </Field>
          <div className="flex gap-2 pt-2">
            <button className="btn btn-outline flex-1" onClick={() => { setShowItemForm(false); setEditItem(null) }}>Cancel</button>
            <button className="btn btn-primary flex-1" disabled={!itemForm.ingredient_id || !itemForm.qty_ordered || saving} onClick={handleSaveItem}>
              {saving ? 'Saving...' : editItem ? 'Update' : 'Add'}
            </button>
          </div>
        </div>
      )}

      {/* New PO modal */}
      {showModal && (
        <Modal title="New Purchase Order" onClose={() => setShowModal(false)}>
          <div className="space-y-3">
            <Field label="Store *">
              <select className="input w-full" value={newPO.store_id} onChange={e => setNewPO(f => ({ ...f, store_id: e.target.value }))}>
                <option value="">Select store...</option>
                {stores.filter(s => s.is_active).map(s => <option key={s.id} value={String(s.id)}>{s.name} ({s.location_name})</option>)}
              </select>
            </Field>
            <Field label="Vendor *">
              <select className="input w-full" value={newPO.vendor_id} onChange={e => setNewPO(f => ({ ...f, vendor_id: e.target.value }))}>
                <option value="">Select vendor...</option>
                {vendors.map(v => <option key={v.id} value={String(v.id)}>{v.name}</option>)}
              </select>
            </Field>
            <Field label="Expected Delivery Date">
              <input type="date" className="input w-full" value={newPO.expected_date}
                onChange={e => setNewPO(f => ({ ...f, expected_date: e.target.value }))} />
            </Field>
            <Field label="Notes">
              <textarea className="input w-full" rows={2} value={newPO.notes}
                onChange={e => setNewPO(f => ({ ...f, notes: e.target.value }))} />
            </Field>
          </div>
          <div className="flex justify-end gap-2 mt-4">
            <button className="btn btn-outline" onClick={() => setShowModal(false)}>Cancel</button>
            <button className="btn btn-primary" disabled={!newPO.store_id || !newPO.vendor_id || saving} onClick={handleCreatePO}>
              {saving ? 'Creating...' : 'Create PO'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════════
// GoodsInTab
// ════════════════════════════════════════════════════════════════════════════════
function GoodsInTab({ api, stores, vendors, ingredients, storeId, canWrite, showToast }: {
  api: ApiType; stores: Store[]; vendors: VendorRef[]; ingredients: IngredientRef[]
  storeId: number | null; canWrite: boolean; showToast: (msg: string, type?: 'success' | 'error') => void
}) {
  const [grns, setGrns] = useState<GoodsReceived[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<GoodsReceived | null>(null)
  const [items, setItems] = useState<GRNItem[]>([])
  const [checked, setChecked] = useState<Set<number>>(new Set())
  const [showModal, setShowModal] = useState(false)
  const [saving, setSaving] = useState(false)
  const [showItemForm, setShowItemForm] = useState(false)
  const [editItem, setEditItem] = useState<GRNItem | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const q = storeId ? `?store_id=${storeId}` : ''
      const data = await api.get(`/goods-received${q}`)
      setGrns(data || [])
    } finally { setLoading(false) }
  }, [api, storeId])

  useEffect(() => { load() }, [load])

  const loadItems = useCallback(async (grnId: number) => {
    try {
      const data = await api.get(`/goods-received/${grnId}/items`)
      setItems(data || [])
    } catch { setItems([]) }
  }, [api])

  useEffect(() => {
    if (selected) loadItems(selected.id)
    else setItems([])
  }, [selected, loadItems])

  const [newGRN, setNewGRN] = useState({ store_id: '', vendor_id: '', po_id: '', notes: '', received_date: new Date().toISOString().slice(0, 10) })

  const handleCreate = async () => {
    if (!newGRN.store_id || !newGRN.vendor_id) return
    setSaving(true)
    try {
      const created = await api.post('/goods-received', {
        store_id: Number(newGRN.store_id), vendor_id: Number(newGRN.vendor_id),
        po_id: Number(newGRN.po_id) || null,
        notes: newGRN.notes.trim() || null,
        received_date: newGRN.received_date || null,
      })
      showToast('GRN created')
      setShowModal(false)
      await load()
      setSelected(created)
    } catch (err: any) { showToast(err.message || 'Failed to create GRN', 'error') }
    finally { setSaving(false) }
  }

  const handleConfirm = async (grn: GoodsReceived) => {
    try {
      await api.patch(`/goods-received/${grn.id}`, { status: 'confirmed' })
      showToast(`GRN ${grn.grn_number} confirmed - stock updated`)
      load()
      if (selected?.id === grn.id) setSelected({ ...grn, status: 'confirmed' })
    } catch (err: any) { showToast(err.message || 'Failed to confirm', 'error') }
  }

  const [itemForm, setItemForm] = useState({ ingredient_id: null as number | null, qty_received: '', unit_price: '', purchase_unit: '' })

  const handleSaveItem = async () => {
    if (!selected || !itemForm.ingredient_id || !itemForm.qty_received) return
    setSaving(true)
    try {
      const payload = {
        ingredient_id: itemForm.ingredient_id,
        qty_received: Number(itemForm.qty_received),
        unit_price: Number(itemForm.unit_price) || 0,
        purchase_unit: itemForm.purchase_unit.trim() || null,
      }
      if (editItem) {
        await api.put(`/goods-received/${selected.id}/items/${editItem.id}`, payload)
        showToast('Item updated')
      } else {
        await api.post(`/goods-received/${selected.id}/items`, payload)
        showToast('Item added')
      }
      setShowItemForm(false)
      setEditItem(null)
      setItemForm({ ingredient_id: null, qty_received: '', unit_price: '', purchase_unit: '' })
      loadItems(selected.id)
    } catch (err: any) { showToast(err.message || 'Failed to save item', 'error') }
    finally { setSaving(false) }
  }

  const handleDeleteItem = async (item: GRNItem) => {
    if (!selected) return
    try {
      await api.delete(`/goods-received/${selected.id}/items/${item.id}`)
      showToast('Item removed')
      loadItems(selected.id)
    } catch (err: any) { showToast(err.message || 'Failed to remove item', 'error') }
  }

  const handleBulkConfirm = async () => {
    try {
      await Promise.all([...checked].map(id => api.patch(`/goods-received/${id}`, { status: 'confirmed' })))
      showToast(`${checked.size} GRN(s) confirmed`)
      setChecked(new Set())
      load()
    } catch (err: any) { showToast(err.message || 'Bulk action failed', 'error') }
  }

  const handleBulkDelete = async () => {
    try {
      await Promise.all([...checked].filter(id => grns.find(g => g.id === id)?.status === 'draft').map(id => api.delete(`/goods-received/${id}`)))
      showToast('Drafts deleted')
      setChecked(new Set())
      load()
    } catch (err: any) { showToast(err.message || 'Bulk delete failed', 'error') }
  }

  const toggleCheck = (id: number) => setChecked(prev => {
    const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next
  })

  if (loading) return <div className="flex items-center justify-center h-64"><Spinner /></div>

  return (
    <div className="flex h-full">
      {/* Left panel */}
      <div className="w-72 border-r border-border flex flex-col shrink-0 bg-surface">
        <div className="p-3 border-b border-border shrink-0">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold text-text-3 uppercase tracking-wide">Goods Received</h3>
            {canWrite && <button className="btn btn-sm btn-primary text-xs py-1" onClick={() => {
              setNewGRN({ store_id: storeId ? String(storeId) : '', vendor_id: '', po_id: '', notes: '', received_date: new Date().toISOString().slice(0, 10) })
              setShowModal(true)
            }}>+ New GRN</button>}
          </div>
        </div>
        {checked.size > 0 && canWrite && (
          <div className="p-2 border-b border-border bg-yellow-50 shrink-0 flex gap-1">
            <button className="btn btn-sm flex-1 btn-primary text-xs" onClick={handleBulkConfirm}>Confirm ({checked.size})</button>
            <button className="btn btn-sm flex-1 bg-red-600 text-white hover:bg-red-700 text-xs" onClick={handleBulkDelete}>Delete Drafts</button>
          </div>
        )}
        <div className="flex-1 overflow-y-auto">
          {grns.length === 0 ? (
            <EmptyPanel message="No goods received notes." />
          ) : grns.map(grn => (
            <div key={grn.id}
              className={`px-3 py-2.5 border-b border-border/50 cursor-pointer hover:bg-surface-2 transition-colors ${selected?.id === grn.id ? 'bg-accent-dim' : ''}`}
              onClick={() => setSelected(grn)}>
              <div className="flex items-center gap-2">
                {canWrite && <input type="checkbox" checked={checked.has(grn.id)} onChange={() => toggleCheck(grn.id)} onClick={e => e.stopPropagation()} />}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-text-1 truncate">{grn.grn_number}</span>
                    <StatusBadge status={grn.status} />
                  </div>
                  <div className="text-xs text-text-3 mt-0.5">{grn.vendor_name} &middot; {fmtDate(grn.received_date)}</div>
                  {grn.po_number && <div className="text-xs text-text-3">PO: {grn.po_number}</div>}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Centre */}
      <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
        {selected ? (
          <>
            <div className="px-4 py-3 border-b border-border bg-surface shrink-0">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold text-text-1">{selected.grn_number}</h3>
                  <div className="text-xs text-text-3 mt-0.5">{selected.vendor_name} &middot; {selected.store_name} &middot; {fmtDate(selected.received_date)}</div>
                </div>
                <div className="flex items-center gap-2">
                  <StatusBadge status={selected.status} />
                  {canWrite && selected.status === 'draft' && (
                    <button className="btn btn-sm btn-primary text-xs" onClick={() => handleConfirm(selected)}>Confirm GRN</button>
                  )}
                </div>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-4">
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-xs font-bold text-text-3 uppercase tracking-wide">Line Items ({items.length})</h4>
                {canWrite && selected.status === 'draft' && (
                  <button className="btn btn-sm btn-outline text-xs" onClick={() => {
                    setItemForm({ ingredient_id: null, qty_received: '', unit_price: '', purchase_unit: '' })
                    setEditItem(null)
                    setShowItemForm(true)
                  }}>+ Add Item</button>
                )}
              </div>
              {items.length === 0 ? (
                <p className="text-sm text-text-3 text-center py-8">No items yet.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead><tr className="text-left text-xs text-text-3 uppercase tracking-wide border-b border-border">
                    <th className="pb-2 pr-3">Ingredient</th><th className="pb-2 pr-3 text-right">Qty Received</th>
                    <th className="pb-2 pr-3 text-right">Unit Price</th><th className="pb-2 pr-3">Unit</th>
                    {canWrite && selected.status === 'draft' && <th className="pb-2 w-16"></th>}
                  </tr></thead>
                  <tbody>
                    {items.map(item => (
                      <tr key={item.id} className="border-b border-border/50 hover:bg-surface-2">
                        <td className="py-2 pr-3 font-medium">{item.ingredient_name}</td>
                        <td className="py-2 pr-3 text-right">{fmtNum(item.qty_received)}</td>
                        <td className="py-2 pr-3 text-right">{fmtNum(item.unit_price, 4)}</td>
                        <td className="py-2 pr-3">{item.purchase_unit || item.base_unit_abbr || '-'}</td>
                        {canWrite && selected.status === 'draft' && (
                          <td className="py-2">
                            <div className="flex items-center gap-1">
                              <button className="p-1 rounded hover:bg-gray-100 text-text-3 hover:text-accent" onClick={() => {
                                setEditItem(item)
                                setItemForm({
                                  ingredient_id: item.ingredient_id, qty_received: String(item.qty_received),
                                  unit_price: String(item.unit_price), purchase_unit: item.purchase_unit || '',
                                })
                                setShowItemForm(true)
                              }}>
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
                              </button>
                              <button className="p-1 rounded hover:bg-gray-100 text-text-3 hover:text-red-500" onClick={() => handleDeleteItem(item)}>
                                <TrashIcon />
                              </button>
                            </div>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </>
        ) : (
          <EmptyPanel message="Select a GRN from the list." />
        )}
      </div>

      {/* Right - item form */}
      {showItemForm && selected && (
        <div className="w-72 border-l border-border overflow-y-auto shrink-0 bg-surface p-4 space-y-3">
          <h3 className="text-sm font-bold text-text-1">{editItem ? 'Edit Item' : 'Add Item'}</h3>
          <Field label="Ingredient *">
            <SearchSelect items={ingredients} value={itemForm.ingredient_id}
              onChange={(id) => setItemForm(f => ({ ...f, ingredient_id: id }))}
              placeholder="Search ingredients..."
              renderSecondary={(i: IngredientRef) => i.base_unit_abbr || null} />
          </Field>
          <Field label="Qty Received *">
            <input type="number" step="0.01" min="0" className="input w-full" value={itemForm.qty_received}
              onChange={e => setItemForm(f => ({ ...f, qty_received: e.target.value }))} />
          </Field>
          <Field label="Unit Price">
            <input type="number" step="0.0001" min="0" className="input w-full" value={itemForm.unit_price}
              onChange={e => setItemForm(f => ({ ...f, unit_price: e.target.value }))} />
          </Field>
          <Field label="Purchase Unit">
            <input className="input w-full" value={itemForm.purchase_unit} placeholder="e.g. case, bag"
              onChange={e => setItemForm(f => ({ ...f, purchase_unit: e.target.value }))} />
          </Field>
          <div className="flex gap-2 pt-2">
            <button className="btn btn-outline flex-1" onClick={() => { setShowItemForm(false); setEditItem(null) }}>Cancel</button>
            <button className="btn btn-primary flex-1" disabled={!itemForm.ingredient_id || !itemForm.qty_received || saving} onClick={handleSaveItem}>
              {saving ? 'Saving...' : editItem ? 'Update' : 'Add'}
            </button>
          </div>
        </div>
      )}

      {/* New GRN modal */}
      {showModal && (
        <Modal title="New Goods Received Note" onClose={() => setShowModal(false)}>
          <div className="space-y-3">
            <Field label="Store *">
              <select className="input w-full" value={newGRN.store_id} onChange={e => setNewGRN(f => ({ ...f, store_id: e.target.value }))}>
                <option value="">Select store...</option>
                {stores.filter(s => s.is_active).map(s => <option key={s.id} value={String(s.id)}>{s.name} ({s.location_name})</option>)}
              </select>
            </Field>
            <Field label="Vendor *">
              <select className="input w-full" value={newGRN.vendor_id} onChange={e => setNewGRN(f => ({ ...f, vendor_id: e.target.value }))}>
                <option value="">Select vendor...</option>
                {vendors.map(v => <option key={v.id} value={String(v.id)}>{v.name}</option>)}
              </select>
            </Field>
            <Field label="Received Date">
              <input type="date" className="input w-full" value={newGRN.received_date}
                onChange={e => setNewGRN(f => ({ ...f, received_date: e.target.value }))} />
            </Field>
            <Field label="Notes">
              <textarea className="input w-full" rows={2} value={newGRN.notes}
                onChange={e => setNewGRN(f => ({ ...f, notes: e.target.value }))} />
            </Field>
          </div>
          <div className="flex justify-end gap-2 mt-4">
            <button className="btn btn-outline" onClick={() => setShowModal(false)}>Cancel</button>
            <button className="btn btn-primary" disabled={!newGRN.store_id || !newGRN.vendor_id || saving} onClick={handleCreate}>
              {saving ? 'Creating...' : 'Create GRN'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════════
// InvoicesTab
// ════════════════════════════════════════════════════════════════════════════════
function InvoicesTab({ api, stores, vendors, ingredients, storeId, canWrite, showToast }: {
  api: ApiType; stores: Store[]; vendors: VendorRef[]; ingredients: IngredientRef[]
  storeId: number | null; canWrite: boolean; showToast: (msg: string, type?: 'success' | 'error') => void
}) {
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<Invoice | null>(null)
  const [items, setItems] = useState<InvoiceItem[]>([])
  const [checked, setChecked] = useState<Set<number>>(new Set())
  const [showModal, setShowModal] = useState(false)
  const [saving, setSaving] = useState(false)
  const [showItemForm, setShowItemForm] = useState(false)
  const [editItem, setEditItem] = useState<InvoiceItem | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const q = storeId ? `?store_id=${storeId}` : ''
      const data = await api.get(`/invoices${q}`)
      setInvoices(data || [])
    } finally { setLoading(false) }
  }, [api, storeId])

  useEffect(() => { load() }, [load])

  const loadItems = useCallback(async (invId: number) => {
    try {
      const data = await api.get(`/invoices/${invId}/items`)
      setItems(data || [])
    } catch { setItems([]) }
  }, [api])

  useEffect(() => {
    if (selected) loadItems(selected.id)
    else setItems([])
  }, [selected, loadItems])

  const [newInv, setNewInv] = useState({ store_id: '', vendor_id: '', invoice_number: '', invoice_date: new Date().toISOString().slice(0, 10), due_date: '', notes: '' })

  const handleCreate = async () => {
    if (!newInv.store_id || !newInv.vendor_id || !newInv.invoice_number.trim()) return
    setSaving(true)
    try {
      const created = await api.post('/invoices', {
        store_id: Number(newInv.store_id), vendor_id: Number(newInv.vendor_id),
        invoice_number: newInv.invoice_number.trim(),
        invoice_date: newInv.invoice_date || null,
        due_date: newInv.due_date || null,
        notes: newInv.notes.trim() || null,
      })
      showToast('Invoice created')
      setShowModal(false)
      await load()
      setSelected(created)
    } catch (err: any) { showToast(err.message || 'Failed to create invoice', 'error') }
    finally { setSaving(false) }
  }

  const handleStatusChange = async (inv: Invoice, newStatus: string) => {
    try {
      await api.patch(`/invoices/${inv.id}`, { status: newStatus })
      showToast(`Invoice ${inv.invoice_number} updated to ${newStatus}`)
      load()
      if (selected?.id === inv.id) setSelected({ ...inv, status: newStatus as Invoice['status'] })
    } catch (err: any) { showToast(err.message || 'Failed to update status', 'error') }
  }

  const [itemForm, setItemForm] = useState({ ingredient_id: null as number | null, description: '', quantity: '', unit_price: '' })

  const handleSaveItem = async () => {
    if (!selected || !itemForm.quantity || !itemForm.unit_price) return
    setSaving(true)
    try {
      const payload = {
        ingredient_id: itemForm.ingredient_id,
        description: itemForm.description.trim() || null,
        quantity: Number(itemForm.quantity),
        unit_price: Number(itemForm.unit_price),
        line_total: Number(itemForm.quantity) * Number(itemForm.unit_price),
      }
      if (editItem) {
        await api.put(`/invoices/${selected.id}/items/${editItem.id}`, payload)
        showToast('Item updated')
      } else {
        await api.post(`/invoices/${selected.id}/items`, payload)
        showToast('Item added')
      }
      setShowItemForm(false)
      setEditItem(null)
      setItemForm({ ingredient_id: null, description: '', quantity: '', unit_price: '' })
      loadItems(selected.id)
      load() // refresh totals
    } catch (err: any) { showToast(err.message || 'Failed to save item', 'error') }
    finally { setSaving(false) }
  }

  const handleDeleteItem = async (item: InvoiceItem) => {
    if (!selected) return
    try {
      await api.delete(`/invoices/${selected.id}/items/${item.id}`)
      showToast('Item removed')
      loadItems(selected.id)
      load()
    } catch (err: any) { showToast(err.message || 'Failed to remove item', 'error') }
  }

  const handleBulkApprove = async () => {
    try {
      await Promise.all([...checked].map(id => api.patch(`/invoices/${id}`, { status: 'approved' })))
      showToast(`${checked.size} invoice(s) approved`)
      setChecked(new Set())
      load()
    } catch (err: any) { showToast(err.message || 'Bulk action failed', 'error') }
  }

  const handleBulkDelete = async () => {
    try {
      await Promise.all([...checked].filter(id => invoices.find(i => i.id === id)?.status === 'draft').map(id => api.delete(`/invoices/${id}`)))
      showToast('Draft invoices deleted')
      setChecked(new Set())
      load()
    } catch (err: any) { showToast(err.message || 'Bulk delete failed', 'error') }
  }

  const toggleCheck = (id: number) => setChecked(prev => {
    const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next
  })

  if (loading) return <div className="flex items-center justify-center h-64"><Spinner /></div>

  return (
    <div className="flex h-full">
      {/* Left panel */}
      <div className="w-72 border-r border-border flex flex-col shrink-0 bg-surface">
        <div className="p-3 border-b border-border shrink-0">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold text-text-3 uppercase tracking-wide">Invoices</h3>
            {canWrite && <button className="btn btn-sm btn-primary text-xs py-1" onClick={() => {
              setNewInv({ store_id: storeId ? String(storeId) : '', vendor_id: '', invoice_number: '', invoice_date: new Date().toISOString().slice(0, 10), due_date: '', notes: '' })
              setShowModal(true)
            }}>+ New Invoice</button>}
          </div>
        </div>
        {checked.size > 0 && canWrite && (
          <div className="p-2 border-b border-border bg-yellow-50 shrink-0 flex gap-1">
            <button className="btn btn-sm flex-1 btn-primary text-xs" onClick={handleBulkApprove}>Approve ({checked.size})</button>
            <button className="btn btn-sm flex-1 bg-red-600 text-white hover:bg-red-700 text-xs" onClick={handleBulkDelete}>Delete Drafts</button>
          </div>
        )}
        <div className="flex-1 overflow-y-auto">
          {invoices.length === 0 ? (
            <EmptyPanel message="No invoices." />
          ) : invoices.map(inv => (
            <div key={inv.id}
              className={`px-3 py-2.5 border-b border-border/50 cursor-pointer hover:bg-surface-2 transition-colors ${selected?.id === inv.id ? 'bg-accent-dim' : ''}`}
              onClick={() => setSelected(inv)}>
              <div className="flex items-center gap-2">
                {canWrite && <input type="checkbox" checked={checked.has(inv.id)} onChange={() => toggleCheck(inv.id)} onClick={e => e.stopPropagation()} />}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-text-1 truncate">{inv.invoice_number}</span>
                    <StatusBadge status={inv.status} />
                  </div>
                  <div className="text-xs text-text-3 mt-0.5">{inv.vendor_name} &middot; {fmtDate(inv.invoice_date)}</div>
                  <div className="text-xs font-medium text-text-1">{inv.currency_code || 'USD'} {fmtNum(inv.total)}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Centre */}
      <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
        {selected ? (
          <>
            <div className="px-4 py-3 border-b border-border bg-surface shrink-0">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold text-text-1">{selected.invoice_number}</h3>
                  <div className="text-xs text-text-3 mt-0.5">{selected.vendor_name} &middot; {selected.store_name} &middot; {fmtDate(selected.invoice_date)}</div>
                </div>
                <div className="flex items-center gap-2">
                  <StatusBadge status={selected.status} />
                  {canWrite && selected.status === 'pending' && (
                    <button className="btn btn-sm btn-primary text-xs" onClick={() => handleStatusChange(selected, 'approved')}>Approve</button>
                  )}
                  {canWrite && selected.status === 'approved' && (
                    <button className="btn btn-sm btn-primary text-xs" onClick={() => handleStatusChange(selected, 'paid')}>Mark Paid</button>
                  )}
                  {canWrite && (selected.status === 'pending' || selected.status === 'approved') && (
                    <button className="btn btn-sm bg-red-600 text-white hover:bg-red-700 text-xs" onClick={() => handleStatusChange(selected, 'disputed')}>Dispute</button>
                  )}
                </div>
              </div>
              {selected.due_date && <p className="text-xs text-text-3 mt-1">Due: {fmtDate(selected.due_date)}</p>}
            </div>
            <div className="flex-1 overflow-y-auto p-4">
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-xs font-bold text-text-3 uppercase tracking-wide">Line Items ({items.length})</h4>
                {canWrite && (selected.status === 'draft' || selected.status === 'pending') && (
                  <button className="btn btn-sm btn-outline text-xs" onClick={() => {
                    setItemForm({ ingredient_id: null, description: '', quantity: '', unit_price: '' })
                    setEditItem(null)
                    setShowItemForm(true)
                  }}>+ Add Item</button>
                )}
              </div>
              {items.length === 0 ? (
                <p className="text-sm text-text-3 text-center py-8">No items yet.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead><tr className="text-left text-xs text-text-3 uppercase tracking-wide border-b border-border">
                    <th className="pb-2 pr-3">Description / Ingredient</th><th className="pb-2 pr-3 text-right">Qty</th>
                    <th className="pb-2 pr-3 text-right">Unit Price</th><th className="pb-2 pr-3 text-right">Line Total</th>
                    {canWrite && (selected.status === 'draft' || selected.status === 'pending') && <th className="pb-2 w-16"></th>}
                  </tr></thead>
                  <tbody>
                    {items.map(item => (
                      <tr key={item.id} className="border-b border-border/50 hover:bg-surface-2">
                        <td className="py-2 pr-3 font-medium">{item.description || item.ingredient_name || '-'}</td>
                        <td className="py-2 pr-3 text-right">{fmtNum(item.quantity)}</td>
                        <td className="py-2 pr-3 text-right">{fmtNum(item.unit_price, 4)}</td>
                        <td className="py-2 pr-3 text-right font-medium">{fmtNum(item.line_total)}</td>
                        {canWrite && (selected.status === 'draft' || selected.status === 'pending') && (
                          <td className="py-2">
                            <div className="flex items-center gap-1">
                              <button className="p-1 rounded hover:bg-gray-100 text-text-3 hover:text-accent" onClick={() => {
                                setEditItem(item)
                                setItemForm({
                                  ingredient_id: item.ingredient_id, description: item.description || '',
                                  quantity: String(item.quantity), unit_price: String(item.unit_price),
                                })
                                setShowItemForm(true)
                              }}>
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
                              </button>
                              <button className="p-1 rounded hover:bg-gray-100 text-text-3 hover:text-red-500" onClick={() => handleDeleteItem(item)}>
                                <TrashIcon />
                              </button>
                            </div>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-border">
                      <td colSpan={2}></td>
                      <td className="py-2 pr-3 text-right text-xs text-text-3">Subtotal</td>
                      <td className="py-2 pr-3 text-right font-medium">{fmtNum(selected.subtotal)}</td>
                      {canWrite && (selected.status === 'draft' || selected.status === 'pending') && <td></td>}
                    </tr>
                    <tr>
                      <td colSpan={2}></td>
                      <td className="py-1 pr-3 text-right text-xs text-text-3">Tax</td>
                      <td className="py-1 pr-3 text-right">{fmtNum(selected.tax_amount)}</td>
                      {canWrite && (selected.status === 'draft' || selected.status === 'pending') && <td></td>}
                    </tr>
                    <tr>
                      <td colSpan={2}></td>
                      <td className="py-1 pr-3 text-right text-xs font-bold text-text-1">Total</td>
                      <td className="py-1 pr-3 text-right font-bold text-text-1">{selected.currency_code || 'USD'} {fmtNum(selected.total)}</td>
                      {canWrite && (selected.status === 'draft' || selected.status === 'pending') && <td></td>}
                    </tr>
                  </tfoot>
                </table>
              )}
            </div>
          </>
        ) : (
          <EmptyPanel message="Select an invoice from the list." />
        )}
      </div>

      {/* Right - item form */}
      {showItemForm && selected && (
        <div className="w-72 border-l border-border overflow-y-auto shrink-0 bg-surface p-4 space-y-3">
          <h3 className="text-sm font-bold text-text-1">{editItem ? 'Edit Item' : 'Add Item'}</h3>
          <Field label="Ingredient (optional)">
            <SearchSelect items={ingredients} value={itemForm.ingredient_id}
              onChange={(id) => setItemForm(f => ({ ...f, ingredient_id: id }))}
              placeholder="Search ingredients..."
              renderSecondary={(i: IngredientRef) => i.base_unit_abbr || null} />
          </Field>
          <Field label="Description">
            <input className="input w-full" value={itemForm.description} placeholder="Line item description"
              onChange={e => setItemForm(f => ({ ...f, description: e.target.value }))} />
          </Field>
          <Field label="Quantity *">
            <input type="number" step="0.01" min="0" className="input w-full" value={itemForm.quantity}
              onChange={e => setItemForm(f => ({ ...f, quantity: e.target.value }))} />
          </Field>
          <Field label="Unit Price *">
            <input type="number" step="0.0001" min="0" className="input w-full" value={itemForm.unit_price}
              onChange={e => setItemForm(f => ({ ...f, unit_price: e.target.value }))} />
          </Field>
          {itemForm.quantity && itemForm.unit_price && (
            <div className="text-sm text-text-3">Line total: <span className="font-medium text-text-1">{fmtNum(Number(itemForm.quantity) * Number(itemForm.unit_price))}</span></div>
          )}
          <div className="flex gap-2 pt-2">
            <button className="btn btn-outline flex-1" onClick={() => { setShowItemForm(false); setEditItem(null) }}>Cancel</button>
            <button className="btn btn-primary flex-1" disabled={!itemForm.quantity || !itemForm.unit_price || saving} onClick={handleSaveItem}>
              {saving ? 'Saving...' : editItem ? 'Update' : 'Add'}
            </button>
          </div>
        </div>
      )}

      {/* New invoice modal */}
      {showModal && (
        <Modal title="New Invoice" onClose={() => setShowModal(false)}>
          <div className="space-y-3">
            <Field label="Store *">
              <select className="input w-full" value={newInv.store_id} onChange={e => setNewInv(f => ({ ...f, store_id: e.target.value }))}>
                <option value="">Select store...</option>
                {stores.filter(s => s.is_active).map(s => <option key={s.id} value={String(s.id)}>{s.name} ({s.location_name})</option>)}
              </select>
            </Field>
            <Field label="Vendor *">
              <select className="input w-full" value={newInv.vendor_id} onChange={e => setNewInv(f => ({ ...f, vendor_id: e.target.value }))}>
                <option value="">Select vendor...</option>
                {vendors.map(v => <option key={v.id} value={String(v.id)}>{v.name}</option>)}
              </select>
            </Field>
            <Field label="Invoice Number *">
              <input className="input w-full" value={newInv.invoice_number}
                onChange={e => setNewInv(f => ({ ...f, invoice_number: e.target.value }))} placeholder="INV-001" />
            </Field>
            <Field label="Invoice Date">
              <input type="date" className="input w-full" value={newInv.invoice_date}
                onChange={e => setNewInv(f => ({ ...f, invoice_date: e.target.value }))} />
            </Field>
            <Field label="Due Date">
              <input type="date" className="input w-full" value={newInv.due_date}
                onChange={e => setNewInv(f => ({ ...f, due_date: e.target.value }))} />
            </Field>
            <Field label="Notes">
              <textarea className="input w-full" rows={2} value={newInv.notes}
                onChange={e => setNewInv(f => ({ ...f, notes: e.target.value }))} />
            </Field>
          </div>
          <div className="flex justify-end gap-2 mt-4">
            <button className="btn btn-outline" onClick={() => setShowModal(false)}>Cancel</button>
            <button className="btn btn-primary" disabled={!newInv.store_id || !newInv.vendor_id || !newInv.invoice_number.trim() || saving} onClick={handleCreate}>
              {saving ? 'Creating...' : 'Create Invoice'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════════
// WasteTab
// ════════════════════════════════════════════════════════════════════════════════
function WasteTab({ api, stores, ingredients, storeId, canWrite, showToast }: {
  api: ApiType; stores: Store[]; ingredients: IngredientRef[]
  storeId: number | null; canWrite: boolean; showToast: (msg: string, type?: 'success' | 'error') => void
}) {
  const [entries, setEntries] = useState<WasteEntry[]>([])
  const [reasonCodes, setReasonCodes] = useState<WasteReasonCode[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [editReason, setEditReason] = useState<WasteReasonCode | null>(null)
  const [reasonForm, setReasonForm] = useState({ name: '', description: '', is_active: true })

  // Bulk entry rows
  interface BulkRow { ingredient_id: number | null; quantity: string; reason_code_id: string; notes: string; store_id: string }
  const [bulkRows, setBulkRows] = useState<BulkRow[]>([])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const q = storeId ? `?store_id=${storeId}` : ''
      const [w, rc] = await Promise.all([
        api.get(`/waste${q}`),
        api.get('/waste/reason-codes'),
      ])
      setEntries(w || [])
      setReasonCodes(rc || [])
    } finally { setLoading(false) }
  }, [api, storeId])

  useEffect(() => { load() }, [load])

  const addRow = () => {
    setBulkRows(prev => [...prev, { ingredient_id: null, quantity: '', reason_code_id: '', notes: '', store_id: storeId ? String(storeId) : '' }])
  }

  const updateRow = (idx: number, patch: Partial<BulkRow>) => {
    setBulkRows(prev => prev.map((r, i) => i === idx ? { ...r, ...patch } : r))
  }

  const removeRow = (idx: number) => {
    setBulkRows(prev => prev.filter((_, i) => i !== idx))
  }

  const handleSubmitAll = async () => {
    const valid = bulkRows.filter(r => r.ingredient_id && r.quantity && r.store_id)
    if (valid.length === 0) { showToast('No valid rows to submit', 'error'); return }
    setSaving(true)
    try {
      await api.post('/waste/bulk', {
        entries: valid.map(r => ({
          store_id: Number(r.store_id),
          ingredient_id: r.ingredient_id,
          quantity: Number(r.quantity),
          reason_code_id: Number(r.reason_code_id) || null,
          notes: r.notes.trim() || null,
          waste_date: new Date().toISOString().slice(0, 10),
        })),
      })
      showToast(`${valid.length} waste entries logged`)
      setBulkRows([])
      load()
    } catch (err: any) { showToast(err.message || 'Failed to submit', 'error') }
    finally { setSaving(false) }
  }

  const handleSaveReason = async () => {
    if (!reasonForm.name.trim()) return
    setSaving(true)
    try {
      const payload = { name: reasonForm.name.trim(), description: reasonForm.description.trim() || null, is_active: reasonForm.is_active }
      if (editReason) {
        await api.put(`/waste/reason-codes/${editReason.id}`, payload)
        showToast('Reason code updated')
      } else {
        await api.post('/waste/reason-codes', payload)
        showToast('Reason code created')
      }
      setEditReason(null)
      setReasonForm({ name: '', description: '', is_active: true })
      load()
    } catch (err: any) { showToast(err.message || 'Failed to save', 'error') }
    finally { setSaving(false) }
  }

  const handleDeleteReason = async (rc: WasteReasonCode) => {
    try {
      await api.delete(`/waste/reason-codes/${rc.id}`)
      showToast('Reason code deleted')
      load()
    } catch (err: any) { showToast(err.message || 'Failed to delete', 'error') }
  }

  if (loading) return <div className="flex items-center justify-center h-64"><Spinner /></div>

  return (
    <div className="flex h-full">
      {/* Main area */}
      <div className="flex-1 min-w-0 overflow-y-auto p-6 space-y-6">
        {/* Bulk entry */}
        {canWrite && (
          <div className="card p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold text-text-1">Log Waste</h3>
              <div className="flex items-center gap-2">
                <button className="btn btn-sm btn-outline text-xs" onClick={addRow}>+ Add Row</button>
                {bulkRows.length > 0 && (
                  <button className="btn btn-sm btn-primary text-xs" disabled={saving} onClick={handleSubmitAll}>
                    {saving ? 'Submitting...' : `Submit All (${bulkRows.filter(r => r.ingredient_id && r.quantity && r.store_id).length})`}
                  </button>
                )}
              </div>
            </div>
            {bulkRows.length === 0 ? (
              <p className="text-sm text-text-3 text-center py-4">Click "+ Add Row" to start logging waste entries.</p>
            ) : (
              <table className="w-full text-sm">
                <thead><tr className="text-left text-xs text-text-3 uppercase tracking-wide border-b border-border">
                  <th className="pb-2 pr-2">Ingredient</th><th className="pb-2 pr-2 w-24">Qty</th>
                  <th className="pb-2 pr-2">Reason</th><th className="pb-2 pr-2">Store</th>
                  <th className="pb-2 pr-2">Notes</th><th className="pb-2 w-8"></th>
                </tr></thead>
                <tbody>
                  {bulkRows.map((row, idx) => (
                    <tr key={idx} className="border-b border-border/50">
                      <td className="py-1.5 pr-2">
                        <SearchSelect items={ingredients} value={row.ingredient_id}
                          onChange={(id) => updateRow(idx, { ingredient_id: id })}
                          placeholder="Search..."
                          renderSecondary={(i: IngredientRef) => i.base_unit_abbr || null} />
                      </td>
                      <td className="py-1.5 pr-2">
                        <input type="number" step="0.01" min="0" className="input w-full text-sm" value={row.quantity}
                          onChange={e => updateRow(idx, { quantity: e.target.value })} />
                      </td>
                      <td className="py-1.5 pr-2">
                        <select className="input w-full text-sm" value={row.reason_code_id} onChange={e => updateRow(idx, { reason_code_id: e.target.value })}>
                          <option value="">None</option>
                          {reasonCodes.filter(rc => rc.is_active).map(rc => <option key={rc.id} value={String(rc.id)}>{rc.name}</option>)}
                        </select>
                      </td>
                      <td className="py-1.5 pr-2">
                        <select className="input w-full text-sm" value={row.store_id} onChange={e => updateRow(idx, { store_id: e.target.value })}>
                          <option value="">Select...</option>
                          {stores.filter(s => s.is_active).map(s => <option key={s.id} value={String(s.id)}>{s.name}</option>)}
                        </select>
                      </td>
                      <td className="py-1.5 pr-2">
                        <input className="input w-full text-sm" value={row.notes} placeholder="Notes"
                          onChange={e => updateRow(idx, { notes: e.target.value })} />
                      </td>
                      <td className="py-1.5">
                        <button className="p-1 rounded hover:bg-gray-100 text-text-3 hover:text-red-500" onClick={() => removeRow(idx)}>
                          <TrashIcon />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* Waste log history */}
        <div className="card p-4">
          <h3 className="text-sm font-bold text-text-1 mb-3">Waste Log History</h3>
          {entries.length === 0 ? (
            <p className="text-sm text-text-3 text-center py-4">No waste entries recorded.</p>
          ) : (
            <div className="overflow-x-auto max-h-[400px] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-white z-10"><tr className="text-left text-xs text-text-3 uppercase tracking-wide border-b border-border">
                  <th className="pb-2 pr-3">Date</th><th className="pb-2 pr-3">Ingredient</th>
                  <th className="pb-2 pr-3 text-right">Qty</th><th className="pb-2 pr-3">Reason</th>
                  <th className="pb-2 pr-3">Store</th><th className="pb-2 pr-3 text-right">Unit Cost</th>
                  <th className="pb-2">Notes</th>
                </tr></thead>
                <tbody>
                  {entries.map(e => (
                    <tr key={e.id} className="border-b border-border/50 hover:bg-surface-2">
                      <td className="py-2 pr-3 text-text-3 whitespace-nowrap">{fmtDate(e.waste_date)}</td>
                      <td className="py-2 pr-3 font-medium">{e.ingredient_name}</td>
                      <td className="py-2 pr-3 text-right">{fmtNum(e.quantity)}</td>
                      <td className="py-2 pr-3">{e.reason_name || '-'}</td>
                      <td className="py-2 pr-3">{e.store_name || '-'}</td>
                      <td className="py-2 pr-3 text-right">{fmtNum(e.unit_cost, 4)}</td>
                      <td className="py-2 text-text-3 truncate max-w-[200px]">{e.notes || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Right panel - Reason codes */}
      <div className="w-72 border-l border-border overflow-y-auto shrink-0 bg-surface">
        <div className="p-3 border-b border-border">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold text-text-3 uppercase tracking-wide">Reason Codes</h3>
            {canWrite && (
              <button className="btn btn-sm btn-outline text-xs py-1" onClick={() => {
                setEditReason(null)
                setReasonForm({ name: '', description: '', is_active: true })
              }}>+ New</button>
            )}
          </div>
        </div>

        {/* Reason code list */}
        <div className="divide-y divide-border/50">
          {reasonCodes.map(rc => (
            <div key={rc.id} className={`px-3 py-2.5 hover:bg-surface-2 cursor-pointer ${editReason?.id === rc.id ? 'bg-accent-dim' : ''}`}
              onClick={() => {
                setEditReason(rc)
                setReasonForm({ name: rc.name, description: rc.description || '', is_active: rc.is_active })
              }}>
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-text-1">{rc.name}</span>
                <span className={`text-xs px-1.5 py-0.5 rounded-full ${rc.is_active ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                  {rc.is_active ? 'Active' : 'Inactive'}
                </span>
              </div>
              {rc.description && <p className="text-xs text-text-3 mt-0.5 truncate">{rc.description}</p>}
            </div>
          ))}
        </div>

        {/* Reason edit form */}
        {canWrite && (
          <div className="p-3 border-t border-border space-y-2">
            <h4 className="text-xs font-bold text-text-3">{editReason ? 'Edit Reason Code' : 'New Reason Code'}</h4>
            <input className="input w-full text-sm" placeholder="Name *" value={reasonForm.name}
              onChange={e => setReasonForm(f => ({ ...f, name: e.target.value }))} />
            <input className="input w-full text-sm" placeholder="Description" value={reasonForm.description}
              onChange={e => setReasonForm(f => ({ ...f, description: e.target.value }))} />
            <label className="flex items-center gap-2 text-xs cursor-pointer">
              <input type="checkbox" checked={reasonForm.is_active} onChange={e => setReasonForm(f => ({ ...f, is_active: e.target.checked }))} />
              Active
            </label>
            <div className="flex gap-2">
              <button className="btn btn-sm btn-primary flex-1 text-xs" disabled={!reasonForm.name.trim() || saving} onClick={handleSaveReason}>
                {saving ? 'Saving...' : editReason ? 'Update' : 'Create'}
              </button>
              {editReason && (
                <button className="btn btn-sm bg-red-600 text-white hover:bg-red-700 text-xs" onClick={() => handleDeleteReason(editReason)}>
                  Delete
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════════
// TransfersTab
// ════════════════════════════════════════════════════════════════════════════════
function TransfersTab({ api, stores, ingredients, canWrite, showToast }: {
  api: ApiType; stores: Store[]; ingredients: IngredientRef[]
  canWrite: boolean; showToast: (msg: string, type?: 'success' | 'error') => void
}) {
  const [transfers, setTransfers] = useState<Transfer[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<Transfer | null>(null)
  const [items, setItems] = useState<TransferItem[]>([])
  const [checked, setChecked] = useState<Set<number>>(new Set())
  const [showModal, setShowModal] = useState(false)
  const [saving, setSaving] = useState(false)
  const [showItemForm, setShowItemForm] = useState(false)
  const [editItem, setEditItem] = useState<TransferItem | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await api.get('/transfers')
      setTransfers(data || [])
    } finally { setLoading(false) }
  }, [api])

  useEffect(() => { load() }, [load])

  const loadItems = useCallback(async (transferId: number) => {
    try {
      const data = await api.get(`/transfers/${transferId}/items`)
      setItems(data || [])
    } catch { setItems([]) }
  }, [api])

  useEffect(() => {
    if (selected) loadItems(selected.id)
    else setItems([])
  }, [selected, loadItems])

  const [newTransfer, setNewTransfer] = useState({ from_store_id: '', to_store_id: '', notes: '' })

  const handleCreate = async () => {
    if (!newTransfer.from_store_id || !newTransfer.to_store_id || newTransfer.from_store_id === newTransfer.to_store_id) return
    setSaving(true)
    try {
      const created = await api.post('/transfers', {
        from_store_id: Number(newTransfer.from_store_id),
        to_store_id: Number(newTransfer.to_store_id),
        notes: newTransfer.notes.trim() || null,
      })
      showToast('Transfer created')
      setShowModal(false)
      await load()
      setSelected(created)
    } catch (err: any) { showToast(err.message || 'Failed to create transfer', 'error') }
    finally { setSaving(false) }
  }

  const handleStatusChange = async (t: Transfer, newStatus: string) => {
    try {
      await api.patch(`/transfers/${t.id}`, { status: newStatus })
      showToast(`Transfer ${t.transfer_number} updated to ${newStatus.replace(/_/g, ' ')}`)
      load()
      if (selected?.id === t.id) setSelected({ ...t, status: newStatus as Transfer['status'] })
    } catch (err: any) { showToast(err.message || 'Failed to update', 'error') }
  }

  const [itemForm, setItemForm] = useState({ ingredient_id: null as number | null, qty_sent: '', qty_received: '' })

  const handleSaveItem = async () => {
    if (!selected || !itemForm.ingredient_id || !itemForm.qty_sent) return
    setSaving(true)
    try {
      const payload = {
        ingredient_id: itemForm.ingredient_id,
        qty_sent: Number(itemForm.qty_sent),
        qty_received: itemForm.qty_received ? Number(itemForm.qty_received) : null,
      }
      if (editItem) {
        await api.put(`/transfers/${selected.id}/items/${editItem.id}`, payload)
        showToast('Item updated')
      } else {
        await api.post(`/transfers/${selected.id}/items`, payload)
        showToast('Item added')
      }
      setShowItemForm(false)
      setEditItem(null)
      setItemForm({ ingredient_id: null, qty_sent: '', qty_received: '' })
      loadItems(selected.id)
    } catch (err: any) { showToast(err.message || 'Failed to save item', 'error') }
    finally { setSaving(false) }
  }

  const handleDeleteItem = async (item: TransferItem) => {
    if (!selected) return
    try {
      await api.delete(`/transfers/${selected.id}/items/${item.id}`)
      showToast('Item removed')
      loadItems(selected.id)
    } catch (err: any) { showToast(err.message || 'Failed to remove item', 'error') }
  }

  const handleBulkCancel = async () => {
    try {
      await Promise.all([...checked].map(id => api.patch(`/transfers/${id}`, { status: 'cancelled' })))
      showToast(`${checked.size} transfer(s) cancelled`)
      setChecked(new Set())
      load()
    } catch (err: any) { showToast(err.message || 'Bulk action failed', 'error') }
  }

  const toggleCheck = (id: number) => setChecked(prev => {
    const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next
  })

  if (loading) return <div className="flex items-center justify-center h-64"><Spinner /></div>

  return (
    <div className="flex h-full">
      {/* Left panel */}
      <div className="w-72 border-r border-border flex flex-col shrink-0 bg-surface">
        <div className="p-3 border-b border-border shrink-0">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold text-text-3 uppercase tracking-wide">Transfers</h3>
            {canWrite && <button className="btn btn-sm btn-primary text-xs py-1" onClick={() => {
              setNewTransfer({ from_store_id: '', to_store_id: '', notes: '' })
              setShowModal(true)
            }}>+ New Transfer</button>}
          </div>
        </div>
        {checked.size > 0 && canWrite && (
          <div className="p-2 border-b border-border bg-yellow-50 shrink-0">
            <button className="btn btn-sm w-full bg-red-600 text-white hover:bg-red-700 text-xs" onClick={handleBulkCancel}>
              Cancel {checked.size} selected
            </button>
          </div>
        )}
        <div className="flex-1 overflow-y-auto">
          {transfers.length === 0 ? (
            <EmptyPanel message="No transfers." />
          ) : transfers.map(t => (
            <div key={t.id}
              className={`px-3 py-2.5 border-b border-border/50 cursor-pointer hover:bg-surface-2 transition-colors ${selected?.id === t.id ? 'bg-accent-dim' : ''}`}
              onClick={() => setSelected(t)}>
              <div className="flex items-center gap-2">
                {canWrite && <input type="checkbox" checked={checked.has(t.id)} onChange={() => toggleCheck(t.id)} onClick={e => e.stopPropagation()} />}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-text-1 truncate">{t.transfer_number}</span>
                    <StatusBadge status={t.status} />
                  </div>
                  <div className="text-xs text-text-3 mt-0.5">{t.from_store_name} &rarr; {t.to_store_name}</div>
                  <div className="text-xs text-text-3">{fmtDate(t.transfer_date)} &middot; {t.item_count ?? 0} items</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Centre */}
      <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
        {selected ? (
          <>
            <div className="px-4 py-3 border-b border-border bg-surface shrink-0">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold text-text-1">{selected.transfer_number}</h3>
                  <div className="text-xs text-text-3 mt-0.5">{selected.from_store_name} &rarr; {selected.to_store_name} &middot; {fmtDate(selected.transfer_date)}</div>
                </div>
                <div className="flex items-center gap-2">
                  <StatusBadge status={selected.status} />
                  {canWrite && selected.status === 'pending' && (
                    <button className="btn btn-sm btn-primary text-xs" onClick={() => handleStatusChange(selected, 'in_transit')}>Dispatch</button>
                  )}
                  {canWrite && selected.status === 'in_transit' && (
                    <button className="btn btn-sm btn-primary text-xs" onClick={() => handleStatusChange(selected, 'confirmed')}>Confirm Receipt</button>
                  )}
                  {canWrite && selected.status !== 'cancelled' && selected.status !== 'confirmed' && (
                    <button className="btn btn-sm bg-red-600 text-white hover:bg-red-700 text-xs" onClick={() => handleStatusChange(selected, 'cancelled')}>Cancel</button>
                  )}
                </div>
              </div>
              {selected.notes && <p className="text-xs text-text-3 mt-2">{selected.notes}</p>}
              {selected.confirmed_at && <p className="text-xs text-text-3 mt-1">Confirmed: {fmtDate(selected.confirmed_at)} by {selected.confirmed_by || '-'}</p>}
            </div>
            <div className="flex-1 overflow-y-auto p-4">
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-xs font-bold text-text-3 uppercase tracking-wide">Items ({items.length})</h4>
                {canWrite && selected.status === 'pending' && (
                  <button className="btn btn-sm btn-outline text-xs" onClick={() => {
                    setItemForm({ ingredient_id: null, qty_sent: '', qty_received: '' })
                    setEditItem(null)
                    setShowItemForm(true)
                  }}>+ Add Item</button>
                )}
              </div>
              {items.length === 0 ? (
                <p className="text-sm text-text-3 text-center py-8">No items yet.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead><tr className="text-left text-xs text-text-3 uppercase tracking-wide border-b border-border">
                    <th className="pb-2 pr-3">Ingredient</th><th className="pb-2 pr-3">Unit</th>
                    <th className="pb-2 pr-3 text-right">Qty Sent</th><th className="pb-2 pr-3 text-right">Qty Received</th>
                    {canWrite && selected.status === 'pending' && <th className="pb-2 w-16"></th>}
                  </tr></thead>
                  <tbody>
                    {items.map(item => (
                      <tr key={item.id} className="border-b border-border/50 hover:bg-surface-2">
                        <td className="py-2 pr-3 font-medium">{item.ingredient_name}</td>
                        <td className="py-2 pr-3">{item.base_unit_abbr || '-'}</td>
                        <td className="py-2 pr-3 text-right">{fmtNum(item.qty_sent)}</td>
                        <td className="py-2 pr-3 text-right">{item.qty_received != null ? fmtNum(item.qty_received) : '-'}</td>
                        {canWrite && selected.status === 'pending' && (
                          <td className="py-2">
                            <div className="flex items-center gap-1">
                              <button className="p-1 rounded hover:bg-gray-100 text-text-3 hover:text-accent" onClick={() => {
                                setEditItem(item)
                                setItemForm({
                                  ingredient_id: item.ingredient_id,
                                  qty_sent: String(item.qty_sent),
                                  qty_received: item.qty_received != null ? String(item.qty_received) : '',
                                })
                                setShowItemForm(true)
                              }}>
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
                              </button>
                              <button className="p-1 rounded hover:bg-gray-100 text-text-3 hover:text-red-500" onClick={() => handleDeleteItem(item)}>
                                <TrashIcon />
                              </button>
                            </div>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </>
        ) : (
          <EmptyPanel message="Select a transfer from the list." />
        )}
      </div>

      {/* Right - item form */}
      {showItemForm && selected && (
        <div className="w-72 border-l border-border overflow-y-auto shrink-0 bg-surface p-4 space-y-3">
          <h3 className="text-sm font-bold text-text-1">{editItem ? 'Edit Item' : 'Add Item'}</h3>
          <Field label="Ingredient *">
            <SearchSelect items={ingredients} value={itemForm.ingredient_id}
              onChange={(id) => setItemForm(f => ({ ...f, ingredient_id: id }))}
              placeholder="Search ingredients..."
              renderSecondary={(i: IngredientRef) => i.base_unit_abbr || null} />
          </Field>
          <Field label="Qty Sent *">
            <input type="number" step="0.01" min="0" className="input w-full" value={itemForm.qty_sent}
              onChange={e => setItemForm(f => ({ ...f, qty_sent: e.target.value }))} />
          </Field>
          <Field label="Qty Received">
            <input type="number" step="0.01" min="0" className="input w-full" value={itemForm.qty_received}
              placeholder="Fill in on receipt" onChange={e => setItemForm(f => ({ ...f, qty_received: e.target.value }))} />
          </Field>
          <div className="flex gap-2 pt-2">
            <button className="btn btn-outline flex-1" onClick={() => { setShowItemForm(false); setEditItem(null) }}>Cancel</button>
            <button className="btn btn-primary flex-1" disabled={!itemForm.ingredient_id || !itemForm.qty_sent || saving} onClick={handleSaveItem}>
              {saving ? 'Saving...' : editItem ? 'Update' : 'Add'}
            </button>
          </div>
        </div>
      )}

      {/* New transfer modal */}
      {showModal && (
        <Modal title="New Transfer" onClose={() => setShowModal(false)}>
          <div className="space-y-3">
            <Field label="From Store *">
              <select className="input w-full" value={newTransfer.from_store_id} onChange={e => setNewTransfer(f => ({ ...f, from_store_id: e.target.value }))}>
                <option value="">Select store...</option>
                {stores.filter(s => s.is_active).map(s => <option key={s.id} value={String(s.id)}>{s.name} ({s.location_name})</option>)}
              </select>
            </Field>
            <Field label="To Store *">
              <select className="input w-full" value={newTransfer.to_store_id} onChange={e => setNewTransfer(f => ({ ...f, to_store_id: e.target.value }))}>
                <option value="">Select store...</option>
                {stores.filter(s => s.is_active && String(s.id) !== newTransfer.from_store_id).map(s => <option key={s.id} value={String(s.id)}>{s.name} ({s.location_name})</option>)}
              </select>
            </Field>
            <Field label="Notes">
              <textarea className="input w-full" rows={2} value={newTransfer.notes}
                onChange={e => setNewTransfer(f => ({ ...f, notes: e.target.value }))} />
            </Field>
          </div>
          <div className="flex justify-end gap-2 mt-4">
            <button className="btn btn-outline" onClick={() => setShowModal(false)}>Cancel</button>
            <button className="btn btn-primary" disabled={!newTransfer.from_store_id || !newTransfer.to_store_id || newTransfer.from_store_id === newTransfer.to_store_id || saving} onClick={handleCreate}>
              {saving ? 'Creating...' : 'Create Transfer'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════════
// StocktakeTab
// ════════════════════════════════════════════════════════════════════════════════
function StocktakeTab({ api, stores, ingredients, storeId, canWrite, showToast }: {
  api: ApiType; stores: Store[]; ingredients: IngredientRef[]
  storeId: number | null; canWrite: boolean; showToast: (msg: string, type?: 'success' | 'error') => void
}) {
  const [stocktakes, setStocktakes] = useState<Stocktake[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<Stocktake | null>(null)
  const [items, setItems] = useState<StocktakeItem[]>([])
  const [showModal, setShowModal] = useState(false)
  const [saving, setSaving] = useState(false)
  const [selectedItem, setSelectedItem] = useState<StocktakeItem | null>(null)
  const [addIngredientId, setAddIngredientId] = useState<number | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const q = storeId ? `?store_id=${storeId}` : ''
      const data = await api.get(`/stocktakes${q}`)
      setStocktakes(data || [])
    } finally { setLoading(false) }
  }, [api, storeId])

  useEffect(() => { load() }, [load])

  const loadItems = useCallback(async (stId: number) => {
    try {
      const data = await api.get(`/stocktakes/${stId}/items`)
      setItems(data || [])
    } catch { setItems([]) }
  }, [api])

  useEffect(() => {
    if (selected) loadItems(selected.id)
    else setItems([])
  }, [selected, loadItems])

  const [newST, setNewST] = useState({ store_id: '', stocktake_type: 'full' as 'full' | 'spot_check', notes: '' })

  const handleCreate = async () => {
    if (!newST.store_id) return
    setSaving(true)
    try {
      const created = await api.post('/stocktakes', {
        store_id: Number(newST.store_id),
        stocktake_type: newST.stocktake_type,
        notes: newST.notes.trim() || null,
      })
      showToast('Stocktake created')
      setShowModal(false)
      await load()
      setSelected(created)
    } catch (err: any) { showToast(err.message || 'Failed to create stocktake', 'error') }
    finally { setSaving(false) }
  }

  const handlePopulateAll = async () => {
    if (!selected) return
    setSaving(true)
    try {
      await api.post(`/stocktakes/${selected.id}/populate`, {})
      showToast('All ingredients populated')
      loadItems(selected.id)
    } catch (err: any) { showToast(err.message || 'Failed to populate', 'error') }
    finally { setSaving(false) }
  }

  const handleAddIngredient = async () => {
    if (!selected || !addIngredientId) return
    setSaving(true)
    try {
      await api.post(`/stocktakes/${selected.id}/items`, { ingredient_id: addIngredientId })
      showToast('Ingredient added')
      setAddIngredientId(null)
      loadItems(selected.id)
    } catch (err: any) { showToast(err.message || 'Failed to add', 'error') }
    finally { setSaving(false) }
  }

  const handleUpdateCount = async (item: StocktakeItem, counted_qty: number | null) => {
    if (!selected) return
    try {
      await api.patch(`/stocktakes/${selected.id}/items/${item.id}`, { counted_qty })
      loadItems(selected.id)
    } catch (err: any) { showToast(err.message || 'Failed to update count', 'error') }
  }

  const handleComplete = async () => {
    if (!selected) return
    try {
      await api.patch(`/stocktakes/${selected.id}`, { status: 'completed' })
      showToast('Stocktake completed - variances calculated')
      load()
      if (selected) setSelected({ ...selected, status: 'completed' })
    } catch (err: any) { showToast(err.message || 'Failed to complete', 'error') }
  }

  const handleApprove = async () => {
    if (!selected) return
    try {
      await api.patch(`/stocktakes/${selected.id}`, { status: 'approved' })
      showToast('Stocktake approved - stock levels adjusted')
      load()
      if (selected) setSelected({ ...selected, status: 'approved' })
    } catch (err: any) { showToast(err.message || 'Failed to approve', 'error') }
  }

  const handleDeleteItem = async (item: StocktakeItem) => {
    if (!selected) return
    try {
      await api.delete(`/stocktakes/${selected.id}/items/${item.id}`)
      showToast('Item removed')
      if (selectedItem?.id === item.id) setSelectedItem(null)
      loadItems(selected.id)
    } catch (err: any) { showToast(err.message || 'Failed to remove', 'error') }
  }

  if (loading) return <div className="flex items-center justify-center h-64"><Spinner /></div>

  return (
    <div className="flex h-full">
      {/* Left panel */}
      <div className="w-72 border-r border-border flex flex-col shrink-0 bg-surface">
        <div className="p-3 border-b border-border shrink-0">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold text-text-3 uppercase tracking-wide">Stocktakes</h3>
            {canWrite && <button className="btn btn-sm btn-primary text-xs py-1" onClick={() => {
              setNewST({ store_id: storeId ? String(storeId) : '', stocktake_type: 'full', notes: '' })
              setShowModal(true)
            }}>+ New Stocktake</button>}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {stocktakes.length === 0 ? (
            <EmptyPanel message="No stocktakes." />
          ) : stocktakes.map(st => (
            <div key={st.id}
              className={`px-3 py-2.5 border-b border-border/50 cursor-pointer hover:bg-surface-2 transition-colors ${selected?.id === st.id ? 'bg-accent-dim' : ''}`}
              onClick={() => { setSelected(st); setSelectedItem(null) }}>
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-text-1 truncate">{st.store_name}</span>
                <StatusBadge status={st.status} />
              </div>
              <div className="flex items-center gap-2 mt-0.5">
                <span className={`text-xs px-1.5 py-0.5 rounded-full ${st.stocktake_type === 'full' ? 'bg-blue-50 text-blue-700' : 'bg-purple-50 text-purple-700'}`}>
                  {st.stocktake_type === 'full' ? 'Full' : 'Spot Check'}
                </span>
                <span className="text-xs text-text-3">{fmtDate(st.started_at)}</span>
              </div>
              <div className="text-xs text-text-3 mt-0.5">{st.item_count ?? 0} items &middot; {st.variance_count ?? 0} variances</div>
            </div>
          ))}
        </div>
      </div>

      {/* Centre - count entry grid */}
      <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
        {selected ? (
          <>
            <div className="px-4 py-3 border-b border-border bg-surface shrink-0">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold text-text-1">{selected.store_name} - {selected.stocktake_type === 'full' ? 'Full Stocktake' : 'Spot Check'}</h3>
                  <div className="text-xs text-text-3 mt-0.5">Started {fmtDate(selected.started_at)} &middot; {items.length} items</div>
                </div>
                <div className="flex items-center gap-2">
                  <StatusBadge status={selected.status} />
                  {canWrite && selected.status === 'in_progress' && selected.stocktake_type === 'full' && (
                    <button className="btn btn-sm btn-outline text-xs" disabled={saving} onClick={handlePopulateAll}>
                      {saving ? 'Populating...' : 'Populate All'}
                    </button>
                  )}
                  {canWrite && selected.status === 'in_progress' && (
                    <button className="btn btn-sm btn-primary text-xs" onClick={handleComplete}>Complete</button>
                  )}
                  {canWrite && selected.status === 'completed' && (
                    <button className="btn btn-sm btn-primary text-xs" onClick={handleApprove}>Approve & Adjust Stock</button>
                  )}
                </div>
              </div>
              {/* Spot check: add ingredient */}
              {canWrite && selected.status === 'in_progress' && selected.stocktake_type === 'spot_check' && (
                <div className="flex items-center gap-2 mt-3">
                  <div className="flex-1">
                    <SearchSelect items={ingredients} value={addIngredientId}
                      onChange={(id) => setAddIngredientId(id)}
                      placeholder="Search ingredient to add..."
                      renderSecondary={(i: IngredientRef) => i.base_unit_abbr || null} />
                  </div>
                  <button className="btn btn-sm btn-primary text-xs" disabled={!addIngredientId || saving} onClick={handleAddIngredient}>Add</button>
                </div>
              )}
            </div>
            <div className="flex-1 overflow-y-auto p-4">
              {items.length === 0 ? (
                <p className="text-sm text-text-3 text-center py-8">
                  {selected.stocktake_type === 'full'
                    ? 'No items. Click "Populate All" to load all ingredients.'
                    : 'No items. Search and add ingredients above.'}
                </p>
              ) : (
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-white z-10"><tr className="text-left text-xs text-text-3 uppercase tracking-wide border-b border-border">
                    <th className="pb-2 pr-3">Ingredient</th><th className="pb-2 pr-3">Unit</th>
                    <th className="pb-2 pr-3 text-right">Expected</th>
                    <th className="pb-2 pr-3 text-right">Counted</th>
                    <th className="pb-2 pr-3 text-right">Variance</th>
                    <th className="pb-2 pr-3">Notes</th>
                    {canWrite && selected.status === 'in_progress' && <th className="pb-2 w-8"></th>}
                  </tr></thead>
                  <tbody>
                    {items.map(item => (
                      <tr key={item.id}
                        className={`border-b border-border/50 hover:bg-surface-2 cursor-pointer ${selectedItem?.id === item.id ? 'bg-accent-dim' : ''} ${item.variance != null && item.variance !== 0 ? (item.variance < 0 ? 'bg-red-50/30' : 'bg-yellow-50/30') : ''}`}
                        onClick={() => setSelectedItem(item)}>
                        <td className="py-2 pr-3 font-medium">{item.ingredient_name}</td>
                        <td className="py-2 pr-3">{item.base_unit_abbr || '-'}</td>
                        <td className="py-2 pr-3 text-right">{item.expected_qty != null ? fmtNum(item.expected_qty) : '-'}</td>
                        <td className="py-2 pr-3 text-right">
                          {canWrite && selected.status === 'in_progress' ? (
                            <input type="number" step="0.01" min="0"
                              className="input w-24 text-right text-sm py-1"
                              value={item.counted_qty ?? ''}
                              onClick={e => e.stopPropagation()}
                              onChange={e => {
                                const val = e.target.value === '' ? null : Number(e.target.value)
                                setItems(prev => prev.map(i => i.id === item.id ? { ...i, counted_qty: val } : i))
                              }}
                              onBlur={() => handleUpdateCount(item, items.find(i => i.id === item.id)?.counted_qty ?? null)}
                            />
                          ) : (
                            item.counted_qty != null ? fmtNum(item.counted_qty) : '-'
                          )}
                        </td>
                        <td className={`py-2 pr-3 text-right font-medium ${item.variance != null && item.variance < 0 ? 'text-red-600' : item.variance != null && item.variance > 0 ? 'text-yellow-600' : ''}`}>
                          {item.variance != null ? fmtNum(item.variance) : '-'}
                        </td>
                        <td className="py-2 pr-3 text-text-3 truncate max-w-[120px]">{item.notes || '-'}</td>
                        {canWrite && selected.status === 'in_progress' && (
                          <td className="py-2" onClick={e => e.stopPropagation()}>
                            <button className="p-1 rounded hover:bg-gray-100 text-text-3 hover:text-red-500" onClick={() => handleDeleteItem(item)}>
                              <TrashIcon />
                            </button>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </>
        ) : (
          <EmptyPanel message="Select a stocktake from the list." />
        )}
      </div>

      {/* Right - item detail */}
      <div className="w-64 border-l border-border overflow-y-auto shrink-0 bg-surface">
        {selectedItem ? (
          <div className="p-4 space-y-3">
            <h3 className="text-sm font-bold text-text-1">{selectedItem.ingredient_name}</h3>
            <div className="space-y-2 text-sm">
              <div><span className="text-text-3">Unit:</span> <span className="font-medium">{selectedItem.base_unit_abbr || '-'}</span></div>
              <div><span className="text-text-3">Expected Qty:</span> <span className="font-medium">{selectedItem.expected_qty != null ? fmtNum(selectedItem.expected_qty) : '-'}</span></div>
              <div><span className="text-text-3">Counted Qty:</span> <span className="font-medium">{selectedItem.counted_qty != null ? fmtNum(selectedItem.counted_qty) : 'Not counted'}</span></div>
              <div>
                <span className="text-text-3">Variance:</span>{' '}
                <span className={`font-medium ${selectedItem.variance != null && selectedItem.variance < 0 ? 'text-red-600' : selectedItem.variance != null && selectedItem.variance > 0 ? 'text-yellow-600' : 'text-green-600'}`}>
                  {selectedItem.variance != null ? fmtNum(selectedItem.variance) : '-'}
                </span>
              </div>
              {selectedItem.counted_by && <div><span className="text-text-3">Counted by:</span> <span className="font-medium">{selectedItem.counted_by}</span></div>}
              {selectedItem.counted_at && <div><span className="text-text-3">Counted at:</span> <span className="font-medium">{fmtDate(selectedItem.counted_at)}</span></div>}
              {selectedItem.notes && <div><span className="text-text-3">Notes:</span><p className="text-text-2 mt-1">{selectedItem.notes}</p></div>}
            </div>
          </div>
        ) : (
          <EmptyPanel message="Select an item to view details." />
        )}
      </div>

      {/* New stocktake modal */}
      {showModal && (
        <Modal title="New Stocktake" onClose={() => setShowModal(false)}>
          <div className="space-y-3">
            <Field label="Store *">
              <select className="input w-full" value={newST.store_id} onChange={e => setNewST(f => ({ ...f, store_id: e.target.value }))}>
                <option value="">Select store...</option>
                {stores.filter(s => s.is_active).map(s => <option key={s.id} value={String(s.id)}>{s.name} ({s.location_name})</option>)}
              </select>
            </Field>
            <Field label="Type">
              <div className="flex gap-2">
                <button className={`btn btn-sm ${newST.stocktake_type === 'full' ? 'btn-primary' : 'btn-outline'}`}
                  onClick={() => setNewST(f => ({ ...f, stocktake_type: 'full' }))}>Full Stocktake</button>
                <button className={`btn btn-sm ${newST.stocktake_type === 'spot_check' ? 'btn-primary' : 'btn-outline'}`}
                  onClick={() => setNewST(f => ({ ...f, stocktake_type: 'spot_check' }))}>Spot Check</button>
              </div>
            </Field>
            <Field label="Notes">
              <textarea className="input w-full" rows={2} value={newST.notes}
                onChange={e => setNewST(f => ({ ...f, notes: e.target.value }))} />
            </Field>
          </div>
          <div className="flex justify-end gap-2 mt-4">
            <button className="btn btn-outline" onClick={() => setShowModal(false)}>Cancel</button>
            <button className="btn btn-primary" disabled={!newST.store_id || saving} onClick={handleCreate}>
              {saving ? 'Creating...' : 'Start Stocktake'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════════
// StockManagerPage — Main export
// ════════════════════════════════════════════════════════════════════════════════
type Tab = 'overview' | 'stores' | 'purchase-orders' | 'goods-in' | 'invoices' | 'waste' | 'transfers' | 'stocktake'

export default function StockManagerPage() {
  const api = useApi()
  const { can } = usePermissions()
  const canWrite = can('stock_manager', 'write')

  const [activeTab, setActiveTab] = useState<Tab>('overview')

  // Global store filter (shared across tabs)
  const [stores, setStores] = useState<Store[]>([])
  const [activeStoreId, setActiveStoreId] = useState<number | null>(null)

  // Reference data
  const [locations, setLocations] = useState<Location[]>([])
  const [ingredients, setIngredients] = useState<IngredientRef[]>([])
  const [vendors, setVendors] = useState<VendorRef[]>([])

  // Toast
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null)
  const showToast = useCallback((msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 3000)
  }, [])

  // Load reference data on mount
  const loadRefData = useCallback(async () => {
    try {
      const [s, l, i, v] = await Promise.all([
        api.get('/stock-stores'),
        api.get('/locations?active=true'),
        api.get('/ingredients'),
        api.get('/vendors'),
      ])
      setStores(s || [])
      setLocations(l || [])
      setIngredients(i || [])
      setVendors(v || [])
    } catch { /* silently ignore */ }
  }, [api])

  useEffect(() => { loadRefData() }, [loadRefData])

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-6 pt-5 pb-0 border-b border-gray-200 bg-white shrink-0">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-lg font-bold text-text-1">Stock Manager</h1>
            <p className="text-sm text-text-3 mt-0.5">Inventory, purchasing, waste & stocktake</p>
          </div>
          <div className="flex items-center gap-3">
            {/* Global store filter */}
            <select
              value={activeStoreId ?? ''}
              onChange={e => setActiveStoreId(e.target.value ? Number(e.target.value) : null)}
              className="input text-sm py-1.5 w-56"
            >
              <option value="">All stores</option>
              {stores.filter(s => s.is_active).map(s => (
                <option key={s.id} value={s.id}>{s.name} ({s.location_name})</option>
              ))}
            </select>
          </div>
        </div>

        {/* Tab bar */}
        <div className="flex gap-1 -mb-px overflow-x-auto">
          {([
            { key: 'overview' as Tab, label: 'Overview' },
            { key: 'stores' as Tab, label: 'Stores' },
            { key: 'purchase-orders' as Tab, label: 'Purchase Orders' },
            { key: 'goods-in' as Tab, label: 'Goods In' },
            { key: 'invoices' as Tab, label: 'Invoices' },
            { key: 'waste' as Tab, label: 'Waste' },
            { key: 'transfers' as Tab, label: 'Transfers' },
            { key: 'stocktake' as Tab, label: 'Stocktake' },
          ]).map(t => (
            <button
              key={t.key}
              onClick={() => setActiveTab(t.key)}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap
                ${activeTab === t.key ? 'border-accent text-accent' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab content */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {activeTab === 'overview' && <OverviewTab storeId={activeStoreId} api={api} stores={stores} />}
        {activeTab === 'stores' && <StoresTab api={api} locations={locations} canWrite={canWrite} showToast={showToast} onStoresChange={loadRefData} />}
        {activeTab === 'purchase-orders' && <PurchaseOrdersTab api={api} stores={stores} vendors={vendors} ingredients={ingredients} storeId={activeStoreId} canWrite={canWrite} showToast={showToast} />}
        {activeTab === 'goods-in' && <GoodsInTab api={api} stores={stores} vendors={vendors} ingredients={ingredients} storeId={activeStoreId} canWrite={canWrite} showToast={showToast} />}
        {activeTab === 'invoices' && <InvoicesTab api={api} stores={stores} vendors={vendors} ingredients={ingredients} storeId={activeStoreId} canWrite={canWrite} showToast={showToast} />}
        {activeTab === 'waste' && <WasteTab api={api} stores={stores} ingredients={ingredients} storeId={activeStoreId} canWrite={canWrite} showToast={showToast} />}
        {activeTab === 'transfers' && <TransfersTab api={api} stores={stores} ingredients={ingredients} canWrite={canWrite} showToast={showToast} />}
        {activeTab === 'stocktake' && <StocktakeTab api={api} stores={stores} ingredients={ingredients} storeId={activeStoreId} canWrite={canWrite} showToast={showToast} />}
      </div>

      {/* Toast */}
      {toast && (
        <div className={`fixed bottom-6 right-6 z-50 flex items-center gap-3 px-4 py-3 rounded-lg shadow-lg text-sm font-semibold text-white
          ${toast.type === 'success' ? 'bg-accent' : 'bg-red-600'}`}>
          {toast.msg}
          <button onClick={() => setToast(null)} className="ml-2 opacity-70 hover:opacity-100">&times;</button>
        </div>
      )}
    </div>
  )
}
