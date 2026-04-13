// =============================================================================
// HTML Content Validator — pure utility, zero React deps
// Scans raw HTML for security violations and problematic markup
// =============================================================================

export type ViolationSeverity = 'error' | 'warning' | 'info'

export interface HtmlViolation {
  severity: ViolationSeverity
  rule: string
  description: string
  tag?: string
  attribute?: string
  snippet: string
  line?: number
}

export interface HtmlValidationResult {
  violations: HtmlViolation[]
  counts: { error: number; warning: number; info: number }
  hasErrors: boolean
  hasWarnings: boolean
  summary: string
}

// ── Line number index ────────────────────────────────────────────────────────

function buildLineIndex(html: string): number[] {
  const offsets: number[] = [0]
  for (let i = 0; i < html.length; i++) {
    if (html[i] === '\n') offsets.push(i + 1)
  }
  return offsets
}

function getLineNumber(offsets: number[], charIndex: number): number {
  let lo = 0, hi = offsets.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (offsets[mid] <= charIndex) lo = mid
    else hi = mid - 1
  }
  return lo + 1 // 1-based
}

// ── Snippet extraction ───────────────────────────────────────────────────────

function extractSnippet(html: string, matchIndex: number, maxLen = 120): string {
  // Find enclosing tag
  let start = matchIndex
  while (start > 0 && html[start] !== '<') start--
  let end = matchIndex
  while (end < html.length && html[end] !== '>') end++
  end++ // include >

  let snippet = html.slice(start, end).replace(/\s+/g, ' ').trim()
  if (snippet.length > maxLen) snippet = snippet.slice(0, maxLen) + '...'
  return snippet
}

// ── Detection rules ──────────────────────────────────────────────────────────

interface Rule {
  id: string
  severity: ViolationSeverity
  pattern: RegExp
  description: string | ((match: RegExpExecArray) => string)
  tag?: string | ((match: RegExpExecArray) => string)
  attribute?: string | ((match: RegExpExecArray) => string)
}

const INLINE_HANDLER_NAMES = [
  'onabort','onblur','onchange','onclick','oncontextmenu','ondblclick',
  'ondrag','ondragend','ondragenter','ondragleave','ondragover','ondragstart','ondrop',
  'onerror','onfocus','oninput','oninvalid','onkeydown','onkeypress','onkeyup',
  'onload','onmousedown','onmouseenter','onmouseleave','onmousemove',
  'onmouseout','onmouseover','onmouseup','onpointerdown','onpointerup',
  'onreset','onresize','onscroll','onsubmit','ontouchstart','ontouchend',
  'onunload','onwheel',
]

const RULES: Rule[] = [
  // ── Errors ─────────────────────────────────────────────────────────────────
  {
    id: 'script-tag',
    severity: 'error',
    pattern: /<script[\s>]/gi,
    description: '<script> tag detected — executable code will be stripped by the sanitiser',
    tag: '<script>',
  },
  {
    id: 'iframe-tag',
    severity: 'error',
    pattern: /<iframe[\s>]/gi,
    description: '<iframe> tag detected — embedded frames are not allowed',
    tag: '<iframe>',
  },
  {
    id: 'object-tag',
    severity: 'error',
    pattern: /<object[\s>]/gi,
    description: '<object> tag detected — embedded objects are not allowed',
    tag: '<object>',
  },
  {
    id: 'embed-tag',
    severity: 'error',
    pattern: /<embed[\s>]/gi,
    description: '<embed> tag detected — embedded content is not allowed',
    tag: '<embed>',
  },
  {
    id: 'applet-tag',
    severity: 'error',
    pattern: /<applet[\s>]/gi,
    description: '<applet> tag detected — Java applets are not allowed',
    tag: '<applet>',
  },
  {
    id: 'inline-handler',
    severity: 'error',
    pattern: new RegExp(`\\s(${INLINE_HANDLER_NAMES.join('|')})\\s*=`, 'gi'),
    description: (m) => `Inline event handler "${m[1]}" detected — will be stripped`,
    attribute: (m) => m[1],
  },
  {
    id: 'javascript-url',
    severity: 'error',
    pattern: /(href|src|action)\s*=\s*["']?\s*javascript\s*:/gi,
    description: (m) => `javascript: URL in "${m[1]}" attribute — potential XSS vector`,
    attribute: (m) => m[1],
  },
  {
    id: 'style-expression',
    severity: 'error',
    pattern: /style\s*=\s*["'][^"']*expression\s*\(/gi,
    description: 'CSS expression() in style attribute — IE-specific code execution vector',
    attribute: 'style',
  },
  {
    id: 'style-js-url',
    severity: 'error',
    pattern: /style\s*=\s*["'][^"']*url\s*\(\s*["']?\s*javascript\s*:/gi,
    description: 'javascript: inside CSS url() — code execution vector',
    attribute: 'style',
  },

  // ── Warnings ───────────────────────────────────────────────────────────────
  {
    id: 'form-external-action',
    severity: 'warning',
    pattern: /<form[^>]+action\s*=\s*["']?\s*https?:\/\//gi,
    description: '<form> with external action URL — may submit data to an external server',
    tag: '<form>',
  },
  {
    id: 'meta-refresh',
    severity: 'warning',
    pattern: /<meta[^>]+http-equiv\s*=\s*["']?refresh/gi,
    description: '<meta http-equiv="refresh"> — auto-redirect detected',
    tag: '<meta>',
  },
  {
    id: 'base-tag',
    severity: 'warning',
    pattern: /<base[\s>]/gi,
    description: '<base> tag — changes all relative URLs in the document',
    tag: '<base>',
  },
  {
    id: 'form-elements',
    severity: 'warning',
    pattern: /<(input|textarea|select)[\s>]/gi,
    description: (m) => `<${m[1]}> form element found — unusual in documentation content`,
    tag: (m) => `<${m[1]}>`,
  },

  // ── Info ────────────────────────────────────────────────────────────────────
  {
    id: 'external-stylesheet',
    severity: 'info',
    pattern: /<link[^>]+rel\s*=\s*["']?\s*stylesheet/gi,
    description: 'External stylesheet <link> — will not be loaded; styles should be inline or in <style> tags',
    tag: '<link>',
  },
  {
    id: 'word-cruft',
    severity: 'info',
    pattern: /class\s*=\s*["'][^"']*Mso|<o:p>|<!--\[if\s/gi,
    description: 'Word/Office-generated HTML detected — may contain unnecessary markup that increases file size',
  },
]

// ── Large base64 detection (special, not regex-only) ─────────────────────────

function detectLargeBase64(html: string, lineIndex: number[]): HtmlViolation[] {
  const violations: HtmlViolation[] = []
  const re = /data:[^;]{1,50};base64,([A-Za-z0-9+/=]+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null) {
    const payloadLen = m[1].length
    const byteSize = Math.floor(payloadLen * 0.75)
    if (byteSize > 50 * 1024) { // >50KB
      violations.push({
        severity: 'warning',
        rule: 'large-base64',
        description: `Large base64 data URI (~${Math.round(byteSize / 1024)}KB) — increases document size significantly`,
        snippet: m[0].slice(0, 60) + '...',
        line: getLineNumber(lineIndex, m.index),
      })
    }
  }
  return violations
}

// ── Main validator ───────────────────────────────────────────────────────────

export function validateHtml(rawHtml: string): HtmlValidationResult {
  if (!rawHtml || !rawHtml.trim()) {
    return { violations: [], counts: { error: 0, warning: 0, info: 0 }, hasErrors: false, hasWarnings: false, summary: '' }
  }

  const lineIndex = buildLineIndex(rawHtml)
  const violations: HtmlViolation[] = []

  // Run each rule
  for (const rule of RULES) {
    // Reset regex state
    rule.pattern.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = rule.pattern.exec(rawHtml)) !== null) {
      violations.push({
        severity: rule.severity,
        rule: rule.id,
        description: typeof rule.description === 'function' ? rule.description(m) : rule.description,
        tag: typeof rule.tag === 'function' ? rule.tag(m) : rule.tag,
        attribute: typeof rule.attribute === 'function' ? rule.attribute(m) : rule.attribute,
        snippet: extractSnippet(rawHtml, m.index),
        line: getLineNumber(lineIndex, m.index),
      })
    }
  }

  // Large base64
  violations.push(...detectLargeBase64(rawHtml, lineIndex))

  // Sort: errors first, then warnings, then info
  const order: Record<ViolationSeverity, number> = { error: 0, warning: 1, info: 2 }
  violations.sort((a, b) => order[a.severity] - order[b.severity] || (a.line ?? 0) - (b.line ?? 0))

  // Counts
  const counts = { error: 0, warning: 0, info: 0 }
  for (const v of violations) counts[v.severity]++

  // Summary
  const parts: string[] = []
  if (counts.error)   parts.push(`${counts.error} error${counts.error > 1 ? 's' : ''}`)
  if (counts.warning) parts.push(`${counts.warning} warning${counts.warning > 1 ? 's' : ''}`)
  if (counts.info)    parts.push(`${counts.info} info`)
  const summary = parts.join(', ') || 'No issues found'

  return {
    violations,
    counts,
    hasErrors: counts.error > 0,
    hasWarnings: counts.warning > 0,
    summary,
  }
}
