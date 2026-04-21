import { useState, useEffect, useCallback } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useAuth0 } from '@auth0/auth0-react'
import { useApi } from '../../hooks/useApi'
import { PageHeader, Spinner, Badge } from '../../components/ui'
import {
  Audit, Question, AuditResponse,
  riskChipClass, ratingBadgeClass, fmtDateTime
} from './shared'

const API_BASE = import.meta.env.VITE_API_URL || '/api'

interface ReportData {
  audit: Audit
  questions: Question[]
  responses: (AuditResponse & { question: Question | null })[]
  summary: {
    by_department: Record<string, { total_points: number; deducted: number; nc: number; compliant: number; not_observed: number; not_applicable: number }>
    by_category:   Record<string, { department: string; total_points: number; deducted: number; nc: number; compliant: number; not_observed: number; not_applicable: number }>
    critical_findings: (AuditResponse & { question?: Question })[]
    non_compliant:     (AuditResponse & { question?: Question })[]
    repeat_findings:   (AuditResponse & { question?: Question })[]
    informational:     (AuditResponse & { question?: Question })[]
  }
}

export default function AuditReportPage() {
  const { id } = useParams<{ id: string }>()
  const api = useApi()
  const { getAccessTokenSilently } = useAuth0()
  const [data, setData]       = useState<ReportData | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!id) return
    setLoading(true)
    try {
      const d = await api.get<ReportData>(`/qsc/audits/${id}/report`)
      setData(d)
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }, [id, api])

  useEffect(() => { load() }, [load])

  async function downloadCsv() {
    if (!id) return
    const token = await getAccessTokenSilently()
    const res = await fetch(`${API_BASE}/qsc/audits/${id}/export.csv`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) { alert('CSV download failed'); return }
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `qsc-audit-${data?.audit.key || id}.csv`
    document.body.appendChild(a); a.click(); a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  if (loading) return <Spinner />
  if (!data)   return <div className="p-6">Report not available.</div>

  const { audit, summary } = data
  const isInternal = audit.audit_type === 'internal'

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="qsc-report-no-print">
        <PageHeader
          title={`${audit.key} · Report`}
          subtitle={`${audit.location_name || '—'} · ${audit.audit_type === 'external' ? 'External' : 'Internal'} audit · auditor: ${audit.auditor_name || '—'}`}
          action={
            <div className="flex items-center gap-2">
              <Link to="/audits" className="btn-ghost text-sm">← Back</Link>
              <button onClick={downloadCsv} className="btn-outline text-sm">Export CSV</button>
              <button onClick={() => window.print()} className="btn-primary text-sm">Print / PDF</button>
            </div>
          }
        />
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-5 qsc-report-print-area">
        {/* Summary banner */}
        <section className="card p-5 mb-4">
          <div className="flex flex-wrap items-center gap-6">
            <div>
              <div className="text-xs text-text-3 uppercase">Overall score</div>
              <div className="text-4xl font-extrabold">{audit.overall_score != null ? Number(audit.overall_score).toFixed(1) : '—'}</div>
            </div>
            <div>
              <div className="text-xs text-text-3 uppercase">Rating</div>
              <span className={`inline-flex items-center px-3 py-1 rounded border text-sm font-semibold mt-1 ${ratingBadgeClass(audit.overall_rating)}`}>
                {audit.overall_rating || '—'}
                {audit.auto_unacceptable && <span className="ml-1">⚠</span>}
              </span>
            </div>
            <div className="text-sm text-text-2">
              <div><span className="text-text-3">Started:</span> {fmtDateTime(audit.started_at)}</div>
              <div><span className="text-text-3">Completed:</span> {fmtDateTime(audit.completed_at)}</div>
            </div>
            {isInternal && (
              <div className="ml-auto">
                <Badge label="Internal" variant="neutral" />
                <div className="text-xs text-text-3 mt-1">Partial score — not an external evaluation</div>
              </div>
            )}
          </div>
          {audit.auto_unacceptable && (
            <div className="mt-3 p-3 rounded bg-red-50 border border-red-200 text-sm text-red-800">
              <strong>Auto-unacceptable triggered.</strong> One or more critical findings forced the overall rating to Unacceptable regardless of the numeric score.
            </div>
          )}
          {audit.notes && (
            <div className="mt-3 p-3 rounded bg-surface-2 border border-border text-sm">
              <div className="text-xs text-text-3 uppercase mb-1">Auditor notes</div>
              {audit.notes}
            </div>
          )}
        </section>

        {/* Critical findings */}
        {summary.critical_findings.length > 0 && (
          <Section title={`⚠ Critical findings (${summary.critical_findings.length})`} tone="red">
            <FindingsList items={summary.critical_findings} />
          </Section>
        )}

        {/* Summary by department */}
        <Section title="Summary by department">
          <table className="w-full text-sm">
            <thead className="text-text-3">
              <tr>
                <th className="text-left py-1">Department</th>
                <th className="text-right py-1">Points available</th>
                <th className="text-right py-1">Deducted</th>
                <th className="text-right py-1">NC</th>
                <th className="text-right py-1">Compliant</th>
                <th className="text-right py-1">N/O</th>
                <th className="text-right py-1">N/A</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(summary.by_department).map(([d, s]) => (
                <tr key={d} className="border-t border-border">
                  <td className="py-1 font-semibold">{d}</td>
                  <td className="py-1 text-right">{s.total_points}</td>
                  <td className={`py-1 text-right ${s.deducted > 0 ? 'text-red-600 font-semibold' : ''}`}>-{s.deducted}</td>
                  <td className="py-1 text-right">{s.nc}</td>
                  <td className="py-1 text-right">{s.compliant}</td>
                  <td className="py-1 text-right">{s.not_observed}</td>
                  <td className="py-1 text-right">{s.not_applicable}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>

        {/* Summary by category */}
        <Section title="Summary by category">
          <table className="w-full text-sm">
            <thead className="text-text-3">
              <tr>
                <th className="text-left py-1">Category</th>
                <th className="text-left py-1">Department</th>
                <th className="text-right py-1">Deducted</th>
                <th className="text-right py-1">NC</th>
                <th className="text-right py-1">Compliant</th>
                <th className="text-right py-1">N/O</th>
                <th className="text-right py-1">N/A</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(summary.by_category).map(([c, s]) => (
                <tr key={c} className="border-t border-border">
                  <td className="py-1 font-semibold">{c}</td>
                  <td className="py-1 text-text-3">{s.department}</td>
                  <td className={`py-1 text-right ${s.deducted > 0 ? 'text-red-600 font-semibold' : ''}`}>-{s.deducted}</td>
                  <td className="py-1 text-right">{s.nc}</td>
                  <td className="py-1 text-right">{s.compliant}</td>
                  <td className="py-1 text-right">{s.not_observed}</td>
                  <td className="py-1 text-right">{s.not_applicable}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>

        {/* All NC findings */}
        {summary.non_compliant.length > 0 && (
          <Section title={`All non-compliant items (${summary.non_compliant.length})`}>
            <FindingsList items={summary.non_compliant} />
          </Section>
        )}

        {/* Repeat findings */}
        {summary.repeat_findings.length > 0 && (
          <Section title={`Repeat findings (${summary.repeat_findings.length})`} tone="amber">
            <FindingsList items={summary.repeat_findings} showRepeatBadge />
          </Section>
        )}

        {/* Informational */}
        {summary.informational.length > 0 && (
          <Section title={`Informational observations (${summary.informational.length})`}>
            <ul className="space-y-1 text-sm">
              {summary.informational.map((r: any) => (
                <li key={r.id} className="flex gap-2">
                  <span className="font-mono text-text-3">{r.question_code}</span>
                  <span className="flex-1">{r.comment || '—'}</span>
                </li>
              ))}
            </ul>
          </Section>
        )}

        <div className="qsc-report-no-print text-xs text-text-3 text-center py-6">
          Report generated {fmtDateTime(new Date().toISOString())} — <span className="font-mono">{audit.key}</span>
        </div>
      </div>

      {/* Print stylesheet — keep report-only content on the page */}
      <style>{`
        @media print {
          body * { visibility: hidden; }
          .qsc-report-print-area, .qsc-report-print-area * { visibility: visible; }
          .qsc-report-print-area { position: absolute; inset: 0; overflow: visible !important; padding: 24px; }
          .qsc-report-no-print { display: none !important; }
          .card { box-shadow: none !important; border: 1px solid #d8e6dd !important; page-break-inside: avoid; }
          section { page-break-inside: avoid; }
        }
      `}</style>
    </div>
  )
}

function Section({ title, children, tone }: { title: string; children: React.ReactNode; tone?: 'red' | 'amber' }) {
  const toneClass = tone === 'red'   ? 'border-red-200 bg-red-50/30'
                  : tone === 'amber' ? 'border-amber-200 bg-amber-50/30'
                  : ''
  return (
    <section className={`card p-5 mb-4 ${toneClass}`}>
      <h2 className="text-base font-bold mb-3">{title}</h2>
      {children}
    </section>
  )
}

function FindingsList({
  items, showRepeatBadge,
}: {
  items: any[]
  showRepeatBadge?: boolean
}) {
  return (
    <ul className="space-y-3">
      {items.map(r => {
        const q = r.question || {}
        const photos: any[] = r.photos || []
        return (
          <li key={r.id} className="p-3 rounded border border-border bg-surface">
            <div className="flex flex-wrap items-center gap-2 text-xs mb-2">
              <span className="font-mono px-1.5 py-0.5 rounded bg-surface-2 border border-border">{r.question_code}</span>
              {q.risk_level && (
                <span className={`px-2 py-0.5 rounded border font-semibold ${riskChipClass(q.risk_level)}`}>
                  {q.risk_level}
                </span>
              )}
              <span className="text-text-3">-{r.points_deducted} pts</span>
              {r.is_repeat    && <Badge label="Repeat"     variant="yellow" />}
              {showRepeatBadge && !r.is_repeat && <span />}
              <span className="text-text-3 ml-auto">{q.department} · {q.category}</span>
            </div>
            <div className="text-sm font-semibold mb-1">{q.title || r.question_code}</div>
            {r.product_name && <div className="text-xs text-text-3 mb-1">Product: {r.product_name}</div>}
            {r.temperature_value != null && (
              <div className="text-xs text-text-3 mb-1">Temperature: {r.temperature_value}°{r.temperature_unit}</div>
            )}
            {r.comment && <div className="text-sm text-text-2 whitespace-pre-wrap">{r.comment}</div>}
            {photos.length > 0 && (
              <div className="grid grid-cols-4 gap-2 mt-2">
                {photos.map(p => (
                  <img key={p.id} src={p.url} alt="" className="w-full h-20 object-cover rounded border border-border" />
                ))}
              </div>
            )}
            {q.cross_refs && q.cross_refs.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-2">
                {q.cross_refs.map((c: string) => (
                  <span key={c} className="px-1.5 py-0.5 rounded border border-border bg-surface-2 text-xs font-mono text-text-3">{c}</span>
                ))}
              </div>
            )}
          </li>
        )
      })}
    </ul>
  )
}
