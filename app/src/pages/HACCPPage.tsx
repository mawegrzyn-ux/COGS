import { useState, useEffect, useCallback, useMemo } from 'react'
import { useApi } from '../hooks/useApi'
import { PageHeader, Modal, Field, EmptyState, Spinner, ConfirmDialog, Toast } from '../components/ui'

// ── Types ─────────────────────────────────────────────────────────────────────

interface Location {
  id:   number
  name: string
}

interface Equipment {
  id:              number
  name:            string
  type:            string
  location_id:     number | null
  location_name:   string | null
  location_desc:   string | null
  target_min_temp: number | null
  target_max_temp: number | null
  is_active:       boolean
  log_count:       number
  last_logged_at:  string | null
  last_temp_c:     number | null
  last_in_range:   boolean | null
}

interface TempLog {
  id:               number
  equipment_id:     number
  equipment_name?:  string
  temp_c:           number
  in_range:         boolean
  corrective_action: string | null
  logged_by:        string | null
  notes:            string | null
  logged_at:        string
}

interface CcpLog {
  id:               number
  log_type:         'cooking' | 'cooling' | 'delivery'
  recipe_name?:     string | null
  item_name:        string
  target_min_temp:  number
  target_max_temp:  number
  actual_temp:      number
  passed:           boolean
  corrective_action: string | null
  logged_by:        string | null
  notes:            string | null
  logged_at:        string
}

interface Report {
  period:      { date_from: string | null; date_to: string | null }
  equipment:   any[]
  ccp_summary: any[]
  incidents:   any[]
}

type HACCPTab   = 'equipment' | 'temp-logs' | 'ccp-logs' | 'report'
type ToastState = { message: string; type: 'success' | 'error' }

const EQUIPMENT_TYPES = ['fridge', 'freezer', 'hot_hold', 'display', 'other']
const CCP_LOG_TYPES   = ['cooking', 'cooling', 'delivery']

// ── Page ──────────────────────────────────────────────────────────────────────

export default function HACCPPage() {
  const api = useApi()
  const [tab,        setTab]        = useState<HACCPTab>('equipment')
  const [locationId, setLocationId] = useState<number | null>(null)
  const [locations,  setLocations]  = useState<Location[]>([])

  useEffect(() => {
    api.get('/locations?active=true').then((d: Location[]) => setLocations(d || [])).catch(() => {})
  }, [api])

  const TAB_LABELS: Record<HACCPTab, string> = {
    'equipment':  'Equipment',
    'temp-logs':  'Temp Logs',
    'ccp-logs':   'CCP Logs',
    'report':     'Report',
  }

  const selectedLocation = locations.find(l => l.id === locationId)

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="HACCP"
        subtitle="Hazard Analysis Critical Control Points — equipment monitoring and process logs."
      />

      {/* Location selector bar */}
      <div className="flex items-center gap-3 px-6 py-3 bg-surface-2 border-b border-border">
        <span className="text-xs font-semibold text-text-3 uppercase tracking-wide shrink-0">Location</span>
        <select
          className="select text-sm max-w-xs"
          value={locationId ?? ''}
          onChange={e => setLocationId(e.target.value ? Number(e.target.value) : null)}
        >
          <option value="">All Locations</option>
          {locations.map(l => (
            <option key={l.id} value={l.id}>{l.name}</option>
          ))}
        </select>
        {selectedLocation && (
          <span className="text-xs text-text-3">
            Showing data for <span className="font-semibold text-text-2">{selectedLocation.name}</span>
          </span>
        )}
        {locationId && (
          <button
            className="text-xs text-text-3 hover:text-accent underline"
            onClick={() => setLocationId(null)}
          >
            Clear
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 px-6 pt-4 bg-surface border-b border-border">
        {(['equipment', 'temp-logs', 'ccp-logs', 'report'] as HACCPTab[]).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2.5 text-sm font-semibold rounded-t transition-colors
              ${tab === t
                ? 'text-accent border-b-2 border-accent bg-accent-dim/50'
                : 'text-text-3 hover:text-text-1'
              }`}
          >
            {TAB_LABELS[t]}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {tab === 'equipment'  && <EquipmentTab  locationId={locationId} locations={locations} />}
        {tab === 'temp-logs'  && <TempLogsTab   locationId={locationId} />}
        {tab === 'ccp-logs'   && <CcpLogsTab    locationId={locationId} />}
        {tab === 'report'     && <ReportTab     locationId={locationId} />}
      </div>
    </div>
  )
}

// ── Equipment Tab ─────────────────────────────────────────────────────────────

function EquipmentTab({ locationId, locations }: { locationId: number | null; locations: Location[] }) {
  const api = useApi()

  const [equipment,     setEquipment]     = useState<Equipment[]>([])
  const [loading,       setLoading]       = useState(true)
  const [modal,         setModal]         = useState<Equipment | 'new' | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<Equipment | null>(null)
  const [toast,         setToast]         = useState<ToastState | null>(null)

  const blankForm = { name: '', type: 'fridge', location_id: locationId ? String(locationId) : '', location_desc: '', target_min_temp: '', target_max_temp: '', is_active: 'true' }
  const [form,   setForm]   = useState(blankForm)
  const [saving, setSaving] = useState(false)

  const showToast = (msg: string, type: 'success' | 'error' = 'success') => setToast({ message: msg, type })

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const qs = locationId ? `?location_id=${locationId}` : ''
      setEquipment(await api.get(`/haccp/equipment${qs}`) || [])
    }
    catch { showToast('Failed to load equipment', 'error') }
    finally { setLoading(false) }
  }, [api, locationId])

  useEffect(() => { load() }, [load])

  function openAdd() { setModal('new'); setForm({ ...blankForm, location_id: locationId ? String(locationId) : '' }) }
  function openEdit(e: Equipment) {
    setModal(e)
    setForm({
      name:            e.name,
      type:            e.type,
      location_id:     e.location_id != null ? String(e.location_id) : '',
      location_desc:   e.location_desc || '',
      target_min_temp: e.target_min_temp != null ? String(e.target_min_temp) : '',
      target_max_temp: e.target_max_temp != null ? String(e.target_max_temp) : '',
      is_active:       String(e.is_active),
    })
  }

  async function handleSave() {
    if (!form.name.trim()) return showToast('Name is required', 'error')
    setSaving(true)
    try {
      const payload = {
        name:            form.name.trim(),
        type:            form.type,
        location_id:     form.location_id ? Number(form.location_id) : null,
        location_desc:   form.location_desc.trim() || null,
        target_min_temp: form.target_min_temp !== '' ? Number(form.target_min_temp) : null,
        target_max_temp: form.target_max_temp !== '' ? Number(form.target_max_temp) : null,
        is_active:       form.is_active !== 'false',
      }
      if (modal === 'new') { await api.post('/haccp/equipment', payload); showToast('Equipment added') }
      else if (modal) { await api.put(`/haccp/equipment/${(modal as Equipment).id}`, payload); showToast('Equipment updated') }
      setModal(null); load()
    } catch (err: any) { showToast(err.message || 'Save failed', 'error') }
    finally { setSaving(false) }
  }

  async function handleDelete() {
    if (!confirmDelete) return
    try {
      await api.delete(`/haccp/equipment/${confirmDelete.id}`)
      showToast('Equipment deleted'); setConfirmDelete(null); load()
    } catch (err: any) { showToast(err.message || 'Delete failed', 'error'); setConfirmDelete(null) }
  }

  const typeColors: Record<string, string> = {
    fridge:   'bg-blue-100 text-blue-700',
    freezer:  'bg-indigo-100 text-indigo-700',
    hot_hold: 'bg-orange-100 text-orange-700',
    display:  'bg-purple-100 text-purple-700',
    other:    'bg-surface-2 text-text-3',
  }

  return (
    <>
      <div className="flex gap-3 mb-5">
        <button className="btn-primary px-4 py-2 text-sm flex items-center gap-2 ml-auto" onClick={openAdd}>
          <PlusIcon size={14} /> Add Equipment
        </button>
      </div>

      {loading ? <Spinner /> : equipment.length === 0 ? (
        <EmptyState
          message="No equipment registered yet."
          action={<button className="btn-primary px-4 py-2 text-sm" onClick={openAdd}>Add Equipment</button>}
        />
      ) : (
        <div className="grid gap-4 grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
          {equipment.map(eq => (
            <div key={eq.id} className={`bg-surface border rounded-xl p-5 ${!eq.is_active ? 'opacity-60' : 'border-border'}`}>
              <div className="flex items-start justify-between gap-2 mb-3">
                <div>
                  <div className="font-extrabold text-text-1">{eq.name}</div>
                  {eq.location_name && <div className="text-xs text-accent font-semibold mt-0.5">📍 {eq.location_name}</div>}
                  {eq.location_desc && <div className="text-xs text-text-3 mt-0.5">{eq.location_desc}</div>}
                </div>
                <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${typeColors[eq.type] || typeColors.other}`}>
                  {eq.type.replace('_', ' ')}
                </span>
              </div>

              <div className="space-y-1.5 mb-3 text-sm">
                {(eq.target_min_temp != null || eq.target_max_temp != null) && (
                  <div className="text-text-2">
                    Target: <span className="font-mono font-semibold">
                      {eq.target_min_temp != null ? `${eq.target_min_temp}°C` : '—'} to {eq.target_max_temp != null ? `${eq.target_max_temp}°C` : '—'}
                    </span>
                  </div>
                )}
                {eq.last_temp_c != null && (
                  <div className="flex items-center gap-2">
                    <span className="text-text-2">Last reading: <span className="font-mono font-semibold">{eq.last_temp_c}°C</span></span>
                    <span className={`text-xs font-bold px-1.5 py-0.5 rounded-full ${eq.last_in_range ? 'bg-accent-dim text-accent' : 'bg-red-100 text-red-600'}`}>
                      {eq.last_in_range ? 'OK' : 'OUT'}
                    </span>
                  </div>
                )}
                <div className="text-xs text-text-3">{eq.log_count} log{eq.log_count !== 1 ? 's' : ''}{eq.last_logged_at ? ` · Last: ${new Date(eq.last_logged_at).toLocaleDateString()}` : ''}</div>
              </div>

              <div className="flex gap-2">
                <button className="btn-outline flex-1 py-1.5 text-sm flex items-center justify-center gap-1.5" onClick={() => openEdit(eq)}>
                  <EditIcon size={13} /> Edit
                </button>
                <button className="flex-1 py-1.5 text-sm flex items-center justify-center gap-1.5 rounded-lg border border-red-200 text-red-500 hover:bg-red-50 transition-colors font-semibold" onClick={() => setConfirmDelete(eq)}>
                  <TrashIcon size={13} /> Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {modal !== null && (
        <Modal title={modal === 'new' ? 'Add Equipment' : 'Edit Equipment'} onClose={() => setModal(null)}>
          <Field label="Name" required>
            <input className="input w-full" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Walk-in Fridge A" autoFocus />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Type" required>
              <select className="select w-full" value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))}>
                {EQUIPMENT_TYPES.map(t => <option key={t} value={t}>{t.replace('_', ' ')}</option>)}
              </select>
            </Field>
            <Field label="Status">
              <select className="select w-full" value={form.is_active} onChange={e => setForm(f => ({ ...f, is_active: e.target.value }))}>
                <option value="true">Active</option>
                <option value="false">Inactive</option>
              </select>
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Location">
              <select className="select w-full" value={form.location_id} onChange={e => setForm(f => ({ ...f, location_id: e.target.value }))}>
                <option value="">— No location —</option>
                {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </Field>
            <Field label="Position / Description">
              <input className="input w-full" value={form.location_desc} onChange={e => setForm(f => ({ ...f, location_desc: e.target.value }))} placeholder="e.g. Kitchen — back wall" />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Min Target Temp (°C)">
              <input className="input w-full font-mono" type="number" step="0.5" value={form.target_min_temp} onChange={e => setForm(f => ({ ...f, target_min_temp: e.target.value }))} placeholder="e.g. 1" />
            </Field>
            <Field label="Max Target Temp (°C)">
              <input className="input w-full font-mono" type="number" step="0.5" value={form.target_max_temp} onChange={e => setForm(f => ({ ...f, target_max_temp: e.target.value }))} placeholder="e.g. 5" />
            </Field>
          </div>
          <div className="flex gap-3 justify-end pt-2">
            <button className="btn-ghost px-4 py-2 text-sm" onClick={() => setModal(null)}>Cancel</button>
            <button className="btn-primary px-4 py-2 text-sm" onClick={handleSave} disabled={saving}>
              {saving ? 'Saving…' : 'Save Equipment'}
            </button>
          </div>
        </Modal>
      )}

      {confirmDelete && (
        <ConfirmDialog
          message={`Delete equipment "${confirmDelete.name}"? All temperature logs will also be deleted.`}
          onConfirm={handleDelete}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </>
  )
}

// ── Temp Logs Tab ─────────────────────────────────────────────────────────────

function TempLogsTab({ locationId }: { locationId: number | null }) {
  const api = useApi()

  const [equipment,   setEquipment]   = useState<Equipment[]>([])
  const [logs,        setLogs]        = useState<TempLog[]>([])
  const [loading,     setLoading]     = useState(false)
  const [selectedEq,  setSelectedEq]  = useState('')
  const [modal,       setModal]       = useState(false)
  const [confirmDel,  setConfirmDel]  = useState<TempLog | null>(null)
  const [toast,       setToast]       = useState<ToastState | null>(null)
  const [saving,      setSaving]      = useState(false)

  const blankForm = { temp_c: '', logged_by: '', notes: '', corrective_action: '', logged_at: '' }
  const [form, setForm] = useState(blankForm)

  const showToast = (msg: string, type: 'success' | 'error' = 'success') => setToast({ message: msg, type })

  useEffect(() => {
    const qs = locationId ? `?location_id=${locationId}` : ''
    api.get(`/haccp/equipment${qs}`).then((d: Equipment[]) => {
      setEquipment(d || [])
      // Clear selection if the selected equipment is no longer in the filtered list
      if (selectedEq && !(d || []).find((e: Equipment) => String(e.id) === selectedEq)) {
        setSelectedEq('')
      }
    }).catch(() => {})
  }, [api, locationId])

  const loadLogs = useCallback(async (eqId: string) => {
    if (!eqId) { setLogs([]); return }
    setLoading(true)
    try { setLogs(await api.get(`/haccp/equipment/${eqId}/logs?limit=100`) || []) }
    catch { showToast('Failed to load logs', 'error') }
    finally { setLoading(false) }
  }, [api])

  useEffect(() => { loadLogs(selectedEq) }, [selectedEq, loadLogs])

  const selectedEquipment = equipment.find(e => String(e.id) === selectedEq)

  // Check if temp is out of range for current equipment
  function isOutOfRange(temp: string) {
    if (!selectedEquipment || temp === '') return false
    const t = Number(temp)
    const { target_min_temp: mn, target_max_temp: mx } = selectedEquipment
    return (mn != null && t < mn) || (mx != null && t > mx)
  }

  const outOfRange = isOutOfRange(form.temp_c)

  async function handleSave() {
    if (!selectedEq) return showToast('Select equipment first', 'error')
    if (form.temp_c === '') return showToast('Temperature is required', 'error')
    if (outOfRange && !form.corrective_action.trim()) return showToast('Corrective action required for out-of-range temperature', 'error')
    setSaving(true)
    try {
      await api.post(`/haccp/equipment/${selectedEq}/logs`, {
        temp_c:            Number(form.temp_c),
        logged_by:         form.logged_by.trim() || null,
        notes:             form.notes.trim() || null,
        corrective_action: form.corrective_action.trim() || null,
        logged_at:         form.logged_at || undefined,
      })
      showToast('Temperature logged'); setModal(false); setForm(blankForm); loadLogs(selectedEq)
    } catch (err: any) { showToast(err.message || 'Save failed', 'error') }
    finally { setSaving(false) }
  }

  async function handleDelete() {
    if (!confirmDel) return
    try {
      await api.delete(`/haccp/equipment-logs/${confirmDel.id}`)
      showToast('Log deleted'); setConfirmDel(null); loadLogs(selectedEq)
    } catch (err: any) { showToast(err.message || 'Delete failed', 'error'); setConfirmDel(null) }
  }

  return (
    <>
      <div className="flex gap-3 mb-5 flex-wrap">
        <select
          className="select flex-1 min-w-[200px] max-w-xs"
          value={selectedEq}
          onChange={e => setSelectedEq(e.target.value)}
        >
          <option value="">Select equipment…</option>
          {equipment.filter(e => e.is_active).map(e => (
            <option key={e.id} value={e.id}>{e.name}</option>
          ))}
        </select>
        {selectedEq && (
          <button className="btn-primary px-4 py-2 text-sm flex items-center gap-2 ml-auto" onClick={() => { setModal(true); setForm(blankForm) }}>
            <PlusIcon size={14} /> Log Temperature
          </button>
        )}
      </div>

      {!selectedEq ? (
        <EmptyState message="Select a piece of equipment to view its temperature logs." />
      ) : loading ? (
        <Spinner />
      ) : logs.length === 0 ? (
        <EmptyState
          message="No temperature logs for this equipment yet."
          action={<button className="btn-primary px-4 py-2 text-sm" onClick={() => setModal(true)}>Log Temperature</button>}
        />
      ) : (
        <div className="bg-surface border border-border rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-surface-2 border-b border-border">
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-text-2">Date / Time</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-text-2">Temp (°C)</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-text-2">Status</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-text-2">Logged By</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-text-2">Corrective Action</th>
                <th className="w-12" />
              </tr>
            </thead>
            <tbody>
              {logs.map(log => (
                <tr key={log.id} className="border-b border-border last:border-0 hover:bg-surface-2 transition-colors">
                  <td className="px-4 py-3 text-text-2 font-mono text-xs">{new Date(log.logged_at).toLocaleString()}</td>
                  <td className="px-4 py-3 font-mono font-bold text-text-1">{log.temp_c}°C</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${log.in_range ? 'bg-accent-dim text-accent' : 'bg-red-100 text-red-600'}`}>
                      {log.in_range ? 'In Range' : 'Out of Range'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-text-2">{log.logged_by || '—'}</td>
                  <td className="px-4 py-3 text-text-2 max-w-xs truncate">{log.corrective_action || '—'}</td>
                  <td className="px-4 py-3">
                    <button className="w-7 h-7 flex items-center justify-center rounded border border-red-200 text-red-400 hover:bg-red-50 hover:text-red-600 transition-colors" onClick={() => setConfirmDel(log)}>
                      <TrashIcon size={12} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modal && (
        <Modal title="Log Temperature" onClose={() => setModal(false)}>
          {selectedEquipment && (selectedEquipment.target_min_temp != null || selectedEquipment.target_max_temp != null) && (
            <div className="bg-surface-2 rounded-lg px-3 py-2 text-xs text-text-2 mb-3">
              Target range: <span className="font-mono font-semibold">
                {selectedEquipment.target_min_temp != null ? `${selectedEquipment.target_min_temp}°C` : '—'} to {selectedEquipment.target_max_temp != null ? `${selectedEquipment.target_max_temp}°C` : '—'}
              </span>
            </div>
          )}
          <Field label="Temperature (°C)" required>
            <input className={`input w-full font-mono ${outOfRange ? 'border-red-400 focus:ring-red-400' : ''}`} type="number" step="0.1" value={form.temp_c} onChange={e => setForm(f => ({ ...f, temp_c: e.target.value }))} placeholder="e.g. 3.5" autoFocus />
            {outOfRange && <p className="text-xs text-red-500 mt-1 font-semibold">Out of range — corrective action required.</p>}
          </Field>
          <Field label={`Corrective Action${outOfRange ? ' *' : ''}`}>
            <textarea className="input w-full" rows={2} value={form.corrective_action} onChange={e => setForm(f => ({ ...f, corrective_action: e.target.value }))} placeholder={outOfRange ? 'Describe action taken…' : 'Optional'} />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Logged By">
              <input className="input w-full" value={form.logged_by} onChange={e => setForm(f => ({ ...f, logged_by: e.target.value }))} placeholder="Name" />
            </Field>
            <Field label="Override Date/Time">
              <input className="input w-full" type="datetime-local" value={form.logged_at} onChange={e => setForm(f => ({ ...f, logged_at: e.target.value }))} />
              <p className="text-xs text-text-3 mt-1">Leave blank for now.</p>
            </Field>
          </div>
          <Field label="Notes">
            <input className="input w-full" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Optional" />
          </Field>
          <div className="flex gap-3 justify-end pt-2">
            <button className="btn-ghost px-4 py-2 text-sm" onClick={() => setModal(false)}>Cancel</button>
            <button className="btn-primary px-4 py-2 text-sm" onClick={handleSave} disabled={saving}>
              {saving ? 'Saving…' : 'Log Temperature'}
            </button>
          </div>
        </Modal>
      )}

      {confirmDel && (
        <ConfirmDialog
          message="Delete this temperature log? This action cannot be undone."
          onConfirm={handleDelete}
          onCancel={() => setConfirmDel(null)}
        />
      )}
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </>
  )
}

// ── CCP Logs Tab ──────────────────────────────────────────────────────────────

function CcpLogsTab({ locationId }: { locationId: number | null }) {
  const api = useApi()

  const [logs,        setLogs]        = useState<CcpLog[]>([])
  const [loading,     setLoading]     = useState(true)
  const [filterType,  setFilterType]  = useState('')
  const [modal,       setModal]       = useState(false)
  const [confirmDel,  setConfirmDel]  = useState<CcpLog | null>(null)
  const [toast,       setToast]       = useState<ToastState | null>(null)
  const [saving,      setSaving]      = useState(false)

  const blankForm = { log_type: 'cooking', item_name: '', target_min_temp: '', target_max_temp: '', actual_temp: '', corrective_action: '', logged_by: '', notes: '', logged_at: '' }
  const [form, setForm] = useState(blankForm)

  const showToast = (msg: string, type: 'success' | 'error' = 'success') => setToast({ message: msg, type })

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (filterType) params.set('log_type', filterType)
      if (locationId) params.set('location_id', String(locationId))
      const query = params.toString() ? `?${params}` : ''
      setLogs(await api.get(`/haccp/ccp-logs${query}`) || [])
    } catch { showToast('Failed to load CCP logs', 'error') }
    finally { setLoading(false) }
  }, [api, filterType, locationId])

  useEffect(() => { load() }, [load])

  const passed  = useMemo(() => form.target_min_temp !== '' && form.target_max_temp !== '' && form.actual_temp !== ''
    ? Number(form.actual_temp) >= Number(form.target_min_temp) && Number(form.actual_temp) <= Number(form.target_max_temp)
    : null, [form])

  async function handleSave() {
    if (!form.item_name.trim()) return showToast('Item name is required', 'error')
    if (form.target_min_temp === '' || form.target_max_temp === '' || form.actual_temp === '')
      return showToast('All temperature fields are required', 'error')
    if (passed === false && !form.corrective_action.trim())
      return showToast('Corrective action required when CCP fails', 'error')

    setSaving(true)
    try {
      await api.post('/haccp/ccp-logs', {
        log_type:          form.log_type,
        item_name:         form.item_name.trim(),
        target_min_temp:   Number(form.target_min_temp),
        target_max_temp:   Number(form.target_max_temp),
        actual_temp:       Number(form.actual_temp),
        corrective_action: form.corrective_action.trim() || null,
        logged_by:         form.logged_by.trim() || null,
        notes:             form.notes.trim() || null,
        logged_at:         form.logged_at || undefined,
        location_id:       locationId || null,
      })
      showToast('CCP log saved'); setModal(false); setForm(blankForm); load()
    } catch (err: any) { showToast(err.message || 'Save failed', 'error') }
    finally { setSaving(false) }
  }

  async function handleDelete() {
    if (!confirmDel) return
    try {
      await api.delete(`/haccp/ccp-logs/${confirmDel.id}`)
      showToast('Log deleted'); setConfirmDel(null); load()
    } catch (err: any) { showToast(err.message || 'Delete failed', 'error'); setConfirmDel(null) }
  }

  const typeColors: Record<string, string> = {
    cooking:  'bg-orange-100 text-orange-700',
    cooling:  'bg-blue-100 text-blue-700',
    delivery: 'bg-purple-100 text-purple-700',
  }

  return (
    <>
      <div className="flex gap-3 mb-5 flex-wrap">
        <select className="select" value={filterType} onChange={e => setFilterType(e.target.value)}>
          <option value="">All Types</option>
          {CCP_LOG_TYPES.map(t => <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>)}
        </select>
        <button className="btn-primary px-4 py-2 text-sm flex items-center gap-2 ml-auto" onClick={() => { setModal(true); setForm(blankForm) }}>
          <PlusIcon size={14} /> Log CCP
        </button>
      </div>

      {loading ? <Spinner /> : logs.length === 0 ? (
        <EmptyState
          message="No CCP logs yet."
          action={<button className="btn-primary px-4 py-2 text-sm" onClick={() => setModal(true)}>Log CCP</button>}
        />
      ) : (
        <div className="bg-surface border border-border rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-surface-2 border-b border-border">
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-text-2">Type</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-text-2">Item</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-text-2">Target</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-text-2">Actual</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-text-2">Result</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-text-2">Logged By</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-text-2">Date</th>
                <th className="w-12" />
              </tr>
            </thead>
            <tbody>
              {logs.map(log => (
                <tr key={log.id} className="border-b border-border last:border-0 hover:bg-surface-2 transition-colors">
                  <td className="px-4 py-3">
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${typeColors[log.log_type] || ''}`}>
                      {log.log_type}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-semibold text-text-1">{log.item_name}</td>
                  <td className="px-4 py-3 font-mono text-text-2 text-xs">{log.target_min_temp}–{log.target_max_temp}°C</td>
                  <td className="px-4 py-3 font-mono font-bold text-text-1">{log.actual_temp}°C</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${log.passed ? 'bg-accent-dim text-accent' : 'bg-red-100 text-red-600'}`}>
                      {log.passed ? 'Pass' : 'Fail'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-text-2">{log.logged_by || '—'}</td>
                  <td className="px-4 py-3 font-mono text-text-2 text-xs">{new Date(log.logged_at).toLocaleDateString()}</td>
                  <td className="px-4 py-3">
                    <button className="w-7 h-7 flex items-center justify-center rounded border border-red-200 text-red-400 hover:bg-red-50 hover:text-red-600 transition-colors" onClick={() => setConfirmDel(log)}>
                      <TrashIcon size={12} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modal && (
        <Modal title="Log CCP Check" onClose={() => setModal(false)} width="max-w-xl">
          <div className="grid grid-cols-2 gap-4">
            <Field label="Log Type" required>
              <select className="select w-full" value={form.log_type} onChange={e => setForm(f => ({ ...f, log_type: e.target.value }))}>
                {CCP_LOG_TYPES.map(t => <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>)}
              </select>
            </Field>
            <Field label="Item Name" required>
              <input className="input w-full" value={form.item_name} onChange={e => setForm(f => ({ ...f, item_name: e.target.value }))} placeholder="e.g. Grilled Chicken" autoFocus />
            </Field>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <Field label="Min Target (°C)" required>
              <input className="input w-full font-mono" type="number" step="0.5" value={form.target_min_temp} onChange={e => setForm(f => ({ ...f, target_min_temp: e.target.value }))} placeholder="e.g. 75" />
            </Field>
            <Field label="Max Target (°C)" required>
              <input className="input w-full font-mono" type="number" step="0.5" value={form.target_max_temp} onChange={e => setForm(f => ({ ...f, target_max_temp: e.target.value }))} placeholder="e.g. 85" />
            </Field>
            <Field label="Actual Temp (°C)" required>
              <input className={`input w-full font-mono ${passed === false ? 'border-red-400' : ''}`} type="number" step="0.1" value={form.actual_temp} onChange={e => setForm(f => ({ ...f, actual_temp: e.target.value }))} placeholder="e.g. 78" />
            </Field>
          </div>
          {passed !== null && (
            <div className={`rounded-lg px-3 py-2 text-sm font-semibold ${passed ? 'bg-accent-dim text-accent' : 'bg-red-50 text-red-600'}`}>
              {passed ? 'CCP Pass' : 'CCP Fail — corrective action required'}
            </div>
          )}
          <Field label={`Corrective Action${passed === false ? ' *' : ''}`}>
            <textarea className="input w-full" rows={2} value={form.corrective_action} onChange={e => setForm(f => ({ ...f, corrective_action: e.target.value }))} placeholder={passed === false ? 'Describe action taken…' : 'Optional'} />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Logged By">
              <input className="input w-full" value={form.logged_by} onChange={e => setForm(f => ({ ...f, logged_by: e.target.value }))} placeholder="Name" />
            </Field>
            <Field label="Override Date/Time">
              <input className="input w-full" type="datetime-local" value={form.logged_at} onChange={e => setForm(f => ({ ...f, logged_at: e.target.value }))} />
            </Field>
          </div>
          <div className="flex gap-3 justify-end pt-2">
            <button className="btn-ghost px-4 py-2 text-sm" onClick={() => setModal(false)}>Cancel</button>
            <button className="btn-primary px-4 py-2 text-sm" onClick={handleSave} disabled={saving}>
              {saving ? 'Saving…' : 'Save Log'}
            </button>
          </div>
        </Modal>
      )}

      {confirmDel && (
        <ConfirmDialog
          message="Delete this CCP log? This action cannot be undone."
          onConfirm={handleDelete}
          onCancel={() => setConfirmDel(null)}
        />
      )}
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </>
  )
}

// ── Report Tab ────────────────────────────────────────────────────────────────

function ReportTab({ locationId }: { locationId: number | null }) {
  const api = useApi()

  const [report,    setReport]    = useState<Report | null>(null)
  const [loading,   setLoading]   = useState(false)
  const [dateFrom,  setDateFrom]  = useState('')
  const [dateTo,    setDateTo]    = useState('')
  const [toast,     setToast]     = useState<ToastState | null>(null)

  const showToast = (msg: string, type: 'success' | 'error' = 'success') => setToast({ message: msg, type })

  const loadReport = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (dateFrom)  params.set('date_from',   dateFrom)
      if (dateTo)    params.set('date_to',      dateTo)
      if (locationId) params.set('location_id', String(locationId))
      const query = params.toString() ? `?${params}` : ''
      setReport(await api.get(`/haccp/report${query}`))
    } catch { showToast('Failed to generate report', 'error') }
    finally { setLoading(false) }
  }, [api, dateFrom, dateTo, locationId])

  useEffect(() => { loadReport() }, [loadReport])

  const ccpColors: Record<string, string> = {
    cooking:  'bg-orange-100 text-orange-700',
    cooling:  'bg-blue-100 text-blue-700',
    delivery: 'bg-purple-100 text-purple-700',
  }

  return (
    <>
      {/* Date filter */}
      <div className="flex gap-4 mb-6 flex-wrap items-end">
        <Field label="Date From">
          <input className="input" type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
        </Field>
        <Field label="Date To">
          <input className="input" type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} />
        </Field>
        <button className="btn-outline px-4 py-2 text-sm" onClick={() => { setDateFrom(''); setDateTo('') }}>
          Clear Dates
        </button>
      </div>

      {loading ? <Spinner /> : !report ? null : (
        <div className="space-y-8">
          {/* Equipment summary */}
          <section>
            <h3 className="text-base font-extrabold text-text-1 mb-3">Equipment Temperature Compliance</h3>
            {report.equipment.length === 0 ? (
              <p className="text-sm text-text-3">No active equipment.</p>
            ) : (
              <div className="bg-surface border border-border rounded-xl overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-surface-2 border-b border-border">
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-text-2">Equipment</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-text-2">Type</th>
                      <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-text-2">Checks</th>
                      <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-text-2">In Range</th>
                      <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-text-2">Out of Range</th>
                      <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-text-2">Compliance %</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.equipment.map((eq: any) => {
                      const pct = eq.total_checks > 0 ? Math.round(eq.in_range_count / eq.total_checks * 100) : null
                      return (
                        <tr key={eq.id} className="border-b border-border last:border-0 hover:bg-surface-2">
                          <td className="px-4 py-3 font-semibold text-text-1">{eq.name}</td>
                          <td className="px-4 py-3 text-text-3 capitalize">{eq.type.replace('_', ' ')}</td>
                          <td className="px-4 py-3 font-mono text-right text-text-2">{eq.total_checks}</td>
                          <td className="px-4 py-3 font-mono text-right text-accent font-semibold">{eq.in_range_count}</td>
                          <td className="px-4 py-3 font-mono text-right text-red-500 font-semibold">{eq.out_of_range_count}</td>
                          <td className="px-4 py-3 text-right">
                            {pct !== null ? (
                              <span className={`font-bold font-mono ${pct >= 95 ? 'text-accent' : pct >= 85 ? 'text-amber-600' : 'text-red-600'}`}>{pct}%</span>
                            ) : <span className="text-text-3">—</span>}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* CCP summary */}
          <section>
            <h3 className="text-base font-extrabold text-text-1 mb-3">CCP Log Summary</h3>
            {report.ccp_summary.length === 0 ? (
              <p className="text-sm text-text-3">No CCP logs in this period.</p>
            ) : (
              <div className="grid gap-4 grid-cols-1 sm:grid-cols-3">
                {report.ccp_summary.map((row: any) => {
                  const pct = row.total > 0 ? Math.round(row.passed_count / row.total * 100) : null
                  return (
                    <div key={row.log_type} className="bg-surface border border-border rounded-xl p-5">
                      <div className="flex items-center gap-2 mb-3">
                        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${ccpColors[row.log_type] || ''}`}>
                          {row.log_type}
                        </span>
                      </div>
                      <div className="text-2xl font-extrabold text-text-1">{pct ?? '—'}{pct != null ? '%' : ''}</div>
                      <div className="text-xs text-text-3 mt-1">pass rate · {row.total} checks</div>
                      <div className="text-xs text-text-2 mt-2">{row.passed_count} pass · {row.failed_count} fail</div>
                    </div>
                  )
                })}
              </div>
            )}
          </section>

          {/* Recent incidents */}
          {report.incidents.length > 0 && (
            <section>
              <h3 className="text-base font-extrabold text-text-1 mb-3">Recent Incidents</h3>
              <div className="bg-surface border border-border rounded-xl overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-surface-2 border-b border-border">
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-text-2">Source</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-text-2">Item</th>
                      <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-text-2">Actual</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-text-2">Target Range</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-text-2">Corrective Action</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-text-2">Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.incidents.map((inc: any, i: number) => (
                      <tr key={i} className="border-b border-border last:border-0 hover:bg-surface-2">
                        <td className="px-4 py-3">
                          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${inc.source === 'equipment' ? 'bg-blue-100 text-blue-700' : 'bg-orange-100 text-orange-700'}`}>
                            {inc.source}
                          </span>
                        </td>
                        <td className="px-4 py-3 font-semibold text-text-1">{inc.item}</td>
                        <td className="px-4 py-3 font-mono font-bold text-red-600 text-right">{inc.actual_temp}°C</td>
                        <td className="px-4 py-3 font-mono text-text-2 text-xs">{inc.target_min_temp}–{inc.target_max_temp}°C</td>
                        <td className="px-4 py-3 text-text-2 max-w-xs truncate">{inc.corrective_action || <span className="text-red-400 font-semibold">None logged</span>}</td>
                        <td className="px-4 py-3 font-mono text-text-2 text-xs">{new Date(inc.logged_at).toLocaleDateString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </div>
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
