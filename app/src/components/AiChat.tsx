import React, { useState, useRef, useEffect, useCallback, RefObject } from 'react'
import { useLocation } from 'react-router-dom'
import { useAuth0 } from '@auth0/auth0-react'

const API_BASE = import.meta.env.VITE_API_URL || '/api'

// ── Types ─────────────────────────────────────────────────────────────────────

interface Message {
  role: 'user' | 'assistant'
  content: string
  toolNames?: string[]
  fileName?: string
  /** Set when an Excel export was triggered during this message */
  downloadFile?: { filename: string }
}

interface ChatSession {
  session_id: string
  started_at: string
  last_active_at: string
  turns: number
  first_message: string
  last_message: string
}

interface MyUsage {
  period_tokens: number
  limit:         number
  remaining:     number | null
  exceeded:      boolean
  next_reset:    string
}

type PanelView = 'chat' | 'history'

// ── Helpers ───────────────────────────────────────────────────────────────────

function newSessionId() {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36)
}

function formatSessionDate(iso: string) {
  const d    = new Date(iso)
  const now  = new Date()
  const diff = (now.getTime() - d.getTime()) / 1000
  if (diff < 60)         return 'Just now'
  if (diff < 3600)       return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400)      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  if (diff < 86400 * 7)  return d.toLocaleDateString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' })
  return d.toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' })
}

function groupSessionsByDate(sessions: ChatSession[]) {
  const today     = new Date(); today.setHours(0,0,0,0)
  const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1)
  const week      = new Date(today); week.setDate(today.getDate() - 7)

  const groups: Record<string, ChatSession[]> = {
    'Today': [], 'Yesterday': [], 'This week': [], 'Older': [],
  }
  for (const s of sessions) {
    const d = new Date(s.last_active_at); d.setHours(0,0,0,0)
    if (d >= today)          groups['Today'].push(s)
    else if (d >= yesterday) groups['Yesterday'].push(s)
    else if (d >= week)      groups['This week'].push(s)
    else                     groups['Older'].push(s)
  }
  return groups
}

// ── CogIcon ───────────────────────────────────────────────────────────────────

function CogIcon({ size = 24, color = '#fff' }: { size?: number; color?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="-100 -100 200 200" width={size} height={size}>
      <circle cx="0" cy="0" r="66" fill={color}/>
      <g fill={color}>
        {[0,30,60,90,120,150,180,210,240,270,300,330].map(deg => (
          <rect key={deg} x="-9" y="-80" width="18" height="20" rx="3"
            transform={`rotate(${deg})`}/>
        ))}
      </g>
      <circle cx="0" cy="0" r="54" fill="var(--accent)"/>
      <line x1="0" y1="30" x2="0" y2="-16"
        stroke={color} strokeWidth="6" strokeLinecap="round"/>
      <path d="M 0,6 C -4,-10 -26,-16 -26,-4 C -26,8 -8,12 0,6 Z" fill="#1E8A44"/>
      <path d="M 0,-4 C 4,-20 26,-26 26,-14 C 26,-2 8,2 0,-4 Z" fill={color}/>
      <circle cx="0" cy="-16" r="6" fill="#1E8A44"/>
    </svg>
  )
}

// ── Markdown renderer ─────────────────────────────────────────────────────────

function renderMd(text: string): string {
  // Escape HTML entities (applied before inline formatting)
  const esc = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

  // Inline markdown – input is already HTML-escaped
  const inline = (s: string): string =>
    s.replace(/`([^`\n]+)`/g, (_, c) =>
        `<code style="background:var(--accent-dim);padding:1px 4px;border-radius:3px;font-size:0.75em;font-family:ui-monospace,SFMono-Regular,monospace">${c}</code>`)
     .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
     .replace(/\*([^*\n]+)\*/g, '<em>$1</em>')
     .replace(/_([^_\n]+)_/g, '<em>$1</em>')

  const lines = text.split('\n')
  const out: string[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i].trim()

    // ── Fenced code block ──────────────────────────────────────────────────────
    if (line.startsWith('```')) {
      const body: string[] = []
      i++
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        body.push(esc(lines[i]))
        i++
      }
      i++ // skip closing ```
      out.push(
        `<pre style="background:var(--surface-2);border:1px solid var(--border);border-radius:6px;` +
        `padding:10px 12px;margin:6px 0;overflow-x:auto;font-size:0.72rem;font-family:ui-monospace,` +
        `SFMono-Regular,monospace;line-height:1.55;white-space:pre-wrap;color:var(--text-2)">${body.join('\n')}</pre>`
      )
      continue
    }

    // ── Heading ────────────────────────────────────────────────────────────────
    const hm = line.match(/^(#{1,3})\s+(.+)$/)
    if (hm) {
      const lvl = hm[1].length
      const style = lvl === 1
        ? 'font-size:0.9rem;font-weight:800;margin:10px 0 3px;color:var(--text-1)'
        : lvl === 2
        ? 'font-size:0.85rem;font-weight:700;margin:8px 0 2px;color:var(--text-1)'
        : 'font-size:0.72rem;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;margin:6px 0 2px;color:var(--text-3)'
      out.push(`<div style="${style}">${inline(esc(hm[2]))}</div>`)
      i++; continue
    }

    // ── Pipe table ─────────────────────────────────────────────────────────────
    if (line.includes('|') && i + 1 < lines.length && /^\|?[\s:\-|]+\|?$/.test(lines[i + 1].trim())) {
      const parseRow = (r: string) =>
        r.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim())
      const headers = parseRow(line)
      i += 2  // skip header + separator
      const rows: string[][] = []
      while (i < lines.length && lines[i].trim().includes('|')) {
        rows.push(parseRow(lines[i]))
        i++
      }
      let tbl = '<div style="overflow-x:auto;margin:6px 0;border-radius:6px;border:1px solid var(--border)">'
      tbl += '<table style="width:100%;border-collapse:collapse;font-size:0.72rem">'
      tbl += '<thead><tr style="background:var(--surface-2)">'
      for (const h of headers)
        tbl += `<th style="padding:5px 10px;text-align:left;font-weight:600;color:var(--text-2);` +
               `border-bottom:2px solid var(--border);white-space:nowrap">${inline(esc(h))}</th>`
      tbl += '</tr></thead><tbody>'
      rows.forEach((row, ri) => {
        tbl += `<tr style="background:${ri % 2 === 1 ? 'var(--surface-2)' : 'transparent'}">`
        headers.forEach((_, hi) => {
          const cell = row[hi] ?? ''
          tbl += `<td style="padding:4px 10px;color:var(--text-1);border-top:1px solid var(--border)">${inline(esc(cell))}</td>`
        })
        tbl += '</tr>'
      })
      tbl += '</tbody></table></div>'
      out.push(tbl)
      continue
    }

    // ── Unordered list ─────────────────────────────────────────────────────────
    if (/^[-*•]\s/.test(line)) {
      const items: string[] = []
      while (i < lines.length && /^[-*•]\s/.test(lines[i].trim())) {
        items.push(
          `<li style="color:var(--text-1);padding-left:2px">${inline(esc(lines[i].trim().replace(/^[-*•]\s+/, '')))}</li>`
        )
        i++
      }
      out.push(`<ul style="margin:4px 0;padding-left:18px;list-style-type:disc;display:flex;flex-direction:column;gap:1px">${items.join('')}</ul>`)
      continue
    }

    // ── Ordered list ───────────────────────────────────────────────────────────
    if (/^\d+[.)]\s/.test(line)) {
      const items: string[] = []
      while (i < lines.length && /^\d+[.)]\s/.test(lines[i].trim())) {
        items.push(
          `<li style="color:var(--text-1);padding-left:2px">${inline(esc(lines[i].trim().replace(/^\d+[.)]\s+/, '')))}</li>`
        )
        i++
      }
      out.push(`<ol style="margin:4px 0;padding-left:18px;list-style-type:decimal;display:flex;flex-direction:column;gap:1px">${items.join('')}</ol>`)
      continue
    }

    // ── Blank line → small spacer ──────────────────────────────────────────────
    if (!line) {
      out.push('<div style="height:5px"></div>')
      i++; continue
    }

    // ── Regular text ──────────────────────────────────────────────────────────
    out.push(`<div style="line-height:1.6;color:var(--text-1)">${inline(esc(line))}</div>`)
    i++
  }

  return out.join('')
}

const ACCEPTED_TYPES = '.csv,.txt,.pdf,.xlsx,.xls,.docx,.pptx,image/png,image/jpeg,image/webp'

export type PepperMode = 'float' | 'docked-left' | 'docked-right'

const FLOAT_SIZE_KEY  = 'pepper-float-size'
const MIN_FLOAT_W = 300
const MAX_FLOAT_W = 800
const MIN_FLOAT_H = 380
const MAX_FLOAT_H = 900

// ── HistoryPanel — module-level component (stable identity across renders) ────

interface HistoryPanelProps {
  sessions: ChatSession[]
  sessionsLoad: boolean
  onBack: () => void
  onNewChat: () => void
  onLoadSession: (sid: string) => void
}

function HistoryPanel({ sessions, sessionsLoad, onBack, onNewChat, onLoadSession }: HistoryPanelProps) {
  const groups  = groupSessionsByDate(sessions)
  const isEmpty = sessions.length === 0 && !sessionsLoad

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* History header */}
      <div className="flex items-center gap-2 px-4 py-2.5 border-b flex-shrink-0"
        style={{ borderColor: 'var(--border)' }}>
        <button onClick={onBack}
          className="text-xs flex items-center gap-1 hover:opacity-70 transition-opacity"
          style={{ color: 'var(--accent)' }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <path d="M15 18l-6-6 6-6"/>
          </svg>
          Back
        </button>
        <span className="text-sm font-semibold flex-1" style={{ color: 'var(--text-1)' }}>Chat History</span>
        <button onClick={onNewChat}
          className="text-xs px-2 py-1 rounded"
          style={{ background: 'var(--accent-dim)', color: 'var(--accent)' }}>
          + New Chat
        </button>
      </div>

      {/* Session list */}
      <div className="flex-1 overflow-y-auto py-2">
        {sessionsLoad && (
          <div className="flex justify-center py-8">
            <span className="w-5 h-5 border-2 border-accent/30 border-t-accent rounded-full animate-spin inline-block"
              style={{ borderTopColor: 'var(--accent)' }}/>
          </div>
        )}
        {isEmpty && !sessionsLoad && (
          <div className="text-center py-10 px-4" style={{ color: 'var(--text-3)' }}>
            <p className="text-sm">No saved conversations yet.</p>
            <p className="text-xs mt-1">Your chats are stored after you send a message.</p>
          </div>
        )}
        {Object.entries(groups).map(([label, group]) => {
          if (!group.length) return null
          return (
            <div key={label}>
              <div className="px-4 py-1 text-xs font-semibold uppercase tracking-wide"
                style={{ color: 'var(--text-3)' }}>{label}</div>
              {group.map(s => (
                <button key={s.session_id} onClick={() => onLoadSession(s.session_id)}
                  className="w-full text-left px-4 py-2.5 hover:bg-[var(--surface-2)] transition-colors border-b"
                  style={{ borderColor: 'var(--border)' }}>
                  <div className="flex items-center justify-between mb-0.5">
                    <span className="text-xs" style={{ color: 'var(--text-3)' }}>
                      {formatSessionDate(s.last_active_at)}
                    </span>
                    <span className="text-xs px-1.5 py-0.5 rounded"
                      style={{ background: 'var(--surface-2)', color: 'var(--text-3)' }}>
                      {s.turns} {s.turns === 1 ? 'turn' : 'turns'}
                    </span>
                  </div>
                  <p className="text-sm truncate" style={{ color: 'var(--text-1)' }}>
                    {s.first_message || '(file upload)'}
                  </p>
                </button>
              ))}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── ChatPanel — module-level component (stable identity across renders) ────────

interface ChatPanelProps {
  messages: Message[]
  streaming: boolean
  toolLabel: string | null
  attachedFile: File | null
  attachedFilePreview: string | null   // object URL for image thumbnail
  input: string
  inputRef: RefObject<HTMLTextAreaElement>
  fileInputRef: RefObject<HTMLInputElement>
  bottomRef: RefObject<HTMLDivElement>
  onInputChange: (val: string) => void
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void
  onPaste: (e: React.ClipboardEvent<HTMLTextAreaElement>) => void
  onSend: () => void
  onFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void
  onFilePickerClick: () => void
  onRemoveFile: () => void
  onScreenshot: () => void
  canSend: boolean
}

function ChatPanel({
  messages, streaming, toolLabel, attachedFile, attachedFilePreview, input,
  inputRef, fileInputRef, bottomRef,
  onInputChange, onKeyDown, onPaste, onSend, onFileChange, onFilePickerClick, onRemoveFile, onScreenshot,
  canSend,
}: ChatPanelProps) {
  return (
    <>
      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {messages.length === 0 && (
          <div className="text-center py-8" style={{ color: 'var(--text-3)' }}>
            <div className="flex justify-center mb-3">
              <div className="w-12 h-12 rounded-full flex items-center justify-center"
                style={{ background: 'var(--accent-dim)' }}>
                <CogIcon size={28} color="var(--accent)" />
              </div>
            </div>
            <p className="text-sm font-semibold mb-1" style={{ color: 'var(--accent)' }}>Hi, I'm Pepper!</p>
            <p className="text-sm">Ask me about your ingredients, recipes, COGS, or how to use the platform. I can also create and edit records — just ask!</p>
            <p className="text-xs mt-2 opacity-70">📎 Attach CSV, Excel, Word, PPTX, PDF or images to import data</p>
          </div>
        )}
        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className="max-w-[85%] rounded-lg px-3 py-2 text-sm"
              style={msg.role === 'user'
                ? { background: 'var(--accent)', color: '#fff' }
                : { background: 'var(--surface-2)', color: 'var(--text-1)', border: '1px solid var(--border)' }
              }>
              {msg.fileName && (
                <div className="flex items-center gap-1 mb-1.5 text-xs opacity-80">
                  <span>📎</span>
                  <span className="truncate max-w-[180px]">{msg.fileName}</span>
                </div>
              )}
              {msg.role === 'assistant' && msg.toolNames?.length ? (
                <div className="flex flex-wrap gap-1 mb-1">
                  {msg.toolNames.map((t, j) => (
                    <span key={j} className="text-xs px-1.5 py-0.5 rounded"
                      style={{ background: 'var(--accent-dim)', color: 'var(--accent-dark)' }}>
                      ⚙ {t}
                    </span>
                  ))}
                </div>
              ) : null}
              {msg.downloadFile && (
                <div className="flex items-center gap-1.5 mt-1.5 mb-0.5 text-xs px-2 py-1 rounded"
                  style={{ background: 'rgba(20,106,52,0.12)', color: 'var(--accent-dark)' }}>
                  <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24"
                    fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                    <polyline points="7 10 12 15 17 10"/>
                    <line x1="12" y1="15" x2="12" y2="3"/>
                  </svg>
                  <span className="truncate max-w-[200px]">{msg.downloadFile.filename}</span>
                  <span className="opacity-60">downloaded</span>
                </div>
              )}
              {msg.content ? (
                <span dangerouslySetInnerHTML={{ __html: renderMd(msg.content) }} />
              ) : (
                streaming && i === messages.length - 1 ? (
                  <span className="flex items-center gap-1.5 py-0.5">
                    {toolLabel && (
                      <span className="text-xs opacity-50 mr-1">{toolLabel}</span>
                    )}
                    {[0, 1, 2].map(j => (
                      <span
                        key={j}
                        className="inline-block rounded-full"
                        style={{
                          width: 7, height: 7,
                          background: 'var(--accent)',
                          opacity: 0.7,
                          animation: `pepper-dot 1.2s ease-in-out ${j * 0.2}s infinite`,
                        }}
                      />
                    ))}
                  </span>
                ) : null
              )}
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* File preview badge */}
      {attachedFile && (
        <div className="flex-shrink-0 mx-3 mb-1 rounded-lg flex items-center gap-2 text-xs overflow-hidden"
          style={{ background: 'var(--accent-dim)', color: 'var(--accent-dark)', border: '1px solid var(--accent)/20' }}>
          {attachedFilePreview ? (
            <img src={attachedFilePreview} alt="preview"
              className="w-14 h-14 object-cover flex-shrink-0 rounded-l-lg" />
          ) : (
            <span className="pl-3">📎</span>
          )}
          <span className="flex-1 truncate py-1.5 pr-1">{attachedFile.name}</span>
          <button onClick={onRemoveFile}
            className="shrink-0 px-2 py-1.5 opacity-60 hover:opacity-100 transition-opacity font-bold self-stretch flex items-center"
            title="Remove file">✕</button>
        </div>
      )}

      {/* Input */}
      <div className="flex-shrink-0 px-3 py-3 border-t" style={{ borderColor: 'var(--border)' }}>
        <div className="flex items-end gap-2 rounded-lg px-3 py-2"
          style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
          <input ref={fileInputRef} type="file" accept={ACCEPTED_TYPES} className="hidden" onChange={onFileChange} />
          {/* Attach file */}
          <button onClick={onFilePickerClick} disabled={streaming}
            className="flex-shrink-0 w-7 h-7 flex items-center justify-center rounded transition-opacity disabled:opacity-40 hover:opacity-70"
            style={{ color: 'var(--text-3)' }} title="Attach file" aria-label="Attach file">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48"/>
            </svg>
          </button>
          {/* Screenshot page */}
          <button onClick={onScreenshot} disabled={streaming}
            className="flex-shrink-0 w-7 h-7 flex items-center justify-center rounded transition-opacity disabled:opacity-40 hover:opacity-70"
            style={{ color: 'var(--text-3)' }} title="Attach screenshot of current page" aria-label="Screenshot page">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/>
              <circle cx="12" cy="13" r="4"/>
            </svg>
          </button>
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => onInputChange(e.target.value)}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
            placeholder={attachedFile ? 'Add a message… (optional)' : 'Ask anything… (Enter to send)'}
            disabled={streaming}
            rows={1}
            className="flex-1 resize-none bg-transparent text-sm outline-none leading-relaxed"
            style={{ color: 'var(--text-1)', maxHeight: '120px', overflowY: 'auto' }}
          />
          <button onClick={onSend} disabled={!canSend}
            className="flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center transition-opacity disabled:opacity-40"
            style={{ background: 'var(--accent)', color: '#fff' }} aria-label="Send">
            {streaming
              ? <span className="flex items-center gap-0.5">
                  {[0,1,2].map(j => (
                    <span key={j} className="inline-block rounded-full bg-white"
                      style={{ width: 4, height: 4, animation: `pepper-dot 1.2s ease-in-out ${j * 0.2}s infinite` }} />
                  ))}
                </span>
              : <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M2 21l21-9L2 3v7l15 2-15 2z" /></svg>
            }
          </button>
        </div>
        <p className="text-center mt-1.5 text-xs" style={{ color: 'var(--text-3)' }}>
          Shift+Enter for new line · 📎 attach or paste image · CSV, Excel, Word, PPTX, PDF · 10 MB max
        </p>
      </div>
    </>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function AiChat({ mode = 'float', onModeChange }: { mode?: PepperMode; onModeChange?: (m: PepperMode) => void }) {
  const { user, getAccessTokenSilently } = useAuth0()

  // Returns { Authorization: 'Bearer <token>' } for every authenticated fetch
  const authHeader = useCallback(async () => {
    try {
      const token = await getAccessTokenSilently()
      return { Authorization: `Bearer ${token}` }
    } catch {
      return {} as Record<string, string>
    }
  }, [getAccessTokenSilently])
  const location   = useLocation()

  const [open,               setOpen]               = useState(false)
  const [view,               setView]               = useState<PanelView>('chat')
  const [messages,           setMessages]           = useState<Message[]>([])
  const [input,              setInput]              = useState('')
  const [streaming,          setStreaming]          = useState(false)
  const [toolLabel,          setToolLabel]          = useState<string | null>(null)
  const [attachedFile,       setAttachedFile]       = useState<File | null>(null)
  const [attachedFilePreview,setAttachedFilePreview]= useState<string | null>(null)
  const [sessionId,          setSessionId]          = useState(newSessionId)
  const [sessions,           setSessions]           = useState<ChatSession[]>([])
  const [sessionsLoad,       setSessionsLoad]       = useState(false)
  const [myUsage,            setMyUsage]            = useState<MyUsage | null>(null)

  const [floatSize, setFloatSize] = useState<{ w: number; h: number }>(() => {
    try {
      const s = localStorage.getItem(FLOAT_SIZE_KEY)
      if (s) return JSON.parse(s)
    } catch { /* ignore */ }
    return { w: 390, h: 600 }
  })
  const floatSizeRef = useRef(floatSize)
  useEffect(() => { floatSizeRef.current = floatSize }, [floatSize])

  const bottomRef    = useRef<HTMLDivElement>(null)
  const inputRef     = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const wasStreaming = useRef(false)

  // Scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streaming])

  // Focus input when chat opens or view switches back to chat
  useEffect(() => {
    if (open && view === 'chat') setTimeout(() => inputRef.current?.focus(), 150)
  }, [open, view])

  // Restore focus when streaming completes
  useEffect(() => {
    if (wasStreaming.current && !streaming && open && view === 'chat') {
      setTimeout(() => inputRef.current?.focus(), 100)
    }
    wasStreaming.current = streaming
  }, [streaming, open, view])

  // Fetch monthly usage when panel opens and after each response completes
  const refreshUsage = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/ai-chat/my-usage`, { headers: await authHeader() })
      if (res.ok) setMyUsage(await res.json())
    } catch { /* non-critical */ }
  }, [authHeader])

  useEffect(() => {
    if (open) refreshUsage()
  }, [open, refreshUsage])

  useEffect(() => {
    // Refresh after each streaming turn completes
    if (!streaming && open) refreshUsage()
  }, [streaming]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── New Chat ──────────────────────────────────────────────────────────────

  const startNewChat = useCallback(() => {
    setMessages([])
    setInput('')
    setAttachedFile(null)
    setSessionId(newSessionId())
    setView('chat')
  }, [])

  // ── History panel ─────────────────────────────────────────────────────────

  const openHistory = useCallback(async () => {
    setView('history')
    if (!user?.sub) return
    setSessionsLoad(true)
    try {
      const params = new URLSearchParams({ user_sub: user.sub, limit: '40' })
      const res    = await fetch(`${API_BASE}/ai-chat/sessions?${params}`, { headers: await authHeader() })
      if (res.ok) setSessions(await res.json())
    } catch { /* non-critical */ }
    finally  { setSessionsLoad(false) }
  }, [user?.sub])

  const loadSession = useCallback(async (sid: string) => {
    if (!user?.sub) return
    try {
      const params = new URLSearchParams({ user_sub: user.sub })
      const res    = await fetch(`${API_BASE}/ai-chat/sessions/${encodeURIComponent(sid)}?${params}`, { headers: await authHeader() })
      if (!res.ok) return
      const turns: Array<{ user_message: string; response: string; tools_called?: string[] }> = await res.json()
      const loaded: Message[] = []
      for (const t of turns) {
        loaded.push({ role: 'user',      content: t.user_message })
        loaded.push({ role: 'assistant', content: t.response,
          toolNames: Array.isArray(t.tools_called) ? t.tools_called : [] })
      }
      setMessages(loaded)
      setSessionId(sid)
      setView('chat')
    } catch { /* non-critical */ }
  }, [user?.sub])

  // ── Send ──────────────────────────────────────────────────────────────────

  // ── Core send logic (accepts direct text override for programmatic use) ───────

  const sendCore = useCallback(async (overrideText?: string, overrideFile?: File | null) => {
    const text     = (overrideText ?? input).trim()
    const fileToUse = overrideFile !== undefined ? overrideFile : attachedFile
    const hasFile  = fileToUse !== null
    if ((!text && !hasFile) || streaming) return

    const fileName = fileToUse?.name
    const userMsg: Message = { role: 'user', content: text || `📎 ${fileName}`, fileName }
    setMessages(prev => [...prev, userMsg])
    setInput('')
    setAttachedFile(null)
    setStreaming(true)
    setToolLabel(null)

    const history = messages.slice(-10).map(m => ({ role: m.role, content: m.content }))
    const context = { currentPage: location.pathname }

    setMessages(prev => [...prev, { role: 'assistant', content: '' }])

    try {
      let res: Response

      if (hasFile && fileToUse) {
        const form = new FormData()
        if (text)          form.append('message',    text)
        form.append('file',      fileToUse)
        form.append('context',   JSON.stringify(context))
        form.append('history',   JSON.stringify(history))
        form.append('sessionId', sessionId)
        if (user?.email)   form.append('userEmail',  user.email)
        if (user?.sub)     form.append('userSub',    user.sub)
        res = await fetch(`${API_BASE}/ai-upload`, { method: 'POST', body: form, headers: await authHeader() })
      } else {
        res = await fetch(`${API_BASE}/ai-chat`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json', ...await authHeader() },
          body:    JSON.stringify({
            message: text, history, context,
            sessionId,
            userEmail: user?.email ?? null,
            userSub:   user?.sub   ?? null,
          }),
        })
      }

      if (!res.ok || !res.body) {
        const err = await res.json().catch(() => ({ error: { message: `HTTP ${res.status}` } }))
        setMessages(prev => {
          const msgs = [...prev]
          msgs[msgs.length - 1] = { role: 'assistant', content: `Error: ${err?.error?.message ?? 'Request failed'}` }
          return msgs
        })
        return
      }

      const reader  = res.body.getReader()
      const decoder = new TextDecoder()
      let   buffer  = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const raw = line.slice(6).trim()
          if (!raw) continue
          try {
            const event = JSON.parse(raw)
            if (event.type === 'text') {
              setMessages(prev => {
                const msgs = [...prev]
                msgs[msgs.length - 1] = { ...msgs[msgs.length - 1], content: msgs[msgs.length - 1].content + event.text }
                return msgs
              })
            }
            if (event.type === 'tool') {
              setToolLabel(event.name)
              setMessages(prev => {
                const msgs = [...prev]
                const last = msgs[msgs.length - 1]
                msgs[msgs.length - 1] = { ...last, toolNames: [...(last.toolNames ?? []), event.name] }
                return msgs
              })
            }
            if (event.type === 'error') {
              setMessages(prev => {
                const msgs = [...prev]
                msgs[msgs.length - 1] = { role: 'assistant', content: `Error: ${event.message}` }
                return msgs
              })
            }
            if (event.type === 'download') {
              // Trigger browser file download from base64 payload
              try {
                const bytes   = Uint8Array.from(atob(event.base64), (c: string) => c.charCodeAt(0))
                const blob    = new Blob([bytes], { type: event.mimeType || 'application/octet-stream' })
                const url     = URL.createObjectURL(blob)
                const anchor  = document.createElement('a')
                anchor.href     = url
                anchor.download = event.filename
                document.body.appendChild(anchor)
                anchor.click()
                document.body.removeChild(anchor)
                URL.revokeObjectURL(url)
              } catch { /* download failed silently */ }
              // Tag the current message so a badge is shown
              setMessages(prev => {
                const msgs = [...prev]
                msgs[msgs.length - 1] = { ...msgs[msgs.length - 1], downloadFile: { filename: event.filename } }
                return msgs
              })
            }
            if (event.type === 'done') setToolLabel(null)
          } catch { /* ignore parse errors */ }
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Network error'
      setMessages(prev => {
        const msgs = [...prev]
        msgs[msgs.length - 1] = { role: 'assistant', content: `Error: ${msg}` }
        return msgs
      })
    } finally {
      setStreaming(false)
      setToolLabel(null)
    }
  }, [input, attachedFile, streaming, messages, location.pathname, sessionId, user])

  const send        = useCallback(() => sendCore(),          [sendCore])

  const handleKey = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
  }, [send])

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setAttachedFile(e.target.files?.[0] ?? null)
    e.target.value = ''
  }, [])

  const handleFilePickerClick = useCallback(() => {
    fileInputRef.current?.click()
  }, [])

  const handleRemoveFile = useCallback(() => setAttachedFile(null), [])

  const handleScreenshot = useCallback(async () => {
    try {
      const { default: html2canvas } = await import('html2canvas')
      const mainEl = document.querySelector('main') as HTMLElement
      const canvas = await html2canvas(mainEl || document.body, {
        scale: 0.65, useCORS: true, logging: false,
        ignoreElements: (el: Element) => el.classList.contains('pepper-ui'),
      })
      const file = await new Promise<File | null>(resolve =>
        canvas.toBlob(
          blob => resolve(blob ? new File([blob], `screenshot-${Date.now()}.jpg`, { type: 'image/jpeg' }) : null),
          'image/jpeg', 0.82
        )
      )
      if (file) setAttachedFile(file)
    } catch { /* silent */ }
  }, [])

  // ── Float panel resize ────────────────────────────────────────────────────
  // Panel is pinned to bottom-right, so dragging the top-left corner
  // moves the top (height) and left (width) edges.

  const startFloatResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const startX = e.clientX
    const startY = e.clientY
    const startW = floatSizeRef.current.w
    const startH = floatSizeRef.current.h

    function onMove(ev: MouseEvent) {
      // Moving left → panel grows wider (right edge is fixed)
      const w = Math.max(MIN_FLOAT_W, Math.min(MAX_FLOAT_W, startW - (ev.clientX - startX)))
      // Moving up → panel grows taller (bottom edge is fixed)
      const h = Math.max(MIN_FLOAT_H, Math.min(MAX_FLOAT_H, startH - (ev.clientY - startY)))
      floatSizeRef.current = { w, h }
      setFloatSize({ w, h })
    }
    function onUp() {
      localStorage.setItem(FLOAT_SIZE_KEY, JSON.stringify(floatSizeRef.current))
      document.body.style.cursor     = ''
      document.body.style.userSelect = ''
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup',   onUp)
    }

    document.body.style.cursor     = 'nw-resize'
    document.body.style.userSelect = 'none'
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup',   onUp)
  }, [])

  // Generate / revoke object URL for image previews
  useEffect(() => {
    if (attachedFile && attachedFile.type.startsWith('image/')) {
      const url = URL.createObjectURL(attachedFile)
      setAttachedFilePreview(url)
      return () => URL.revokeObjectURL(url)
    }
    setAttachedFilePreview(null)
  }, [attachedFile])

  // Paste image from clipboard
  const handlePaste = useCallback((e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = Array.from(e.clipboardData?.items ?? [])
    const imgItem = items.find(item => item.type.startsWith('image/'))
    if (!imgItem) return
    const blob = imgItem.getAsFile()
    if (!blob) return
    e.preventDefault()
    const ext  = blob.type.split('/')[1]?.replace('jpeg', 'jpg') ?? 'png'
    const name = `pasted-image-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.${ext}`
    setAttachedFile(new File([blob], name, { type: blob.type }))
  }, [])

  // ── pepper-ask: right-click "Ask Pepper" on instrumented elements — sends immediately
  useEffect(() => {
    function onAsk(e: Event) {
      const { message, screenshotFile } = (e as CustomEvent<{ message: string; screenshotFile?: File | null }>).detail
      if (!message) return
      setOpen(true)
      setView('chat')
      // Small delay to ensure panel is mounted/visible before sending
      setTimeout(() => sendCore(message, screenshotFile ?? null), 80)
    }
    window.addEventListener('pepper-ask', onAsk)
    return () => window.removeEventListener('pepper-ask', onAsk)
  }, [sendCore])

  // ── pepper-screenshot: right-click "Screenshot & Ask" — attaches file, opens panel, user types
  useEffect(() => {
    function onScreenshot(e: Event) {
      const { screenshotFile } = (e as CustomEvent<{ screenshotFile: File | null }>).detail
      setOpen(true)
      setView('chat')
      if (screenshotFile) setAttachedFile(screenshotFile)
      // Focus textarea so user can type their question
      setTimeout(() => inputRef.current?.focus(), 80)
    }
    window.addEventListener('pepper-screenshot', onScreenshot)
    return () => window.removeEventListener('pepper-screenshot', onScreenshot)
  }, [])

  const canSend = !streaming && (input.trim().length > 0 || attachedFile !== null)

  // ── Shared panel content ──────────────────────────────────────────────────

  const docked = mode !== 'float'

  // Usage bar values
  const usagePct      = myUsage?.limit ? Math.min(100, Math.round((myUsage.period_tokens / myUsage.limit) * 100)) : 0
  const usageExceeded = myUsage?.exceeded ?? false
  const usageWarning  = myUsage?.limit ? usagePct >= 80 && !usageExceeded : false
  const fmtTok        = (n: number) => n >= 1_000_000 ? `${(n/1_000_000).toFixed(1)}M` : n >= 1_000 ? `${(n/1_000).toFixed(0)}k` : String(n)

  const panelHeader = (
    <div className={`flex-shrink-0 ${!docked ? 'rounded-t-xl' : ''}`}
      style={{ background: 'var(--accent)', color: '#fff' }}>
      <div className="flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-2.5">
          <CogIcon size={26} color="#fff" />
          <div>
            <div className="font-semibold text-sm leading-tight">Pepper</div>
            <div className="text-xs opacity-75">Powered by Claude</div>
          </div>
        </div>
      <div className="flex items-center gap-1">
        {/* Dock-mode toggles */}
        <div className="flex items-center rounded overflow-hidden mr-1" style={{ background: 'rgba(255,255,255,0.15)' }}>
          {/* Dock left */}
          <button onClick={() => onModeChange?.('docked-left')} title="Dock to left"
            className={`p-1.5 transition-colors ${mode === 'docked-left' ? 'bg-white/30' : 'hover:bg-white/20'}`}>
            <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor">
              <rect x="1" y="1" width="5" height="14" rx="1" opacity="1"/>
              <rect x="7" y="1" width="8" height="14" rx="1" opacity="0.4"/>
            </svg>
          </button>
          {/* Float */}
          <button onClick={() => onModeChange?.('float')} title="Floating panel"
            className={`p-1.5 transition-colors ${mode === 'float' ? 'bg-white/30' : 'hover:bg-white/20'}`}>
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
              <rect x="4" y="4" width="10" height="10" rx="1.5"/>
              <path d="M2 2h4v4H2z" fill="currentColor" stroke="none" opacity="0.5"/>
            </svg>
          </button>
          {/* Dock right */}
          <button onClick={() => onModeChange?.('docked-right')} title="Dock to right"
            className={`p-1.5 transition-colors ${mode === 'docked-right' ? 'bg-white/30' : 'hover:bg-white/20'}`}>
            <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor">
              <rect x="10" y="1" width="5" height="14" rx="1" opacity="1"/>
              <rect x="1" y="1" width="8" height="14" rx="1" opacity="0.4"/>
            </svg>
          </button>
        </div>
        {/* History button */}
        <button onClick={view === 'history' ? () => setView('chat') : openHistory}
          className="p-1.5 rounded hover:bg-white/20 transition-colors"
          title={view === 'history' ? 'Back to chat' : 'Chat history'} aria-label="Chat history">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
          </svg>
        </button>
        {/* New Chat button */}
        <button onClick={startNewChat} disabled={streaming}
          className="p-1.5 rounded hover:bg-white/20 transition-colors disabled:opacity-40"
          title="New chat" aria-label="New chat">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 5v14M5 12h14"/>
          </svg>
        </button>
        {/* Close button — always visible */}
        <button
          onClick={docked ? () => onModeChange?.('float') : () => setOpen(false)}
          className="p-1.5 rounded hover:bg-white/20 transition-colors ml-0.5"
          title={docked ? 'Close panel' : 'Close'}
          aria-label={docked ? 'Close panel' : 'Close Pepper'}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <path d="M18 6L6 18M6 6l12 12"/>
          </svg>
        </button>
      </div>
      {/* Monthly token usage bar — shown only when a limit is configured */}
      {myUsage && myUsage.limit > 0 && (
        <div className="px-3 pb-2">
          <div className="flex items-center justify-between mb-1" style={{ opacity: 0.9 }}>
            <span className="text-xs" style={{ color: usageExceeded ? '#fca5a5' : 'rgba(255,255,255,0.8)' }}>
              {usageExceeded
                ? `⛔ Limit reached — resets ${new Date(myUsage.next_reset).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`
                : usageWarning
                ? `⚠ ${fmtTok(myUsage.period_tokens)} / ${fmtTok(myUsage.limit)} tokens this period`
                : `${fmtTok(myUsage.period_tokens)} / ${fmtTok(myUsage.limit)} tokens`
              }
            </span>
            <span className="text-xs" style={{ color: 'rgba(255,255,255,0.6)' }}>{usagePct}%</span>
          </div>
          <div className="h-1 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.2)' }}>
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${usagePct}%`,
                background: usageExceeded ? '#EF4444' : usageWarning ? '#F59E0B' : 'rgba(255,255,255,0.8)',
              }}
            />
          </div>
        </div>
      )}
    </div>
  )

  const panelBody = (
    <div className="flex-1 flex flex-col overflow-hidden">
      {view === 'history' ? (
        <HistoryPanel
          sessions={sessions} sessionsLoad={sessionsLoad}
          onBack={() => setView('chat')} onNewChat={startNewChat} onLoadSession={loadSession}
        />
      ) : (
        <ChatPanel
          messages={messages} streaming={streaming} toolLabel={toolLabel}
          attachedFile={attachedFile} attachedFilePreview={attachedFilePreview}
          input={input} inputRef={inputRef} fileInputRef={fileInputRef} bottomRef={bottomRef}
          onInputChange={setInput} onKeyDown={handleKey} onPaste={handlePaste}
          onSend={send} onFileChange={handleFileChange} onFilePickerClick={handleFilePickerClick}
          onRemoveFile={handleRemoveFile} onScreenshot={handleScreenshot} canSend={canSend}
        />
      )}
    </div>
  )

  // ── Render ────────────────────────────────────────────────────────────────

  // Docked mode — fills the slot provided by AppLayout
  if (docked) {
    return (
      <div className="pepper-ui h-full flex flex-col print:hidden"
        style={{ background: 'var(--surface)' }}>
        {panelHeader}
        {panelBody}
      </div>
    )
  }

  // Float mode — FAB + fixed popup
  return (
    <>
      <button onClick={() => setOpen(o => !o)}
        className="pepper-ui fixed bottom-6 right-6 z-50 w-12 h-12 rounded-full shadow-lg flex items-center justify-center transition-transform hover:scale-110 print:hidden overflow-hidden"
        style={{ background: 'var(--accent)', color: '#fff' }}
        title="Pepper" aria-label="Toggle AI chat">
        {open ? <span className="text-lg font-bold">✕</span> : <CogIcon size={30} color="#fff" />}
      </button>
      {open && (
        <div className="pepper-ui fixed bottom-20 right-6 z-50 flex flex-col rounded-xl shadow-2xl print:hidden"
          style={{ width: floatSize.w, height: floatSize.h, background: 'var(--surface)', border: '1px solid var(--border)' }}>
          {/* Resize handle — top-left corner (panel is bottom-right anchored) */}
          <div
            onMouseDown={startFloatResize}
            className="absolute top-0 left-0 z-10 rounded-tl-xl"
            style={{ width: 24, height: 24, cursor: 'nw-resize' }}
            title="Drag to resize"
          >
            {/* Grip dots */}
            <svg width="10" height="10" viewBox="0 0 10 10" className="absolute top-1.5 left-1.5 opacity-30">
              {[1,4,7].flatMap(x => [1,4,7].map(y => (
                <circle key={`${x}-${y}`} cx={x} cy={y} r="0.9" fill="var(--text-3)" />
              )))}
            </svg>
          </div>
          {panelHeader}
          {panelBody}
        </div>
      )}
    </>
  )
}
