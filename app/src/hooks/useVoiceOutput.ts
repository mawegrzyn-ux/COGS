import { useCallback, useEffect, useRef, useState } from 'react'

// Sentence-buffered speechSynthesis. Callers feed streaming text via `feed()`
// as tokens arrive; the hook splits on sentence boundaries and queues each
// sentence to the OS TTS engine. Skip empty or non-printable content.
//
// Usage in AiChat:
//   const tts = useVoiceOutput({ lang: 'en-GB' })
//   // per streaming chunk from SSE:
//   tts.feed(newText)
//   // on streaming done:
//   tts.flush()
//   // header button:
//   <button onClick={tts.toggle}>{tts.enabled ? '🔊' : '🔇'}</button>

const STORAGE_KEY = 'pepper-tts-enabled'

function loadEnabled(): boolean {
  try { return localStorage.getItem(STORAGE_KEY) === '1' } catch { return false }
}

interface UseVoiceOutputOpts {
  lang?: string
}

export interface VoiceOutputApi {
  /** User's current toggle state — persisted to localStorage. */
  enabled:  boolean
  /** True while something is actively being spoken. */
  speaking: boolean
  /** Indicates whether the browser supports speechSynthesis at all. */
  available: boolean
  /** Toggle on/off (also cancels in-flight speech). */
  toggle:   () => void
  /** Feed additional streaming text; sentences get queued, partial sentence
   *  is held back until the next feed / flush. */
  feed:     (chunk: string) => void
  /** Flush any pending buffer as a final fragment — call on stream end. */
  flush:    () => void
  /** Stop all current + queued speech. */
  cancel:   () => void
}

// Strip markdown-ish noise before speaking — readers don't want to hear
// asterisks, backticks, hashes, or table pipes pronounced.
function cleanForSpeech(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' ')   // fenced code blocks
    .replace(/`([^`]+)`/g, '$1')       // inline code
    .replace(/[*_#>|]/g, ' ')          // markdown noise
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // links → label only
    .replace(/\s+/g, ' ')
    .trim()
}

export function useVoiceOutput(opts: UseVoiceOutputOpts = {}): VoiceOutputApi {
  const lang = opts.lang || 'en-GB'
  const [enabled,  setEnabled]  = useState<boolean>(loadEnabled)
  const [speaking, setSpeaking] = useState(false)
  const bufferRef = useRef('')   // unspoken tail that hasn't hit a sentence boundary yet

  const available = typeof window !== 'undefined' && 'speechSynthesis' in window

  // Persist toggle
  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, enabled ? '1' : '0') } catch { /* ignore */ }
  }, [enabled])

  // When disabled, cancel anything in flight.
  useEffect(() => {
    if (!enabled && available) window.speechSynthesis.cancel()
  }, [enabled, available])

  const speak = useCallback((text: string) => {
    if (!available || !enabled) return
    const cleaned = cleanForSpeech(text)
    if (!cleaned) return
    const u = new SpeechSynthesisUtterance(cleaned)
    u.lang = lang
    u.rate = 1.05
    u.onstart = () => setSpeaking(true)
    u.onend   = () => setSpeaking(false)
    u.onerror = () => setSpeaking(false)
    window.speechSynthesis.speak(u)
  }, [available, enabled, lang])

  const feed = useCallback((chunk: string) => {
    if (!enabled || !available) return
    bufferRef.current += chunk
    // Split on sentence boundaries: . ? ! followed by whitespace or end.
    // Keep the partial trailing fragment in the buffer for next feed.
    const re = /(.+?[.!?])(?=\s|$)/g
    let match: RegExpExecArray | null
    let consumed = 0
    while ((match = re.exec(bufferRef.current)) !== null) {
      speak(match[1])
      consumed = match.index + match[0].length
    }
    if (consumed > 0) bufferRef.current = bufferRef.current.slice(consumed)
  }, [enabled, available, speak])

  const flush = useCallback(() => {
    const tail = bufferRef.current.trim()
    bufferRef.current = ''
    if (tail) speak(tail)
  }, [speak])

  const cancel = useCallback(() => {
    bufferRef.current = ''
    if (available) window.speechSynthesis.cancel()
    setSpeaking(false)
  }, [available])

  const toggle = useCallback(() => {
    setEnabled(prev => {
      if (prev && available) window.speechSynthesis.cancel()
      return !prev
    })
  }, [available])

  // Kill in-flight on unmount
  useEffect(() => () => {
    if (available) window.speechSynthesis.cancel()
  }, [available])

  return { enabled, speaking, available, toggle, feed, flush, cancel }
}
