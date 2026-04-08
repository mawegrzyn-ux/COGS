import { useState, useEffect, useRef, useCallback } from 'react'

interface ImageEditorProps {
  open:    boolean
  src:     string
  onClose: () => void
  onSave:  (blob: Blob, mimeType: string) => void
}

interface CropRect { x: number; y: number; w: number; h: number }

export default function ImageEditor({ open, src, onClose, onSave }: ImageEditorProps) {
  const canvasRef   = useRef<HTMLCanvasElement>(null)
  const imgRef      = useRef<HTMLImageElement | null>(null)
  const dragging    = useRef(false)
  const dragStart   = useRef<{ x: number; y: number } | null>(null)

  const [rotation, setRotation] = useState(0)
  const [flipH,    setFlipH]    = useState(false)
  const [flipV,    setFlipV]    = useState(false)
  const [cropMode, setCropMode] = useState(false)
  const [cropRect, setCropRect] = useState<CropRect | null>(null)
  const [imgLoaded, setImgLoaded] = useState(false)

  // ── Load image once ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!open || !src) return
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      imgRef.current = img
      setImgLoaded(true)
    }
    img.src = src
    return () => { imgRef.current = null; setImgLoaded(false) }
  }, [open, src])

  // ── Reset state when modal opens ────────────────────────────────────────────
  useEffect(() => {
    if (open) {
      setRotation(0); setFlipH(false); setFlipV(false)
      setCropMode(false); setCropRect(null); setImgLoaded(false)
    }
  }, [open])

  // ── Draw ────────────────────────────────────────────────────────────────────
  const draw = useCallback(() => {
    const canvas = canvasRef.current
    const img    = imgRef.current
    if (!canvas || !img || !imgLoaded) return

    const rot90 = rotation === 90 || rotation === 270
    const iw    = rot90 ? img.naturalHeight : img.naturalWidth
    const ih    = rot90 ? img.naturalWidth  : img.naturalHeight

    // Scale to fit 600×600 display area
    const scale = Math.min(600 / iw, 600 / ih, 1)
    const dw    = Math.round(iw * scale)
    const dh    = Math.round(ih * scale)

    canvas.width  = dw
    canvas.height = dh

    const ctx = canvas.getContext('2d')!
    ctx.clearRect(0, 0, dw, dh)

    ctx.save()
    ctx.translate(dw / 2, dh / 2)
    ctx.rotate((rotation * Math.PI) / 180)
    ctx.scale(flipH ? -1 : 1, flipV ? -1 : 1)

    const sw = rot90 ? img.naturalHeight * scale : img.naturalWidth  * scale
    const sh = rot90 ? img.naturalWidth  * scale : img.naturalHeight * scale
    ctx.drawImage(img, -sw / 2, -sh / 2, sw, sh)
    ctx.restore()

    // Crop overlay
    if (cropMode && cropRect && (cropRect.w !== 0 || cropRect.h !== 0)) {
      const { x, y, w, h } = normalisedRect(cropRect)
      // dim everything outside crop
      ctx.fillStyle = 'rgba(0,0,0,0.45)'
      ctx.fillRect(0, 0, dw, dh)
      ctx.clearRect(x, y, w, h)
      // redraw cropped region on top
      ctx.save()
      ctx.beginPath()
      ctx.rect(x, y, w, h)
      ctx.clip()
      ctx.translate(dw / 2, dh / 2)
      ctx.rotate((rotation * Math.PI) / 180)
      ctx.scale(flipH ? -1 : 1, flipV ? -1 : 1)
      ctx.drawImage(img, -sw / 2, -sh / 2, sw, sh)
      ctx.restore()
      // dashed border
      ctx.strokeStyle = '#fff'
      ctx.lineWidth   = 1.5
      ctx.setLineDash([5, 3])
      ctx.strokeRect(x, y, w, h)
      ctx.setLineDash([])
    }
  }, [rotation, flipH, flipV, cropMode, cropRect, imgLoaded])

  useEffect(() => { draw() }, [draw])

  // ── Helpers ─────────────────────────────────────────────────────────────────
  function normalisedRect(r: CropRect): CropRect {
    return {
      x: r.w < 0 ? r.x + r.w : r.x,
      y: r.h < 0 ? r.y + r.h : r.y,
      w: Math.abs(r.w),
      h: Math.abs(r.h),
    }
  }

  function canvasCoords(e: React.MouseEvent<HTMLCanvasElement>): { x: number; y: number } {
    const rect = canvasRef.current!.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  // ── Crop mouse events ────────────────────────────────────────────────────────
  function onMouseDown(e: React.MouseEvent<HTMLCanvasElement>) {
    if (!cropMode) return
    dragging.current = true
    const pt = canvasCoords(e)
    dragStart.current = pt
    setCropRect({ x: pt.x, y: pt.y, w: 0, h: 0 })
  }

  function onMouseMove(e: React.MouseEvent<HTMLCanvasElement>) {
    if (!cropMode || !dragging.current || !dragStart.current) return
    const pt = canvasCoords(e)
    setCropRect({
      x: dragStart.current.x,
      y: dragStart.current.y,
      w: pt.x - dragStart.current.x,
      h: pt.y - dragStart.current.y,
    })
  }

  function onMouseUp() {
    dragging.current = false
  }

  // ── Apply crop (collapses the crop into new display state by adjusting draw) ─
  function applyCrop() {
    if (!cropRect) return
    // We store the crop rect as canvas-space coords; when saving we'll project them.
    setCropMode(false)
    // Keep cropRect for save, but exit crop mode UI
  }

  // ── Save ─────────────────────────────────────────────────────────────────────
  function handleSave() {
    const img = imgRef.current
    if (!img) return

    const rot90  = rotation === 90 || rotation === 270
    const origW  = img.naturalWidth
    const origH  = img.naturalHeight
    const dispW  = rot90 ? origH : origW
    const dispH  = rot90 ? origW : origH
    const scale  = Math.min(600 / dispW, 600 / dispH, 1)
    const canvW  = Math.round(dispW * scale)
    const canvH  = Math.round(dispH * scale)

    // Determine output dimensions
    let outW = canvW
    let outH = canvH
    let cropX = 0, cropY = 0

    if (cropRect) {
      const nr = normalisedRect(cropRect)
      cropX = nr.x; cropY = nr.y
      outW  = Math.max(1, Math.round(nr.w))
      outH  = Math.max(1, Math.round(nr.h))
    }

    const off  = document.createElement('canvas')
    off.width  = outW
    off.height = outH
    const ctx  = off.getContext('2d')!

    ctx.translate(outW / 2 - cropX, outH / 2 - cropY)
    ctx.rotate((rotation * Math.PI) / 180)
    ctx.scale(flipH ? -1 : 1, flipV ? -1 : 1)

    const sw = rot90 ? origH * scale : origW * scale
    const sh = rot90 ? origW * scale : origH * scale
    ctx.drawImage(img, -sw / 2, -sh / 2, sw, sh)

    off.toBlob(blob => {
      if (blob) onSave(blob, 'image/jpeg')
    }, 'image/jpeg', 0.92)
  }

  // ── Toolbar actions ─────────────────────────────────────────────────────────
  function rotateLeft()  { setRotation(r => (r - 90 + 360) % 360) }
  function rotateRight() { setRotation(r => (r + 90) % 360) }
  function reset()       { setRotation(0); setFlipH(false); setFlipV(false); setCropRect(null); setCropMode(false) }

  const btnBase  = 'flex flex-col items-center gap-0.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors'
  const btnNorm  = `${btnBase} text-white/80 hover:bg-white/10`
  const btnActive = `${btnBase} text-white bg-white/20`

  const hasCrop = cropRect && (Math.abs(cropRect.w) > 4 || Math.abs(cropRect.h) > 4)

  if (!open) return null

  return (
    <div className="fixed inset-0 bg-black/80 z-[60] flex items-center justify-center">
      <div
        className="flex flex-col rounded-2xl overflow-hidden shadow-2xl"
        style={{ background: '#1a1a1a', maxWidth: '660px', width: '100%', maxHeight: '90vh' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: '1px solid #333' }}>
          <span className="font-semibold text-white text-sm">Edit Image</span>
          <button onClick={onClose} className="text-white/60 hover:text-white text-lg leading-none">✕</button>
        </div>

        {/* Toolbar */}
        <div className="flex items-center gap-1 px-3 py-2 flex-wrap" style={{ borderBottom: '1px solid #333' }}>
          <button onClick={rotateLeft}  className={btnNorm} title="Rotate Left">
            <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
              <path fillRule="evenodd" d="M7.793 2.232a.75.75 0 01-.025 1.06L6.107 5h2.518a7.25 7.25 0 110 14.5.75.75 0 010-1.5 5.75 5.75 0 100-11.5H6.107l1.66 1.71a.75.75 0 01-1.084 1.036L4.197 7.197a.75.75 0 010-1.06l2.487-2.55a.75.75 0 011.109.645z" clipRule="evenodd"/>
            </svg>
            Left
          </button>
          <button onClick={rotateRight} className={btnNorm} title="Rotate Right">
            <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4" style={{ transform: 'scaleX(-1)' }}>
              <path fillRule="evenodd" d="M7.793 2.232a.75.75 0 01-.025 1.06L6.107 5h2.518a7.25 7.25 0 110 14.5.75.75 0 010-1.5 5.75 5.75 0 100-11.5H6.107l1.66 1.71a.75.75 0 01-1.084 1.036L4.197 7.197a.75.75 0 010-1.06l2.487-2.55a.75.75 0 011.109.645z" clipRule="evenodd"/>
            </svg>
            Right
          </button>

          <div className="w-px h-6 mx-1" style={{ background: '#444' }} />

          <button onClick={() => setFlipH(v => !v)} className={flipH ? btnActive : btnNorm} title="Flip Horizontal">
            <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
              <path d="M10 2a.75.75 0 01.75.75v14.5a.75.75 0 01-1.5 0V2.75A.75.75 0 0110 2zM2.22 7.47a.75.75 0 011.06 0L6.5 10.69V7.25a.75.75 0 011.5 0v5.5a.75.75 0 01-.75.75h-5.5a.75.75 0 010-1.5H5.44L2.22 8.53a.75.75 0 010-1.06zm15.56 0a.75.75 0 010 1.06l-3.22 3.22h3.19a.75.75 0 010 1.5h-5.5a.75.75 0 01-.75-.75v-5.5a.75.75 0 011.5 0v3.44l3.22-3.22a.75.75 0 011.06 0z"/>
            </svg>
            Flip H
          </button>
          <button onClick={() => setFlipV(v => !v)} className={flipV ? btnActive : btnNorm} title="Flip Vertical">
            <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4" style={{ transform: 'rotate(90deg)' }}>
              <path d="M10 2a.75.75 0 01.75.75v14.5a.75.75 0 01-1.5 0V2.75A.75.75 0 0110 2zM2.22 7.47a.75.75 0 011.06 0L6.5 10.69V7.25a.75.75 0 011.5 0v5.5a.75.75 0 01-.75.75h-5.5a.75.75 0 010-1.5H5.44L2.22 8.53a.75.75 0 010-1.06zm15.56 0a.75.75 0 010 1.06l-3.22 3.22h3.19a.75.75 0 010 1.5h-5.5a.75.75 0 01-.75-.75v-5.5a.75.75 0 011.5 0v3.44l3.22-3.22a.75.75 0 011.06 0z"/>
            </svg>
            Flip V
          </button>

          <div className="w-px h-6 mx-1" style={{ background: '#444' }} />

          <button
            onClick={() => { setCropMode(v => !v); if (cropMode) setCropRect(null) }}
            className={cropMode ? btnActive : btnNorm}
            title="Crop mode"
          >
            <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
              <path fillRule="evenodd" d="M14.5 1.75a.75.75 0 00-1.5 0V5H5.75A.75.75 0 005 5.75v7.25H1.75a.75.75 0 000 1.5H5v2.75a.75.75 0 001.5 0V15h7.25a.75.75 0 00.75-.75V7h2.75a.75.75 0 000-1.5H14.5V1.75zM6.5 13.5v-7h7v7h-7z" clipRule="evenodd"/>
            </svg>
            Crop
          </button>

          {cropMode && hasCrop && (
            <button onClick={applyCrop} className={btnActive} title="Apply crop">
              ✓ Apply Crop
            </button>
          )}

          <div className="flex-1" />

          <button onClick={reset} className={btnNorm} title="Reset">
            <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
              <path fillRule="evenodd" d="M15.312 11.424a5.5 5.5 0 01-9.201 2.466l-.312-.311h2.433a.75.75 0 000-1.5H3.989a.75.75 0 00-.75.75v4.242a.75.75 0 001.5 0v-2.43l.31.31a7 7 0 0011.712-3.138.75.75 0 00-1.449-.389zm1.23-3.723a.75.75 0 00.219-.53V2.929a.75.75 0 00-1.5 0V5.36l-.31-.31A7 7 0 003.239 8.188a.75.75 0 101.448.389A5.5 5.5 0 0113.89 6.11l.311.31h-2.432a.75.75 0 000 1.5h4.243a.75.75 0 00.53-.219z" clipRule="evenodd"/>
            </svg>
            Reset
          </button>
        </div>

        {/* Canvas area */}
        <div className="flex-1 flex items-center justify-center p-4 overflow-auto" style={{ minHeight: 0 }}>
          {!imgLoaded ? (
            <div className="text-white/40 text-sm">Loading…</div>
          ) : (
            <canvas
              ref={canvasRef}
              style={{
                cursor:      cropMode ? 'crosshair' : 'default',
                display:     'block',
                borderRadius: '6px',
                maxWidth:    '100%',
              }}
              onMouseDown={onMouseDown}
              onMouseMove={onMouseMove}
              onMouseUp={onMouseUp}
              onMouseLeave={onMouseUp}
            />
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-4 py-3" style={{ borderTop: '1px solid #333' }}>
          {cropMode ? (
            <p className="text-xs text-white/50">
              {hasCrop ? 'Drag to adjust • click Apply Crop to confirm' : 'Click and drag on the image to draw a crop area'}
            </p>
          ) : (
            <span />
          )}
          <div className="flex gap-2 ml-auto">
            <button onClick={onClose} className="btn-outline text-sm px-4 py-1.5" style={{ color: '#ccc', borderColor: '#555' }}>
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={!imgLoaded}
              className="btn-primary text-sm px-4 py-1.5"
              style={{ background: 'var(--accent)' }}
            >
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
