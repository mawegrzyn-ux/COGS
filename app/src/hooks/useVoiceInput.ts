import { useCallback, useEffect, useRef, useState } from 'react'

// Browser SpeechRecognition (Chromium/Edge/Samsung Internet) — accuracy is
// acceptable in a quiet room, poor in a kitchen. For Safari/iOS we fall
// back to a MediaRecorder that POSTs to /api/ai-transcribe (Whisper proxy).
//
// Usage:
//   const voice = useVoiceInput({ lang: 'en-GB', onTranscript, onError, apiBase, authHeader })
//   <button onMouseDown={voice.start} onMouseUp={voice.stop}>🎙️</button>

type SpeechRecognitionCtor = new () => any

interface UseVoiceInputOpts {
  lang?:        string
  onTranscript: (text: string) => void
  onError?:     (err: string) => void
  apiBase?:     string
  /** Returns the Authorization header for the Whisper fallback fetch. */
  authHeader?:  () => Promise<Record<string, string>>
}

export interface VoiceInputApi {
  /** True while actively listening. */
  recording:   boolean
  /** Which backend is in use for the current session. */
  backend:     'browser' | 'whisper' | null
  /** `true` if *some* voice backend is usable on this device. */
  available:   boolean
  /** Begin capture — call on pointer-down / tap. */
  start: () => void
  /** End capture — call on pointer-up / release. For browser speech this
   *  commits the final transcript; for Whisper it stops recording and posts
   *  the audio. */
  stop:  () => void
  /** Human-readable explanation for why voice is unavailable, if it is. */
  unavailableReason: string | null
}

export function useVoiceInput(opts: UseVoiceInputOpts): VoiceInputApi {
  const { lang = 'en-GB', onTranscript, onError, apiBase, authHeader } = opts

  const [recording, setRecording] = useState(false)
  const [backend,   setBackend]   = useState<'browser' | 'whisper' | null>(null)

  const recognitionRef = useRef<any | null>(null)
  const mediaRef       = useRef<MediaRecorder | null>(null)
  const chunksRef      = useRef<Blob[]>([])

  // Feature detection — what's available on this device.
  const hasSpeechRecognition = typeof window !== 'undefined' &&
    !!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition)
  const hasMediaRecorder = typeof window !== 'undefined' &&
    !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== 'undefined'

  const available = hasSpeechRecognition || hasMediaRecorder
  const unavailableReason = available ? null
    : 'Voice capture isn\u2019t supported in this browser. Try Chrome, Edge, or install the PWA.'

  // ── Browser SpeechRecognition path ──────────────────────────────────────────
  const startBrowser = useCallback(() => {
    const Ctor: SpeechRecognitionCtor =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    const rec = new Ctor()
    rec.lang           = lang
    rec.interimResults = true
    rec.continuous     = true

    let finalText = ''
    rec.onresult = (e: any) => {
      let interim = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const chunk = e.results[i][0].transcript
        if (e.results[i].isFinal) finalText += chunk
        else interim += chunk
      }
      onTranscript((finalText + interim).trim())
    }
    rec.onerror = (e: any) => {
      onError?.(e?.error || 'speech-recognition-error')
      setRecording(false)
    }
    rec.onend = () => {
      setRecording(false)
      recognitionRef.current = null
    }
    try {
      rec.start()
      recognitionRef.current = rec
      setBackend('browser')
      setRecording(true)
    } catch (err: any) {
      onError?.(err?.message || 'speech-recognition-start-failed')
    }
  }, [lang, onTranscript, onError])

  const stopBrowser = useCallback(() => {
    try { recognitionRef.current?.stop() } catch { /* ignore */ }
  }, [])

  // ── Whisper (MediaRecorder) path ─────────────────────────────────────────────
  const startWhisper = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      // webm/opus is widely supported and small on the wire.
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : (MediaRecorder.isTypeSupported('audio/mp4') ? 'audio/mp4' : '')
      const rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
      chunksRef.current = []
      rec.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data) }
      rec.onstop = async () => {
        stream.getTracks().forEach(t => t.stop())
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || 'audio/webm' })
        chunksRef.current = []
        if (blob.size === 0) { setRecording(false); return }
        try {
          const form = new FormData()
          form.append('audio', blob, 'voice.webm')
          form.append('language', lang.split('-')[0] || 'en')
          const headers = authHeader ? await authHeader() : {}
          const res = await fetch(`${apiBase || '/api'}/ai-transcribe`, {
            method: 'POST', body: form, headers,
          })
          if (!res.ok) {
            const err = await res.json().catch(() => ({}))
            onError?.(err?.error?.message || `Whisper HTTP ${res.status}`)
            return
          }
          const data = await res.json()
          if (data?.text) onTranscript(String(data.text).trim())
        } catch (err: any) {
          onError?.(err?.message || 'whisper-upload-failed')
        } finally {
          setRecording(false)
        }
      }
      rec.start()
      mediaRef.current = rec
      setBackend('whisper')
      setRecording(true)
    } catch (err: any) {
      onError?.(err?.message || 'microphone-permission-denied')
    }
  }, [lang, onTranscript, onError, apiBase, authHeader])

  const stopWhisper = useCallback(() => {
    try { mediaRef.current?.stop() } catch { /* ignore */ }
  }, [])

  // ── Public API ───────────────────────────────────────────────────────────────
  const start = useCallback(() => {
    if (recording) return
    if (hasSpeechRecognition) startBrowser()
    else if (hasMediaRecorder) startWhisper()
    else onError?.('no-voice-backend')
  }, [recording, hasSpeechRecognition, hasMediaRecorder, startBrowser, startWhisper, onError])

  const stop = useCallback(() => {
    if (!recording) return
    if (backend === 'browser') stopBrowser()
    else if (backend === 'whisper') stopWhisper()
  }, [recording, backend, stopBrowser, stopWhisper])

  // Cleanup on unmount
  useEffect(() => () => {
    try { recognitionRef.current?.abort?.() } catch { /* ignore */ }
    try { mediaRef.current?.stop?.() } catch { /* ignore */ }
  }, [])

  return { recording, backend, available, start, stop, unavailableReason }
}
