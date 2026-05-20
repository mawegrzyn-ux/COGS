import { useState, useEffect, useCallback } from 'react'
import { useParams } from 'react-router-dom'
import { Badge } from '../components/ui'
import VoteBar from '../components/VoteBar'
import TokenBadge from '../components/TokenBadge'

// ── Types ────────────────────────────────────────────────────────────────────

interface SessionMeta {
  name: string
  board_name: string
  description?: string
  tokens_for: number
  tokens_against: number
  is_active: boolean
  expires_at?: string
}

interface VoteCard {
  id: number
  title: string
  description?: string
  priority?: string
  labels?: string
  story_points?: number
  epic?: string
}

interface MyVote {
  card_id: number
  tokens_for: number
  tokens_against: number
}

interface ResultCard {
  card_id: number
  title: string
  votes_for: number
  votes_against: number
  net_score: number
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function tokenStorageKey(slug: string) { return `kbn_token_${slug}` }

const priorityConfig: Record<string, { label: string; variant: 'red' | 'orange' | 'yellow' | 'blue' | 'neutral' }> = {
  highest: { label: 'Highest', variant: 'red' },
  high:    { label: 'High',    variant: 'orange' },
  medium:  { label: 'Medium',  variant: 'yellow' },
  low:     { label: 'Low',     variant: 'blue' },
  lowest:  { label: 'Lowest',  variant: 'neutral' },
}

// ── Component ────────────────────────────────────────────────────────────────

export default function VotePage() {
  const { slug } = useParams<{ slug: string }>()

  // Phase tracking
  const [phase, setPhase] = useState<'join' | 'vote' | 'results'>('join')

  // Session meta
  const [meta, setMeta] = useState<SessionMeta | null>(null)
  const [metaLoading, setMetaLoading] = useState(true)
  const [metaError, setMetaError] = useState('')

  // Join
  const [name, setName] = useState('')
  const [joining, setJoining] = useState(false)
  const [joinError, setJoinError] = useState('')
  const [token, setToken] = useState<string | null>(null)

  // Vote
  const [cards, setCards] = useState<VoteCard[]>([])
  const [allocations, setAllocations] = useState<Record<number, { for: number; against: number }>>({})
  const [savedAllocations, setSavedAllocations] = useState<Record<number, { for: number; against: number }>>({})
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')

  // Results
  const [results, setResults] = useState<ResultCard[]>([])

  // ── Load session meta ───────────────────────────────────────────────────────

  useEffect(() => {
    if (!slug) return
    setMetaLoading(true)
    fetch(`/kanban/api/vote/${slug}`)
      .then(r => r.json())
      .then(d => {
        if (d.error) { setMetaError(d.error.message || 'Session not found'); return }
        setMeta(d)
        // Check for existing token
        const stored = sessionStorage.getItem(tokenStorageKey(slug))
        if (stored) {
          setToken(stored)
          setPhase('vote')
        }
      })
      .catch(() => setMetaError('Could not load this voting session.'))
      .finally(() => setMetaLoading(false))
  }, [slug])

  // ── Load cards + existing votes when authenticated ──────────────────────────

  const loadVoteData = useCallback(async (tok: string) => {
    if (!slug) return
    try {
      const [cardsRes, votesRes] = await Promise.all([
        fetch(`/kanban/api/vote/${slug}/cards`, { headers: { Authorization: `Bearer ${tok}` } }),
        fetch(`/kanban/api/vote/${slug}/my-votes`, { headers: { Authorization: `Bearer ${tok}` } }),
      ])
      if (!cardsRes.ok) {
        if (cardsRes.status === 401) {
          sessionStorage.removeItem(tokenStorageKey(slug))
          setToken(null)
          setPhase('join')
          return
        }
        throw new Error('Failed to load cards')
      }
      const cardsData = await cardsRes.json()
      const votesData = await votesRes.json()

      setCards(cardsData)

      // Build allocations from existing votes
      const alloc: Record<number, { for: number; against: number }> = {}
      for (const card of cardsData) {
        const existing = (votesData as MyVote[]).find(v => v.card_id === card.id)
        alloc[card.id] = {
          for: existing?.tokens_for ?? 0,
          against: existing?.tokens_against ?? 0,
        }
      }
      setAllocations(alloc)
      setSavedAllocations(JSON.parse(JSON.stringify(alloc)))
    } catch {
      setSubmitError('Failed to load voting data.')
    }
  }, [slug])

  useEffect(() => {
    if (token && phase === 'vote') loadVoteData(token)
  }, [token, phase, loadVoteData])

  // ── Join handler ────────────────────────────────────────────────────────────

  async function handleJoin(e: React.FormEvent) {
    e.preventDefault()
    if (!slug || !name.trim()) return
    setJoining(true)
    setJoinError('')
    try {
      const res = await fetch(`/kanban/api/vote/${slug}/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim() }),
      })
      const d = await res.json()
      if (d.error) { setJoinError(d.error.message); return }
      sessionStorage.setItem(tokenStorageKey(slug!), d.token)
      setToken(d.token)
      setPhase('vote')
    } catch {
      setJoinError('Failed to join session.')
    } finally {
      setJoining(false)
    }
  }

  // ── Token budget calculations ───────────────────────────────────────────────

  const totalForSpent = Object.values(allocations).reduce((s, a) => s + a.for, 0)
  const totalAgainstSpent = Object.values(allocations).reduce((s, a) => s + a.against, 0)
  const forRemaining = (meta?.tokens_for ?? 0) - totalForSpent
  const againstRemaining = (meta?.tokens_against ?? 0) - totalAgainstSpent

  function adjustFor(cardId: number, delta: number) {
    setAllocations(prev => {
      const current = prev[cardId] ?? { for: 0, against: 0 }
      const newVal = current.for + delta
      if (newVal < 0) return prev
      if (delta > 0 && forRemaining <= 0) return prev
      return { ...prev, [cardId]: { ...current, for: newVal } }
    })
  }

  function adjustAgainst(cardId: number, delta: number) {
    setAllocations(prev => {
      const current = prev[cardId] ?? { for: 0, against: 0 }
      const newVal = current.against + delta
      if (newVal < 0) return prev
      if (delta > 0 && againstRemaining <= 0) return prev
      return { ...prev, [cardId]: { ...current, against: newVal } }
    })
  }

  // Check if allocations changed from saved
  const hasChanges = JSON.stringify(allocations) !== JSON.stringify(savedAllocations)

  // ── Submit votes ────────────────────────────────────────────────────────────

  async function handleSubmit() {
    if (!token || !slug) return
    setSubmitting(true)
    setSubmitError('')
    try {
      const votes = Object.entries(allocations)
        .filter(([, v]) => v.for > 0 || v.against > 0)
        .map(([cardId, v]) => ({
          card_id: Number(cardId),
          tokens_for: v.for,
          tokens_against: v.against,
        }))
      const res = await fetch(`/kanban/api/vote/${slug}/cast`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ votes }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: { message: 'Failed to submit' } }))
        throw new Error(err.error?.message || 'Failed to submit votes')
      }
      setSavedAllocations(JSON.parse(JSON.stringify(allocations)))
      // Load results
      const resultsRes = await fetch(`/kanban/api/vote/${slug}/results`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (resultsRes.ok) {
        const data = await resultsRes.json()
        setResults(data.cards ?? data)
      }
      setPhase('results')
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Failed to submit votes')
    } finally {
      setSubmitting(false)
    }
  }

  // ── Render: Loading ─────────────────────────────────────────────────────────

  if (metaLoading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-text-3 text-sm animate-pulse">Loading...</div>
      </div>
    )
  }

  // ── Render: Error ───────────────────────────────────────────────────────────

  if (metaError || !meta) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="card max-w-sm w-full p-8 text-center">
          <div className="w-14 h-14 rounded-full bg-red-50 flex items-center justify-center mx-auto mb-4">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2" strokeLinecap="round">
              <circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/>
            </svg>
          </div>
          <h1 className="text-lg font-bold text-text-1 mb-2">Session Unavailable</h1>
          <p className="text-sm text-text-3">{metaError || 'This voting session could not be found.'}</p>
        </div>
      </div>
    )
  }

  // ── Render: Session expired ─────────────────────────────────────────────────

  const isExpired = !meta.is_active || (meta.expires_at && new Date(meta.expires_at) < new Date())

  if (isExpired && phase === 'join') {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="card max-w-sm w-full p-8 text-center">
          <div className="w-14 h-14 rounded-full bg-surface-2 flex items-center justify-center mx-auto mb-4">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#94A3B8" strokeWidth="2" strokeLinecap="round">
              <circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>
            </svg>
          </div>
          <h1 className="text-lg font-bold text-text-1 mb-2">Voting Has Ended</h1>
          <p className="text-sm text-text-3">This voting session has closed. Thank you for your interest.</p>
        </div>
      </div>
    )
  }

  // ── Render: Join phase ──────────────────────────────────────────────────────

  if (phase === 'join') {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="card max-w-sm w-full p-8">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-12 h-12 rounded-xl bg-accent-dim flex items-center justify-center flex-shrink-0">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="7" height="7"/>
                <rect x="14" y="3" width="7" height="9"/>
                <rect x="3" y="14" width="7" height="7"/>
                <rect x="14" y="16" width="7" height="5"/>
              </svg>
            </div>
            <div>
              <h1 className="font-bold text-text-1 text-lg leading-tight">{meta.name}</h1>
              <p className="text-sm text-text-3">{meta.board_name}</p>
            </div>
          </div>

          {meta.description && (
            <p className="text-sm text-text-2 mb-6 bg-surface-2 rounded-lg p-3">{meta.description}</p>
          )}

          <form onSubmit={handleJoin} className="space-y-4">
            <div>
              <label className="block text-sm font-semibold text-text-2 mb-1.5">Your name <span className="text-red-400">*</span></label>
              <input
                type="text"
                autoFocus
                className="w-full px-3 py-2.5 rounded-lg border border-border text-sm bg-surface focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent transition"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="e.g. Jane Smith"
                maxLength={80}
              />
            </div>
            {joinError && <p className="text-red-500 text-sm">{joinError}</p>}
            <button
              type="submit"
              className="btn-primary w-full py-2.5 text-sm disabled:opacity-50"
              disabled={joining || !name.trim()}
            >
              {joining ? 'Joining...' : 'Join Voting Session'}
            </button>
          </form>

          <div className="mt-5 flex justify-center gap-4 text-xs text-text-3">
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-emerald-400" />
              {meta.tokens_for} FOR tokens
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-red-400" />
              {meta.tokens_against} AGAINST tokens
            </span>
          </div>
        </div>
      </div>
    )
  }

  // ── Render: Vote phase ──────────────────────────────────────────────────────

  if (phase === 'vote') {
    return (
      <div className="min-h-screen bg-slate-50">
        {/* Header */}
        <header className="bg-white border-b border-border sticky top-0 z-10">
          <div className="max-w-2xl mx-auto px-4 py-3">
            <div className="flex items-center justify-between">
              <div>
                <h1 className="font-bold text-text-1 text-base">{meta.name}</h1>
                <p className="text-xs text-text-3">{meta.board_name}</p>
              </div>
              <div className="flex items-center gap-1">
                <div className="w-8 h-8 rounded-full bg-accent flex items-center justify-center">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="3" width="7" height="7"/>
                    <rect x="14" y="3" width="7" height="9"/>
                    <rect x="3" y="14" width="7" height="7"/>
                    <rect x="14" y="16" width="7" height="5"/>
                  </svg>
                </div>
              </div>
            </div>
          </div>
        </header>

        {/* Token budget */}
        <div className="bg-white border-b border-border sticky top-[57px] z-10">
          <div className="max-w-2xl mx-auto px-4 py-3">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-emerald-700 uppercase">FOR</span>
                <div className="flex gap-1">
                  {Array.from({ length: meta.tokens_for }).map((_, i) => (
                    <span
                      key={i}
                      className={`w-5 h-5 rounded-full border-2 transition-colors ${
                        i < totalForSpent
                          ? 'bg-emerald-400 border-emerald-500'
                          : 'bg-emerald-50 border-emerald-200'
                      }`}
                    />
                  ))}
                </div>
                <span className="text-xs text-text-3 font-mono">{forRemaining}/{meta.tokens_for}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-red-600 uppercase">AGAINST</span>
                <div className="flex gap-1">
                  {Array.from({ length: meta.tokens_against }).map((_, i) => (
                    <span
                      key={i}
                      className={`w-5 h-5 rounded-full border-2 transition-colors ${
                        i < totalAgainstSpent
                          ? 'bg-red-400 border-red-500'
                          : 'bg-red-50 border-red-200'
                      }`}
                    />
                  ))}
                </div>
                <span className="text-xs text-text-3 font-mono">{againstRemaining}/{meta.tokens_against}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Card list */}
        <div className="max-w-2xl mx-auto px-4 py-4">
          {submitError && (
            <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700 mb-4">
              {submitError}
            </div>
          )}

          <div className="space-y-3">
            {cards.map(card => {
              const alloc = allocations[card.id] ?? { for: 0, against: 0 }
              const labelsArr = card.labels ? card.labels.split(',').map(l => l.trim()).filter(Boolean) : []
              const pCfg = card.priority ? priorityConfig[card.priority.toLowerCase()] : null

              return (
                <div key={card.id} className="card p-4">
                  {/* Card info */}
                  <div className="mb-3">
                    <div className="flex items-center gap-2 mb-1">
                      <p className="text-sm font-semibold text-text-1">{card.title}</p>
                      {pCfg && <Badge label={pCfg.label} variant={pCfg.variant} />}
                      {card.story_points != null && card.story_points > 0 && (
                        <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-accent-dim text-accent text-[10px] font-bold">
                          {card.story_points}
                        </span>
                      )}
                    </div>
                    {labelsArr.length > 0 && (
                      <div className="flex items-center gap-1 flex-wrap mb-1">
                        {labelsArr.map(l => (
                          <span key={l} className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-surface-2 text-text-3 border border-border">
                            {l}
                          </span>
                        ))}
                      </div>
                    )}
                    {card.description && (
                      <p className="text-xs text-text-3 mt-1">{card.description}</p>
                    )}
                  </div>

                  {/* Vote controls */}
                  <div className="grid grid-cols-2 gap-3">
                    {/* FOR row */}
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => adjustFor(card.id, -1)}
                        disabled={alloc.for === 0}
                        className="w-9 h-9 rounded-lg bg-emerald-50 text-emerald-600 font-bold text-lg flex items-center justify-center hover:bg-emerald-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                      >
                        -
                      </button>
                      <TokenBadge count={alloc.for} direction="for" size="md" />
                      <button
                        onClick={() => adjustFor(card.id, 1)}
                        disabled={forRemaining <= 0}
                        className="w-9 h-9 rounded-lg bg-emerald-50 text-emerald-600 font-bold text-lg flex items-center justify-center hover:bg-emerald-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                      >
                        +
                      </button>
                      <span className="text-xs text-emerald-600 font-semibold ml-1">FOR</span>
                    </div>

                    {/* AGAINST row */}
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => adjustAgainst(card.id, -1)}
                        disabled={alloc.against === 0}
                        className="w-9 h-9 rounded-lg bg-red-50 text-red-600 font-bold text-lg flex items-center justify-center hover:bg-red-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                      >
                        -
                      </button>
                      <TokenBadge count={alloc.against} direction="against" size="md" />
                      <button
                        onClick={() => adjustAgainst(card.id, 1)}
                        disabled={againstRemaining <= 0}
                        className="w-9 h-9 rounded-lg bg-red-50 text-red-600 font-bold text-lg flex items-center justify-center hover:bg-red-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                      >
                        +
                      </button>
                      <span className="text-xs text-red-600 font-semibold ml-1">AGAINST</span>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>

          {/* Submit button */}
          <div className="sticky bottom-0 bg-slate-50 pt-4 pb-6 mt-4">
            <button
              onClick={handleSubmit}
              disabled={!hasChanges || submitting}
              className="btn-primary w-full py-3 text-sm disabled:opacity-50"
            >
              {submitting ? 'Submitting...' : 'Submit Votes'}
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ── Render: Results phase ───────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-white border-b border-border">
        <div className="max-w-2xl mx-auto px-4 py-3">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="font-bold text-text-1 text-base">{meta.name}</h1>
              <p className="text-xs text-text-3">{meta.board_name}</p>
            </div>
            <div className="w-8 h-8 rounded-full bg-accent flex items-center justify-center">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="7" height="7"/>
                <rect x="14" y="3" width="7" height="9"/>
                <rect x="3" y="14" width="7" height="7"/>
                <rect x="14" y="16" width="7" height="5"/>
              </svg>
            </div>
          </div>
        </div>
      </header>

      <div className="max-w-2xl mx-auto px-4 py-6">
        {/* Success banner */}
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-5 text-center mb-6">
          <div className="w-12 h-12 rounded-full bg-emerald-100 flex items-center justify-center mx-auto mb-3">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#059669" strokeWidth="2.5" strokeLinecap="round">
              <path d="M20 6L9 17l-5-5"/>
            </svg>
          </div>
          <h2 className="text-lg font-bold text-emerald-800 mb-1">Votes Submitted</h2>
          <p className="text-sm text-emerald-600">Your votes have been recorded. Here are the current results.</p>
        </div>

        {/* Results list */}
        <div className="space-y-2 mb-6">
          {results
            .sort((a, b) => b.net_score - a.net_score)
            .map((card, i) => (
              <div key={card.card_id} className="card p-4 flex items-center gap-3">
                <span className="w-7 h-7 rounded-full bg-accent-dim text-accent text-xs font-bold flex items-center justify-center flex-shrink-0">
                  {i + 1}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-text-1 truncate mb-1">{card.title}</p>
                  <VoteBar votesFor={card.votes_for} votesAgainst={card.votes_against} />
                </div>
                <span className={`text-base font-bold tabular-nums flex-shrink-0 ${
                  card.net_score > 0 ? 'text-emerald-600' : card.net_score < 0 ? 'text-red-500' : 'text-text-3'
                }`}>
                  {card.net_score > 0 ? '+' : ''}{card.net_score}
                </span>
              </div>
            ))}
        </div>

        {/* Change votes button */}
        <button
          onClick={() => setPhase('vote')}
          className="btn-outline w-full py-3 text-sm"
        >
          Change Votes
        </button>

        <p className="text-center text-xs text-text-3 mt-6">
          Powered by <span className="font-semibold text-accent">Kanban Prioritiser</span>
        </p>
      </div>
    </div>
  )
}
