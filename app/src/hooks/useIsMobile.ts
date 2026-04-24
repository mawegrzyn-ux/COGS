import { useEffect, useState } from 'react'

// Matches the sm: breakpoint in Tailwind (640px). Anything below this is
// treated as "phone-sized" and triggers mobile-specific UX: full-viewport
// Pepper sheet, larger tap targets, bigger fonts, locked-to-bottom dock.
const MOBILE_MAX_WIDTH = 640

export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState<boolean>(() =>
    typeof window !== 'undefined' && window.innerWidth < MOBILE_MAX_WIDTH
  )

  useEffect(() => {
    if (typeof window === 'undefined') return
    const mql = window.matchMedia(`(max-width: ${MOBILE_MAX_WIDTH - 1}px)`)
    const onChange = () => setIsMobile(mql.matches)
    // initial sync (matchMedia fires only on change)
    onChange()
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [])

  return isMobile
}

// Tracks the visual-viewport height on iOS/Android so a keyboard pop-up
// doesn't hide the chat input. Returns 0 on desktop or when the API is
// unavailable — callers fall back to CSS `bottom: 0` in that case.
export function useKeyboardInset(): number {
  const [inset, setInset] = useState(0)
  useEffect(() => {
    if (typeof window === 'undefined') return
    const vv = window.visualViewport
    if (!vv) return
    const onChange = () => {
      // Difference between layout viewport and visual viewport ≈ keyboard height.
      const layoutH = window.innerHeight
      setInset(Math.max(0, Math.round(layoutH - vv.height)))
    }
    onChange()
    vv.addEventListener('resize', onChange)
    vv.addEventListener('scroll', onChange)
    return () => {
      vv.removeEventListener('resize', onChange)
      vv.removeEventListener('scroll', onChange)
    }
  }, [])
  return inset
}
