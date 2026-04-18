import { useEffect, useMemo, useState } from 'react'
import { useApi } from '../hooks/useApi'
import { useLanguage } from '../contexts/LanguageContext'

type EntityType =
  | 'ingredient' | 'recipe' | 'sales_item' | 'modifier_group' | 'modifier_option'
  | 'combo_step' | 'combo_step_option' | 'category' | 'vendor' | 'price_level' | 'menu'

interface Meta {
  source?: 'ai' | 'human'
  hash?: string
  reviewed?: boolean
  reviewed_by?: string | null
  updated_at?: string
}

interface TranslationEntry extends Record<string, string | Meta | undefined> {
  _meta?: Meta
}

interface Props {
  entityType: EntityType
  entityId: number | null                  // null disables the editor
  fields: string[]                          // e.g. ['name', 'notes']
  /** Optional callback fired after a successful save */
  onChange?: (lang: string, translation: TranslationEntry) => void
  /** Optional inline mode — shrinks the layout */
  compact?: boolean
}

/**
 * Tabbed translation editor for an entity row. One tab per active language
 * (excluding English — the base). Each tab lets the user edit every translatable
 * field; saving stamps source:'human' + reviewed:true.
 */
export default function TranslationEditor({ entityType, entityId, fields, onChange, compact = false }: Props) {
  const api = useApi()
  const { languages } = useLanguage()
  const [base, setBase] = useState<Record<string, string>>({})
  const [translations, setTranslations] = useState<Record<string, TranslationEntry>>({})
  const [activeLang, setActiveLang] = useState<string>('')
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Target languages = active languages except English
  const targetLangs = useMemo(
    () => languages.filter(l => l.code !== 'en' && l.is_active),
    [languages]
  )

  // Load translations when entity changes
  useEffect(() => {
    if (!entityId) return
    setLoading(true)
    setError(null)
    api.get(`/translations/${entityType}/${entityId}`)
      .then((res: any) => {
        setBase(res.base || {})
        setTranslations(res.translations || {})
        if (!activeLang && targetLangs.length) setActiveLang(targetLangs[0].code)
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [entityType, entityId, api, targetLangs]) // activeLang intentionally excluded

  // Sync draft when active tab / translations change
  useEffect(() => {
    if (!activeLang) return
    const entry = translations[activeLang] || {}
    const d: Record<string, string> = {}
    for (const f of fields) d[f] = (entry[f] as string | undefined) || ''
    setDraft(d)
  }, [activeLang, translations, fields])

  async function save() {
    if (!entityId || !activeLang) return
    setSaving(true)
    setError(null)
    try {
      const payload: Record<string, string> = {}
      for (const f of fields) if (draft[f]?.trim()) payload[f] = draft[f].trim()
      const res: any = await api.put(`/translations/${entityType}/${entityId}/${activeLang}`, payload)
      setTranslations(res.translations)
      onChange?.(activeLang, res.translations[activeLang])
    } catch (e: any) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  async function clearCurrent() {
    if (!entityId || !activeLang) return
    if (!confirm(`Remove ${activeLang.toUpperCase()} translation for this item?`)) return
    setSaving(true)
    try {
      await api.delete(`/translations/${entityType}/${entityId}/${activeLang}`)
      const next = { ...translations }
      delete next[activeLang]
      setTranslations(next)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  if (!entityId) {
    return <div className="text-xs text-text-3 italic">Save the item first to edit translations.</div>
  }
  if (!targetLangs.length) {
    return <div className="text-xs text-text-3 italic">No additional languages are active. Enable more in Configuration → Languages.</div>
  }

  const activeEntry = translations[activeLang]
  const isHuman = activeEntry?._meta?.source === 'human'
  const isAi    = activeEntry?._meta?.source === 'ai'
  const exists  = !!activeEntry

  return (
    <div className={`border border-border rounded-lg bg-surface-2 ${compact ? 'p-3' : 'p-4'} space-y-3`}>
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <div className="text-xs font-semibold text-text-1 uppercase tracking-wide">Translations</div>
          <div className="text-[11px] text-text-3 mt-0.5">Base language is English. Add translations for other languages here.</div>
        </div>
        {exists && (
          <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold uppercase tracking-wide ${
            isHuman ? 'bg-emerald-100 text-emerald-700' :
            isAi    ? 'bg-amber-100 text-amber-700' : 'bg-surface text-text-3'
          }`}>
            {isHuman ? 'Reviewed' : isAi ? 'AI draft' : '—'}
          </span>
        )}
      </div>

      {/* Language tabs */}
      <div className="flex flex-wrap gap-1">
        {targetLangs.map(l => {
          const has = !!translations[l.code]
          return (
            <button
              key={l.code}
              onClick={() => setActiveLang(l.code)}
              className={`text-xs px-2 py-1 rounded transition-colors flex items-center gap-1.5 ${
                activeLang === l.code
                  ? 'bg-accent text-white'
                  : 'bg-surface text-text-2 hover:bg-accent-dim hover:text-accent border border-border'
              }`}
            >
              <span className="font-mono uppercase">{l.code}</span>
              <span>{l.native_name || l.name}</span>
              {has && (
                <span className={`w-1.5 h-1.5 rounded-full ${
                  translations[l.code]?._meta?.source === 'human' ? 'bg-emerald-400' : 'bg-amber-400'
                }`} />
              )}
            </button>
          )
        })}
      </div>

      {/* Field editors */}
      {loading ? (
        <div className="h-20 bg-surface rounded animate-pulse" />
      ) : (
        <div className="space-y-2">
          {fields.map(f => (
            <div key={f}>
              <label className="text-[11px] text-text-3 uppercase tracking-wide font-medium">{f}</label>
              <div className="text-[11px] text-text-3 mb-1 italic">
                EN: <span className="text-text-2 not-italic">{base[f] || <em>(empty)</em>}</span>
              </div>
              {f === 'notes' || f === 'description' ? (
                <textarea
                  rows={2}
                  value={draft[f] || ''}
                  onChange={e => setDraft(d => ({ ...d, [f]: e.target.value }))}
                  placeholder={`${activeLang.toUpperCase()} translation of ${f}`}
                  className="input w-full text-sm"
                />
              ) : (
                <input
                  value={draft[f] || ''}
                  onChange={e => setDraft(d => ({ ...d, [f]: e.target.value }))}
                  placeholder={`${activeLang.toUpperCase()} translation of ${f}`}
                  className="input w-full text-sm"
                />
              )}
            </div>
          ))}
        </div>
      )}

      {error && <div className="text-xs text-red-600">{error}</div>}

      <div className="flex items-center gap-2 pt-1">
        <button onClick={save} disabled={saving} className="btn-primary text-xs py-1.5 px-3">
          {saving ? 'Saving…' : `Save ${activeLang.toUpperCase()}`}
        </button>
        {exists && (
          <button onClick={clearCurrent} disabled={saving}
            className="text-xs py-1.5 px-3 rounded border border-border text-text-3 hover:text-red-600 hover:border-red-300">
            Remove
          </button>
        )}
        {activeEntry?._meta?.reviewed_by && (
          <span className="text-[10px] text-text-3 ml-auto">
            Last edited by {activeEntry._meta.reviewed_by}
          </span>
        )}
      </div>
    </div>
  )
}
