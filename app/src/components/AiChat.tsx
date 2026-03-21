import { useState, useRef, useEffect, useCallback } from 'react'
import { useLocation } from 'react-router-dom'

const API_BASE = import.meta.env.VITE_API_URL || '/api'

interface Message {
  role: 'user' | 'assistant'
  content: string
  toolNames?: string[]
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

export default function AiChat() {
  const [open,      setOpen]      = useState(false)
  const [messages,  setMessages]  = useState<Message[]>([])
  const [input,     setInput]     = useState('')
  const [streaming, setStreaming] = useState(false)
  const [toolLabel, setToolLabel] = useState<string | null>(null)
  const bottomRef  = useRef<HTMLDivElement>(null)
  const inputRef   = useRef<HTMLTextAreaElement>(null)
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
    const text = input.trim()
    if (!text || streaming) return

    const userMsg: Message = { role: 'user', content: text }
    setMessages(prev => [...prev, userMsg])
    setInput('')
    setStreaming(true)
    setToolLabel(null)

    // Build history from current messages (last 10 turns)
    const history = messages.slice(-10).map(m => ({
      role: m.role,
      content: m.content,
    }))

    const context = { currentPage: location.pathname }

    // Placeholder assistant message we'll stream into
    setMessages(prev => [...prev, { role: 'assistant', content: '' }])

    try {
      const res = await fetch(`${API_BASE}/ai-chat`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ message: text, history, context }),
      })

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
  }, [input, streaming, messages, location.pathname])

  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }

  return (
    <>
      {/* Toggle button */}
      <button
        onClick={() => setOpen(o => !o)}
        className="fixed bottom-6 right-6 z-50 w-12 h-12 rounded-full shadow-lg flex items-center justify-center text-xl transition-transform hover:scale-110 print:hidden"
        style={{ background: 'var(--accent)', color: '#fff' }}
        title="COGS Assistant"
        aria-label="Toggle AI chat"
      >
        {open ? '✕' : '🤖'}
      </button>

      {/* Panel */}
      {open && (
        <div
          className="fixed bottom-20 right-6 z-50 flex flex-col rounded-xl shadow-2xl print:hidden"
          style={{
            width:      '380px',
            height:     '560px',
            background: 'var(--surface)',
            border:     '1px solid var(--border)',
          }}
        >
          {/* Header */}
          <div
            className="flex items-center justify-between px-4 py-3 rounded-t-xl flex-shrink-0"
            style={{ background: 'var(--accent)', color: '#fff' }}
          >
            <div className="flex items-center gap-2">
              <span className="text-lg">🤖</span>
              <div>
                <div className="font-semibold text-sm leading-tight">COGS Assistant</div>
                <div className="text-xs opacity-75">Powered by Claude</div>
              </div>
            </div>
            <button
              onClick={() => { setMessages([]); setInput('') }}
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
                <div className="text-3xl mb-2">🤖</div>
                <p className="text-sm">Ask me about your ingredients, recipes, COGS, or how to use the platform.</p>
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

          {/* Input */}
          <div
            className="flex-shrink-0 px-3 py-3 border-t"
            style={{ borderColor: 'var(--border)' }}
          >
            <div
              className="flex items-end gap-2 rounded-lg px-3 py-2"
              style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}
            >
              <textarea
                ref={inputRef}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKey}
                placeholder="Ask anything… (Enter to send)"
                disabled={streaming}
                rows={1}
                className="flex-1 resize-none bg-transparent text-sm outline-none leading-relaxed"
                style={{
                  color:       'var(--text-1)',
                  maxHeight:   '120px',
                  overflowY:   'auto',
                }}
              />
              <button
                onClick={send}
                disabled={streaming || !input.trim()}
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
              Shift+Enter for new line
            </p>
          </div>
        </div>
      )}
    </>
  )
}
