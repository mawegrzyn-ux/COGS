import { useState, useEffect, useCallback, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useApi } from '../../hooks/useApi'
import { usePermissions } from '../../hooks/usePermissions'
import { PageHeader, Modal, Field, EmptyState, Spinner, Badge, ConfirmDialog } from '../../components/ui'
import { AuditTemplate, Question, riskChipClass } from './shared'

export default function AuditTemplatesPage() {
  const api = useApi()
  const { can } = usePermissions()
  const canWrite = can('audits', 'write')

  const [templates, setTemplates] = useState<AuditTemplate[]>([])
  const [questions, setQuestions] = useState<Question[]>([])
  const [loading, setLoading]     = useState(true)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [editOpen, setEditOpen]   = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<AuditTemplate | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [t, q] = await Promise.all([
        api.get<AuditTemplate[]>('/qsc/templates'),
        api.get<Question[]>('/qsc/questions?active=true&version=1'),
      ])
      setTemplates(t || [])
      setQuestions(q || [])
      if (!selectedId && t && t.length) setSelectedId(t[0].id)
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }, [api, selectedId])

  useEffect(() => { load() }, [load])

  const selected = templates.find(t => t.id === selectedId) || null
  const byCode   = useMemo(() => new Map(questions.map(q => [q.code, q])), [questions])

  async function createTemplate(payload: { name: string; description: string; codes: string[] }) {
    const created = await api.post<AuditTemplate>('/qsc/templates', {
      name: payload.name, description: payload.description, question_codes: payload.codes,
    })
    setTemplates(ts => [...ts, created])
    setSelectedId(created.id)
    setEditOpen(false)
  }

  async function saveTemplate(id: number, payload: { name: string; description: string; codes: string[] }) {
    const saved = await api.put<AuditTemplate>(`/qsc/templates/${id}`, {
      name: payload.name, description: payload.description, question_codes: payload.codes,
    })
    setTemplates(ts => ts.map(t => t.id === id ? saved : t))
    setEditOpen(false)
  }

  async function removeTemplate(t: AuditTemplate) {
    await api.delete(`/qsc/templates/${t.id}`)
    setTemplates(ts => ts.filter(x => x.id !== t.id))
    if (selectedId === t.id) setSelectedId(null)
    setDeleteTarget(null)
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <PageHeader
        title="Audit Templates"
        subtitle="Saved subsets used for internal ad-hoc audits. System templates ship with the product."
        action={
          <div className="flex items-center gap-2">
            <Link to="/audits" className="btn-ghost text-sm">← Back to audits</Link>
            {canWrite && <button onClick={() => { setSelectedId(null); setEditOpen(true) }} className="btn-primary text-sm">+ New template</button>}
          </div>
        }
      />

      {loading ? <Spinner /> : (
        <div className="flex-1 overflow-hidden flex">
          <aside className="w-72 shrink-0 border-r border-border overflow-y-auto bg-surface-2/50">
            {templates.length === 0 ? (
              <EmptyState message="No templates yet." />
            ) : (
              <ul className="py-2">
                {templates.map(t => (
                  <li key={t.id}>
                    <button
                      onClick={() => setSelectedId(t.id)}
                      className={`w-full text-left px-4 py-2 text-sm transition
                        ${selectedId === t.id ? 'bg-accent-dim text-accent font-semibold' : 'hover:bg-surface'}`}
                    >
                      <div className="flex items-center gap-2">
                        <span className="flex-1 truncate">{t.name}</span>
                        {t.is_system && <Badge label="System" variant="neutral" />}
                      </div>
                      <div className="text-xs text-text-3 mt-0.5">{t.question_codes.length} items</div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </aside>

          <main className="flex-1 overflow-y-auto p-6">
            {selected ? (
              <div className="max-w-3xl">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <h2 className="text-xl font-bold">{selected.name}</h2>
                    {selected.description && <p className="text-sm text-text-2 mt-1">{selected.description}</p>}
                    <div className="text-xs text-text-3 mt-2">{selected.question_codes.length} questions · {selected.is_system ? 'System' : 'Custom'}</div>
                  </div>
                  <div className="flex gap-2">
                    {canWrite && <button onClick={() => setEditOpen(true)} className="btn-outline text-sm">Edit</button>}
                    {canWrite && !selected.is_system && <button onClick={() => setDeleteTarget(selected)} className="btn-ghost text-sm text-red-600">Delete</button>}
                  </div>
                </div>

                <div className="card p-4">
                  <h3 className="font-semibold text-sm mb-2">Questions in this template</h3>
                  <ul className="divide-y divide-border">
                    {selected.question_codes.map(code => {
                      const q = byCode.get(code)
                      return (
                        <li key={code} className="py-2 flex items-start gap-3">
                          <span className="font-mono text-xs px-1.5 py-0.5 rounded bg-surface-2 border border-border">{code}</span>
                          {q ? (
                            <div className="flex-1">
                              <div className="text-sm">{q.title}</div>
                              <div className="flex items-center gap-2 mt-0.5">
                                <span className={`inline-flex items-center px-1.5 py-0.5 rounded border text-[10px] font-semibold ${riskChipClass(q.risk_level)}`}>
                                  {q.risk_level}
                                </span>
                                <span className="text-xs text-text-3">{q.department} · {q.category}</span>
                              </div>
                            </div>
                          ) : (
                            <span className="text-xs text-red-600">Question not found in current bank</span>
                          )}
                        </li>
                      )
                    })}
                  </ul>
                </div>
              </div>
            ) : (
              <div className="text-text-3">Pick a template on the left, or create a new one.</div>
            )}
          </main>
        </div>
      )}

      {editOpen && (
        <TemplateEditor
          template={selected}
          questions={questions}
          onCancel={() => setEditOpen(false)}
          onSave={(p) => selected ? saveTemplate(selected.id, p) : createTemplate(p)}
        />
      )}

      {deleteTarget && (
        <ConfirmDialog
          message={`Delete template "${deleteTarget.name}"? This cannot be undone. Audits that already started from this template keep their questions.`}
          onConfirm={() => removeTemplate(deleteTarget)}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </div>
  )
}

function TemplateEditor({
  template, questions, onCancel, onSave,
}: {
  template: AuditTemplate | null
  questions: Question[]
  onCancel: () => void
  onSave: (p: { name: string; description: string; codes: string[] }) => void
}) {
  const [name, setName]         = useState(template?.name || '')
  const [desc, setDesc]         = useState(template?.description || '')
  const [codes, setCodes]       = useState<Set<string>>(new Set(template?.question_codes || []))
  const [search, setSearch]     = useState('')
  const [filterDept, setFilterDept] = useState<'all' | string>('all')

  const depts = useMemo(() => {
    const s = new Set<string>()
    questions.forEach(q => q.department && s.add(q.department))
    return [...s]
  }, [questions])

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    return questions.filter(x => {
      if (filterDept !== 'all' && x.department !== filterDept) return false
      if (!q) return true
      return x.code.toLowerCase().includes(q) || x.title.toLowerCase().includes(q)
    })
  }, [questions, search, filterDept])

  function toggle(code: string) {
    setCodes(s => {
      const next = new Set(s)
      if (next.has(code)) next.delete(code); else next.add(code)
      return next
    })
  }

  return (
    <Modal title={template ? `Edit ${template.name}` : 'New template'} onClose={onCancel} width="max-w-3xl">
      <div className="space-y-3">
        <Field label="Name" required>
          <input type="text" className="input w-full" value={name} onChange={e => setName(e.target.value)} />
        </Field>
        <Field label="Description">
          <textarea className="input w-full" rows={2} value={desc} onChange={e => setDesc(e.target.value)} />
        </Field>

        <div>
          <div className="flex items-center gap-2 mb-2">
            <label className="text-sm font-semibold text-text-2 flex-1">
              Questions ({codes.size} selected)
            </label>
            <select value={filterDept} onChange={e => setFilterDept(e.target.value)} className="input w-auto text-xs">
              <option value="all">All departments</option>
              {depts.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
            <input
              type="search" placeholder="Search…"
              className="input w-40 text-xs"
              value={search} onChange={e => setSearch(e.target.value)}
            />
          </div>
          <div className="max-h-80 overflow-y-auto border border-border rounded">
            {filtered.map(q => (
              <label key={q.code} className="flex items-start gap-2 px-3 py-2 border-b border-border cursor-pointer hover:bg-surface-2">
                <input type="checkbox" checked={codes.has(q.code)} onChange={() => toggle(q.code)} className="mt-1" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 text-xs">
                    <span className="font-mono">{q.code}</span>
                    <span className={`px-1.5 py-0.5 rounded border font-semibold ${riskChipClass(q.risk_level)}`}>{q.risk_level}</span>
                    <span className="text-text-3">{q.department} · {q.category}</span>
                  </div>
                  <div className="text-sm mt-0.5 truncate">{q.title}</div>
                </div>
              </label>
            ))}
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onCancel} className="btn-ghost">Cancel</button>
          <button
            disabled={!name.trim() || codes.size === 0}
            onClick={() => onSave({ name: name.trim(), description: desc.trim(), codes: [...codes] })}
            className="btn-primary disabled:opacity-50"
          >
            {template ? 'Save changes' : 'Create template'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
