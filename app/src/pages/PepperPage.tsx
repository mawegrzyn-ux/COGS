// =============================================================================
// PepperPage — full-viewport standalone Pepper chat at /pepper
//
// Designed to be installed as a PWA on phones AND tablets. Uses the existing
// AiChat component but renders it edge-to-edge with the touch-optimised layout
// (bigger tap targets, font, push-to-talk button) regardless of viewport. The
// page also swaps the document's manifest link to the dedicated Pepper
// manifest at /pepper-manifest.webmanifest so installs from this URL register
// with their own scope/start_url and sit on the home screen as "Pepper".
// =============================================================================

import { useEffect } from 'react'
import AiChat from '../components/AiChat'
import { useKeyboardInset } from '../hooks/useIsMobile'

export default function PepperPage() {
  // Push the bottom edge up by the on-screen-keyboard height on iOS/Android so
  // the input stays visible when the keyboard opens. Returns 0 on desktop.
  const keyboardInset = useKeyboardInset()

  // Swap the manifest link to /pepper-manifest.webmanifest while this page is
  // mounted. When the user "Add to Home Screen" from /pepper, the standalone
  // app icon launches at /pepper rather than the full app shell. Restored on
  // unmount so other routes pick the regular Menu COGS manifest back up.
  useEffect(() => {
    const link = document.querySelector('link[rel="manifest"]') as HTMLLinkElement | null
    if (!link) return
    const original = link.href
    link.href = '/pepper-manifest.webmanifest'

    // Theme color tint so the iOS/Android status bar matches the chat header.
    const meta = document.querySelector('meta[name="theme-color"]') as HTMLMetaElement | null
    const originalTheme = meta?.content
    if (meta) meta.content = '#146A34'

    // Title — shown in the iOS Safari add-to-home-screen prompt and the app
    // switcher on Android.
    const originalTitle = document.title
    document.title = 'Pepper'

    return () => {
      link.href = original
      if (meta && originalTheme != null) meta.content = originalTheme
      document.title = originalTitle
    }
  }, [])

  return (
    <div
      className="pepper-standalone fixed inset-0 flex flex-col"
      style={{
        // Reserve room for the on-screen keyboard. CSS env() handles the iOS
        // home-bar safe-area; visualViewport-driven inset covers Android.
        paddingBottom: `max(${keyboardInset}px, env(safe-area-inset-bottom))`,
        paddingTop:    'env(safe-area-inset-top)',
        background:    'var(--surface)',
      }}
    >
      <AiChat
        // Force the touch-optimised layout for every viewport — phones AND
        // tablets get the bigger tap targets / font / mobile mic UX. Desktop
        // visitors still get a usable chat (just slightly chunkier buttons).
        isMobile
        // Standalone page is always "open" — pepperOpen / onToggle / mode
        // controls live in AppLayout and aren't relevant here.
        pepperOpen
      />
    </div>
  )
}
