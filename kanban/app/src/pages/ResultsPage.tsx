import { useState, useEffect, useCallback } from 'react'
import { useParams } from 'react-router-dom'
import { useApi } from '../hooks/useApi'
import { PageHeader, Spinner, EmptyState, Badge, Toast, useToast } from '../components/ui'
import VoteBar from '../components/VoteBar'

interface SessionInfo {
  id: number
  name: string
  slug: string
}

interface CardResult {
  card_id: number
  title: string
  priority?: string
  labels?: string
  story_points?: number
  votes_for: number
  votes_against: number
  net_score: number
}

interface VoterInfo {
  name: string
  tokens_for_spent: number
  tokens_against_spent: number
  joined_at: string
}

interface ResultsData {
  cards: CardResult[]
  voters: VoterInfo[]
  total_voters: number
  total_votes_cast: number
  avg_tokens_spent: number
}

export default function ResultsPage() {
  const { id: boardId } = useParams<{ id: string }>()
  const api = useApi()
  const { toast, show: showToast, clear: clearToast } = useToast()

  const [boardName, setBoardName] = useState('')
  const [sessions, setSessions] = useState<SessionInfo[]>([])
  const [selectedSession, setSelectedSession] = useState<number | 'all'>('all')
  const [results, setResults] = useState<ResultsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [resultsLoading, setResultsLoading] = useState(false)

  const loadSessions = useCallback(async () => {
    if (!boardId) return
    try {
      const [board, sessionData] = await Promise.all([
        api.get(`/boards/${boardId}`),
        api.get(`/boards/${boardId}/sessions`),
      ])
      setBoardName(board.name)
      setSessions(sessionData)
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to load data', 'error')
    } finally {
      setLoading(false)
    }
  }, [boardId, api, showToast])

  const loadResults = useCallback(async () => {
    if (!boardId) return
    setResultsLoading(true)
    try {
      const path = selectedSession === 'all'
        ? `/boards/${boardId}/results`
        : `/boards/${boardId}/results?session_id=${selectedSession}`
      const data = await api.get(path)
      setResults(data)
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to load results', 'error')
    } finally {
      setResultsLoading(false)
    }
  }, [boardId, selectedSession, api, showToast])

  useEffect(() => { loadSessions() }, [loadSessions])
  useEffect(() => { if (!loading) loadResults() }, [loading, loadResults])

  function exportCsv() {
    if (!results || results.cards.length === 0) return
    const headers = ['Rank', 'Title', 'Priority', 'Story Points', 'Votes For', 'Votes Against', 'Net Score']
    const rows = results.cards.map((card, i) => [
      i + 1,
      `"${card.title.replace(/"/g, '""')}"`,
      card.priority ?? '',
      card.story_points ?? '',
      card.votes_for,
      card.votes_against,
      card.net_score,
    ])
    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `results-${boardId}-${selectedSession}.csv`
    a.click()
    URL.revokeObjectURL(url)
    showToast('CSV exported')
  }

  if (loading) return <Spinner />

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="Vote Results"
        subtitle={`Board: ${boardName}`}
        action={
          <button onClick={exportCsv} className="btn-outline px-4 py-2 text-sm flex items-center gap-1.5" disabled={!results || results.cards.length === 0}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/>
            </svg>
            Export CSV
          </button>
        }
      />

      <div className="flex-1 overflow-y-auto p-6">
        {/* Session selector */}
        <div className="flex items-center gap-4 mb-6">
          <div className="flex items-center gap-2">
            <label className="text-sm font-semibold text-text-2">View:</label>
            <select
              className="px-3 py-2 text-sm border border-border rounded-lg bg-surface focus:outline-none focus:ring-2 focus:ring-accent/30"
              value={selectedSession}
              onChange={e => setSelectedSession(e.target.value === 'all' ? 'all' : Number(e.target.value))}
            >
              <option value="all">All Sessions (Aggregate)</option>
              {sessions.map(s => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
        </div>

        {resultsLoading ? (
          <Spinner />
        ) : !results || results.cards.length === 0 ? (
          <EmptyState message="No voting results yet. Create a session and collect some votes first." />
        ) : (
          <>
            {/* Summary stats */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
              <div className="card p-4 text-center">
                <p className="text-2xl font-extrabold text-accent">{results.total_voters}</p>
                <p className="text-xs text-text-3 mt-1">Total Voters</p>
              </div>
              <div className="card p-4 text-center">
                <p className="text-2xl font-extrabold text-accent">{results.total_votes_cast}</p>
                <p className="text-xs text-text-3 mt-1">Total Votes Cast</p>
              </div>
              <div className="card p-4 text-center">
                <p className="text-2xl font-extrabold text-accent">{results.avg_tokens_spent.toFixed(1)}</p>
                <p className="text-xs text-text-3 mt-1">Avg Tokens Spent</p>
              </div>
            </div>

            {/* Ranked card list */}
            <div className="mb-8">
              <h3 className="text-sm font-bold text-text-1 mb-3">Ranked Results</h3>
              <div className="space-y-2">
                {results.cards.map((card, i) => (
                  <div key={card.card_id} className="card p-4 flex items-center gap-4">
                    <span className="w-8 h-8 rounded-full bg-accent-dim text-accent text-sm font-bold flex items-center justify-center flex-shrink-0">
                      {i + 1}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <p className="text-sm font-semibold text-text-1 truncate">{card.title}</p>
                        {card.priority && (
                          <Badge
                            label={card.priority}
                            variant={
                              card.priority.toLowerCase() === 'highest' ? 'red' :
                              card.priority.toLowerCase() === 'high' ? 'orange' :
                              card.priority.toLowerCase() === 'medium' ? 'yellow' :
                              card.priority.toLowerCase() === 'low' ? 'blue' : 'neutral'
                            }
                          />
                        )}
                        {card.story_points != null && card.story_points > 0 && (
                          <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-accent-dim text-accent text-[10px] font-bold">
                            {card.story_points}
                          </span>
                        )}
                      </div>
                      <VoteBar votesFor={card.votes_for} votesAgainst={card.votes_against} />
                    </div>
                    <div className="text-right flex-shrink-0 ml-2">
                      <p className={`text-lg font-bold tabular-nums ${card.net_score > 0 ? 'text-emerald-600' : card.net_score < 0 ? 'text-red-500' : 'text-text-3'}`}>
                        {card.net_score > 0 ? '+' : ''}{card.net_score}
                      </p>
                      <p className="text-[10px] text-text-3">net</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Voter participation */}
            {results.voters.length > 0 && (
              <div>
                <h3 className="text-sm font-bold text-text-1 mb-3">Voter Participation</h3>
                <div className="card overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-surface-2 border-b border-border">
                        <th className="text-left px-4 py-2.5 text-xs font-semibold text-text-3 uppercase">Name</th>
                        <th className="text-right px-4 py-2.5 text-xs font-semibold text-text-3 uppercase">For Spent</th>
                        <th className="text-right px-4 py-2.5 text-xs font-semibold text-text-3 uppercase">Against Spent</th>
                        <th className="text-right px-4 py-2.5 text-xs font-semibold text-text-3 uppercase">Joined</th>
                      </tr>
                    </thead>
                    <tbody>
                      {results.voters.map(voter => (
                        <tr key={voter.name} className="border-b border-border last:border-0">
                          <td className="px-4 py-2.5 font-medium text-text-1">{voter.name}</td>
                          <td className="px-4 py-2.5 text-right tabular-nums text-emerald-600 font-semibold">{voter.tokens_for_spent}</td>
                          <td className="px-4 py-2.5 text-right tabular-nums text-red-500 font-semibold">{voter.tokens_against_spent}</td>
                          <td className="px-4 py-2.5 text-right text-text-3">
                            {new Date(voter.joined_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {toast && <Toast message={toast.message} type={toast.type} onClose={clearToast} />}
    </div>
  )
}
