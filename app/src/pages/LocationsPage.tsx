import { useState, useEffect, useCallback } from 'react'
import { useApi } from '../hooks/useApi'
import { PageHeader, Modal, Field, EmptyState, Spinner, ConfirmDialog, Toast } from '../components/ui'

// ── Types ─────────────────────────────────────────────────────────────────────

interface Location {
  id:             number
  name:           string
  country_id:     number | null
  group_id:       number | null
  address:        string | null
  email:          string | null
  phone:          string | null
  contact_name:   string | null
  contact_email:  string | null
  contact_phone:  string | null
  is_active:      boolean
  market_name:    string | null
  market_iso:     string | null
  group_name:     string | null
}

interface LocationGroup {
  id:             number
  name:           string
  description:    string | null
  location_count: number
}

interface Market {
  id:           number
  name:         string
  country_iso:  string | null
  currency_code: string
}

type Tab        = 'locations' | 'groups'
type ToastState = { message: string; type: 'success' | 'error' }

function isoToFlag(iso: string | null) {
  if (!iso || iso.length !== 2) return '🏳'
  return [...iso.toUpperCase()].map(c => String.fromCodePoint(0x1F1E6 - 65 + c.charCodeAt(0))).join('')
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function LocationsPage() {
  const [tab, setTab] = useState<Tab>('locations')
  const [locationCount, setLocationCount] = useState(0)
  const [groupCount,    setGroupCount]    = useState(0)

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="Locations"
        subtitle="Physical stores and sites. Linked to markets, grouped by city or region."
      />

      {/* Tabs */}
      <div className="flex gap-1 px-6 pt-4 bg-surface border-b border-border">
        {(['locations', 'groups'] as Tab[]).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2.5 text-sm font-semibold rounded-t transition-colors -mb-px
              ${tab === t
                ? 'text-accent border-b-2 border-accent bg-accent-dim/50'
                : 'text-text-3 hover:text-text-1'
              }`}
          >
            {t === 'locations' ? 'Locations' : 'Groups'}
            {t === 'locations' && locationCount > 0 && (
              <span className="ml-2 text-xs bg-accent-dim text-accent rounded-full px-1.5 py-0.5 font-bold">
                {locationCount}
              </span>
            )}
            {t === 'groups' && groupCount > 0 && (
              <span className="ml-2 text-xs bg-accent-dim text-accent rounded-full px-1.5 py-0.5 font-bold">
                {groupCount}
              </span>
            )}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {tab === 'locations' && (
          <LocationsTab onCountChange={setLocationCount} />
        )}
        {tab === 'groups' && (
          <GroupsTab onCountChange={setGroupCount} />
        )}
      </div>
    </div>
  )
}

// ── Locations Tab ─────────────────────────────────────────────────────────────

function LocationsTab({ onCountChange }: { onCountChange: (n: number) => void }) {
  const api = useApi()

  const [locations,     setLocations]     = useState<Location[]>([])
  const [markets,       setMarkets]       = useState<Market[]>([])
  const [groups,        setGroups]        = useState<LocationGroup[]>([])
  const [loading,       setLoading]       = useState(true)
  const [modal,         setModal]         = useState<Location | 'new' | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<Location | null>(null)
  const [toast,         setToast]         = useState<ToastState | null>(null)
  const [saving,        setSaving]        = useState(false)

  // Filters
  const [filterMarket, setFilterMarket] = useState('')
  const [filterGroup,  setFilterGroup]  = useState('')
  const [showInactive, setShowInactive] = useState(false)

  const blankForm = {
    name: '', country_id: '', group_id: '',
    address: '', email: '', phone: '',
    contact_name: '', contact_email: '', contact_phone: '',
    is_active: 'true',
  }
  const [form, setForm] = useState(blankForm)

  const showToast = (msg: string, type: 'success' | 'error' = 'success') => setToast({ message: msg, type })

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [locs, mkts, grps] = await Promise.all([
        api.get('/locations'),
        api.get('/countries'),
        api.get('/location-groups'),
      ])
      setLocations(locs || [])
      setMarkets(mkts || [])
      setGroups(grps || [])
      onCountChange((locs || []).length)
    } catch {
      showToast('Failed to load locations', 'error')
    } finally {
      setLoading(false)
    }
  }, [api, onCountChange])

  useEffect(() => { load() }, [load])

  function openAdd() { setModal('new'); setForm(blankForm) }
  function openEdit(loc: Location) {
    setModal(loc)
    setForm({
      name:          loc.name,
      country_id:    loc.country_id ? String(loc.country_id) : '',
      group_id:      loc.group_id   ? String(loc.group_id)   : '',
      address:       loc.address       || '',
      email:         loc.email         || '',
      phone:         loc.phone         || '',
      contact_name:  loc.contact_name  || '',
      contact_email: loc.contact_email || '',
      contact_phone: loc.contact_phone || '',
      is_active:     String(loc.is_active),
    })
  }

  async function handleSave() {
    if (!form.name.trim()) return showToast('Name is required', 'error')
    setSaving(true)
    try {
      const payload = {
        name:          form.name.trim(),
        country_id:    form.country_id  ? Number(form.country_id)  : null,
        group_id:      form.group_id    ? Number(form.group_id)    : null,
        address:       form.address.trim()       || null,
        email:         form.email.trim()         || null,
        phone:         form.phone.trim()         || null,
        contact_name:  form.contact_name.trim()  || null,
        contact_email: form.contact_email.trim() || null,
        contact_phone: form.contact_phone.trim() || null,
        is_active:     form.is_active !== 'false',
      }
      if (modal === 'new') {
        await api.post('/locations', payload)
        showToast('Location added')
      } else if (modal) {
        await api.put(`/locations/${(modal as Location).id}`, payload)
        showToast('Location updated')
      }
      setModal(null); load()
    } catch (err: any) { showToast(err.message || 'Save failed', 'error') }
    finally { setSaving(false) }
  }

  async function handleDelete() {
    if (!confirmDelete) return
    try {
      await api.delete(`/locations/${confirmDelete.id}`)
      showToast('Location deleted'); setConfirmDelete(null); load()
    } catch (err: any) { showToast(err.message || 'Delete failed', 'error'); setConfirmDelete(null) }
  }

  // Apply filters
  const filtered = locations.filter(loc => {
    if (filterMarket && String(loc.country_id) !== filterMarket) return false
    if (filterGroup  && String(loc.group_id)   !== filterGroup)  return false
    if (!showInactive && !loc.is_active) return false
    return true
  })

  return (
    <>
      {/* Filter bar */}
      <div className="flex gap-3 mb-5 flex-wrap items-center">
        <select
          className="select text-sm"
          value={filterMarket}
          onChange={e => setFilterMarket(e.target.value)}
        >
          <option value="">All Markets</option>
          {markets.map(m => (
            <option key={m.id} value={m.id}>
              {isoToFlag(m.country_iso)} {m.name}
            </option>
          ))}
        </select>

        <select
          className="select text-sm"
          value={filterGroup}
          onChange={e => setFilterGroup(e.target.value)}
        >
          <option value="">All Groups</option>
          {groups.map(g => (
            <option key={g.id} value={g.id}>{g.name}</option>
          ))}
        </select>

        <label className="flex items-center gap-2 text-sm text-text-2 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={showInactive}
            onChange={e => setShowInactive(e.target.checked)}
            className="w-4 h-4 accent-accent"
          />
          Show inactive
        </label>

        <button
          className="btn-primary px-4 py-2 text-sm flex items-center gap-2 ml-auto"
          onClick={openAdd}
        >
          <PlusIcon size={14} /> Add Location
        </button>
      </div>

      {loading ? <Spinner /> : filtered.length === 0 ? (
        <EmptyState
          message={locations.length === 0 ? 'No locations yet.' : 'No locations match the current filters.'}
          action={locations.length === 0
            ? <button className="btn-primary px-4 py-2 text-sm" onClick={openAdd}>Add Location</button>
            : undefined}
        />
      ) : (
        <div className="bg-surface border border-border rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-200 border-b border-gray-300">
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-text-2">Location</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-text-2">Market</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-text-2">Group</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-text-2">Address</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-text-2">Contact Person</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-text-2">Status</th>
                <th className="w-20" />
              </tr>
            </thead>
            <tbody>
              {filtered.map(loc => (
                <tr key={loc.id} className={`border-b border-border last:border-0 hover:bg-surface-2 transition-colors ${!loc.is_active ? 'opacity-60' : ''}`}>
                  {/* Name */}
                  <td className="px-4 py-3">
                    <div className="font-semibold text-text-1">{loc.name}</div>
                    {loc.email && <div className="text-xs text-text-3">{loc.email}</div>}
                    {loc.phone && !loc.email && <div className="text-xs text-text-3">{loc.phone}</div>}
                  </td>

                  {/* Market */}
                  <td className="px-4 py-3">
                    {loc.market_name ? (
                      <span className="flex items-center gap-1.5 text-text-2">
                        <span className="text-base leading-none">{isoToFlag(loc.market_iso)}</span>
                        <span>{loc.market_name}</span>
                      </span>
                    ) : <span className="text-text-3">—</span>}
                  </td>

                  {/* Group */}
                  <td className="px-4 py-3">
                    {loc.group_name
                      ? <span className="text-xs font-semibold bg-accent-dim text-accent px-2 py-0.5 rounded-full">{loc.group_name}</span>
                      : <span className="text-text-3">—</span>}
                  </td>

                  {/* Address */}
                  <td className="px-4 py-3 text-text-2 max-w-[180px]">
                    {loc.address
                      ? <span className="text-xs leading-snug line-clamp-2">{loc.address}</span>
                      : <span className="text-text-3">—</span>}
                  </td>

                  {/* Contact */}
                  <td className="px-4 py-3">
                    {loc.contact_name ? (
                      <div>
                        <div className="text-text-1 font-medium text-xs">{loc.contact_name}</div>
                        {loc.contact_email && <div className="text-xs text-text-3">{loc.contact_email}</div>}
                        {loc.contact_phone && <div className="text-xs text-text-3">{loc.contact_phone}</div>}
                      </div>
                    ) : <span className="text-text-3">—</span>}
                  </td>

                  {/* Status */}
                  <td className="px-4 py-3">
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${loc.is_active ? 'bg-accent-dim text-accent' : 'bg-surface-2 text-text-3 border border-border'}`}>
                      {loc.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </td>

                  {/* Actions */}
                  <td className="px-4 py-3">
                    <div className="flex gap-1.5 justify-end">
                      <button
                        className="w-7 h-7 flex items-center justify-center rounded border border-border text-text-3 hover:border-accent hover:text-accent transition-colors"
                        onClick={() => openEdit(loc)}
                        title="Edit"
                      >
                        <EditIcon size={12} />
                      </button>
                      <button
                        className="w-7 h-7 flex items-center justify-center rounded border border-red-200 text-red-400 hover:bg-red-50 hover:text-red-600 transition-colors"
                        onClick={() => setConfirmDelete(loc)}
                        title="Delete"
                      >
                        <TrashIcon size={12} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Add / Edit Modal */}
      {modal !== null && (
        <Modal
          title={modal === 'new' ? 'Add Location' : `Edit: ${(modal as Location).name}`}
          onClose={() => setModal(null)}
          width="max-w-2xl"
        >
          {/* Basic info */}
          <div className="grid grid-cols-2 gap-4">
            <Field label="Location Name" required>
              <input
                className="input w-full"
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="e.g. King Street Store"
                autoFocus
              />
            </Field>
            <Field label="Status">
              <select className="select w-full" value={form.is_active} onChange={e => setForm(f => ({ ...f, is_active: e.target.value }))}>
                <option value="true">Active</option>
                <option value="false">Inactive</option>
              </select>
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Market">
              <select className="select w-full" value={form.country_id} onChange={e => setForm(f => ({ ...f, country_id: e.target.value }))}>
                <option value="">— No market —</option>
                {markets.map(m => (
                  <option key={m.id} value={m.id}>
                    {isoToFlag(m.country_iso)} {m.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Group">
              <select className="select w-full" value={form.group_id} onChange={e => setForm(f => ({ ...f, group_id: e.target.value }))}>
                <option value="">— No group —</option>
                {groups.map(g => (
                  <option key={g.id} value={g.id}>{g.name}</option>
                ))}
              </select>
            </Field>
          </div>

          {/* Address */}
          <Field label="Address">
            <textarea
              className="input w-full"
              rows={3}
              value={form.address}
              onChange={e => setForm(f => ({ ...f, address: e.target.value }))}
              placeholder="Street, city, postcode"
            />
          </Field>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Location Email">
              <input className="input w-full" type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} placeholder="store@brand.com" />
            </Field>
            <Field label="Location Phone">
              <input className="input w-full" type="tel" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} placeholder="+44 20 1234 5678" />
            </Field>
          </div>

          {/* Contact Person */}
          <div className="border-t border-border pt-4 mt-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-text-3 mb-3">Contact Person</p>
            <Field label="Full Name">
              <input className="input w-full" value={form.contact_name} onChange={e => setForm(f => ({ ...f, contact_name: e.target.value }))} placeholder="e.g. Jane Smith" />
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Email">
                <input className="input w-full" type="email" value={form.contact_email} onChange={e => setForm(f => ({ ...f, contact_email: e.target.value }))} placeholder="jane@brand.com" />
              </Field>
              <Field label="Phone">
                <input className="input w-full" type="tel" value={form.contact_phone} onChange={e => setForm(f => ({ ...f, contact_phone: e.target.value }))} placeholder="+44 7700 900000" />
              </Field>
            </div>
          </div>

          <div className="flex gap-3 justify-end pt-2">
            <button className="btn-ghost px-4 py-2 text-sm" onClick={() => setModal(null)}>Cancel</button>
            <button className="btn-primary px-4 py-2 text-sm" onClick={handleSave} disabled={saving}>
              {saving ? 'Saving…' : modal === 'new' ? 'Add Location' : 'Save Changes'}
            </button>
          </div>
        </Modal>
      )}

      {confirmDelete && (
        <ConfirmDialog
          message={`Delete location "${confirmDelete.name}"? This cannot be undone.`}
          onConfirm={handleDelete}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </>
  )
}

// ── Groups Tab ────────────────────────────────────────────────────────────────

function GroupsTab({ onCountChange }: { onCountChange: (n: number) => void }) {
  const api = useApi()

  const [groups,        setGroups]        = useState<LocationGroup[]>([])
  const [loading,       setLoading]       = useState(true)
  const [modal,         setModal]         = useState<LocationGroup | 'new' | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<LocationGroup | null>(null)
  const [toast,         setToast]         = useState<ToastState | null>(null)
  const [saving,        setSaving]        = useState(false)

  const blankForm = { name: '', description: '' }
  const [form, setForm] = useState(blankForm)

  const showToast = (msg: string, type: 'success' | 'error' = 'success') => setToast({ message: msg, type })

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await api.get('/location-groups')
      setGroups(data || [])
      onCountChange((data || []).length)
    } catch { showToast('Failed to load groups', 'error') }
    finally { setLoading(false) }
  }, [api, onCountChange])

  useEffect(() => { load() }, [load])

  function openAdd()              { setModal('new'); setForm(blankForm) }
  function openEdit(g: LocationGroup) {
    setModal(g)
    setForm({ name: g.name, description: g.description || '' })
  }

  async function handleSave() {
    if (!form.name.trim()) return showToast('Name is required', 'error')
    setSaving(true)
    try {
      const payload = { name: form.name.trim(), description: form.description.trim() || null }
      if (modal === 'new') { await api.post('/location-groups', payload); showToast('Group added') }
      else if (modal)      { await api.put(`/location-groups/${(modal as LocationGroup).id}`, payload); showToast('Group updated') }
      setModal(null); load()
    } catch (err: any) { showToast(err.message || 'Save failed', 'error') }
    finally { setSaving(false) }
  }

  async function handleDelete() {
    if (!confirmDelete) return
    try {
      await api.delete(`/location-groups/${confirmDelete.id}`)
      showToast('Group deleted'); setConfirmDelete(null); load()
    } catch (err: any) { showToast(err.message || 'Delete failed', 'error'); setConfirmDelete(null) }
  }

  return (
    <>
      <div className="flex gap-3 mb-5">
        <button className="btn-primary px-4 py-2 text-sm flex items-center gap-2 ml-auto" onClick={openAdd}>
          <PlusIcon size={14} /> Add Group
        </button>
      </div>

      {loading ? <Spinner /> : groups.length === 0 ? (
        <EmptyState
          message="No location groups yet. Groups let you cluster locations by city or region."
          action={<button className="btn-primary px-4 py-2 text-sm" onClick={openAdd}>Add Group</button>}
        />
      ) : (
        <div className="bg-surface border border-border rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-200 border-b border-gray-300">
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-text-2">Group Name</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-text-2">Description</th>
                <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-text-2">Locations</th>
                <th className="w-20" />
              </tr>
            </thead>
            <tbody>
              {groups.map(g => (
                <tr key={g.id} className="border-b border-border last:border-0 hover:bg-surface-2 transition-colors">
                  <td className="px-4 py-3 font-semibold text-text-1">{g.name}</td>
                  <td className="px-4 py-3 text-text-2">{g.description || <span className="text-text-3">—</span>}</td>
                  <td className="px-4 py-3 text-right">
                    <span className="text-xs font-bold bg-accent-dim text-accent px-2 py-0.5 rounded-full">
                      {g.location_count}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1.5 justify-end">
                      <button
                        className="w-7 h-7 flex items-center justify-center rounded border border-border text-text-3 hover:border-accent hover:text-accent transition-colors"
                        onClick={() => openEdit(g)}
                      >
                        <EditIcon size={12} />
                      </button>
                      <button
                        className="w-7 h-7 flex items-center justify-center rounded border border-red-200 text-red-400 hover:bg-red-50 hover:text-red-600 transition-colors"
                        onClick={() => setConfirmDelete(g)}
                      >
                        <TrashIcon size={12} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modal !== null && (
        <Modal title={modal === 'new' ? 'Add Group' : 'Edit Group'} onClose={() => setModal(null)}>
          <Field label="Group Name" required>
            <input
              className="input w-full"
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              placeholder="e.g. London Central"
              autoFocus
            />
          </Field>
          <Field label="Description">
            <input
              className="input w-full"
              value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              placeholder="Optional note"
            />
          </Field>
          <div className="flex gap-3 justify-end pt-2">
            <button className="btn-ghost px-4 py-2 text-sm" onClick={() => setModal(null)}>Cancel</button>
            <button className="btn-primary px-4 py-2 text-sm" onClick={handleSave} disabled={saving}>
              {saving ? 'Saving…' : 'Save Group'}
            </button>
          </div>
        </Modal>
      )}

      {confirmDelete && (
        <ConfirmDialog
          message={`Delete group "${confirmDelete.name}"? Locations in this group will be unassigned but not deleted.`}
          onConfirm={handleDelete}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </>
  )
}

// ── Icons ─────────────────────────────────────────────────────────────────────

function PlusIcon({ size = 16 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M12 5v14M5 12h14"/></svg>
}
function EditIcon({ size = 16 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
}
function TrashIcon({ size = 16 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6M10 11v6M14 11v6M9 6V4h6v2"/></svg>
}
