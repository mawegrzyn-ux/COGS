import { useState, useEffect, useCallback } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useApi } from '../../hooks/useApi'
import { usePermissions } from '../../hooks/usePermissions'
import { PageHeader, Modal, Field, EmptyState, Spinner, Badge } from '../../components/ui'
import {
  Audit, AuditTemplate, AuditType,
  ratingBadgeClass, fmtDate
} from './shared'

interface Location {
  id: number
  name: string
}

export default function AuditsPage() {
  const api = useApi()
  const navigate = useNavigate()
  const { can } = usePermissions()

  const [audits, setAudits]         = useState<Audit[]>([])
  const [templates, setTemplates]   = useState<AuditTemplate[]>([])
  const [locations, setLocations]   = useState<Location[]>([])
  const [loading, setLoading]       = useState(true)
  const [filterType, setFilterType] = useState<'all' | AuditType>('all')
  const [filterStatus, setFilterStatus] = useState<'all' | 'in_progress' | 'completed'>('all')
  const [newOpen, setNewOpen]       = useState(false)

  const canWrite = can('audits', 'write')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const qs: string[] = []
      if (filterType !== 'all')   qs.push(`audit_type=${filterType}`)
      if (filterStatus !== 'all') qs.push(`status=${filterStatus}`)
      const res = await api.get<{ rows: Audit[]; total: number }>(`/qsc/audits?${qs.join('&')}`)
      setAudits(res.rows || [])
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }, [api, filterType, filterStatus])

  const loadMeta = useCallback(async () => {
    try {
      const [t, l] = await Promise.all([
        api.get<AuditTemplate[]>('/qsc/templates'),
        api.get<Location[]>('/locations'),
      ])
      setTemplates(t || [])
      setLocations(l || [])
    } catch (err) {
      console.error(err)
    }
  }, [api])

  useEffect(() => { load() },     [load])
  useEffect(() => { loadMeta() }, [loadMeta])

  async function startAudit(payload: { audit_type: AuditType; location_id: number; template_id: number | null; auditor_name: string }) {
    try {
      const created = await api.post<Audit>('/qsc/audits', payload)
      setNewOpen(false)
      navigate(`/audits/${created.id}/run`)
    } catch (err: any) {
      alert(err?.message || 'Failed to start audit')
    }
  }

  const inProgress  = audits.filter(a => a.status === 'in_progress')
  const completed   = audits.filter(a => a.status === 'completed')

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <PageHeader
        title="QSC Audits"
        subtitle="Quality · Service · Cleanliness — external and internal restaurant audits."
        action={
          <div className="flex items-center gap-2">
            <Link to="/audits/templates" className="btn-outline text-sm">Templates</Link>
            {canWrite && (
              <button onClick={() => setNewOpen(true)} className="btn-primary text-sm">
                + Start audit
              </button>
            )}
          </div>
        }
      />

      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-6">
        {/* Stat cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <StatCard label="In progress"     value={inProgress.length} />
          <StatCard label="Completed"       value={completed.length} />
          <StatCard label="Auto-unaccept"   value={completed.filter(a => a.auto_unacceptable).length} tint="red" />
          <StatCard label="Avg score"       value={completed.length ? Math.round(completed.reduce((s, a) => s + (a.overall_score || 0), 0) / completed.length) : '—'} />
        </div>

        {/* Filters */}
        <div className="flex items-center gap-3 text-sm">
          <span className="text-text-3">Filter:</span>
          <select value={filterType} onChange={e => setFilterType(e.target.value as any)} className="input w-auto">
            <option value="all">All types</option>
            <option value="external">External</option>
            <option value="internal">Internal</option>
          </select>
          <select value={filterStatus} onChange={e => setFilterStatus(e.target.value as any)} className="input w-auto">
            <option value="all">All statuses</option>
            <option value="in_progress">In progress</option>
            <option value="completed">Completed</option>
          </select>
        </div>

        {loading ? <Spinner /> : audits.length === 0 ? (
          <EmptyState
            message="No audits yet. Start an external evaluation or an ad-hoc internal check."
            action={canWrite ? <button onClick={() => setNewOpen(true)} className="btn-primary text-sm">Start audit</button> : undefined}
          />
        ) : (
          <div className="card overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-surface-2 text-text-3">
                <tr>
                  <th className="text-left px-4 py-2 font-semibold">Key</th>
                  <th className="text-left px-4 py-2 font-semibold">Type</th>
                  <th className="text-left px-4 py-2 font-semibold">Location</th>
                  <th className="text-left px-4 py-2 font-semibold">Auditor</th>
                  <th className="text-left px-4 py-2 font-semibold">Started</th>
                  <th className="text-left px-4 py-2 font-semibold">Completed</th>
                  <th className="text-left px-4 py-2 font-semibold">Score</th>
                  <th className="text-left px-4 py-2 font-semibold">Rating</th>
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {audits.map(a => (
                  <tr key={a.id} className="border-t border-border hover:bg-surface-2/50">
                    <td className="px-4 py-2 font-mono">{a.key}</td>
                    <td className="px-4 py-2">
                      <Badge label={a.audit_type === 'external' ? 'External' : 'Internal'} variant={a.audit_type === 'external' ? 'green' : 'neutral'} />
                    </td>
                    <td className="px-4 py-2">{a.location_name || '—'}</td>
                    <td className="px-4 py-2">{a.auditor_name || '—'}</td>
                    <td className="px-4 py-2">{fmtDate(a.started_at)}</td>
                    <td className="px-4 py-2">{fmtDate(a.completed_at)}</td>
                    <td className="px-4 py-2 font-semibold">{a.overall_score != null ? Number(a.overall_score).toFixed(1) : '—'}</td>
                    <td className="px-4 py-2">
                      {a.overall_rating ? (
                        <span className={`inline-flex items-center px-2 py-0.5 rounded border text-xs font-semibold ${ratingBadgeClass(a.overall_rating)}`}>
                          {a.overall_rating}{a.auto_unacceptable && ' ⚠'}
                        </span>
                      ) : <span className="text-text-3">—</span>}
                    </td>
                    <td className="px-4 py-2 text-right">
                      {a.status === 'in_progress'
                        ? <Link to={`/audits/${a.id}/run`} className="text-accent font-semibold">Resume →</Link>
                        : <Link to={`/audits/${a.id}/report`} className="text-accent font-semibold">Report →</Link>
                      }
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {newOpen && canWrite && (
        <NewAuditModal
          templates={templates}
          locations={locations}
          onCancel={() => setNewOpen(false)}
          onCreate={startAudit}
        />
      )}
    </div>
  )
}

function StatCard({ label, value, tint }: { label: string; value: number | string; tint?: 'red' }) {
  return (
    <div className={`card p-4 ${tint === 'red' && value ? 'border-red-200 bg-red-50' : ''}`}>
      <div className="text-xs text-text-3 uppercase tracking-wide">{label}</div>
      <div className="text-2xl font-extrabold mt-1">{value}</div>
    </div>
  )
}

// ── New audit modal ─────────────────────────────────────────────────────────
function NewAuditModal({
  templates, locations, onCancel, onCreate,
}: {
  templates: AuditTemplate[]
  locations: Location[]
  onCancel: () => void
  onCreate: (p: { audit_type: AuditType; location_id: number; template_id: number | null; auditor_name: string }) => void
}) {
  const [type, setType] = useState<AuditType>('external')
  const [locationId, setLocationId] = useState<number | null>(null)
  const [templateId, setTemplateId] = useState<number | null>(null)
  const [auditor, setAuditor]       = useState('')

  const canSubmit = !!locationId && (type === 'external' || templateId !== null || type === 'internal')

  return (
    <Modal title="Start new audit" onClose={onCancel}>
      <div className="space-y-4">
        <Field label="Audit type">
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => { setType('external'); setTemplateId(null) }}
              className={`p-3 rounded border text-sm text-left transition
                ${type === 'external' ? 'border-accent bg-accent-dim' : 'border-border hover:bg-surface-2'}`}
            >
              <div className="font-semibold">External</div>
              <div className="text-xs text-text-3 mt-1">Formal scheduled evaluation. Every question required.</div>
            </button>
            <button
              type="button"
              onClick={() => setType('internal')}
              className={`p-3 rounded border text-sm text-left transition
                ${type === 'internal' ? 'border-accent bg-accent-dim' : 'border-border hover:bg-surface-2'}`}
            >
              <div className="font-semibold">Internal</div>
              <div className="text-xs text-text-3 mt-1">Ad-hoc check. Optional template. Partial-complete OK.</div>
            </button>
          </div>
        </Field>

        <Field label="Location" required>
          <select
            className="input w-full"
            value={locationId ?? ''}
            onChange={e => setLocationId(e.target.value ? parseInt(e.target.value, 10) : null)}
          >
            <option value="">Choose a location…</option>
            {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </Field>

        {type === 'internal' && (
          <Field label="Template (optional — leave empty for full audit)">
            <select
              className="input w-full"
              value={templateId ?? ''}
              onChange={e => setTemplateId(e.target.value ? parseInt(e.target.value, 10) : null)}
            >
              <option value="">— No template (all questions) —</option>
              {templates.map(t => (
                <option key={t.id} value={t.id}>
                  {t.name} {t.is_system && '(system)'} · {t.question_codes.length} items
                </option>
              ))}
            </select>
          </Field>
        )}

        <Field label="Auditor name">
          <input
            type="text"
            className="input w-full"
            value={auditor}
            placeholder="e.g. Steritech — Jane Doe"
            onChange={e => setAuditor(e.target.value)}
          />
        </Field>

        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onCancel} className="btn-ghost">Cancel</button>
          <button
            onClick={() => canSubmit && locationId && onCreate({
              audit_type: type, location_id: locationId, template_id: templateId, auditor_name: auditor,
            })}
            disabled={!canSubmit}
            className="btn-primary disabled:opacity-50"
          >
            Start audit
          </button>
        </div>
      </div>
    </Modal>
  )
}
