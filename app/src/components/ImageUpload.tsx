import { useState, useRef } from 'react'
import { useAuth0 } from '@auth0/auth0-react'

const API_BASE  = import.meta.env.VITE_API_URL || '/api'
const MAX_BYTES = 5 * 1024 * 1024 // 5 MB

interface Props {
  value:    string | null
  onChange: (url: string | null) => void
  label?:   string
}

export default function ImageUpload({ value, onChange, label }: Props) {
  const { getAccessTokenSilently } = useAuth0()
  const [uploading, setUploading] = useState(false)
  const [error,     setError]     = useState<string | null>(null)
  const ref = useRef<HTMLInputElement>(null)

  async function handleFile(file: File) {
    if (file.size > MAX_BYTES) { setError('Image must be under 5 MB'); return }
    setError(null)
    setUploading(true)
    try {
      const token = await getAccessTokenSilently()
      const fd = new FormData()
      fd.append('image', file)
      const res = await fetch(`${API_BASE}/upload`, {
        method:  'POST',
        headers: { Authorization: `Bearer ${token}` },
        body:    fd,
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body?.error?.message || `Upload failed (${res.status})`)
      }
      const { url } = await res.json()
      onChange(url)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  return (
    <div>
      {label && <label className="block text-sm font-medium text-text-2 mb-1.5">{label}</label>}
      <div className="flex items-start gap-3">

        {/* Thumbnail / placeholder */}
        <div
          className="w-20 h-20 rounded-lg border border-border bg-surface-2 flex items-center justify-center overflow-hidden shrink-0 cursor-pointer hover:border-accent transition-colors"
          onClick={() => !uploading && ref.current?.click()}
          title="Click to upload image"
        >
          {value ? (
            <img src={value} alt="" className="w-full h-full object-cover" />
          ) : (
            <svg className="w-8 h-8 text-text-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5zm10.5-11.25h.008v.008h-.008V8.25zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
            </svg>
          )}
        </div>

        {/* Controls */}
        <div className="flex flex-col gap-1.5 pt-1">
          <button
            type="button"
            onClick={() => ref.current?.click()}
            disabled={uploading}
            className="btn-outline text-sm py-1.5 px-3"
          >
            {uploading ? (
              <span className="flex items-center gap-1.5">
                <svg className="animate-spin w-3.5 h-3.5" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Uploading…
              </span>
            ) : value ? 'Change Image' : 'Upload Image'}
          </button>

          {value && (
            <button
              type="button"
              onClick={() => { onChange(null); setError(null) }}
              className="text-sm text-red-500 hover:text-red-700 hover:underline text-left"
            >
              Remove
            </button>
          )}

          <p className="text-xs text-text-3">JPEG, PNG, WebP, GIF · max 5 MB</p>
          {error && <p className="text-xs text-red-500">{error}</p>}
        </div>
      </div>

      <input
        ref={ref}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        className="hidden"
        onChange={e => {
          if (e.target.files?.[0]) handleFile(e.target.files[0])
          e.target.value = '' // allow re-selecting same file
        }}
      />
    </div>
  )
}
