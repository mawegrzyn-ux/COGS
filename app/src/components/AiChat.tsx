import { useState, useRef, useEffect, useCallback, RefObject } from 'react'
import { useLocation } from 'react-router-dom'
import { useAuth0 } from '@auth0/auth0-react'

const API_BASE = import.meta.env.VITE_API_URL || '/api'

// ── Types ─────────────────────────────────────────────────────────────────────

interface Message {
  role: 'user' | 'assistant'
  content: string
  toolNames?: string[]
  fileName?: string
}

interface ChatSession {
  session_id: string
  started_at: string
  last_active_at: string
  turns: number
  first_message: string
  last_message: string
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

// ── Minimal markdown renderer ──────────────────────────────────────────────────

function renderMd(text: string): string {
  return text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`(.+?)`/g, '<code class="bg-[#e8f5ed] px-1 rounded text-xs font-mono">$1</code>')
    .replace(/\n/g, '<br>')
}

const ACCEPTED_TYPES = '.csv,.txt,.pdf,.xlsx,.xls,.docx,.pptx,image/png,image/jpeg,image/webp'

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
  canSend: boolean
}

function ChatPanel({
  messages, streaming, toolLabel, attachedFile, attachedFilePreview, input,
  inputRef, fileInputRef, bottomRef,
  onInputChange, onKeyDown, onPaste, onSend, onFileChange, onFilePickerClick, onRemoveFile,
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
            <p className="text-sm font-semibold mb-1" style={{ color: 'var(--accent)' }}>Hi, I'm McFry!</p>
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
                          animation: `mcfry-dot 1.2s ease-in-out ${j * 0.2}s infinite`,
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
          <button onClick={onFilePickerClick} disabled={streaming}
            className="flex-shrink-0 w-7 h-7 flex items-center justify-center rounded transition-opacity disabled:opacity-40 hover:opacity-70"
            style={{ color: 'var(--text-3)' }} title="Attach file" aria-label="Attach file">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48"/>
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
                      style={{ width: 4, height: 4, animation: `mcfry-dot 1.2s ease-in-out ${j * 0.2}s infinite` }} />
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

export default function AiChat() {
  const { user }   = useAuth0()
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
      const res    = await fetch(`${API_BASE}/ai-chat/sessions?${params}`)
      if (res.ok) setSessions(await res.json())
    } catch { /* non-critical */ }
    finally  { setSessionsLoad(false) }
  }, [user?.sub])

  const loadSession = useCallback(async (sid: string) => {
    if (!user?.sub) return
    try {
      const params = new URLSearchParams({ user_sub: user.sub })
      const res    = await fetch(`${API_BASE}/ai-chat/sessions/${encodeURIComponent(sid)}?${params}`)
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

  const send = useCallback(async () => {
    const text    = input.trim()
    const hasFile = attachedFile !== null
    if ((!text && !hasFile) || streaming) return

    const fileName = attachedFile?.name
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

      if (hasFile && attachedFile) {
        const form = new FormData()
        if (text)          form.append('message',    text)
        form.append('file',      attachedFile)
        form.append('context',   JSON.stringify(context))
        form.append('history',   JSON.stringify(history))
        form.append('sessionId', sessionId)
        if (user?.email)   form.append('userEmail',  user.email)
        if (user?.sub)     form.append('userSub',    user.sub)
        res = await fetch(`${API_BASE}/ai-upload`, { method: 'POST', body: form })
      } else {
        res = await fetch(`${API_BASE}/ai-chat`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
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

  const canSend = !streaming && (input.trim().length > 0 || attachedFile !== null)

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <>
      {/* FAB toggle */}
      <button
        onClick={() => setOpen(o => !o)}
        className="fixed bottom-6 right-6 z-50 w-12 h-12 rounded-full shadow-lg flex items-center justify-center transition-transform hover:scale-110 print:hidden overflow-hidden"
        style={{ background: 'var(--accent)', color: '#fff' }}
        title="McFry" aria-label="Toggle AI chat">
        {open
          ? <span className="text-lg font-bold">✕</span>
          : <CogIcon size={30} color="#fff" />
        }
      </button>

      {/* Panel */}
      {open && (
        <div className="fixed bottom-20 right-6 z-50 flex flex-col rounded-xl shadow-2xl print:hidden"
          style={{ width: '390px', height: '600px', background: 'var(--surface)', border: '1px solid var(--border)' }}>

          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 rounded-t-xl flex-shrink-0"
            style={{ background: 'var(--accent)', color: '#fff' }}>
            <div className="flex items-center gap-2.5">
              <CogIcon size={26} color="#fff" />
              <div>
                <div className="font-semibold text-sm leading-tight">McFry</div>
                <div className="text-xs opacity-75">Powered by Claude</div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {/* History button */}
              <button
                onClick={view === 'history' ? () => setView('chat') : openHistory}
                className="p-1.5 rounded hover:bg-white/20 transition-colors"
                title={view === 'history' ? 'Back to chat' : 'Chat history'}
                aria-label="Chat history">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10"/>
                  <polyline points="12 6 12 12 16 14"/>
                </svg>
              </button>
              {/* New Chat button */}
              <button
                onClick={startNewChat}
                disabled={streaming}
                className="p-1.5 rounded hover:bg-white/20 transition-colors disabled:opacity-40"
                title="New chat" aria-label="New chat">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 5v14M5 12h14"/>
                </svg>
              </button>
            </div>
          </div>

          {/* Body — either chat or history */}
          <div className="flex-1 flex flex-col overflow-hidden">
            {view === 'history' ? (
              <HistoryPanel
                sessions={sessions}
                sessionsLoad={sessionsLoad}
                onBack={() => setView('chat')}
                onNewChat={startNewChat}
                onLoadSession={loadSession}
              />
            ) : (
              <ChatPanel
                messages={messages}
                streaming={streaming}
                toolLabel={toolLabel}
                attachedFile={attachedFile}
                attachedFilePreview={attachedFilePreview}
                input={input}
                inputRef={inputRef}
                fileInputRef={fileInputRef}
                bottomRef={bottomRef}
                onInputChange={setInput}
                onKeyDown={handleKey}
                onPaste={handlePaste}
                onSend={send}
                onFileChange={handleFileChange}
                onFilePickerClick={handleFilePickerClick}
                onRemoveFile={handleRemoveFile}
                canSend={canSend}
              />
            )}
          </div>
        </div>
      )}
    </>
  )
}
