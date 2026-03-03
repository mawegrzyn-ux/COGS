export default function LoadingScreen() {
  return (
    <div className="fixed inset-0 bg-surface-2 flex items-center justify-center">
      <div className="flex flex-col items-center gap-4">
        <div className="w-10 h-10 rounded-full border-4 border-accent-dim border-t-accent animate-spin" />
        <span className="text-text-3 text-sm font-semibold">Loading…</span>
      </div>
    </div>
  )
}
