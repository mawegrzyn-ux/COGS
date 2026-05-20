interface VoteBarProps {
  votesFor: number
  votesAgainst: number
}

export default function VoteBar({ votesFor, votesAgainst }: VoteBarProps) {
  const total = votesFor + votesAgainst

  if (total === 0) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-xs text-text-3 tabular-nums w-6 text-right">0</span>
        <div className="flex-1 h-5 bg-gray-100 rounded-full" />
        <span className="text-xs text-text-3 tabular-nums w-6">0</span>
      </div>
    )
  }

  const forPct = (votesFor / total) * 100
  const againstPct = (votesAgainst / total) * 100

  return (
    <div className="flex items-center gap-2">
      <span className="text-xs font-semibold text-emerald-600 tabular-nums w-6 text-right">{votesFor}</span>
      <div className="flex-1 h-5 bg-gray-100 rounded-full overflow-hidden flex">
        {forPct > 0 && (
          <div
            className="h-full bg-emerald-400 transition-all duration-300"
            style={{ width: `${forPct}%` }}
            title={`For: ${votesFor} (${Math.round(forPct)}%)`}
          />
        )}
        {againstPct > 0 && (
          <div
            className="h-full bg-red-400 transition-all duration-300 ml-auto"
            style={{ width: `${againstPct}%` }}
            title={`Against: ${votesAgainst} (${Math.round(againstPct)}%)`}
          />
        )}
      </div>
      <span className="text-xs font-semibold text-red-500 tabular-nums w-6">{votesAgainst}</span>
    </div>
  )
}
