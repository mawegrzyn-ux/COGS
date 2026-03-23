import { useState, useRef, useEffect, useCallback } from 'react'
import { useLocation } from 'react-router-dom'

const API_BASE = import.meta.env.VITE_API_URL || '/api'

interface Message {
  role: 'user' | 'assistant'
  content: string
  toolNames?: string[]
  fileName?: string
}

// Cog SVG icon — used in both the FAB button and the panel header
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

// Minimal markdown: **bold**, `code`, newlines → <br>
function renderMd(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`(.+?)`/g, '<code class="bg-[#e8f5ed] px-1 rounded text-xs font-mono">$1</code>')
    .replace(/\n/g, '<br>')
}

const ACCEPTED_TYPES = '.csv,.txt,.pdf,.xlsx,.xls,.docx,.pptx,image/png,image/jpeg,image/webp'

export default function AiChat() {
  const [open,         setOpen]         = useState(false)
  const [messages,     setMessages]     = useState<Message[]>([])
  const [input,        setInput]        = useState('')
  const [streaming,    setStreaming]    = useState(false)
  const [toolLabel,    setToolLabel]    = useState<string | null>(null)
  const [attachedFile, setAttachedFile] = useState<File | null>(null)
  const bottomRef  = useRef<HTMLDivElement>(null)
  const inputRef   = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const location   = useLocation()

  // Scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streaming])

  // Focus input when panel opens
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 150)
  }, [open])

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

    // Build history from current messages (last 10 turns)
    const history = messages.slice(-10).map(m => ({
      role:    m.role,
      content: m.content,
    }))

    const context = { currentPage: location.pathname }

    // Placeholder assistant message to stream into
    setMessages(prev => [...prev, { role: 'assistant', content: '' }])

    try {
      let res: Response

      if (hasFile && attachedFile) {
        // Multipart upload path
        const form = new FormData()
        if (text) form.append('message', text)
        form.append('file',    attachedFile)
        form.append('context', JSON.stringify(context))
        form.append('history', JSON.stringify(history))
        res = await fetch(`${API_BASE}/ai-upload`, { method: 'POST', body: form })
      } else {
        // Plain JSON path
        res = await fetch(`${API_BASE}/ai-chat`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ message: text, history, context }),
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
                msgs[msgs.length - 1] = {
                  ...msgs[msgs.length - 1],
                  content: msgs[msgs.length - 1].content + event.text,
                }
                return msgs
              })
            }
            if (event.type === 'tool') {
              setToolLabel(event.name)
              setMessages(prev => {
                const msgs = [...prev]
                const last = msgs[msgs.length - 1]
                msgs[msgs.length - 1] = {
                  ...last,
                  toolNames: [...(last.toolNames ?? []), event.name],
                }
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
            if (event.type === 'done') {
              setToolLabel(null)
            }
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
  }, [input, attachedFile, streaming, messages, location.pathname])

  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] ?? null
    setAttachedFile(f)
    // Reset so the same file can be re-selected
    e.target.value = ''
  }

  const canSend = !streaming && (input.trim().length > 0 || attachedFile !== null)

  return (
    <>
      {/* Toggle button */}
      <button
        onClick={() => setOpen(o => !o)}
        className="fixed bottom-6 right-6 z-50 w-12 h-12 rounded-full shadow-lg flex items-center justify-center transition-transform hover:scale-110 print:hidden overflow-hidden"
        style={{ background: 'var(--accent)', color: '#fff' }}
        title="McFry"
        aria-label="Toggle AI chat"
      >
        {open
          ? <span className="text-lg font-bold">✕</span>
          : <CogIcon size={30} color="#fff" />
        }
      </button>

      {/* Panel */}
      {open && (
        <div
          className="fixed bottom-20 right-6 z-50 flex flex-col rounded-xl shadow-2xl print:hidden"
          style={{
            width:      '390px',
            height:     '580px',
            background: 'var(--surface)',
            border:     '1px solid var(--border)',
          }}
        >
          {/* Header */}
          <div
            className="flex items-center justify-between px-4 py-3 rounded-t-xl flex-shrink-0"
            style={{ background: 'var(--accent)', color: '#fff' }}
          >
            <div className="flex items-center gap-2.5">
              <CogIcon size={28} color="#fff" />
              <div>
                <div className="font-semibold text-sm leading-tight">McFry</div>
                <div className="text-xs opacity-75">Powered by Claude</div>
              </div>
            </div>
            <button
              onClick={() => { setMessages([]); setInput(''); setAttachedFile(null) }}
              className="text-xs opacity-75 hover:opacity-100 transition-opacity"
              title="Clear conversation"
            >
              Clear
            </button>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
            {messages.length === 0 && (
              <div className="text-center py-8" style={{ color: 'var(--text-3)' }}>
                <div className="flex justify-center mb-3">
                  <div className="w-12 h-12 rounded-full flex items-center justify-center" style={{ background: 'var(--accent-dim)' }}>
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
                <div
                  className="max-w-[85%] rounded-lg px-3 py-2 text-sm"
                  style={
                    msg.role === 'user'
                      ? { background: 'var(--accent)', color: '#fff' }
                      : { background: 'var(--surface-2)', color: 'var(--text-1)', border: '1px solid var(--border)' }
                  }
                >
                  {/* File attachment badge on user messages */}
                  {msg.fileName && (
                    <div className="flex items-center gap-1 mb-1.5 text-xs opacity-80">
                      <span>📎</span>
                      <span className="truncate max-w-[180px]">{msg.fileName}</span>
                    </div>
                  )}
                  {/* Tool chips on assistant messages */}
                  {msg.role === 'assistant' && msg.toolNames?.length ? (
                    <div className="flex flex-wrap gap-1 mb-1">
                      {msg.toolNames.map((t, j) => (
                        <span
                          key={j}
                          className="text-xs px-1.5 py-0.5 rounded"
                          style={{ background: 'var(--accent-dim)', color: 'var(--accent-dark)' }}
                        >
                          ⚙ {t}
                        </span>
                      ))}
                    </div>
                  ) : null}
                  {msg.content ? (
                    <span dangerouslySetInnerHTML={{ __html: renderMd(msg.content) }} />
                  ) : (
                    streaming && i === messages.length - 1 ? (
                      <span className="opacity-60 text-xs">
                        {toolLabel ? `Running ${toolLabel}…` : '…'}
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
            <div
              className="flex-shrink-0 mx-3 mb-1 px-3 py-1.5 rounded-lg flex items-center gap-2 text-xs"
              style={{ background: 'var(--accent-dim)', color: 'var(--accent-dark)' }}
            >
              <span>📎</span>
              <span className="flex-1 truncate">{attachedFile.name}</span>
              <button
                onClick={() => setAttachedFile(null)}
                className="shrink-0 opacity-60 hover:opacity-100 transition-opacity font-bold"
                title="Remove file"
              >
                ✕
              </button>
            </div>
          )}

          {/* Input */}
          <div
            className="flex-shrink-0 px-3 py-3 border-t"
            style={{ borderColor: 'var(--border)' }}
          >
            <div
              className="flex items-end gap-2 rounded-lg px-3 py-2"
              style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}
            >
              {/* Hidden file input */}
              <input
                ref={fileInputRef}
                type="file"
                accept={ACCEPTED_TYPES}
                className="hidden"
                onChange={handleFileChange}
              />

              {/* Paperclip button */}
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={streaming}
                className="flex-shrink-0 w-7 h-7 flex items-center justify-center rounded transition-opacity disabled:opacity-40 hover:opacity-70"
                style={{ color: 'var(--text-3)' }}
                title="Attach CSV or image"
                aria-label="Attach file"
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48"/>
                </svg>
              </button>

              <textarea
                ref={inputRef}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKey}
                placeholder={attachedFile ? 'Add a message… (optional)' : 'Ask anything… (Enter to send)'}
                disabled={streaming}
                rows={1}
                className="flex-1 resize-none bg-transparent text-sm outline-none leading-relaxed"
                style={{
                  color:     'var(--text-1)',
                  maxHeight: '120px',
                  overflowY: 'auto',
                }}
              />

              {/* Send button */}
              <button
                onClick={send}
                disabled={!canSend}
                className="flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center transition-opacity disabled:opacity-40"
                style={{ background: 'var(--accent)', color: '#fff' }}
                aria-label="Send"
              >
                {streaming ? (
                  <span className="text-xs animate-pulse">…</span>
                ) : (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M2 21l21-9L2 3v7l15 2-15 2z" />
                  </svg>
                )}
              </button>
            </div>
            <p className="text-center mt-1.5 text-xs" style={{ color: 'var(--text-3)' }}>
              Shift+Enter for new line · 📎 CSV, Excel, Word, PPTX, PDF or image · 10 MB max
            </p>
          </div>
        </div>
      )}
    </>
  )
}
