// =============================================================================
// HTML Validation Report — modal showing violations with Ask Pepper escalation
// =============================================================================
import { Badge, Modal } from './ui'
import type { HtmlValidationResult } from '../lib/htmlValidator'

interface HtmlValidationReportProps {
  result: HtmlValidationResult
  originalFile?: File | null
  rawHtml: string
  onContinue: () => void
  onCancel: () => void
}

// ── Severity icons (inline SVGs) ─────────────────────────────────────────────

function ErrorIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"
      fill="none" stroke="#DC2626" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/>
      <line x1="9" y1="9" x2="15" y2="15"/>
    </svg>
  )
}

function WarningIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"
      fill="none" stroke="#D97706" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
      <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
    </svg>
  )
}

function InfoIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"
      fill="none" stroke="#3B82F6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/>
      <line x1="12" y1="8" x2="12.01" y2="8"/>
    </svg>
  )
}

const SEVERITY_ICON = { error: ErrorIcon, warning: WarningIcon, info: InfoIcon }
const SEVERITY_BORDER = { error: '#DC2626', warning: '#D97706', info: '#3B82F6' }
const SEVERITY_BADGE: Record<string, 'red' | 'yellow' | 'neutral'> =
  { error: 'red', warning: 'yellow', info: 'neutral' }

// ── Pepper prompt builder ────────────────────────────────────────────────────

function buildPepperPrompt(result: HtmlValidationResult): string {
  const lines = [
    `This HTML document has validation issues: ${result.summary}.`,
    `Please review the attached HTML file and suggest how to fix these issues.`,
    ``,
    `Violations found:`,
    ...result.violations.map((v, i) =>
      `${i + 1}. [${v.severity.toUpperCase()}] ${v.description}${v.line ? ` (line ${v.line})` : ''}`
    ),
    ``,
    `Please provide a corrected version of the HTML that removes all security issues while preserving the document content and styling.`,
  ]
  return lines.join('\n')
}

// ── Component ────────────────────────────────────────────────────────────────

export default function HtmlValidationReport({
  result, originalFile, rawHtml, onContinue, onCancel,
}: HtmlValidationReportProps) {

  function handleAskPepper() {
    const prompt = buildPepperPrompt(result)
    const file = originalFile ?? new File([rawHtml], 'document.html', { type: 'text/html' })
    window.dispatchEvent(new CustomEvent('pepper-ask', {
      detail: { message: prompt, screenshotFile: file },
    }))
    onCancel()
  }

  return (
    <Modal title="HTML Validation Report" onClose={onCancel} width="max-w-2xl">
      {/* ── Summary badges ──────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 mb-4">
        {result.counts.error > 0 && (
          <Badge label={`${result.counts.error} error${result.counts.error > 1 ? 's' : ''}`} variant="red" />
        )}
        {result.counts.warning > 0 && (
          <Badge label={`${result.counts.warning} warning${result.counts.warning > 1 ? 's' : ''}`} variant="yellow" />
        )}
        {result.counts.info > 0 && (
          <Badge label={`${result.counts.info} info`} variant="neutral" />
        )}
      </div>

      {result.hasErrors && (
        <p className="text-sm mb-3" style={{ color: 'var(--text-2)' }}>
          Security issues were found. The sanitiser will strip these automatically, but you may want Pepper to review and fix the source HTML.
        </p>
      )}

      {/* ── Violations list ─────────────────────────────────────────────────── */}
      <div className="max-h-96 overflow-y-auto space-y-2 mb-4 pr-1">
        {result.violations.map((v, i) => {
          const Icon = SEVERITY_ICON[v.severity]
          return (
            <div key={i} className="flex items-start gap-2.5 rounded-lg p-2.5"
              style={{
                borderLeft: `4px solid ${SEVERITY_BORDER[v.severity]}`,
                background: 'var(--surface-2)',
              }}>
              <div className="shrink-0 mt-0.5"><Icon /></div>
              <div className="min-w-0 flex-1">
                <div className="text-sm" style={{ color: 'var(--text-1)' }}>
                  {v.description}
                </div>
                {v.snippet && (
                  <code className="block mt-1 text-xs font-mono rounded px-2 py-1 break-all"
                    style={{ background: 'var(--surface)', color: 'var(--text-3)', border: '1px solid var(--border)' }}>
                    {v.snippet}
                  </code>
                )}
              </div>
              {v.line && (
                <span className="text-xs shrink-0 mt-0.5" style={{ color: 'var(--text-3)' }}>
                  Line {v.line}
                </span>
              )}
            </div>
          )
        })}
      </div>

      {/* ── Action buttons ──────────────────────────────────────────────────── */}
      <div className="flex items-center justify-end gap-2 pt-2 border-t" style={{ borderColor: 'var(--border)' }}>
        {result.hasErrors && (
          <button className="btn-primary flex items-center gap-1.5" onClick={handleAskPepper}>
            <span>Ask Pepper</span>
          </button>
        )}
        <button className="btn-outline" onClick={onContinue}>
          Continue Anyway
        </button>
        <button className="btn-ghost" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </Modal>
  )
}
