import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { useAuth0 } from '@auth0/auth0-react'
import { useApi } from '../../hooks/useApi'
import { PageHeader, Spinner, Badge, ConfirmDialog, Modal, Field } from '../../components/ui'
import {
  Audit, Question, AuditResponse, AuditTemplate,
  riskChipClass, fmtDateTime
} from './shared'

const API_BASE = import.meta.env.VITE_API_URL || '/api'
const MAX_BYTES = 5 * 1024 * 1024

export default function AuditRunnerPage() {
  const { id } = useParams<{ id: string }>()
  const api = useApi()
  const navigate = useNavigate()
  const { getAccessTokenSilently } = useAuth0()

  const [audit, setAudit]           = useState<Audit | null>(null)
  const [questions, setQuestions]   = useState<Question[]>([])
  const [responses, setResponses]   = useState<Record<string, AuditResponse>>({})
  const [activeCode, setActiveCode] = useState<string | null>(null)
  const [template, setTemplate]     = useState<AuditTemplate | null>(null)
  const [repeatCodes, setRepeatCodes] = useState<Set<string>>(new Set())
  const [loading, setLoading]       = useState(true)
  const [saving, setSaving]         = useState(false)
  const [showPolicy, setShowPolicy] = useState(false)
  const [finalizeOpen, setFinalizeOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notesOpen, setNotesOpen] = useState(false)

  const load = useCallback(async () => {
    if (!id) return
    setLoading(true)
    try {
      const [a, qs] = await Promise.all([
        api.get<{ audit: Audit; responses: AuditResponse[] }>(`/qsc/audits/${id}`),
        api.get<Question[]>(`/qsc/questions?active=true&version=1`),
      ])
      setAudit(a.audit)
      setQuestions(qs || [])
      const map: Record<string, AuditResponse> = {}
      for (const r of a.responses || []) map[r.question_code] = r
      setResponses(map)

      // Load template (if pinned) + previous NC codes in parallel
      let tpl: AuditTemplate | null = null
      if (a.audit.template_id) {
        try {
          const all = await api.get<AuditTemplate[]>(`/qsc/templates`)
          tpl = (all || []).find((x: AuditTemplate) => x.id === a.audit.template_id) || null
          setTemplate(tpl)
        } catch { /* non-fatal */ }
      }
      if (a.audit.location_id) {
        try {
          const prev = await api.get<{ audit: any; nc_codes: string[] } | null>(`/qsc/locations/${a.audit.location_id}/last-external`)
          if (prev?.nc_codes) setRepeatCodes(new Set(prev.nc_codes))
        } catch { /* non-fatal */ }
      }

      // Pick first unanswered question to start on
      const filtered = filterByTemplate(qs || [], tpl?.question_codes || null)
      const first = filtered.find(q => !map[q.code]) || filtered[0]
      if (first) setActiveCode(first.code)
    } catch (err: any) {
      console.error(err)
      setError(err?.message || 'Failed to load audit')
    } finally {
      setLoading(false)
    }
  }, [id, api])

  useEffect(() => { load() }, [load])

  // Filtered question list — when template pinned, only template codes
  const scopedQuestions = useMemo(() => {
    const codes = template?.question_codes
    return filterByTemplate(questions, codes || null)
  }, [questions, template])

  const active = scopedQuestions.find(q => q.code === activeCode) || null
  const resp   = active ? responses[active.code] : null

  const answered   = scopedQuestions.filter(q => responses[q.code] && responses[q.code].status !== 'not_observed').length
  const scoredQs   = scopedQuestions.filter(q => q.points > 0)
  const nc         = scopedQuestions.filter(q => responses[q.code]?.status === 'not_compliant').length
  const autoTrip   = scopedQuestions.some(q => q.auto_unacceptable && responses[q.code]?.status === 'not_compliant')

  async function saveResponse(code: string, patch: Partial<AuditResponse>) {
    if (!id) return
    setSaving(true)
    try {
      const existing = responses[code]
      const payload = {
        status:            patch.status ?? existing?.status ?? 'not_observed',
        is_repeat:         patch.is_repeat ?? existing?.is_repeat ?? repeatCodes.has(code),
        comment:           patch.comment ?? existing?.comment ?? null,
        temperature_value: patch.temperature_value ?? existing?.temperature_value ?? null,
        temperature_unit:  patch.temperature_unit ?? existing?.temperature_unit ?? null,
        product_name:      patch.product_name ?? existing?.product_name ?? null,
      }
      const saved = await api.put<AuditResponse>(`/qsc/audits/${id}/responses/${code}`, payload)
      setResponses(r => ({ ...r, [code]: { ...saved, photos: responses[code]?.photos || [] } }))
    } catch (err: any) {
      setError(err?.message || 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  async function uploadPhoto(file: File) {
    if (!id || !active) return
    if (file.size > MAX_BYTES) { setError('Photo must be under 5 MB'); return }
    // Response must exist first — if not, default to not_observed then upload
    if (!responses[active.code]) {
      await saveResponse(active.code, { status: 'not_observed' })
    }
    try {
      const token = await getAccessTokenSilently()
      const fd = new FormData()
      fd.append('image', file)
      const res = await fetch(`${API_BASE}/upload`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd })
      if (!res.ok) throw new Error('Upload failed')
      const { url } = await res.json()
      const photo = await api.post(`/qsc/audits/${id}/responses/${active.code}/photos`, { url })
      setResponses(r => ({
        ...r,
        [active.code]: {
          ...r[active.code],
          photos: [...(r[active.code]?.photos || []), photo as any],
        },
      }))
    } catch (err: any) {
      setError(err?.message || 'Photo upload failed')
    }
  }

  async function deletePhoto(photoId: number) {
    if (!id || !active) return
    await api.delete(`/qsc/audits/${id}/responses/${active.code}/photos/${photoId}`)
    setResponses(r => ({
      ...r,
      [active.code]: {
        ...r[active.code],
        photos: (r[active.code]?.photos || []).filter(p => p.id !== photoId),
      },
    }))
  }

  async function finalize() {
    if (!id) return
    try {
      await api.post(`/qsc/audits/${id}/complete`, {})
      navigate(`/audits/${id}/report`)
    } catch (err: any) {
      setError(err?.message || 'Finalize failed — check all required questions are answered.')
      setFinalizeOpen(false)
    }
  }

  async function cancelAudit() {
    if (!id) return
    if (!window.confirm('Cancel this audit? Responses will be kept but the audit will be marked cancelled and cannot be resumed.')) return
    await api.post(`/qsc/audits/${id}/cancel`, {})
    navigate('/audits')
  }

  if (loading) return <Spinner />
  if (!audit)  return <div className="p-6">Audit not found</div>

  const isLocked = audit.status !== 'in_progress'

  // If audit is finalised, redirect to report
  if (isLocked) {
    navigate(`/audits/${id}/report`, { replace: true })
    return null
  }

  const nav = scopedQuestions

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <PageHeader
        title={`${audit.key} · ${audit.audit_type === 'external' ? 'External' : 'Internal'} audit`}
        subtitle={`${audit.location_name || '—'} · auditor: ${audit.auditor_name || '—'} · started ${fmtDateTime(audit.started_at)}`}
        action={
          <div className="flex items-center gap-2">
            <button onClick={() => setNotesOpen(true)} className="btn-outline text-sm">Notes</button>
            <button onClick={cancelAudit} className="btn-ghost text-sm text-red-600">Cancel</button>
            <button
              onClick={() => setFinalizeOpen(true)}
              className="btn-primary text-sm"
              disabled={audit.audit_type === 'external' && answered < scoredQs.length}
              title={audit.audit_type === 'external' && answered < scoredQs.length ? 'All scored questions must be answered first' : ''}
            >
              Finalize
            </button>
          </div>
        }
      />

      {/* Sticky progress strip */}
      <div className="border-b border-border bg-surface-2 px-6 py-2 flex items-center gap-4 text-xs">
        <div className="font-semibold">
          {Object.keys(responses).length} / {nav.length} answered
        </div>
        <div className="text-text-3">
          {nc} non-compliant
          {autoTrip && <span className="ml-2 text-red-600 font-semibold">⚠ auto-unacceptable triggered</span>}
        </div>
        {saving && <span className="text-accent">Saving…</span>}
        <Link to="/audits" className="ml-auto text-text-3 hover:text-accent">← back to audits</Link>
      </div>

      <div className="flex-1 overflow-hidden flex">
        {/* Question nav sidebar */}
        <aside className="w-60 shrink-0 border-r border-border overflow-y-auto bg-surface-2/50">
          <QuestionList
            questions={nav}
            responses={responses}
            activeCode={activeCode}
            onPick={setActiveCode}
          />
        </aside>

        {/* Main question pane */}
        <main className="flex-1 overflow-y-auto">
          {active ? (
            <div className="max-w-3xl mx-auto p-6 space-y-4">
              <div className="flex flex-wrap items-start gap-3">
                <span className="font-mono text-xs px-2 py-1 rounded bg-surface-2 border border-border">{active.code}</span>
                <span className={`inline-flex items-center px-2 py-0.5 rounded border text-xs font-semibold ${riskChipClass(active.risk_level)}`}>
                  {active.risk_level}
                </span>
                <span className="text-xs text-text-3">{active.points} pts · repeat {active.repeat_points}</span>
                {active.auto_unacceptable && <Badge label="AUTO-UNACCEPT" variant="red" />}
                {active.photo_required    && <Badge label="Photo required" variant="yellow" />}
                <span className="text-xs text-text-3 ml-auto">{active.department} · {active.category}</span>
              </div>

              <h2 className="text-lg font-bold leading-snug">{active.title}</h2>

              {active.policy && (
                <div>
                  <button
                    onClick={() => setShowPolicy(s => !s)}
                    className="text-xs text-accent font-semibold"
                  >
                    {showPolicy ? '▾ Hide policy' : '▸ Show policy / scoring guidance'}
                  </button>
                  {showPolicy && (
                    <pre className="mt-2 text-xs whitespace-pre-wrap bg-surface-2 border border-border rounded p-3 text-text-2">
                      {active.policy}
                    </pre>
                  )}
                </div>
              )}

              {/* Status buttons */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                <StatusButton
                  label="Compliant" variant="green" active={resp?.status === 'compliant'}
                  onClick={() => saveResponse(active.code, { status: 'compliant' })}
                />
                <StatusButton
                  label="Not Compliant" variant="red" active={resp?.status === 'not_compliant'}
                  onClick={() => saveResponse(active.code, { status: 'not_compliant' })}
                />
                <StatusButton
                  label="Not Observed" variant="neutral" active={resp?.status === 'not_observed'}
                  onClick={() => saveResponse(active.code, { status: 'not_observed' })}
                />
                <StatusButton
                  label="N/A" variant="neutral" active={resp?.status === 'not_applicable'}
                  onClick={() => saveResponse(active.code, { status: 'not_applicable' })}
                />
              </div>

              {resp?.status === 'not_compliant' && (
                <label className="flex items-center gap-2 text-sm text-text-2">
                  <input
                    type="checkbox"
                    checked={!!resp?.is_repeat}
                    onChange={e => saveResponse(active.code, { is_repeat: e.target.checked })}
                  />
                  Repeat finding (also NC on the previous external audit)
                  {repeatCodes.has(active.code) && <span className="text-xs text-amber-600">· suggested</span>}
                </label>
              )}

              {active.temperature_input && (
                <Field label="Temperature reading">
                  <div className="flex gap-2">
                    <input
                      type="number" step="0.1"
                      className="input flex-1"
                      placeholder="e.g. 38.5"
                      value={resp?.temperature_value ?? ''}
                      onChange={e => saveResponse(active.code, { temperature_value: e.target.value === '' ? null : parseFloat(e.target.value) })}
                    />
                    <select
                      className="input w-20"
                      value={resp?.temperature_unit || 'F'}
                      onChange={e => saveResponse(active.code, { temperature_unit: e.target.value as 'F' | 'C' })}
                    >
                      <option value="F">°F</option>
                      <option value="C">°C</option>
                    </select>
                  </div>
                </Field>
              )}

              <Field label="Product name (if applicable)">
                <input
                  type="text"
                  className="input w-full"
                  placeholder="e.g. Classic chicken, Ranch dip"
                  value={resp?.product_name || ''}
                  onBlur={e => saveResponse(active.code, { product_name: e.target.value || null })}
                  onChange={e => setResponses(r => ({ ...r, [active.code]: { ...(r[active.code] || {} as any), product_name: e.target.value } }))}
                />
              </Field>

              <Field label={`Comment${resp?.status === 'not_compliant' ? ' (required)' : ''}`}>
                <textarea
                  className="input w-full"
                  rows={3}
                  placeholder="Observations, root cause, corrective action…"
                  value={resp?.comment || ''}
                  onBlur={e => saveResponse(active.code, { comment: e.target.value || null })}
                  onChange={e => setResponses(r => ({ ...r, [active.code]: { ...(r[active.code] || {} as any), comment: e.target.value } }))}
                />
              </Field>

              {/* Photos */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-semibold text-text-2">
                    Photos{active.photo_required && <span className="text-amber-600 ml-1">(required)</span>}
                  </label>
                  <PhotoUpload onFile={uploadPhoto} />
                </div>
                <div className="grid grid-cols-4 gap-2">
                  {(resp?.photos || []).map(p => (
                    <div key={p.id} className="relative group">
                      <img src={p.url} alt="" className="w-full h-24 object-cover rounded border border-border" />
                      <button
                        onClick={() => deletePhoto(p.id)}
                        className="absolute top-1 right-1 bg-white/90 rounded-full w-6 h-6 flex items-center justify-center text-red-600 opacity-0 group-hover:opacity-100 transition-opacity"
                      >×</button>
                    </div>
                  ))}
                </div>
              </div>

              {/* Cross-references */}
              {active.cross_refs.length > 0 && (
                <div>
                  <div className="text-xs text-text-3 mb-1">Cross-referenced codes:</div>
                  <div className="flex flex-wrap gap-1">
                    {active.cross_refs.map(code => (
                      <button
                        key={code}
                        onClick={() => setActiveCode(code)}
                        className="px-2 py-0.5 rounded border border-border bg-surface-2 text-xs font-mono text-accent hover:bg-accent-dim"
                      >
                        {code}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Prev / Next */}
              <div className="flex justify-between pt-4 border-t border-border">
                <NavButton dir="prev" scoped={nav} active={active} onPick={setActiveCode} />
                <NavButton dir="next" scoped={nav} active={active} onPick={setActiveCode} />
              </div>
            </div>
          ) : (
            <div className="p-6 text-text-3">Pick a question from the sidebar.</div>
          )}
        </main>
      </div>

      {error && (
        <ConfirmDialog
          message={error}
          onConfirm={() => setError(null)}
          onCancel={() => setError(null)}
          danger={false}
        />
      )}

      {finalizeOpen && (
        <ConfirmDialog
          message={`Finalize this ${audit.audit_type} audit? ${audit.audit_type === 'external' ? 'External audits require every scored question to be answered.' : 'Unanswered questions will be recorded as Not Observed.'} Once finalized the audit is locked and the scored report is generated.`}
          onConfirm={() => { setFinalizeOpen(false); finalize() }}
          onCancel={() => setFinalizeOpen(false)}
          danger={false}
        />
      )}

      {notesOpen && (
        <NotesModal
          notes={audit.notes || ''}
          onSave={async (notes) => {
            await api.put(`/qsc/audits/${id}`, { notes })
            setAudit(a => a ? { ...a, notes } : a)
            setNotesOpen(false)
          }}
          onCancel={() => setNotesOpen(false)}
        />
      )}
    </div>
  )
}

// ── Template question-code filter ───────────────────────────────────────────
function filterByTemplate(qs: Question[], codes: string[] | null): Question[] {
  if (!codes || !codes.length) return qs
  const set = new Set(codes)
  return qs.filter(q => set.has(q.code))
}

// ── Question list sidebar ────────────────────────────────────────────────────
function QuestionList({
  questions, responses, activeCode, onPick,
}: {
  questions: Question[]
  responses: Record<string, AuditResponse>
  activeCode: string | null
  onPick: (code: string) => void
}) {
  // Group by department → category
  const groups = useMemo(() => {
    const by: Record<string, Record<string, Question[]>> = {}
    for (const q of questions) {
      const d = q.department || 'Other'
      const c = q.category   || 'Other'
      by[d] ||= {}
      by[d][c] ||= []
      by[d][c].push(q)
    }
    return by
  }, [questions])

  return (
    <div className="text-sm py-2">
      {Object.entries(groups).map(([dept, cats]) => (
        <div key={dept}>
          <div className="px-3 py-1.5 text-xs font-bold uppercase tracking-wide text-text-3 bg-surface-2 border-y border-border sticky top-0">
            {dept}
          </div>
          {Object.entries(cats).map(([cat, qs]) => (
            <div key={cat}>
              <div className="px-3 py-1 text-[11px] uppercase tracking-wide text-text-3 mt-2">{cat}</div>
              {qs.map(q => {
                const r = responses[q.code]
                const dot =
                  r?.status === 'compliant'     ? 'bg-green-500' :
                  r?.status === 'not_compliant' ? 'bg-red-500' :
                  r?.status === 'not_applicable'? 'bg-slate-400' :
                  r?.status === 'not_observed'  ? 'bg-amber-400' :
                  r?.status === 'informational' ? 'bg-blue-400' : 'bg-border'
                return (
                  <button
                    key={q.code}
                    onClick={() => onPick(q.code)}
                    className={`w-full flex items-center gap-2 px-3 py-1.5 text-left transition
                      ${activeCode === q.code ? 'bg-accent-dim text-accent font-semibold' : 'hover:bg-surface'}`}
                  >
                    <span className={`w-2 h-2 rounded-full shrink-0 ${dot}`} />
                    <span className="font-mono text-xs">{q.code}</span>
                    <span className="truncate text-xs">{q.title.slice(0, 40)}</span>
                  </button>
                )
              })}
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

// ── Status button ───────────────────────────────────────────────────────────
function StatusButton({
  label, variant, active, onClick,
}: {
  label: string
  variant: 'green' | 'red' | 'neutral'
  active: boolean
  onClick: () => void
}) {
  const base = 'px-4 py-3 rounded border text-sm font-semibold transition'
  const idle = variant === 'green'  ? 'border-border text-green-700 hover:bg-green-50'
             : variant === 'red'    ? 'border-border text-red-700   hover:bg-red-50'
             : 'border-border text-text-2 hover:bg-surface-2'
  const on   = variant === 'green'  ? 'border-green-500 bg-green-100 text-green-800'
             : variant === 'red'    ? 'border-red-500   bg-red-100   text-red-800'
             : 'border-slate-500  bg-slate-100  text-slate-800'
  return <button onClick={onClick} className={`${base} ${active ? on : idle}`}>{label}</button>
}

// ── Prev/Next nav ───────────────────────────────────────────────────────────
function NavButton({
  dir, scoped, active, onPick,
}: {
  dir: 'prev' | 'next'
  scoped: Question[]
  active: Question
  onPick: (code: string) => void
}) {
  const idx = scoped.findIndex(q => q.code === active.code)
  const target = dir === 'next' ? scoped[idx + 1] : scoped[idx - 1]
  if (!target) return <span />
  return (
    <button onClick={() => onPick(target.code)} className="btn-outline text-sm">
      {dir === 'prev' ? '← Previous' : 'Next →'} <span className="font-mono text-xs ml-1">{target.code}</span>
    </button>
  )
}

// ── Photo upload widget ─────────────────────────────────────────────────────
function PhotoUpload({ onFile }: { onFile: (f: File) => void }) {
  const ref = useRef<HTMLInputElement>(null)
  return (
    <>
      <button onClick={() => ref.current?.click()} className="btn-outline text-xs">+ Attach photo</button>
      <input
        ref={ref} type="file" accept="image/*" className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (f) { onFile(f); e.target.value = '' } }}
      />
    </>
  )
}

// ── Notes modal ─────────────────────────────────────────────────────────────
function NotesModal({ notes, onSave, onCancel }: {
  notes: string
  onSave: (n: string) => void
  onCancel: () => void
}) {
  const [v, setV] = useState(notes)
  return (
    <Modal title="Audit notes" onClose={onCancel}>
      <textarea
        className="input w-full"
        rows={8}
        value={v}
        onChange={e => setV(e.target.value)}
        placeholder="Overall observations, context, anything that belongs on the cover of the report…"
      />
      <div className="flex justify-end gap-2 pt-3">
        <button onClick={onCancel} className="btn-ghost">Cancel</button>
        <button onClick={() => onSave(v)} className="btn-primary">Save notes</button>
      </div>
    </Modal>
  )
}
