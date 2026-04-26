import { useState, useEffect, useCallback, useMemo } from 'react'
import { useApi } from '../hooks/useApi'
import { PageHeader, Modal, Field, EmptyState, Spinner, ConfirmDialog, DateConfirmDialog, Toast, Badge, PepperHelpButton } from '../components/ui'
import ImportPage from './ImportPage'
import { usePermissions } from '../hooks/usePermissions'
import type { Feature, AccessLevel } from '../hooks/usePermissions'

// ── Types ─────────────────────────────────────────────────────────────────────

interface Unit {
  id:                              number
  name:                            string
  abbreviation:                    string
  type:                            'mass' | 'volume' | 'count'
  default_recipe_unit:             string | null
  default_recipe_unit_conversion:  number | null
}

interface PriceLevel {
  id:          number
  name:        string
  description: string | null
  is_default:  boolean
}

interface AppSettings {
  base_currency?:   { code: string; symbol: string; name: string }
  cogs_thresholds?: { excellent: number; acceptable: number }
  target_cogs?:     number
  /** How the ingredient cost fallback is resolved when no preferred vendor is set for
   *  that ingredient+country. Preferred vendor quote ALWAYS wins. */
  costing_method?:  'best' | 'average'
}

type CostingMethod = 'best' | 'average'

type Tab = 'units' | 'price-levels' | 'currency' | 'thresholds' | 'test-data' | 'ai' | 'storage' | 'database' | 'import' | 'users' | 'roles'

const UNIT_TYPES = ['mass', 'volume', 'count'] as const

const TAB_LABELS: Record<Tab, string> = {
  'units':        'Base Units',
  'price-levels': 'Price Levels',
  'currency':     'Currency',
  'thresholds':   'COGS Thresholds',
  'test-data':    'Test Data',
  'ai':           'AI',
  'storage':      'Storage',
  'database':     'Database',
  'import':       'Import',
  'users':        'Users',
  'roles':        'Roles',
}

const TAB_TUTORIALS: Record<Tab, string> = {
  'units':        'How do measurement Units work in COGS Manager? Explain base units, purchase units, and prep units — and when I need to add a new unit.',
  'price-levels': 'What are Price Levels and how do they work? Give examples of how Eat-In, Takeout, and Delivery levels affect COGS calculations and sell prices differently.',
  'currency':     'How does the Currency settings tab work? Explain the base currency (USD default), the currency code/symbol/name fields, and how the Exchange Rates sync connects to Frankfurter API.',
  'thresholds':   'What are COGS Thresholds and the Recipe Costing Method? Explain the green/amber/red target percentages (typical good ranges for a restaurant), and then explain the difference between the two costing methods — "Best price quote" (cheapest active quote) vs "Market amalgamated quote" (arithmetic mean of all active quotes in a market) — and when to pick each. Clarify that preferred vendor quotes always take priority regardless of method.',
  'test-data':    'Explain the Test Data tab. What do each of the four buttons do (Load Test Data, Load Small Data, Clear Database, Load Default Data), when should I use each one, the date-confirmation safeguard, and who can access it (dev flag).',
  'ai':           'What AI settings are available? Explain the Anthropic key, Brave Search API key, Voyage AI key, Concise Mode, Claude Code Integration key, and the Token Usage panel — what each does and when I would configure it.',
  'storage':      'Explain the Storage settings tab. What is the difference between Local storage and Amazon S3? What are the pros/cons of each, and what S3 fields do I need to fill in (bucket, region, access key, secret key, custom base URL)?',
  'database':     'Explain the Database settings tab. What is the difference between Local and Standalone (AWS RDS) mode, when would I switch, what fields do I need (host, port, database, user, password, SSL), and what happens after I save?',
  'import':       'Walk me through the Settings Import tab. What file formats does it support, what data can I import (ingredients, recipes, menus?), and what are the steps in the import wizard?',
  'users':        'How does user management work? Explain the pending approval flow, roles, and brand partner scope — and what each status means (pending, active, disabled).',
  'roles':        'What are Roles in COGS Manager? Explain the three built-in roles (Admin, Operator, Viewer), how the permission matrix works (none/read/write per feature), and when I would create a custom role.',
}

// ── Settings Page ─────────────────────────────────────────────────────────────

export default function SettingsPage({ embedded, initialTab }: { embedded?: boolean; initialTab?: Tab } = {}) {
  const [tab, setTab] = useState<Tab>(initialTab ?? 'units')
  const { isDev, can } = usePermissions()

  // Sync active tab when initialTab prop changes (used in embedded/Configuration context)
  useEffect(() => {
    if (initialTab) setTab(initialTab)
  }, [initialTab])

  const canManageSettings = can('settings', 'write')

  const visibleTabs = (['units', 'price-levels', 'currency', 'thresholds', 'test-data', 'ai', 'storage', 'database', 'import', 'users', 'roles'] as Tab[])
    .filter(t => t !== 'test-data' || isDev)
    .filter(t => t !== 'database' || canManageSettings)

  function renderTabContent(t: Tab) {
    return (
      <>
        {t === 'units'        && <UnitsTab />}
        {t === 'price-levels' && <PriceLevelsTab />}
        {t === 'currency'     && <CurrencyTab />}
        {t === 'thresholds'   && <ThresholdsTab />}
        {t === 'test-data'    && isDev && <TestDataTab />}
        {t === 'ai'           && <AiTab />}
        {t === 'storage'      && <StorageTab />}
        {t === 'database'     && canManageSettings && <DatabaseTab />}
        {t === 'import'       && <ImportPage hideHeader />}
        {t === 'users'        && <UsersTab />}
        {t === 'roles'        && <RolesTab />}
      </>
    )
  }

  // ── Embedded mode: render only the content, no header/tab bar ─────────────
  if (embedded) {
    return (
      <div className={tab === 'import' ? 'flex-1 overflow-y-auto' : 'flex-1 overflow-y-auto p-6'}>
        {renderTabContent(tab)}
      </div>
    )
  }

  // ── Full standalone page ───────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="Settings"
        subtitle="Units, price levels, currency and more"
        tutorialPrompt="Walk me through the Settings page. What are the tabs for — Base Units, Price Levels, Currency, COGS Thresholds, and AI — and which should I configure first when setting up a new account?"
      />

      <div className="flex gap-1 px-6 pt-4 bg-surface border-b border-border overflow-x-auto">
        {visibleTabs.map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            data-ai-context={JSON.stringify({ type: 'tutorial', prompt: TAB_TUTORIALS[t] })}
            className={`px-4 py-2.5 text-sm font-semibold rounded-t transition-colors whitespace-nowrap
              ${tab === t
                ? 'text-accent border-b-2 border-accent bg-accent-dim/50'
                : 'text-text-3 hover:text-text-1'
              }`}
          >
            <span className="flex items-center gap-1.5">
              {TAB_LABELS[t]}
              {t === 'test-data' && <span className="text-[9px] font-bold px-1 py-0.5 rounded bg-purple-100 text-purple-700 leading-none">DEV</span>}
              <PepperHelpButton prompt={TAB_TUTORIALS[t]} size={12} />
            </span>
          </button>
        ))}
      </div>

      <div className={tab === 'import' ? 'flex-1 overflow-y-auto' : 'flex-1 overflow-y-auto p-6'}>
        {renderTabContent(tab)}
      </div>
    </div>
  )
}

// ── Units Tab ─────────────────────────────────────────────────────────────────

function UnitsTab() {
  const api = useApi()
  const [units, setUnits]       = useState<Unit[]>([])
  const [loading, setLoading]   = useState(true)
  const [modal, setModal]       = useState<Unit | 'new' | null>(null)
  const [deleting, setDeleting] = useState<Unit | null>(null)
  const [toast, setToast]       = useState<{ message: string; type: 'success' | 'error' } | null>(null)

  const load = useCallback(async () => {
    try {
      setLoading(true)
      setUnits(await api.get('/units'))
    } finally {
      setLoading(false)
    }
  }, [api])

  useEffect(() => { load() }, [load])

  const handleSave = async (values: Omit<Unit, 'id'>) => {
    try {
      if (modal === 'new') {
        await api.post('/units', values)
        setToast({ message: 'Unit added', type: 'success' })
      } else if (modal != null) {
        await api.put(`/units/${(modal as Unit).id}`, values)
        setToast({ message: 'Unit updated', type: 'success' })
      }
      setModal(null)
      load()
    } catch (err: any) {
      setToast({ message: err.message, type: 'error' })
    }
  }

  const handleDelete = async () => {
    if (!deleting) return
    try {
      await api.delete(`/units/${deleting.id}`)
      setToast({ message: 'Unit deleted', type: 'success' })
      setDeleting(null)
      load()
    } catch (err: any) {
      setToast({ message: err.message, type: 'error' })
      setDeleting(null)
    }
  }

  return (
    <>
      <div className="flex justify-between items-center mb-6">
        <p className="text-sm text-text-3">Base units used across ingredients and recipes.</p>
        <button onClick={() => setModal('new')} className="btn-primary px-4 py-2 text-sm">
          + Add Base Unit
        </button>
      </div>

      {loading ? <Spinner /> : units.length === 0 ? (
        <EmptyState
          message="No base units yet. Add your first unit to get started."
          action={<button onClick={() => setModal('new')} className="btn-primary px-4 py-2 text-sm">Add Base Unit</button>}
        />
      ) : (
        <div className="bg-surface rounded-lg border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-200 border-b border-gray-300">
                <th className="text-left px-4 py-2.5 font-semibold text-text-2">Name</th>
                <th className="text-left px-4 py-2.5 font-semibold text-text-2">Abbreviation</th>
                <th className="text-left px-4 py-2.5 font-semibold text-text-2">Type</th>
                <th className="text-left px-4 py-2.5 font-semibold text-text-2">Default Recipe Unit</th>
                <th className="text-left px-4 py-2.5 font-semibold text-text-2">Conversion</th>
                <th className="w-20"/>
              </tr>
            </thead>
            <tbody>
              {units.map((unit, i) => (
                <tr key={unit.id} className={`border-b border-border last:border-0 hover:bg-surface-2 transition-colors ${i % 2 === 0 ? '' : 'bg-surface-2/50'}`}>
                  <td className="px-4 py-3 font-semibold text-text-1">{unit.name}</td>
                  <td className="px-4 py-3 font-mono text-text-2">{unit.abbreviation}</td>
                  <td className="px-4 py-3"><Badge label={unit.type} variant="neutral" /></td>
                  <td className="px-4 py-3 font-mono text-text-2">{unit.default_recipe_unit || <span className="text-text-3">—</span>}</td>
                  <td className="px-4 py-3 font-mono text-text-2 text-xs">
                    {unit.default_recipe_unit_conversion != null
                      ? <span title={`1 ${unit.default_recipe_unit || 'recipe unit'} = ${unit.default_recipe_unit_conversion} ${unit.abbreviation}`}>{unit.default_recipe_unit_conversion}</span>
                      : <span className="text-text-3">—</span>}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2 justify-end">
                      <button onClick={() => setModal(unit)} className="btn-ghost px-2 py-1 text-xs">Edit</button>
                      <button onClick={() => setDeleting(unit)} className="btn-ghost px-2 py-1 text-xs text-red-500 hover:text-red-600">Delete</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modal !== null && (
        <UnitModal
          unit={modal === 'new' ? null : modal as Unit}
          onSave={handleSave}
          onClose={() => setModal(null)}
        />
      )}

      {deleting && (
        <ConfirmDialog
          message={`Delete unit "${deleting.name}"? This may affect ingredients using this unit.`}
          onConfirm={handleDelete}
          onCancel={() => setDeleting(null)}
        />
      )}

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </>
  )
}

// ── Unit Modal ────────────────────────────────────────────────────────────────

function UnitModal({ unit, onSave, onClose }: {
  unit:    Unit | null
  onSave:  (v: Omit<Unit, 'id'>) => Promise<void>
  onClose: () => void
}) {
  const [name,       setName]       = useState(unit?.name || '')
  const [abbr,       setAbbr]       = useState(unit?.abbreviation || '')
  const [type,       setType]       = useState<Unit['type']>(unit?.type || 'mass')
  const [recipeUnit, setRecipeUnit] = useState(unit?.default_recipe_unit || '')
  const [conversion, setConversion] = useState(unit?.default_recipe_unit_conversion?.toString() || '')
  const [saving,     setSaving]     = useState(false)
  const [errors,     setErrors]     = useState<Record<string, string>>({})

  const validate = () => {
    const e: Record<string, string> = {}
    if (!name.trim()) e.name = 'Name is required'
    if (!abbr.trim()) e.abbr = 'Abbreviation is required'
    if (conversion && isNaN(parseFloat(conversion))) e.conversion = 'Must be a number'
    if (conversion && parseFloat(conversion) <= 0)   e.conversion = 'Must be greater than 0'
    return e
  }

  const handleSubmit = async () => {
    const e = validate()
    if (Object.keys(e).length) { setErrors(e); return }
    setSaving(true)
    await onSave({
      name:                           name.trim(),
      abbreviation:                   abbr.trim(),
      type,
      default_recipe_unit:            recipeUnit.trim() || null,
      default_recipe_unit_conversion: conversion ? parseFloat(conversion) : null,
    })
    setSaving(false)
  }

  return (
    <Modal title={unit ? 'Edit Unit' : 'Add Unit'} onClose={onClose}>
      <Field label="Name" required error={errors.name}>
        <input className="input" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Kilogram" autoFocus />
      </Field>
      <Field label="Abbreviation" required error={errors.abbr}>
        <input className="input" value={abbr} onChange={e => setAbbr(e.target.value)} placeholder="e.g. kg" />
      </Field>
      <Field label="Type" required>
        <select className="select" value={type} onChange={e => setType(e.target.value as Unit['type'])}>
          {UNIT_TYPES.map(t => <option key={t} value={t} className="capitalize">{t}</option>)}
        </select>
      </Field>
      <div className="border-t border-border pt-4 mt-2">
        <p className="text-xs text-text-3 mb-3">Default recipe unit — pre-filled when this base unit is selected on a new ingredient.</p>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Default Recipe Unit">
            <input className="input" value={recipeUnit} onChange={e => setRecipeUnit(e.target.value)}
              placeholder={`e.g. ${abbr || 'g'}`} />
          </Field>
          <Field label="Conversion to Base Unit" error={errors.conversion}
            hint={recipeUnit && abbr ? `1 ${recipeUnit} = ${conversion || '?'} ${abbr}` : undefined}>
            <input className="input font-mono" type="number" min="0.000001" step="any"
              value={conversion} onChange={e => setConversion(e.target.value)}
              placeholder="e.g. 0.001" />
          </Field>
        </div>
      </div>
      <div className="flex gap-3 justify-end pt-2">
        <button onClick={onClose} className="btn-ghost px-4 py-2 text-sm">Cancel</button>
        <button onClick={handleSubmit} disabled={saving} className="btn-primary px-4 py-2 text-sm disabled:opacity-60">
          {saving ? 'Saving…' : unit ? 'Save Changes' : 'Add Unit'}
        </button>
      </div>
    </Modal>
  )
}

// ── Price Levels Tab ──────────────────────────────────────────────────────────

function PriceLevelsTab() {
  const api = useApi()
  const [levels, setLevels]     = useState<PriceLevel[]>([])
  const [loading, setLoading]   = useState(true)
  const [modal, setModal]       = useState<PriceLevel | 'new' | null>(null)
  const [deleting, setDeleting] = useState<PriceLevel | null>(null)
  const [toast, setToast]       = useState<{ message: string; type: 'success' | 'error' } | null>(null)

  const load = useCallback(async () => {
    try {
      setLoading(true)
      setLevels(await api.get('/price-levels'))
    } finally {
      setLoading(false)
    }
  }, [api])

  useEffect(() => { load() }, [load])

  const handleSetDefault = async (level: PriceLevel) => {
    try {
      await api.post(`/price-levels/${level.id}/set-default`, {})
      setToast({ message: `"${level.name}" set as default`, type: 'success' })
      load()
    } catch (err: any) {
      setToast({ message: err.message, type: 'error' })
    }
  }

  const handleSave = async (values: Omit<PriceLevel, 'id'>) => {
    try {
      if (modal === 'new') {
        await api.post('/price-levels', values)
        setToast({ message: 'Price level added', type: 'success' })
      } else if (modal != null) {
        await api.put(`/price-levels/${(modal as PriceLevel).id}`, values)
        setToast({ message: 'Price level updated', type: 'success' })
      }
      setModal(null)
      load()
    } catch (err: any) {
      setToast({ message: err.message, type: 'error' })
    }
  }

  const handleDelete = async () => {
    if (!deleting) return
    try {
      await api.delete(`/price-levels/${deleting.id}`)
      setToast({ message: 'Price level deleted', type: 'success' })
      setDeleting(null)
      load()
    } catch (err: any) {
      setToast({ message: err.message, type: 'error' })
      setDeleting(null)
    }
  }

  return (
    <>
      <div className="flex justify-between items-center mb-6">
        <p className="text-sm text-text-3">Named price levels used across menus (e.g. Eat-in, Takeout, Delivery).</p>
        <button onClick={() => setModal('new')} className="btn-primary px-4 py-2 text-sm">+ Add Price Level</button>
      </div>

      {loading ? <Spinner /> : levels.length === 0 ? (
        <EmptyState
          message="No price levels yet."
          action={<button onClick={() => setModal('new')} className="btn-primary px-4 py-2 text-sm">Add Price Level</button>}
        />
      ) : (
        <div className="bg-surface rounded-lg border border-border overflow-hidden max-w-2xl">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-200 border-b border-gray-300">
                <th className="text-left px-4 py-2.5 font-semibold text-text-2">Name</th>
                <th className="text-left px-4 py-2.5 font-semibold text-text-2">Description</th>
                <th className="text-center px-4 py-2.5 font-semibold text-text-2 w-24">Default</th>
                <th className="w-20"/>
              </tr>
            </thead>
            <tbody>
              {levels.map(level => (
                <tr key={level.id} className="border-b border-border last:border-0 hover:bg-surface-2 transition-colors">
                  <td className="px-4 py-3 font-semibold text-text-1">
                    {level.name}
                  </td>
                  <td className="px-4 py-3 text-text-3">{level.description || '—'}</td>
                  <td className="px-4 py-3 text-center">
                    {level.is_default
                      ? <span title="Default level" className="text-yellow-500 text-lg">★</span>
                      : <button
                          onClick={() => handleSetDefault(level)}
                          title="Set as default"
                          className="text-gray-300 hover:text-yellow-400 text-lg transition-colors"
                        >☆</button>
                    }
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2 justify-end">
                      <button onClick={() => setModal(level)} className="btn-ghost px-2 py-1 text-xs">Edit</button>
                      <button onClick={() => setDeleting(level)} className="btn-ghost px-2 py-1 text-xs text-red-500">Delete</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modal !== null && (
        <PriceLevelModal
          level={modal === 'new' ? null : modal as PriceLevel}
          onSave={handleSave}
          onClose={() => setModal(null)}
        />
      )}

      {deleting && (
        <ConfirmDialog
          message={`Delete price level "${deleting.name}"?`}
          onConfirm={handleDelete}
          onCancel={() => setDeleting(null)}
        />
      )}

      {/* Per-country enablement matrix — lets admins hide specific price levels in specific markets */}
      <div className="mt-10">
        <CountryPriceLevelsMatrix />
      </div>

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </>
  )
}

// ── Country × Price-level enablement matrix ──────────────────────────────────
// Lets an admin disable a specific price level for a specific country. Every
// component that renders a country-scoped price list (Menus, Menu Engineer,
// Shared pages, POS tester, dashboard charts) respects this by calling
// GET /price-levels?country_id=X.

type CplRow = {
  country_id:       number
  country_name:     string
  price_level_id:   number
  price_level_name: string
  is_enabled:       boolean
}

function CountryPriceLevelsMatrix() {
  const api = useApi()
  const [rows, setRows]       = useState<CplRow[]>([])
  const [loading, setLoading] = useState(true)
  const [savingKey, setSavingKey] = useState<string | null>(null)
  const [toast, setToast]     = useState<{ message: string; type: 'success' | 'error' } | null>(null)

  const load = useCallback(async () => {
    try {
      setLoading(true)
      const data = await api.get('/country-price-levels') as CplRow[] | null
      setRows(data || [])
    } finally {
      setLoading(false)
    }
  }, [api])

  useEffect(() => { load() }, [load])

  async function toggle(countryId: number, levelId: number, next: boolean) {
    const key = `${countryId}-${levelId}`
    setSavingKey(key)
    // Optimistic update — revert if the server rejects.
    const prev = rows
    setRows(rows.map(r =>
      r.country_id === countryId && r.price_level_id === levelId
        ? { ...r, is_enabled: next }
        : r
    ))
    try {
      await api.put(`/country-price-levels/${countryId}/${levelId}`, { is_enabled: next })
    } catch (err: any) {
      setRows(prev)
      setToast({ message: err?.message || 'Failed to update', type: 'error' })
    } finally {
      setSavingKey(null)
    }
  }

  if (loading) return <Spinner />

  if (rows.length === 0) {
    return (
      <div className="text-sm text-text-3 p-4 bg-surface-2 rounded border border-border">
        Add a country and a price level first, then come back to toggle enablement.
      </div>
    )
  }

  // Pivot: unique countries down the rows, unique price levels across the columns.
  const countries = Array.from(
    new Map(rows.map(r => [r.country_id, { id: r.country_id, name: r.country_name }])).values()
  )
  const levels = Array.from(
    new Map(rows.map(r => [r.price_level_id, { id: r.price_level_id, name: r.price_level_name }])).values()
  )
  const byKey = new Map(rows.map(r => [`${r.country_id}-${r.price_level_id}`, r.is_enabled]))

  return (
    <div>
      <div className="mb-3">
        <h3 className="text-sm font-bold text-text-1">Per-country enablement</h3>
        <p className="text-xs text-text-3 mt-0.5">
          Uncheck a box to hide that price level from menus, scenarios and POS in the selected country.
          Existing prices are preserved — disabling simply hides the column until you re-enable it.
        </p>
      </div>

      <div className="bg-surface rounded-lg border border-border overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-200 border-b border-gray-300">
              <th className="text-left px-4 py-2.5 font-semibold text-text-2 sticky left-0 bg-gray-200">Country</th>
              {levels.map(l => (
                <th key={l.id} className="text-center px-4 py-2.5 font-semibold text-text-2 whitespace-nowrap">{l.name}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {countries.map(c => (
              <tr key={c.id} className="border-b border-border last:border-0 hover:bg-surface-2">
                <td className="px-4 py-2 font-medium text-text-1 sticky left-0 bg-surface">{c.name}</td>
                {levels.map(l => {
                  const key = `${c.id}-${l.id}`
                  const checked = byKey.get(key) ?? true
                  const saving = savingKey === key
                  return (
                    <td key={l.id} className="px-4 py-2 text-center">
                      <label className={`inline-flex items-center justify-center ${saving ? 'opacity-50' : 'cursor-pointer'}`}>
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={saving}
                          onChange={e => toggle(c.id, l.id, e.target.checked)}
                          className="w-4 h-4 accent-accent"
                        />
                      </label>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  )
}

// ── Price Level Modal ─────────────────────────────────────────────────────────

function PriceLevelModal({ level, onSave, onClose }: {
  level:   PriceLevel | null
  onSave:  (v: Omit<PriceLevel, 'id'>) => Promise<void>
  onClose: () => void
}) {
  const [name,       setName]      = useState(level?.name || '')
  const [desc,       setDesc]      = useState(level?.description || '')
  const [isDefault,  setIsDefault] = useState(level?.is_default || false)
  const [saving,     setSaving]    = useState(false)
  const [error,      setError]     = useState('')

  const handleSubmit = async () => {
    if (!name.trim()) { setError('Name is required'); return }
    setSaving(true)
    await onSave({ name: name.trim(), description: desc.trim() || null, is_default: isDefault })
    setSaving(false)
  }

  return (
    <Modal title={level ? 'Edit Price Level' : 'Add Price Level'} onClose={onClose}>
      <Field label="Name" required error={error}>
        <input className="input" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Eat-in" autoFocus />
      </Field>
      <Field label="Description">
        <input className="input" value={desc} onChange={e => setDesc(e.target.value)} placeholder="Optional description" />
      </Field>
      <Field label="Default level">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={isDefault}
            onChange={e => setIsDefault(e.target.checked)}
            className="w-4 h-4 accent-yellow-500"
          />
          <span className="text-sm text-text-2">Use as the default price level across menus</span>
        </label>
      </Field>
      <div className="flex gap-3 justify-end pt-2">
        <button onClick={onClose} className="btn-ghost px-4 py-2 text-sm">Cancel</button>
        <button onClick={handleSubmit} disabled={saving} className="btn-primary px-4 py-2 text-sm disabled:opacity-60">
          {saving ? 'Saving…' : level ? 'Save Changes' : 'Add Price Level'}
        </button>
      </div>
    </Modal>
  )
}

// ── Exchange Rates Tab ────────────────────────────────────────────────────────

// ── Currency Tab (Base Currency + Exchange Rates) ─────────────────────────────

function CurrencyTab() {
  const api = useApi()

  // ── Base currency form ─────────────────────────────────────────────────────
  const [loading, setLoading]   = useState(true)
  const [saving, setSaving]     = useState(false)
  const [currToast, setCurrToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null)
  const [form, setForm]         = useState({ code: 'USD', symbol: '$', name: 'US Dollar' })
  const [errors, setErrors]     = useState<Partial<typeof form>>({})

  // ── Exchange rate sync ────────────────────────────────────────────────────
  const [syncing, setSyncing]   = useState(false)
  const [syncResult, setSyncResult] = useState<{ synced_at: string; base: string; updated: { currency_code: string; rate: number }[] } | null>(null)
  const [syncError, setSyncError]   = useState('')

  useEffect(() => {
    api.get('/settings')
      .then((s: AppSettings) => {
        if (s?.base_currency) {
          setForm({
            code:   s.base_currency.code   || 'USD',
            symbol: s.base_currency.symbol || '$',
            name:   s.base_currency.name   || 'US Dollar',
          })
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [api])

  function validate() {
    const e: Partial<typeof form> = {}
    if (!form.code.trim())   e.code   = 'Required'
    if (!form.symbol.trim()) e.symbol = 'Required'
    if (!form.name.trim())   e.name   = 'Required'
    setErrors(e)
    return Object.keys(e).length === 0
  }

  async function handleSave() {
    if (!validate()) return
    setSaving(true)
    try {
      await api.patch('/settings', {
        base_currency: {
          code:   form.code.toUpperCase().trim(),
          symbol: form.symbol.trim(),
          name:   form.name.trim(),
        }
      })
      setCurrToast({ message: 'Base currency saved', type: 'success' })
    } catch (err: any) {
      setCurrToast({ message: err.message || 'Save failed', type: 'error' })
    } finally {
      setSaving(false)
    }
  }

  async function handleSync() {
    setSyncing(true)
    setSyncError('')
    setSyncResult(null)
    try {
      const data = await api.post('/sync-exchange-rates', {})
      setSyncResult(data)
    } catch (err: any) {
      setSyncError(err.message)
    } finally {
      setSyncing(false)
    }
  }

  if (loading) return <Spinner />

  return (
    <div className="max-w-xl space-y-8">

      {/* ── Section 1: Base Currency ────────────────────────────────────────── */}
      <div>
        <h2 className="text-base font-bold text-text-1 mb-1">Base Currency</h2>
        <p className="text-sm text-text-3 mb-4">
          All costs are stored and compared in this currency internally, then converted to each
          country's local currency for display.
        </p>

        {/* Live preview */}
        <div className="flex items-center gap-4 bg-surface-2 border border-border rounded-xl px-5 py-4 mb-5">
          <div className="w-12 h-12 rounded-lg bg-accent-dim flex items-center justify-center text-accent text-xl font-bold shrink-0">
            {form.symbol || '$'}
          </div>
          <div>
            <div className="font-extrabold text-text-1 text-base">{form.name || 'Currency Name'}</div>
            <div className="font-mono text-sm text-text-3 mt-0.5">{form.code?.toUpperCase() || 'CODE'}</div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4 mb-4">
          <Field label="Currency Code" required error={errors.code}>
            <input
              className="input w-full"
              value={form.code}
              onChange={e => setForm(f => ({ ...f, code: e.target.value.toUpperCase() }))}
              placeholder="USD"
              maxLength={10}
            />
            <p className="text-xs text-text-3 mt-1">ISO 4217 — USD, GBP, EUR…</p>
          </Field>
          <Field label="Symbol" required error={errors.symbol}>
            <input
              className="input w-full"
              value={form.symbol}
              onChange={e => setForm(f => ({ ...f, symbol: e.target.value }))}
              placeholder="$"
              maxLength={10}
            />
          </Field>
        </div>
        <Field label="Display Name" required error={errors.name}>
          <input
            className="input w-full"
            value={form.name}
            onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
            placeholder="US Dollar"
          />
        </Field>
        <div className="flex justify-end pt-2">
          <button className="btn-primary px-5 py-2 text-sm" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : 'Save Currency'}
          </button>
        </div>
        {currToast && <Toast message={currToast.message} type={currToast.type} onClose={() => setCurrToast(null)} />}
      </div>

      {/* ── Section 2: Exchange Rates ────────────────────────────────────────── */}
      <div className="border-t border-border pt-6">
        <h2 className="text-base font-bold text-text-1 mb-1">Exchange Rates</h2>
        <p className="text-sm text-text-3 mb-4">
          Fetch the latest rates from the Frankfurter API (free, no key required).
          Rates are calculated relative to <span className="font-mono font-bold text-text-1">{form.code || 'USD'}</span> and
          stored on each country for cross-market COGS calculations.
        </p>

        <div className="bg-surface rounded-lg border border-border p-5">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h3 className="font-semibold text-text-1 text-sm">Frankfurter API</h3>
              <p className="text-xs text-text-3 mt-0.5">api.frankfurter.app — free, no API key required</p>
            </div>
            <button
              onClick={handleSync}
              disabled={syncing}
              className="btn-primary px-4 py-2 text-sm disabled:opacity-60"
            >
              {syncing ? (
                <span className="flex items-center gap-2">
                  <span className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin"/>
                  Syncing…
                </span>
              ) : '↻ Sync Rates'}
            </button>
          </div>

          {syncError && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-600">{syncError}</div>
          )}

          {syncResult && (
            <div className="mt-3">
              <p className="text-xs text-text-3 mb-3">
                Synced at {new Date(syncResult.synced_at).toLocaleString()} — {syncResult.updated.length} countries updated
                {syncResult.base && (
                  <span className="ml-2 font-mono text-accent font-semibold">(base: {syncResult.base})</span>
                )}
              </p>
              <div className="grid grid-cols-3 gap-2">
                {syncResult.updated.map(r => (
                  <div key={r.currency_code} className="flex justify-between items-center bg-surface-2 rounded px-3 py-2 text-sm">
                    <span className="font-semibold text-text-1">{r.currency_code}</span>
                    <span className="font-mono text-text-3">{r.rate.toFixed(4)}</span>
                  </div>
                ))}
              </div>
              {syncResult.updated.length === 0 && (
                <p className="text-sm text-text-3 italic">No countries with matching currencies found. Add countries first.</p>
              )}
            </div>
          )}
        </div>
      </div>

    </div>
  )
}

// ── COGS Thresholds Tab ───────────────────────────────────────────────────────

function ThresholdsTab() {
  const api = useApi()
  const [loading, setLoading]     = useState(true)
  const [saving, setSaving]       = useState(false)
  const [toast, setToast]         = useState<{ message: string; type: 'success' | 'error' } | null>(null)
  const [excellent, setExcellent]   = useState(28)
  const [acceptable, setAcceptable] = useState(35)
  const [targetCogs, setTargetCogs] = useState('')
  const [costingMethod, setCostingMethod] = useState<CostingMethod>('best')

  useEffect(() => {
    api.get('/settings')
      .then((s: AppSettings) => {
        if (s?.cogs_thresholds) {
          setExcellent(s.cogs_thresholds.excellent  ?? 28)
          setAcceptable(s.cogs_thresholds.acceptable ?? 35)
        }
        if (s?.target_cogs != null) setTargetCogs(String(s.target_cogs))
        if (s?.costing_method === 'average' || s?.costing_method === 'best') {
          setCostingMethod(s.costing_method)
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [api])

  async function handleSave() {
    if (excellent >= acceptable) {
      setToast({ message: 'Excellent threshold must be lower than Acceptable', type: 'error' })
      return
    }
    setSaving(true)
    try {
      await api.patch('/settings', {
        cogs_thresholds: { excellent, acceptable },
        target_cogs: targetCogs ? Number(targetCogs) : null,
        costing_method: costingMethod,
      })
      setToast({ message: 'Saved', type: 'success' })
    } catch (err: any) {
      setToast({ message: err.message || 'Save failed', type: 'error' })
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <Spinner />

  return (
    <div className="max-w-lg">
      <div className="mb-6">
        <h2 className="text-base font-bold text-text-1 mb-1">COGS % Thresholds</h2>
        <p className="text-sm text-text-3">
          Define the boundaries for colour-coded COGS status badges across all menus.
        </p>
      </div>

      <div className="bg-surface border border-border rounded-xl overflow-hidden mb-6">

        <div className="flex items-center gap-4 px-5 py-4 border-b border-border">
          <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-bold bg-accent-dim text-accent w-24 justify-center shrink-0">
            Excellent
          </span>
          <span className="text-sm text-text-3 shrink-0">COGS ≤</span>
          <input
            type="number"
            className="input w-20 text-center font-mono"
            min={1} max={99} step={1}
            value={excellent}
            onChange={e => setExcellent(Number(e.target.value))}
          />
          <span className="text-sm text-text-3">%</span>
        </div>

        <div className="flex items-center gap-4 px-5 py-4 border-b border-border">
          <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-bold bg-yellow-50 text-yellow-700 w-24 justify-center shrink-0">
            Acceptable
          </span>
          <span className="text-sm text-text-3 shrink-0">COGS ≤</span>
          <input
            type="number"
            className="input w-20 text-center font-mono"
            min={1} max={99} step={1}
            value={acceptable}
            onChange={e => setAcceptable(Number(e.target.value))}
          />
          <span className="text-sm text-text-3">%</span>
        </div>

        <div className="flex items-center gap-4 px-5 py-4">
          <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-bold bg-red-50 text-red-600 w-24 justify-center shrink-0">
            Review
          </span>
          <span className="text-sm text-text-3 shrink-0">COGS &gt;</span>
          <span className="font-mono font-bold text-text-1 w-20 text-center">{acceptable}%</span>
          <span className="text-xs text-text-3">(auto)</span>
        </div>

      </div>

      <Field label="Target COGS % (company-wide)">
        <input
          type="number"
          className="input w-32 font-mono"
          min={1} max={99} step={0.5}
          value={targetCogs}
          onChange={e => setTargetCogs(e.target.value)}
          placeholder="e.g. 28"
        />
        <p className="text-xs text-text-3 mt-1">Used for benchmark line on dashboard charts.</p>
      </Field>

      {/* ── Recipe Costing Method ─────────────────────────────────────────── */}
      <div className="mt-8 mb-2">
        <h2 className="text-base font-bold text-text-1 mb-1">Recipe Costing Method</h2>
        <p className="text-sm text-text-3">
          How ingredient cost is resolved when an ingredient has <strong>no preferred vendor</strong> set for a market.
          Preferred vendor quotes always take priority and are unaffected by this setting.
        </p>
      </div>

      <div className="bg-surface border border-border rounded-xl overflow-hidden mb-6">
        <label className={`flex items-start gap-3 px-5 py-4 border-b border-border cursor-pointer hover:bg-surface-2 ${costingMethod === 'best' ? 'bg-accent-dim/40' : ''}`}>
          <input
            type="radio"
            name="costing-method"
            value="best"
            checked={costingMethod === 'best'}
            onChange={() => setCostingMethod('best')}
            className="mt-1 accent-[#146A34]"
          />
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-text-1">Best price quote</span>
              <span className="text-[10px] font-bold text-text-3 bg-surface-2 border border-border rounded px-1.5 py-0.5 uppercase tracking-wide">Default</span>
            </div>
            <p className="text-xs text-text-3 mt-0.5">Use the cheapest active quote in the market. Optimistic view — reflects best-case sourcing.</p>
          </div>
        </label>

        <label className={`flex items-start gap-3 px-5 py-4 cursor-pointer hover:bg-surface-2 ${costingMethod === 'average' ? 'bg-accent-dim/40' : ''}`}>
          <input
            type="radio"
            name="costing-method"
            value="average"
            checked={costingMethod === 'average'}
            onChange={() => setCostingMethod('average')}
            className="mt-1 accent-[#146A34]"
          />
          <div className="flex-1">
            <span className="text-sm font-semibold text-text-1">Market amalgamated quote</span>
            <p className="text-xs text-text-3 mt-0.5">
              Use the arithmetic mean of all active quotes in the market. Blended view —
              useful when ingredients are sourced from multiple vendors and no single
              vendor is clearly preferred.
            </p>
          </div>
        </label>
      </div>

      <div className="flex justify-end pt-2">
        <button className="btn-primary px-5 py-2 text-sm" onClick={handleSave} disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  )
}

// ── Test Data Tab ─────────────────────────────────────────────────────────────

function TestDataTab() {
  const api = useApi()
  const [loading,       setLoading]       = useState(false)
  const [log,           setLog]           = useState<string[]>([])
  const [confirmAction, setConfirmAction] = useState<'seed' | 'seed-small' | 'clear' | 'defaults' | null>(null)
  const [toast,         setToast]         = useState<{ message: string; type: 'success' | 'error' } | null>(null)

  async function handleSeed() {
    setConfirmAction(null)
    setLoading(true)
    setLog(['Clearing existing data…', 'Seeding full test data (1,000 ingredients) — please wait…'])
    try {
      const result = await api.post('/seed', {})
      setLog(result.log || [])
      setToast({ message: 'Full test data loaded successfully', type: 'success' })
    } catch (err: any) {
      setLog(prev => [...prev, `Error: ${err.message}`])
      setToast({ message: err.message || 'Failed to load test data', type: 'error' })
    } finally {
      setLoading(false)
    }
  }

  async function handleSeedSmall() {
    setConfirmAction(null)
    setLoading(true)
    setLog(['Clearing existing data…', 'Seeding small test data (200 ingredients) — please wait…'])
    try {
      const result = await api.post('/seed/small', {})
      setLog(result.log || [])
      setToast({ message: 'Small test data loaded successfully', type: 'success' })
    } catch (err: any) {
      setLog(prev => [...prev, `Error: ${err.message}`])
      setToast({ message: err.message || 'Failed to load small test data', type: 'error' })
    } finally {
      setLoading(false)
    }
  }

  async function handleClear() {
    setConfirmAction(null)
    setLoading(true)
    setLog(['Clearing all data…'])
    try {
      const result = await api.post('/seed/clear', {})
      setLog(result.log || ['All data cleared.'])
      setToast({ message: 'Database cleared', type: 'success' })
    } catch (err: any) {
      setLog(prev => [...prev, `Error: ${err.message}`])
      setToast({ message: err.message || 'Failed to clear data', type: 'error' })
    } finally {
      setLoading(false)
    }
  }

  async function handleDefaults() {
    setConfirmAction(null)
    setLoading(true)
    setLog(['Loading default data…'])
    try {
      const result = await api.post('/seed/defaults', {})
      setLog(result.log || ['Default data loaded.'])
      setToast({ message: 'Default data loaded successfully', type: 'success' })
    } catch (err: any) {
      setLog(prev => [...prev, `Error: ${err.message}`])
      setToast({ message: err.message || 'Failed to load default data', type: 'error' })
    } finally {
      setLoading(false)
    }
  }

  const SEED_SUMMARY = [
    ['4',     'Countries with realistic tax rates per level'],
    ['3',     'Price Levels (Eat-In, Takeaway, Delivery)'],
    ['10',    'Vendors + 3 Brand Partners'],
    ['1,000', 'Ingredients across 12 categories with allergen tags'],
    ['500',   'Price Quotes'],
    ['48',    'Recipes with ingredient line items'],
    ['4',     'Menus — items priced across all price levels'],
    ['12',    'Sales Items (incl. 1 combo meal deal)'],
    ['2',     'Modifier Groups (Extras, Dip Choice)'],
  ]

  const SMALL_SEED_SUMMARY = [
    ['4',   'Countries with realistic tax rates per level'],
    ['3',   'Price Levels (Eat-In, Takeaway, Delivery)'],
    ['10',  'Vendors + 3 Brand Partners'],
    ['200', 'Ingredients across 12 categories with allergen tags'],
    ['400', 'Price Quotes (2 per ingredient)'],
    ['48',  'Recipes with ingredient line items'],
    ['4',   'Menus — items priced across all price levels'],
    ['12',  'Sales Items (incl. 1 combo meal deal)'],
    ['2',   'Modifier Groups (Extras, Dip Choice)'],
  ]

  return (
    <div className="max-w-2xl">
      <div className="mb-6">
        <h2 className="text-base font-bold text-text-1 mb-1">Test Data</h2>
        <p className="text-sm text-text-3">
          Load a full set of realistic dummy data to explore and test the app, or wipe the database to start fresh.
          All operations run inside a transaction and roll back on error.
        </p>
      </div>

      {/* Load Test Data card */}
      <div className="bg-surface border border-border rounded-xl p-5 mb-4">
        <div className="flex items-start justify-between gap-6">
          <div className="flex-1">
            <h3 className="font-bold text-text-1 mb-2">Load Test Data</h3>
            <p className="text-xs text-text-3 mb-3">
              Clears <strong>all existing data</strong> first, then inserts:
            </p>
            <div className="grid grid-cols-2 gap-x-6 gap-y-1">
              {SEED_SUMMARY.map(([n, label]) => (
                <div key={label} className="flex items-center gap-1.5 text-sm text-text-2">
                  <span className="font-mono font-bold text-accent w-12 shrink-0 text-right">{n}</span>
                  <span className="text-text-3">{label}</span>
                </div>
              ))}
            </div>
          </div>
          <button
            onClick={() => setConfirmAction('seed')}
            disabled={loading}
            className="btn-primary px-4 py-2 text-sm whitespace-nowrap shrink-0 disabled:opacity-60"
          >
            {loading ? (
              <span className="flex items-center gap-2">
                <span className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                Running…
              </span>
            ) : 'Load Test Data'}
          </button>
        </div>
      </div>

      {/* Load Small Test Data card */}
      <div className="bg-surface border border-border rounded-xl p-5 mb-4">
        <div className="flex items-start justify-between gap-6">
          <div className="flex-1">
            <h3 className="font-bold text-text-1 mb-2">Load Small Test Data</h3>
            <p className="text-xs text-text-3 mb-3">
              Faster reset for development — clears <strong>all existing data</strong> first, then inserts:
            </p>
            <div className="grid grid-cols-2 gap-x-6 gap-y-1">
              {SMALL_SEED_SUMMARY.map(([n, label]) => (
                <div key={label} className="flex items-center gap-1.5 text-sm text-text-2">
                  <span className="font-mono font-bold text-accent w-12 shrink-0 text-right">{n}</span>
                  <span className="text-text-3">{label}</span>
                </div>
              ))}
            </div>
          </div>
          <button
            onClick={() => setConfirmAction('seed-small')}
            disabled={loading}
            className="btn-outline px-4 py-2 text-sm whitespace-nowrap shrink-0 disabled:opacity-60"
          >
            {loading ? (
              <span className="flex items-center gap-2">
                <span className="w-3.5 h-3.5 border-2 border-accent/40 border-t-accent rounded-full animate-spin" />
                Running…
              </span>
            ) : 'Load Small Data'}
          </button>
        </div>
      </div>

      {/* Clear All Data card */}
      <div className="bg-surface border border-red-200 rounded-xl p-5 mb-4">
        <div className="flex items-start justify-between gap-6">
          <div>
            <h3 className="font-bold text-red-600 mb-1">Clear All Data</h3>
            <p className="text-sm text-text-3">
              Permanently removes all rows from every table. The schema and table structure are preserved.
              This cannot be undone.
            </p>
          </div>
          <button
            onClick={() => setConfirmAction('clear')}
            disabled={loading}
            className="btn-danger px-4 py-2 text-sm whitespace-nowrap shrink-0 disabled:opacity-60"
          >
            Clear Database
          </button>
        </div>
      </div>

      {/* Load Default Data card */}
      <div className="bg-surface border border-border rounded-xl p-5 mb-6">
        <div className="flex items-start justify-between gap-6">
          <div className="flex-1">
            <h3 className="font-bold text-text-1 mb-2">Load Default Data</h3>
            <p className="text-xs text-text-3 mb-3">
              Adds a minimal, production-ready starting point. Safe to run after{' '}
              <strong>Clear Database</strong> — does not wipe existing data first.
            </p>
            <div className="grid grid-cols-2 gap-x-6 gap-y-1">
              {[
                ['1', 'Market — United Kingdom (GBP)'],
                ['1', 'Brand — Default Brand'],
                ['1', 'Location — Default Location'],
                ['3', 'Units — Kilogram, Litre, Each'],
                ['6', 'Categories — Food, Beverage, Other × 2 types'],
                ['1', 'Price Level — Default (is_default)'],
                ['1', 'Vendor — Default Vendor'],
                ['3', 'UK Tax Rates — 20%, 5%, 0% VAT'],
                ['1', 'Standard VAT → Default price level'],
              ].map(([n, label]) => (
                <div key={label} className="flex items-center gap-1.5 text-sm text-text-2">
                  <span className="font-mono font-bold text-accent w-12 shrink-0 text-right">{n}</span>
                  <span className="text-text-3">{label}</span>
                </div>
              ))}
            </div>
            <p className="text-xs text-text-3 mt-3 italic">No recipes or price quotes are created — those are entered by you.</p>
          </div>
          <button
            onClick={() => setConfirmAction('defaults')}
            disabled={loading}
            className="btn-outline px-4 py-2 text-sm whitespace-nowrap shrink-0 disabled:opacity-60"
          >
            {loading ? (
              <span className="flex items-center gap-2">
                <span className="w-3.5 h-3.5 border-2 border-accent/40 border-t-accent rounded-full animate-spin" />
                Running…
              </span>
            ) : 'Load Defaults'}
          </button>
        </div>
      </div>

      {/* Log output panel */}
      {log.length > 0 && (
        <div className="bg-gray-950 rounded-lg p-4 font-mono text-xs text-green-400 max-h-56 overflow-y-auto space-y-0.5">
          {loading && (
            <div className="flex items-center gap-2 text-green-300 mb-1">
              <span className="w-3 h-3 border-2 border-green-400/40 border-t-green-400 rounded-full animate-spin inline-block" />
              Working…
            </div>
          )}
          {log.map((line, i) => (
            <div key={i} className={line.startsWith('Error') ? 'text-red-400' : ''}>{line}</div>
          ))}
        </div>
      )}

      {/* Confirm — seed (full) */}
      {confirmAction === 'seed' && (
        <DateConfirmDialog
          title="Load full test data?"
          message={
            <>
              This will <strong>DELETE all existing data</strong> and load the full test dataset
              (1,000 ingredients, 48 recipes, sales items, modifiers, combos, and 4 menus).
              This cannot be undone.
            </>
          }
          confirmLabel="Wipe & load test data"
          onConfirm={handleSeed}
          onCancel={() => setConfirmAction(null)}
        />
      )}

      {/* Confirm — seed (small) */}
      {confirmAction === 'seed-small' && (
        <DateConfirmDialog
          title="Load small test data?"
          message={
            <>
              This will <strong>DELETE all existing data</strong> and load the small test dataset
              (200 ingredients, 400 quotes, 48 recipes, sales items, modifiers, combos, and 4 menus).
              This cannot be undone.
            </>
          }
          confirmLabel="Wipe & load small data"
          onConfirm={handleSeedSmall}
          onCancel={() => setConfirmAction(null)}
        />
      )}

      {/* Confirm — clear */}
      {confirmAction === 'clear' && (
        <DateConfirmDialog
          title="Clear entire database?"
          message={
            <>
              This will <strong>permanently DELETE ALL DATA</strong> from every operational table.
              The schema is preserved but every record will be gone. This cannot be undone.
            </>
          }
          confirmLabel="Clear database"
          onConfirm={handleClear}
          onCancel={() => setConfirmAction(null)}
        />
      )}

      {/* Confirm — defaults */}
      {confirmAction === 'defaults' && (
        <DateConfirmDialog
          title="Load default data?"
          message={
            <>
              This will insert default data (UK market, 3 units, categories, price level, vendor,
              tax rates) into the current database <strong>without clearing existing records</strong>.
              Existing rows may end up alongside the defaults.
            </>
          }
          confirmLabel="Load defaults"
          danger={false}
          onConfirm={handleDefaults}
          onCancel={() => setConfirmAction(null)}
        />
      )}

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  )
}

// ── AI Integration Tab ────────────────────────────────────────────────────────

interface AiKeyStatus {
  anthropic_key_set:   boolean
  voyage_key_set:      boolean
  brave_key_set:       boolean
  claude_code_key_set: boolean
  github_pat_set:      boolean
  github_repo_set:     boolean
  jira_base_url_set:   boolean
  jira_email_set:      boolean
  jira_token_set:      boolean
  jira_project_set:    boolean
  mapbox_token_set:    boolean
  openai_key_set:      boolean
}

interface UsageSummary {
  total_turns: number
  total_sessions: number
  total_users: number
  tokens_in: number
  tokens_out: number
  tokens_total: number
  cost_usd: number
  first_turn: string | null
  last_turn: string | null
}
interface UsageDaily { day: string; turns: number; tokens_in: number; tokens_out: number; cost_usd: number }
interface UsageUser  { user: string; turns: number; tokens_in: number; tokens_out: number; period_tokens: number; cost_usd: number; last_active: string }
interface UsageData  { summary: UsageSummary; daily: UsageDaily[]; by_user: UsageUser[]; monthly_limit: number; period_start: string; next_reset: string }

// ── Storage Tab ───────────────────────────────────────────────────────────────

interface StorageCfg {
  type:          'local' | 's3'
  s3_bucket?:    string
  s3_region?:    string
  s3_access_key?: string
  s3_secret_key?: string
  s3_base_url?:  string
}

function FixLocalUrlsButton() {
  const api = useApi()
  const [running, setRunning] = useState(false)
  const [result,  setResult]  = useState<{ fixed: number; total: number } | null>(null)
  const [error,   setError]   = useState<string | null>(null)

  const run = async () => {
    setRunning(true); setResult(null); setError(null)
    try {
      const data = await api.post('/media/fix-local-urls', {})
      setResult(data)
    } catch (e: any) {
      setError(e.message || 'Request failed')
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="flex items-center gap-3 flex-wrap">
      <button className="btn-outline px-4 text-sm" onClick={run} disabled={running}>
        {running ? 'Fixing…' : '🔧 Fix Image URLs'}
      </button>
      {result && (
        <span className="text-xs font-medium" style={{ color: 'var(--accent)' }}>
          ✅ Fixed {result.fixed} of {result.total} local items
        </span>
      )}
      {error && (
        <span className="text-xs font-medium text-red-600">{error}</span>
      )}
    </div>
  )
}

function StorageTab() {
  const api                 = useApi()
  const [loading, setLoading] = useState(true)
  const [saving,  setSaving]  = useState(false)
  const [toast,   setToast]   = useState<{ msg: string; type?: 'success' | 'error' } | null>(null)
  const [cfg,     setCfg]     = useState<StorageCfg>({ type: 'local' })
  const [migrating,   setMigrating]   = useState(false)
  const [migrateLog,  setMigrateLog]  = useState<string[]>([])
  const [migrateDone, setMigrateDone] = useState(false)
  const [showSecret, setShowSecret] = useState(false)

  useEffect(() => {
    api.get('/settings').then((s: Record<string, unknown>) => {
      if (s?.storage) setCfg(s.storage as StorageCfg)
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [api])

  async function save() {
    setSaving(true)
    try {
      await api.patch('/settings', { storage: cfg })
      setToast({ msg: 'Storage settings saved' })
    } catch {
      setToast({ msg: 'Save failed', type: 'error' })
    } finally {
      setSaving(false)
    }
  }

  const set = (k: keyof StorageCfg) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setCfg(prev => ({ ...prev, [k]: e.target.value } as StorageCfg))

  const startMigration = async () => {
    setMigrating(true)
    setMigrateLog([])
    setMigrateDone(false)
    try {
      const res = await fetch(`${import.meta.env.VITE_API_URL || '/api'}/media/migrate-to-s3`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
      })
      if (!res.body) { setMigrateLog(['No response stream']); return }
      const reader = res.body.getReader()
      const dec    = new TextDecoder()
      let buf      = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += dec.decode(value, { stream: true })
        const lines = buf.split('\n')
        buf = lines.pop() || ''
        for (const line of lines) {
          if (!line.startsWith('data:')) continue
          try {
            const d = JSON.parse(line.slice(5).trim())
            if (d.complete)    { setMigrateDone(true); setMigrateLog(p => [...p, `✅ Migration complete — ${d.migrated} items migrated`]) }
            else if (d.error)       setMigrateLog(p => [...p, `❌ ${d.error}`])
            else if (d.error_item)  setMigrateLog(p => [...p, `⚠ Item ${d.error_item}: ${d.reason}`])
            else if (d.skip)        setMigrateLog(p => [...p, `⏭ Item ${d.skip} skipped: ${d.reason}`])
            else if (d.done != null) setMigrateLog(p => [...p, `[${d.done}/${d.total}] ${d.filename}`])
            else if (d.message)     setMigrateLog(p => [...p, d.message])
          } catch { /* ignore malformed lines */ }
        }
      }
    } catch (e: unknown) {
      setMigrateLog(p => [...p, `Error: ${e instanceof Error ? e.message : String(e)}`])
    } finally {
      setMigrating(false)
    }
  }

  if (loading) return <Spinner />

  return (
    <div className="max-w-xl space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-text-1 mb-1">Image Storage</h2>
        <p className="text-sm text-text-3">Where uploaded images (ingredients, recipes, menu items) are stored.</p>
      </div>

      {/* Storage type */}
      <div className="card p-4 space-y-3">
        <Field label="Storage Type">
          <div className="flex gap-3">
            {(['local', 's3'] as const).map(t => (
              <label key={t} className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="storage_type"
                  value={t}
                  checked={cfg.type === t}
                  onChange={() => setCfg(prev => ({ ...prev, type: t }))}
                  className="accent-accent"
                />
                <span className="text-sm font-medium text-text-1">
                  {t === 'local' ? '📁 Local server disk' : '☁️ Amazon S3'}
                </span>
              </label>
            ))}
          </div>
        </Field>

        {cfg.type === 'local' && (
          <p className="text-xs text-text-3 bg-surface-2 rounded-lg px-3 py-2">
            Images are stored in <code className="font-mono text-xs">/uploads/</code> on the server.
            No additional configuration needed. For production use on multiple servers, S3 is recommended.
          </p>
        )}
      </div>

      {/* S3 fields */}
      {cfg.type === 's3' && (
        <div className="card p-4 space-y-4">
          <p className="text-xs text-text-3 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2 text-blue-700">
            Create an IAM user with <code className="font-mono text-xs">s3:PutObject</code> permission on your bucket.
            Access keys are stored encrypted in the database.
          </p>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Bucket Name" required>
              <input className="input" value={cfg.s3_bucket || ''} onChange={set('s3_bucket')} placeholder="my-cogs-images" />
            </Field>
            <Field label="Region">
              <input className="input" value={cfg.s3_region || ''} onChange={set('s3_region')} placeholder="us-east-1" />
            </Field>
          </div>
          <Field label="Access Key ID" required>
            <input className="input font-mono text-sm" value={cfg.s3_access_key || ''} onChange={set('s3_access_key')} placeholder="AKIAIOSFODNN7EXAMPLE" autoComplete="off" />
          </Field>
          <Field label="Secret Access Key" required>
            <div className="relative">
              <input
                className="input font-mono text-sm pr-10"
                type={showSecret ? 'text' : 'password'}
                value={cfg.s3_secret_key || ''}
                onChange={set('s3_secret_key')}
                placeholder="wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"
                autoComplete="new-password"
              />
              <button
                type="button"
                className="absolute right-2 top-1/2 -translate-y-1/2 text-text-3 hover:text-text-1"
                onClick={() => setShowSecret(v => !v)}
              >{showSecret ? '🙈' : '👁️'}</button>
            </div>
          </Field>
          <Field label="Custom Base URL" >
            <input className="input" value={cfg.s3_base_url || ''} onChange={set('s3_base_url')} placeholder="https://cdn.example.com (optional)" />
            <p className="text-xs text-text-3 mt-1">Leave blank to use the default S3 URL. Set this if you use CloudFront or a custom domain.</p>
          </Field>
        </div>
      )}

      <button className="btn-primary px-5 py-2 text-sm" onClick={save} disabled={saving}>
        {saving ? 'Saving…' : 'Save Storage Settings'}
      </button>

      {toast && <Toast message={toast.msg} type={toast.type} onClose={() => setToast(null)} />}

      {/* Fix-local-URLs — one-shot migration for images stored with old absolute URLs */}
      <div className="mt-6 pt-6 border-t" style={{ borderColor: 'var(--border)' }}>
        <h4 className="font-semibold text-sm mb-1" style={{ color: 'var(--text-1)' }}>Fix Image URLs</h4>
        <p className="text-xs mb-3" style={{ color: 'var(--text-3)' }}>
          If images in the Media Library show as broken (e.g. after a domain change), click this to rewrite
          all locally-stored image paths to the current format. Safe to run multiple times.
        </p>
        <FixLocalUrlsButton />
      </div>

      {cfg.type === 's3' && cfg.s3_bucket && (
        <div className="mt-6 pt-6 border-t" style={{ borderColor: 'var(--border)' }}>
          <h4 className="font-semibold text-sm mb-2" style={{ color: 'var(--text-1)' }}>Migrate existing files to S3</h4>
          <p className="text-xs mb-3" style={{ color: 'var(--text-3)' }}>
            Moves all locally-stored media library items to S3. New uploads already go to S3 once the settings above are saved.
            This is a one-time operation for existing files.
          </p>
          <button
            onClick={startMigration}
            disabled={migrating}
            className="btn-outline px-4 text-sm"
          >
            {migrating ? '⏳ Migrating…' : '☁ Migrate local files → S3'}
          </button>
          {migrateLog.length > 0 && (
            <div
              className="mt-3 max-h-40 overflow-y-auto rounded-lg p-3 font-mono text-xs space-y-0.5"
              style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text-2)' }}
            >
              {migrateLog.map((l, i) => <div key={i}>{l}</div>)}
            </div>
          )}
          {migrateDone && (
            <p className="mt-2 text-xs font-semibold" style={{ color: 'var(--accent)' }}>
              All done! Refresh the page to see updated storage indicators.
            </p>
          )}
        </div>
      )}
    </div>
  )
}

// ── Database Tab ──────────────────────────────────────────────────────────────

type DbMode = 'local' | 'standalone'

type DbConfigForm = {
  mode: DbMode
  host: string
  port: number
  database: string
  username: string
  password: string          // '' means "keep existing" on save unless the user typed something
  ssl_enabled: boolean
  ssl_ca_path: string
  pool_max: number
}

type DbConfigResponse = {
  stored: (DbConfigForm & { password_set?: boolean }) | null
  active: { mode: string | null; target: string | null; version?: string; ok: boolean; error?: string }
}

type TestResult = {
  ok: boolean
  latency_ms?: number
  version?: string | null
  database?: string | null
  target?: string
  error?: string
}

type RowCounts = { per_table: Record<string, number | null>; total: number }

type MigratePreview = {
  ok: boolean
  schema_applied?: number
  order?: string[]
  source?: RowCounts
  target_before?: RowCounts
  warnings?: string[]
  target_not_empty?: boolean
  error?: string
}

type MigrateResult = MigratePreview & {
  copied?: RowCounts
  saved?: unknown
  restart_required?: boolean
  message?: string
  code?: string
}

function DatabaseTab() {
  const api = useApi()

  const [loading, setLoading] = useState(true)
  const [saving,  setSaving]  = useState(false)
  const [testing, setTesting] = useState(false)
  const [migrating, setMigrating] = useState(false)

  const [active,  setActive]  = useState<DbConfigResponse['active'] | null>(null)
  const [form, setForm] = useState<DbConfigForm>({
    mode: 'local',
    host: 'localhost',
    port: 5432,
    database: 'mcogs',
    username: 'mcogs',
    password: '',
    ssl_enabled: false,
    ssl_ca_path: '',
    pool_max: 10,
  })
  const [passwordSet, setPasswordSet] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [testResult, setTestResult] = useState<TestResult | null>(null)
  const [confirmSave, setConfirmSave] = useState(false)
  const [confirmRestart, setConfirmRestart] = useState(false)
  const [toast, setToast] = useState<{ msg: string; type?: 'success' | 'error' } | null>(null)

  // Migrate-and-switch state
  const [migrateModalOpen, setMigrateModalOpen] = useState(false)
  const [migratePreview, setMigratePreview] = useState<MigratePreview | null>(null)
  const [migratePreviewLoading, setMigratePreviewLoading] = useState(false)
  const [overwriteConfirmed, setOverwriteConfirmed] = useState(false)
  const [migrateRunning, setMigrateRunning] = useState(false)
  const [migrateResult, setMigrateResult] = useState<MigrateResult | null>(null)

  const load = useCallback(async () => {
    try {
      setLoading(true)
      const data = await api.get('/db-config') as DbConfigResponse
      setActive(data.active)
      if (data.stored) {
        setForm(prev => ({
          ...prev,
          mode:         (data.stored!.mode as DbMode) || prev.mode,
          host:         data.stored!.host || prev.host,
          port:         data.stored!.port || prev.port,
          database:     data.stored!.database || prev.database,
          username:     data.stored!.username || prev.username,
          password:     '',
          ssl_enabled:  !!data.stored!.ssl_enabled,
          ssl_ca_path:  data.stored!.ssl_ca_path || '',
          pool_max:     data.stored!.pool_max || prev.pool_max,
        }))
        setPasswordSet(!!data.stored.password_set)
      }
    } catch (err) {
      setToast({ msg: `Failed to load config: ${(err as Error).message}`, type: 'error' })
    } finally {
      setLoading(false)
    }
  }, [api])

  useEffect(() => { load() }, [load])

  // Build the candidate payload sent to the API. Omit password when empty so
  // the server keeps whatever is already stored (matches StorageTab semantics).
  const candidatePayload = useCallback(() => {
    const p: Record<string, unknown> = {
      mode: form.mode,
      host: form.host.trim() || null,
      port: form.port,
      database: form.database.trim() || null,
      username: form.username.trim() || null,
      ssl_enabled: form.ssl_enabled,
      ssl_ca_path: form.ssl_ca_path.trim() || null,
      pool_max: form.pool_max,
    }
    if (form.password !== '') p.password = form.password
    return p
  }, [form])

  async function handleTest() {
    setTesting(true)
    setTestResult(null)
    try {
      const r = await api.post('/db-config/test', candidatePayload()) as TestResult
      setTestResult(r)
    } catch (err) {
      setTestResult({ ok: false, error: (err as Error).message })
    } finally {
      setTesting(false)
    }
  }

  async function handleSave() {
    setConfirmSave(false)
    setSaving(true)
    try {
      await api.put('/db-config', candidatePayload())
      setToast({ msg: 'Saved. Restart the API to activate the new connection.' })
      await load()
      setConfirmRestart(true)
    } catch (err) {
      setToast({ msg: `Save failed: ${(err as Error).message}`, type: 'error' })
    } finally {
      setSaving(false)
    }
  }

  async function handleRestart() {
    setConfirmRestart(false)
    try {
      await api.post('/db-config/restart', {})
      setToast({ msg: 'API is restarting — refresh in a few seconds.' })
    } catch (err) {
      // Expected: the socket may close before we get a response.
      setToast({ msg: 'Restart signal sent — refresh in a few seconds.' })
      void err
    }
  }

  async function handleMigrate() {
    setMigrating(true)
    try {
      const r = await api.post('/db-config/migrate', {}) as { ok: boolean; applied?: number; error?: { message: string } }
      if (r.ok) {
        setToast({ msg: `Schema migrated: ${r.applied} statements applied.` })
      } else {
        setToast({ msg: `Migration failed: ${r.error?.message || 'unknown error'}`, type: 'error' })
      }
    } catch (err) {
      setToast({ msg: `Migration failed: ${(err as Error).message}`, type: 'error' })
    } finally {
      setMigrating(false)
    }
  }

  // ── Migrate-and-switch flow ──────────────────────────────────────────────
  async function openMigrateModal() {
    setMigrateModalOpen(true)
    setMigratePreview(null)
    setMigrateResult(null)
    setOverwriteConfirmed(false)
    setMigratePreviewLoading(true)
    try {
      const r = await api.post('/db-config/migrate-preview', candidatePayload()) as MigratePreview
      setMigratePreview(r)
    } catch (err) {
      setMigratePreview({ ok: false, error: (err as Error).message })
    } finally {
      setMigratePreviewLoading(false)
    }
  }

  async function runMigrateData() {
    if (!migratePreview || !migratePreview.ok) return
    if (migratePreview.target_not_empty && !overwriteConfirmed) return
    setMigrateRunning(true)
    try {
      const body = { ...candidatePayload(), overwrite: !!migratePreview.target_not_empty }
      const r = await api.post('/db-config/migrate-data', body) as MigrateResult
      setMigrateResult(r)
      if (r.ok) {
        await load() // refresh masked stored config
      }
    } catch (err) {
      setMigrateResult({ ok: false, error: (err as Error).message })
    } finally {
      setMigrateRunning(false)
    }
  }

  function closeMigrateModal() {
    setMigrateModalOpen(false)
    setMigratePreview(null)
    setMigrateResult(null)
    setOverwriteConfirmed(false)
  }

  if (loading) return <Spinner />

  const inStandalone = form.mode === 'standalone'

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-text-1 mb-1">Database</h2>
        <p className="text-sm text-text-3">
          Run the transactional database locally on the API server, or on a standalone host such as AWS RDS.
          Changes take effect after restarting the API.
        </p>
      </div>

      {/* Current status banner */}
      <div className={`card p-4 flex items-start gap-3 ${active?.ok ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'}`}>
        <span className={`mt-0.5 inline-block w-2.5 h-2.5 rounded-full ${active?.ok ? 'bg-green-500' : 'bg-red-500'}`} />
        <div className="text-sm flex-1">
          <div className="font-medium text-text-1">
            {active?.ok ? 'Connected' : 'Not connected'}
            {active?.mode && <span className="ml-2 text-xs font-mono text-text-3">mode: {active.mode}</span>}
          </div>
          {active?.target && <div className="text-xs text-text-3 font-mono">{active.target}</div>}
          {active?.version && <div className="text-xs text-text-3 mt-1">{active.version}</div>}
          {!active?.ok && active?.error && <div className="text-xs text-red-700 mt-1">{active.error}</div>}
        </div>
      </div>

      {/* Mode toggle */}
      <div className="card p-4 space-y-3">
        <Field label="Mode">
          <div className="flex gap-3">
            {(['local', 'standalone'] as const).map(m => (
              <label key={m} className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="db_mode"
                  value={m}
                  checked={form.mode === m}
                  onChange={() => setForm(prev => ({
                    ...prev,
                    mode: m,
                    // Turn SSL on by default when switching to standalone
                    ssl_enabled: m === 'standalone' ? true : prev.ssl_enabled,
                    // Default to localhost when switching back
                    host: m === 'local' && (!prev.host || prev.host === '') ? 'localhost' : prev.host,
                  }))}
                  className="accent-accent"
                />
                <span className="text-sm font-medium text-text-1">
                  {m === 'local' ? '🖥️  Local (same host as the API)' : '☁️  Standalone (AWS RDS or remote Postgres)'}
                </span>
              </label>
            ))}
          </div>
        </Field>
        {inStandalone && (
          <p className="text-xs text-text-3 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2 text-blue-800">
            For AWS RDS: allow inbound TCP/5432 from the API host's security group only. SSL is enabled by default.
            For strict certificate verification, install the{' '}
            <a href="https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem" className="underline" target="_blank" rel="noreferrer">
              AWS RDS global CA bundle
            </a>{' '}
            on the API host and enter its path below.
          </p>
        )}
      </div>

      {/* Connection fields */}
      <div className="card p-4 space-y-4">
        <div className="grid grid-cols-3 gap-4">
          <div className="col-span-2">
            <Field label="Host" required>
              <input
                className="input font-mono text-sm"
                value={form.host}
                onChange={e => setForm(f => ({ ...f, host: e.target.value }))}
                placeholder={inStandalone ? 'mcogs.abcdef1234.eu-west-2.rds.amazonaws.com' : 'localhost'}
                autoComplete="off"
              />
            </Field>
          </div>
          <Field label="Port" required>
            <input
              className="input font-mono text-sm"
              type="number"
              value={form.port}
              onChange={e => setForm(f => ({ ...f, port: parseInt(e.target.value || '5432', 10) }))}
            />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Database" required>
            <input
              className="input font-mono text-sm"
              value={form.database}
              onChange={e => setForm(f => ({ ...f, database: e.target.value }))}
              placeholder="mcogs"
              autoComplete="off"
            />
          </Field>
          <Field label="User" required>
            <input
              className="input font-mono text-sm"
              value={form.username}
              onChange={e => setForm(f => ({ ...f, username: e.target.value }))}
              placeholder="mcogs"
              autoComplete="off"
            />
          </Field>
        </div>

        <Field label={passwordSet ? 'Password (leave blank to keep current)' : 'Password'}>
          <div className="relative">
            <input
              className="input font-mono text-sm pr-10"
              type={showPassword ? 'text' : 'password'}
              value={form.password}
              onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
              placeholder={passwordSet ? '••••••••  (stored, not shown)' : 'Enter the DB password'}
              autoComplete="new-password"
            />
            <button
              type="button"
              className="absolute right-2 top-1/2 -translate-y-1/2 text-text-3 hover:text-text-1"
              onClick={() => setShowPassword(v => !v)}
            >{showPassword ? '🙈' : '👁️'}</button>
          </div>
        </Field>

        {/* SSL */}
        <div className="pt-2 border-t border-border">
          <label className="flex items-center gap-2 cursor-pointer mb-2">
            <input
              type="checkbox"
              checked={form.ssl_enabled}
              onChange={e => setForm(f => ({ ...f, ssl_enabled: e.target.checked }))}
              className="accent-accent"
            />
            <span className="text-sm font-medium text-text-1">Use SSL/TLS</span>
          </label>
          {form.ssl_enabled && (
            <Field label="CA Bundle Path (optional, for strict verification)">
              <input
                className="input font-mono text-sm"
                value={form.ssl_ca_path}
                onChange={e => setForm(f => ({ ...f, ssl_ca_path: e.target.value }))}
                placeholder="/etc/ssl/rds/global-bundle.pem"
              />
            </Field>
          )}
        </div>

        {/* Pool size */}
        <Field label="Pool max connections">
          <input
            className="input font-mono text-sm w-24"
            type="number"
            min={1}
            max={200}
            value={form.pool_max}
            onChange={e => setForm(f => ({ ...f, pool_max: parseInt(e.target.value || '10', 10) }))}
          />
        </Field>
      </div>

      {/* Test result */}
      {testResult && (
        <div className={`card p-4 ${testResult.ok ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'}`}>
          {testResult.ok ? (
            <div className="text-sm text-green-800">
              ✅ <span className="font-medium">Connected</span> in {testResult.latency_ms}ms
              {testResult.database && <> — db <span className="font-mono">{testResult.database}</span></>}
              {testResult.version && <div className="text-xs text-green-700 mt-1">{testResult.version}</div>}
            </div>
          ) : (
            <div className="text-sm text-red-800">
              ❌ <span className="font-medium">Connection failed:</span> {testResult.error}
            </div>
          )}
        </div>
      )}

      {/* Action buttons */}
      <div className="flex flex-wrap gap-3">
        <button
          className="btn-secondary px-5 py-2 text-sm"
          onClick={handleTest}
          disabled={testing || saving}
        >{testing ? 'Testing…' : 'Test Connection'}</button>

        <button
          className="btn-primary px-5 py-2 text-sm"
          onClick={() => setConfirmSave(true)}
          disabled={saving || !form.host}
        >{saving ? 'Saving…' : 'Save'}</button>

        <button
          className="btn-primary px-5 py-2 text-sm"
          onClick={openMigrateModal}
          disabled={saving || !form.host}
          title="Copy schema and all data from the current active database into the target database, then save the new connection"
        >Migrate Data &amp; Switch</button>

        <button
          className="btn-secondary px-5 py-2 text-sm ml-auto"
          onClick={handleMigrate}
          disabled={migrating}
          title="Run CREATE TABLE IF NOT EXISTS for all mcogs_ tables against the currently-active database"
        >{migrating ? 'Migrating…' : 'Run Migrations on Active DB'}</button>
      </div>

      {confirmSave && (
        <ConfirmDialog
          message="Save database configuration? The API will validate the connection before saving. After saving you'll need to restart the API for the change to take effect."
          onConfirm={handleSave}
          onCancel={() => setConfirmSave(false)}
          danger={false}
        />
      )}

      {confirmRestart && (
        <ConfirmDialog
          message="Restart API now? The API process will exit and be respawned by the process manager. This takes a couple of seconds."
          onConfirm={handleRestart}
          onCancel={() => setConfirmRestart(false)}
          danger={false}
        />
      )}

      {migrateModalOpen && (
        <Modal title="Migrate Data & Switch Database" onClose={migrateRunning ? () => {} : closeMigrateModal} width="max-w-2xl">
          {migratePreviewLoading && (
            <div className="py-8 flex items-center gap-3 text-sm text-text-3">
              <Spinner /> Connecting to target and counting rows…
            </div>
          )}

          {!migratePreviewLoading && migratePreview && !migratePreview.ok && (
            <div className="py-4">
              <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-4 py-3">
                ❌ <span className="font-medium">Preview failed:</span> {migratePreview.error}
              </div>
              <div className="mt-4 flex justify-end">
                <button className="btn-secondary px-4 py-2 text-sm" onClick={closeMigrateModal}>Close</button>
              </div>
            </div>
          )}

          {!migratePreviewLoading && migratePreview && migratePreview.ok && !migrateResult && (
            <div className="space-y-4">
              <p className="text-sm text-text-2">
                This will copy all <code className="font-mono text-xs">mcogs_*</code> tables and rows from the
                <strong> currently active database</strong> into the <strong>target database</strong> you configured above,
                then save the new connection. The current database is left untouched. After the copy you'll be prompted
                to restart the API to start using the new target.
              </p>

              <div className="grid grid-cols-2 gap-4">
                <div className="card p-4">
                  <div className="text-xs font-semibold text-text-3 uppercase tracking-wide mb-2">Source (current)</div>
                  <div className="text-2xl font-bold text-text-1">{(migratePreview.source?.total ?? 0).toLocaleString()}</div>
                  <div className="text-xs text-text-3 mt-1">total rows across {migratePreview.order?.length ?? 0} tables</div>
                </div>
                <div className={`card p-4 ${migratePreview.target_not_empty ? 'border-amber-300 bg-amber-50' : ''}`}>
                  <div className="text-xs font-semibold text-text-3 uppercase tracking-wide mb-2">Target</div>
                  <div className={`text-2xl font-bold ${migratePreview.target_not_empty ? 'text-amber-700' : 'text-text-1'}`}>
                    {(migratePreview.target_before?.total ?? 0).toLocaleString()}
                  </div>
                  <div className="text-xs text-text-3 mt-1">
                    {migratePreview.target_not_empty
                      ? <span className="text-amber-700 font-medium">Existing data — will be overwritten</span>
                      : 'empty — safe to copy into'}
                  </div>
                </div>
              </div>

              {migratePreview.target_not_empty && (
                <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 space-y-2">
                  <div className="text-sm font-semibold text-red-800">
                    ⚠ The target database is not empty
                  </div>
                  <div className="text-xs text-red-700">
                    Continuing will <strong>TRUNCATE every <code className="font-mono">mcogs_*</code> table on the target</strong>
                    {' '}and replace its rows with data from the source. This is destructive and cannot be undone from inside the app.
                    Make sure you have a backup of the target database (or are deliberately overwriting empty test data) before continuing.
                  </div>
                  <label className="flex items-center gap-2 cursor-pointer pt-1">
                    <input
                      type="checkbox"
                      checked={overwriteConfirmed}
                      onChange={e => setOverwriteConfirmed(e.target.checked)}
                      className="accent-red-600"
                    />
                    <span className="text-xs font-medium text-red-800">
                      I understand this will overwrite existing data on the remote database
                    </span>
                  </label>
                </div>
              )}

              {!!migratePreview.warnings && migratePreview.warnings.length > 0 && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-2 text-xs text-amber-800">
                  <div className="font-semibold mb-1">Schema warnings:</div>
                  <ul className="list-disc pl-4">
                    {migratePreview.warnings.map((w, i) => <li key={i}>{w}</li>)}
                  </ul>
                </div>
              )}

              <details className="text-xs text-text-3">
                <summary className="cursor-pointer hover:text-text-1">Per-table row counts</summary>
                <table className="w-full mt-2 text-xs">
                  <thead>
                    <tr className="text-left text-text-3">
                      <th className="py-1">Table</th>
                      <th className="py-1 text-right">Source</th>
                      <th className="py-1 text-right">Target</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(migratePreview.order || []).map(t => (
                      <tr key={t} className="border-t border-border">
                        <td className="py-1 font-mono">{t}</td>
                        <td className="py-1 text-right">{migratePreview.source?.per_table?.[t] ?? '—'}</td>
                        <td className="py-1 text-right">{migratePreview.target_before?.per_table?.[t] ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </details>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  className="btn-secondary px-4 py-2 text-sm"
                  onClick={closeMigrateModal}
                  disabled={migrateRunning}
                >Cancel</button>
                <button
                  className="btn-primary px-4 py-2 text-sm"
                  onClick={runMigrateData}
                  disabled={migrateRunning || (!!migratePreview.target_not_empty && !overwriteConfirmed)}
                >{migrateRunning ? 'Migrating…' : 'Start Migration'}</button>
              </div>
            </div>
          )}

          {migrateResult && migrateResult.ok && (
            <div className="space-y-4">
              <div className="text-sm text-green-800 bg-green-50 border border-green-200 rounded-lg px-4 py-3">
                ✅ <span className="font-medium">Migration complete.</span> Copied {(migrateResult.copied?.total ?? 0).toLocaleString()} rows
                across {Object.keys(migrateResult.copied?.per_table || {}).length} tables. The new connection has been saved.
                Restart the API to begin using the new database.
              </div>
              <details className="text-xs text-text-3">
                <summary className="cursor-pointer hover:text-text-1">Per-table copy results</summary>
                <table className="w-full mt-2 text-xs">
                  <tbody>
                    {Object.entries(migrateResult.copied?.per_table || {}).map(([t, n]) => (
                      <tr key={t} className="border-t border-border">
                        <td className="py-1 font-mono">{t}</td>
                        <td className="py-1 text-right">{n}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </details>
              <div className="flex justify-end gap-3">
                <button className="btn-secondary px-4 py-2 text-sm" onClick={closeMigrateModal}>Close</button>
                <button
                  className="btn-primary px-4 py-2 text-sm"
                  onClick={() => { closeMigrateModal(); setConfirmRestart(true) }}
                >Restart API now</button>
              </div>
            </div>
          )}

          {migrateResult && !migrateResult.ok && (
            <div className="py-4 space-y-3">
              <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-4 py-3">
                ❌ <span className="font-medium">Migration failed:</span> {migrateResult.error}
                {migrateResult.code === 'TARGET_NOT_EMPTY' && (
                  <div className="mt-1 text-xs">Tick the overwrite checkbox above and try again.</div>
                )}
              </div>
              <div className="flex justify-end">
                <button className="btn-secondary px-4 py-2 text-sm" onClick={closeMigrateModal}>Close</button>
              </div>
            </div>
          )}
        </Modal>
      )}

      {toast && <Toast message={toast.msg} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  )
}

// ── AI Tab ────────────────────────────────────────────────────────────────────

function AiTab() {
  const api = useApi()
  const [loading,      setLoading]      = useState(true)
  const [saving,       setSaving]       = useState(false)
  const [status,       setStatus]       = useState<AiKeyStatus>({ anthropic_key_set: false, voyage_key_set: false, brave_key_set: false, claude_code_key_set: false, github_pat_set: false, github_repo_set: false, jira_base_url_set: false, jira_email_set: false, jira_token_set: false, jira_project_set: false, mapbox_token_set: false, openai_key_set: false })
  const [anthropic,    setAnthropic]    = useState('')
  const [voyage,       setVoyage]       = useState('')
  const [brave,        setBrave]        = useState('')
  const [githubPat,    setGithubPat]    = useState('')
  const [githubRepo,   setGithubRepo]   = useState('')
  const [jiraUrl,      setJiraUrl]      = useState('')
  const [jiraEmail,    setJiraEmail]    = useState('')
  const [jiraToken,    setJiraToken]    = useState('')
  const [jiraProject,  setJiraProject]  = useState('')
  const [jiraTesting,  setJiraTesting]  = useState(false)
  const [jiraTestResult, setJiraTestResult] = useState<{ ok: boolean; message: string } | null>(null)
  const [mapboxToken,  setMapboxToken]  = useState('')
  const [openaiKey,    setOpenaiKey]    = useState('')
  const [conciseMode,      setConciseMode]      = useState(false)
  const [savingMode,       setSavingMode]       = useState(false)
  const [monthlyTokenLimit,  setMonthlyTokenLimit]  = useState<string>('0')
  const [savingLimit,        setSavingLimit]        = useState(false)
  const [claudeCodeKey,    setClaudeCodeKey]    = useState<string | null>(null)
  const [usage,            setUsage]            = useState<UsageData | null>(null)
  const [usageLoading,     setUsageLoading]     = useState(false)
  const [generatingKey,    setGeneratingKey]    = useState(false)
  const [keyCopied,        setKeyCopied]        = useState(false)
  const [toast,            setToast]            = useState<{ message: string; type: 'success' | 'error' } | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    Promise.all([
      api.get('/ai-config'),
      api.get('/settings'),
      api.get('/ai-config/claude-code-key'),
    ])
      .then(([s, settings, keyData]) => {
        setStatus(s)
        setConciseMode(settings?.ai_concise_mode === true)
        setMonthlyTokenLimit(String(settings?.ai_monthly_token_limit ?? '0'))
        setClaudeCodeKey(keyData?.key ?? null)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [api])

  const loadUsage = useCallback(() => {
    setUsageLoading(true)
    api.get('/ai-chat/usage')
      .then((d: UsageData) => setUsage(d))
      .catch(() => {})
      .finally(() => setUsageLoading(false))
  }, [api])

  async function handleToggleConciseMode(val: boolean) {
    setConciseMode(val)
    setSavingMode(true)
    try {
      await api.patch('/settings', { ai_concise_mode: val })
      setToast({ message: val ? 'Concise mode enabled' : 'Concise mode disabled', type: 'success' })
    } catch (err: any) {
      setConciseMode(!val) // revert
      setToast({ message: err.message || 'Failed to save', type: 'error' })
    } finally {
      setSavingMode(false)
    }
  }

  async function handleSaveTokenLimit() {
    const val = Math.max(0, Math.floor(Number(monthlyTokenLimit) || 0))
    setMonthlyTokenLimit(String(val))
    setSavingLimit(true)
    try {
      await api.patch('/settings', { ai_monthly_token_limit: val })
      setToast({ message: val === 0 ? 'Token allowance removed (unlimited)' : `Monthly limit set to ${val.toLocaleString()} tokens`, type: 'success' })
    } catch (err: any) {
      setToast({ message: err.message || 'Failed to save', type: 'error' })
    } finally {
      setSavingLimit(false)
    }
  }

  useEffect(() => { load() }, [load])

  async function handleSave() {
    const payload: Record<string, string> = {}
    if (anthropic.trim())  payload.ANTHROPIC_API_KEY    = anthropic.trim()
    if (voyage.trim())     payload.VOYAGE_API_KEY       = voyage.trim()
    if (brave.trim())      payload.BRAVE_SEARCH_API_KEY = brave.trim()
    if (githubPat.trim())  payload.GITHUB_PAT           = githubPat.trim()
    if (githubRepo.trim()) payload.GITHUB_REPO          = githubRepo.trim()
    if (jiraUrl.trim())    payload.JIRA_BASE_URL        = jiraUrl.trim().replace(/\/+$/, '')
    if (jiraEmail.trim())  payload.JIRA_EMAIL           = jiraEmail.trim()
    if (jiraToken.trim())  payload.JIRA_API_TOKEN       = jiraToken.trim()
    if (jiraProject.trim()) payload.JIRA_PROJECT_KEY    = jiraProject.trim().toUpperCase()
    if (mapboxToken.trim()) payload.MAPBOX_ACCESS_TOKEN = mapboxToken.trim()
    if (openaiKey.trim())   payload.OPENAI_API_KEY      = openaiKey.trim()
    if (!Object.keys(payload).length) return
    setSaving(true)
    try {
      const updated: AiKeyStatus = await api.patch('/ai-config', payload)
      setStatus(updated)
      setAnthropic('')
      setVoyage('')
      setBrave('')
      setGithubPat('')
      setGithubRepo('')
      setMapboxToken('')
      setToast({ message: 'Keys saved', type: 'success' })
    } catch (err: any) {
      setToast({ message: err.message || 'Save failed', type: 'error' })
    } finally {
      setSaving(false)
    }
  }

  async function handleClear(key: 'ANTHROPIC_API_KEY' | 'VOYAGE_API_KEY' | 'BRAVE_SEARCH_API_KEY' | 'GITHUB_PAT' | 'GITHUB_REPO' | 'JIRA_BASE_URL' | 'JIRA_EMAIL' | 'JIRA_API_TOKEN' | 'JIRA_PROJECT_KEY' | 'MAPBOX_ACCESS_TOKEN' | 'OPENAI_API_KEY') {
    try {
      const updated: AiKeyStatus = await api.delete(`/ai-config/${key}`)
      setStatus(updated)
      setToast({ message: 'Key cleared', type: 'success' })
    } catch (err: any) {
      setToast({ message: err.message || 'Failed to clear key', type: 'error' })
    }
  }

  async function handleGenerateKey() {
    setGeneratingKey(true)
    try {
      const result = await api.post('/ai-config/generate-claude-code-key', {})
      setClaudeCodeKey(result.key)
      setStatus(s => ({ ...s, claude_code_key_set: true }))
      setToast({ message: 'New key generated', type: 'success' })
    } catch (err: any) {
      setToast({ message: err.message || 'Failed to generate key', type: 'error' })
    } finally {
      setGeneratingKey(false)
    }
  }

  async function handleCopyKey() {
    if (!claudeCodeKey) return
    await navigator.clipboard.writeText(claudeCodeKey)
    setKeyCopied(true)
    setTimeout(() => setKeyCopied(false), 2000)
  }

  if (loading) return <Spinner />

  return (
    <div className="max-w-lg">
      <div className="mb-6">
        <h2 className="text-base font-bold text-text-1 mb-1">AI Integration</h2>
        <p className="text-sm text-text-3">
          API keys are stored securely in the database and never returned to the browser. Paste a new key to update — leave blank to keep the existing value.
        </p>
      </div>

      {/* Status cards */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        {[
          { label: 'Anthropic (Claude)', set: status.anthropic_key_set, key: 'ANTHROPIC_API_KEY'    as const },
          { label: 'Voyage AI (RAG)',    set: status.voyage_key_set,    key: 'VOYAGE_API_KEY'       as const },
          { label: 'Brave (Web Search)', set: status.brave_key_set,     key: 'BRAVE_SEARCH_API_KEY' as const },
        ].map(({ label, set, key }) => (
          <div
            key={key}
            className="flex items-center justify-between rounded-xl border px-4 py-3"
            style={{ borderColor: set ? 'var(--accent-mid)' : 'var(--border)', background: set ? 'var(--accent-dim)' : 'var(--surface-2)' }}
          >
            <div>
              <div className="text-xs font-semibold" style={{ color: 'var(--text-2)' }}>{label}</div>
              <Badge label={set ? 'Configured' : 'Not set'} variant={set ? 'green' : 'neutral'} />
            </div>
            {set && (
              <button
                onClick={() => handleClear(key)}
                className="text-xs text-text-3 hover:text-red-500 transition-colors ml-2"
                title="Clear this key"
              >
                ✕
              </button>
            )}
          </div>
        ))}
      </div>

      {/* Key inputs */}
      <div className="space-y-4">
        <Field label="Anthropic API Key">
          <input
            type="password"
            className="input w-full font-mono text-sm"
            value={anthropic}
            onChange={e => setAnthropic(e.target.value)}
            placeholder={status.anthropic_key_set ? '••••••••  (leave blank to keep existing)' : 'sk-ant-…'}
            autoComplete="off"
          />
          <p className="text-xs text-text-3 mt-1">Required for the COGS Assistant. Get your key at console.anthropic.com</p>
        </Field>

        <Field label="Voyage AI API Key">
          <input
            type="password"
            className="input w-full font-mono text-sm"
            value={voyage}
            onChange={e => setVoyage(e.target.value)}
            placeholder={status.voyage_key_set ? '••••••••  (leave blank to keep existing)' : 'pa-…'}
            autoComplete="off"
          />
          <p className="text-xs text-text-3 mt-1">Optional — enables semantic search over COGS documentation. Falls back to keyword search if not set. Get your key at dash.voyageai.com</p>
        </Field>

        <Field label="Brave Search API Key">
          <input
            type="password"
            className="input w-full font-mono text-sm"
            value={brave}
            onChange={e => setBrave(e.target.value)}
            placeholder={status.brave_key_set ? '••••••••  (leave blank to keep existing)' : 'BSA…'}
            autoComplete="off"
          />
          <p className="text-xs text-text-3 mt-1">Optional — enables full web search for the COGS Assistant. Falls back to DuckDuckGo instant answers if not set. Get your key at brave.com/search/api (free tier: 2,000 queries/month)</p>
        </Field>

        <Field label="GitHub Personal Access Token (PAT)">
          <input
            type="password"
            className="input w-full font-mono text-sm"
            value={githubPat}
            onChange={e => setGithubPat(e.target.value)}
            placeholder={status.github_pat_set ? '••••••••  (leave blank to keep existing)' : 'github_pat_…'}
            autoComplete="off"
          />
          <p className="text-xs text-text-3 mt-1">
            Optional — grants Pepper read/write access to your GitHub repository.
            Create a fine-grained PAT at github.com/settings/tokens with <strong>Contents</strong> (read/write) and <strong>Pull requests</strong> (read/write) permissions on the target repo.
            {status.github_pat_set && (
              <button onClick={() => handleClear('GITHUB_PAT')} className="ml-2 text-red-500 hover:underline">Clear</button>
            )}
          </p>
        </Field>

        <Field label="GitHub Repository">
          <input
            type="text"
            className="input w-full font-mono text-sm"
            value={githubRepo}
            onChange={e => setGithubRepo(e.target.value)}
            placeholder={status.github_repo_set ? '(configured — leave blank to keep)' : 'owner/repo'}
            autoComplete="off"
          />
          <p className="text-xs text-text-3 mt-1">
            Default repository for Pepper's GitHub tools, e.g. <code>mawegrzyn-ux/COGS</code>.
            {status.github_repo_set && (
              <button onClick={() => handleClear('GITHUB_REPO')} className="ml-2 text-red-500 hover:underline">Clear</button>
            )}
          </p>
        </Field>
      </div>

      {/* ── Jira Integration ── */}
      <div className="mt-6 pt-5 border-t border-border">
        <div className="flex items-center gap-2 mb-1">
          <h2 className="text-base font-bold text-text-1">Jira Integration</h2>
          <span className={`w-2 h-2 rounded-full ${status.jira_base_url_set && status.jira_email_set && status.jira_token_set && status.jira_project_set ? 'bg-green-500' : 'bg-gray-300'}`} />
          <span className="text-[10px] text-text-3">
            {status.jira_base_url_set && status.jira_email_set && status.jira_token_set && status.jira_project_set ? 'Configured' : 'Not configured'}
          </span>
        </div>
        <p className="text-sm text-text-3 mb-4">Sync bugs and backlog items to a Jira Cloud project. Requires a Jira API token from <a href="https://id.atlassian.com/manage-profile/security/api-tokens" target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">id.atlassian.com</a>.</p>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Jira Base URL">
            <input
              type="text"
              className="input w-full font-mono text-sm"
              value={jiraUrl}
              onChange={e => setJiraUrl(e.target.value)}
              placeholder={status.jira_base_url_set ? '(configured — leave blank to keep)' : 'https://yourteam.atlassian.net'}
              autoComplete="off"
            />
            {status.jira_base_url_set && (
              <button onClick={() => handleClear('JIRA_BASE_URL')} className="text-[10px] text-red-500 hover:underline mt-0.5">Clear</button>
            )}
          </Field>

          <Field label="Jira Project Key">
            <input
              type="text"
              className="input w-full font-mono text-sm uppercase"
              value={jiraProject}
              onChange={e => setJiraProject(e.target.value)}
              placeholder={status.jira_project_set ? '(configured — leave blank to keep)' : 'COGS'}
              autoComplete="off"
            />
            {status.jira_project_set && (
              <button onClick={() => handleClear('JIRA_PROJECT_KEY')} className="text-[10px] text-red-500 hover:underline mt-0.5">Clear</button>
            )}
          </Field>

          <Field label="Jira Account Email">
            <input
              type="email"
              className="input w-full text-sm"
              value={jiraEmail}
              onChange={e => setJiraEmail(e.target.value)}
              placeholder={status.jira_email_set ? '(configured — leave blank to keep)' : 'you@company.com'}
              autoComplete="off"
            />
            {status.jira_email_set && (
              <button onClick={() => handleClear('JIRA_EMAIL')} className="text-[10px] text-red-500 hover:underline mt-0.5">Clear</button>
            )}
          </Field>

          <Field label="Jira API Token">
            <input
              type="password"
              className="input w-full font-mono text-sm"
              value={jiraToken}
              onChange={e => setJiraToken(e.target.value)}
              placeholder={status.jira_token_set ? '••••••••  (leave blank to keep existing)' : 'ATATT3x…'}
              autoComplete="off"
            />
            {status.jira_token_set && (
              <button onClick={() => handleClear('JIRA_API_TOKEN')} className="text-[10px] text-red-500 hover:underline mt-0.5">Clear</button>
            )}
          </Field>
        </div>

        {status.jira_base_url_set && status.jira_email_set && status.jira_token_set && status.jira_project_set && (
          <div className="mt-3 flex items-center gap-3">
            <button
              className="btn-outline text-xs px-3 py-1.5"
              onClick={async () => {
                setJiraTesting(true)
                setJiraTestResult(null)
                try {
                  const r = await api.post('/jira/test')
                  setJiraTestResult({ ok: true, message: `Connected as ${r.displayName} (${r.emailAddress})` })
                } catch (err: any) {
                  setJiraTestResult({ ok: false, message: err?.body?.error?.message || err?.message || 'Connection failed' })
                } finally { setJiraTesting(false) }
              }}
              disabled={jiraTesting}
            >
              {jiraTesting ? 'Testing…' : 'Test Connection'}
            </button>
            {jiraTestResult && (
              <span className={`text-xs ${jiraTestResult.ok ? 'text-green-600' : 'text-red-600'}`}>
                {jiraTestResult.ok ? '✓' : '✗'} {jiraTestResult.message}
              </span>
            )}
          </div>
        )}
      </div>

      {/* ── Mapbox Integration ── */}
      <div className="mt-6 pt-5 border-t border-border">
        <h3 className="text-sm font-semibold text-text-1 mb-1 flex items-center gap-2">
          <span>🗺️</span> Mapbox Integration
        </h3>
        <p className="text-xs text-text-3 mb-3">
          Provides the tile + vector-boundary data for the Dashboard map widgets. Use a <strong>PUBLIC</strong> access token (starts with <code className="text-[10px] bg-surface-2 px-1 rounded">pk.</code>) from <a href="https://account.mapbox.com/access-tokens/" target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">account.mapbox.com</a>. Restrict the token to your production domain in the Mapbox dashboard for safety — it gets embedded in the browser by design.
        </p>
        <Field label="Public access token">
          <input
            type="password"
            className="input w-full"
            value={mapboxToken}
            onChange={e => setMapboxToken(e.target.value)}
            placeholder={status.mapbox_token_set ? '••••••••  (leave blank to keep existing)' : 'pk.eyJ1Ij…'}
            autoComplete="off"
          />
          <div className="text-[10px] text-text-3 mt-0.5 flex items-center gap-2">
            {status.mapbox_token_set
              ? <span className="text-green-600">✓ Configured — maps use Mapbox tiles</span>
              : <span>Not set — map widgets show a "configure token" prompt</span>}
            {status.mapbox_token_set && (
              <button onClick={() => handleClear('MAPBOX_ACCESS_TOKEN')} className="text-red-500 hover:underline">Clear</button>
            )}
          </div>
        </Field>
      </div>

      {/* ── OpenAI — voice transcription fallback ───────────────────────────── */}
      <div className="card p-5 mt-5">
        <h3 className="text-base font-bold text-text-1 mb-2 flex items-center gap-2">
          <span>🎙️</span> OpenAI Whisper (voice transcription)
        </h3>
        <p className="text-xs text-text-3 mb-3">
          Optional. Only used when Pepper's mic button is pressed <em>on Safari or iOS</em> where the browser's built-in SpeechRecognition isn't available. Chromium-based browsers (Chrome, Edge, Samsung Internet) transcribe for free on-device and never hit this endpoint. Get a key at <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">platform.openai.com</a>. Whisper is billed per minute of audio — light restaurant use typically costs a few $ / month.
        </p>
        <Field label="OpenAI API key">
          <input
            type="password"
            className="input w-full"
            value={openaiKey}
            onChange={e => setOpenaiKey(e.target.value)}
            placeholder={status.openai_key_set ? '••••••••  (leave blank to keep existing)' : 'sk-…'}
            autoComplete="off"
          />
          <div className="text-[10px] text-text-3 mt-0.5 flex items-center gap-2">
            {status.openai_key_set
              ? <span className="text-green-600">✓ Configured — Safari / iOS voice input works</span>
              : <span>Not set — Safari / iOS users see "Voice unavailable"; Chromium users still work</span>}
            {status.openai_key_set && (
              <button onClick={() => handleClear('OPENAI_API_KEY')} className="text-red-500 hover:underline">Clear</button>
            )}
          </div>
        </Field>
      </div>

      <div className="flex justify-end pt-4">
        <button
          className="btn-primary px-5 py-2 text-sm"
          onClick={handleSave}
          disabled={saving || (!anthropic.trim() && !voyage.trim() && !brave.trim() && !githubPat.trim() && !githubRepo.trim() && !jiraUrl.trim() && !jiraEmail.trim() && !jiraToken.trim() && !jiraProject.trim() && !mapboxToken.trim() && !openaiKey.trim())}
        >
          {saving ? 'Saving…' : 'Save Keys'}
        </button>
      </div>

      {/* ── Response behaviour ── */}
      <div className="mt-8 pt-6 border-t border-border">
        <h2 className="text-base font-bold text-text-1 mb-1">Response Behaviour</h2>
        <p className="text-sm text-text-3 mb-4">Controls how Pepper formats its replies.</p>

        <div className="flex items-start justify-between gap-4 rounded-xl border border-border bg-surface-2/50 px-4 py-3.5">
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold text-text-1">Concise mode</div>
            <div className="text-xs text-text-3 mt-0.5">
              Pepper gives direct answers without narrating its investigation steps ("Let me check…", "I'll look that up…"). Tool calls happen silently — only the result is shown.
            </div>
          </div>
          <button
            role="switch"
            aria-checked={conciseMode}
            disabled={savingMode}
            onClick={() => handleToggleConciseMode(!conciseMode)}
            className={`relative flex-shrink-0 mt-0.5 w-10 h-5.5 rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-accent/50 ${
              conciseMode ? 'bg-accent' : 'bg-border'
            } ${savingMode ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
            style={{ height: '22px', width: '40px' }}
          >
            <span
              className={`absolute top-0.5 left-0.5 w-[18px] h-[18px] rounded-full bg-white shadow transition-transform ${
                conciseMode ? 'translate-x-[18px]' : 'translate-x-0'
              }`}
            />
          </button>
        </div>
      </div>

      {/* ── Monthly Token Allowance ── */}
      <div className="mt-8 pt-6 border-t border-border">
        <h2 className="text-base font-bold text-text-1 mb-1">Monthly Token Allowance</h2>
        <p className="text-sm text-text-3 mb-4">
          Set a maximum number of tokens each user can consume per billing period (25th → 24th). Set to <strong>0</strong> for unlimited. Applies to all users.
        </p>
        <div className="rounded-xl border border-border bg-surface-2/50 px-4 py-4">
          <div className="flex items-end gap-3 flex-wrap">
            <div className="flex-1 min-w-[200px]">
              <label className="block text-xs font-semibold text-text-2 mb-1.5">
                Tokens per month <span className="font-normal text-text-3">(0 = unlimited)</span>
              </label>
              <input
                type="number"
                min="0"
                step="10000"
                className="input w-full font-mono"
                value={monthlyTokenLimit}
                onChange={e => setMonthlyTokenLimit(e.target.value)}
                placeholder="0"
              />
              {Number(monthlyTokenLimit) > 0 && (
                <p className="text-xs text-text-3 mt-1">
                  ≈ ${((Number(monthlyTokenLimit) * 0.5 / 1_000_000) * (0.80 + 4.00)).toFixed(2)} est. cost/user/month at 50% input split
                </p>
              )}
            </div>
            <button
              className="btn-primary px-4 py-2 text-sm"
              onClick={handleSaveTokenLimit}
              disabled={savingLimit}
            >
              {savingLimit ? 'Saving…' : 'Save Limit'}
            </button>
          </div>
          {Number(monthlyTokenLimit) > 0 && (
            <div className="mt-3 pt-3 border-t border-border text-xs text-text-3">
              Users who exceed the limit will see a clear error message in Pepper — requests are blocked until the 25th. Admin accounts are subject to the same limit.
            </div>
          )}
        </div>
      </div>

      {/* ── Claude Code Integration ── */}
      <div className="mt-8 pt-6 border-t border-border">
        <h2 className="text-base font-bold text-text-1 mb-1">Claude Code Integration</h2>
        <p className="text-sm text-text-3 mb-4">
          Generate an API key so Claude Code can query bugs, feature requests, and change requests logged by Pepper directly from your terminal.
        </p>

        <div className="rounded-xl border border-border bg-surface-2/50 px-4 py-4 space-y-4">
          {claudeCodeKey ? (
            <>
              <div>
                <div className="text-xs font-semibold text-text-2 mb-1.5">Your API Key</div>
                <div className="flex items-center gap-2">
                  <code className="flex-1 font-mono text-xs bg-surface px-3 py-2 rounded-lg border border-border text-text-1 break-all select-all">
                    {claudeCodeKey}
                  </code>
                  <button
                    onClick={handleCopyKey}
                    className="btn-outline text-xs px-3 py-2 shrink-0"
                    title="Copy to clipboard"
                  >
                    {keyCopied ? '✓ Copied' : 'Copy'}
                  </button>
                </div>
              </div>
              <div className="text-xs text-text-3 bg-surface rounded-lg border border-border px-3 py-2.5 space-y-1">
                <div className="font-semibold text-text-2 mb-1">Add to .claude/settings.local.json in your project:</div>
                <code className="block text-xs font-mono whitespace-pre">{`"env": { "INTERNAL_API_KEY": "<paste key here>" }`}</code>
                <div className="mt-1.5">Then ask Claude Code: <span className="italic">"show me open bugs"</span> or <span className="italic">"list feature requests"</span></div>
              </div>
              <button
                onClick={handleGenerateKey}
                disabled={generatingKey}
                className="text-xs text-text-3 hover:text-red-500 transition-colors"
              >
                {generatingKey ? 'Regenerating…' : 'Regenerate key (invalidates current)'}
              </button>
            </>
          ) : (
            <div className="flex items-center justify-between gap-4">
              <div className="text-sm text-text-3">No key generated yet.</div>
              <button
                onClick={handleGenerateKey}
                disabled={generatingKey}
                className="btn-primary text-sm px-4 py-2 shrink-0"
              >
                {generatingKey ? 'Generating…' : 'Generate Key'}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ── Token Usage ── */}
      <div className="mt-8 pt-6 border-t border-border">
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-base font-bold text-text-1">Token Usage</h2>
          <button
            className="btn-outline text-xs px-3 py-1.5"
            onClick={loadUsage}
            disabled={usageLoading}
          >
            {usageLoading ? 'Loading…' : usage ? '↻ Refresh' : 'Load stats'}
          </button>
        </div>
        <p className="text-sm text-text-3 mb-4">
          Pepper AI token consumption and estimated cost (Claude Haiku 4.5 — $0.80/M input, $4.00/M output).
        </p>

        {usageLoading && <div className="py-6 text-center"><Spinner /></div>}

        {!usageLoading && usage && (() => {
          const s = usage.summary
          const fmtK = (n: number) => n >= 1_000_000 ? `${(n/1_000_000).toFixed(2)}M` : n >= 1_000 ? `${(n/1_000).toFixed(1)}k` : String(n)
          const fmtCost = (c: number) => c < 0.01 ? '<$0.01' : `$${c.toFixed(2)}`
          const maxDaily = Math.max(...usage.daily.map(d => d.tokens_in + d.tokens_out), 1)

          return (
            <>
              {/* Summary tiles */}
              <div className="grid grid-cols-2 gap-3 mb-5 sm:grid-cols-4">
                {[
                  { label: 'Total turns',    value: s.total_turns.toLocaleString() },
                  { label: 'Total sessions', value: s.total_sessions.toLocaleString() },
                  { label: 'Total tokens',   value: fmtK(s.tokens_total) },
                  { label: 'Est. cost',      value: fmtCost(s.cost_usd), highlight: true },
                ].map(({ label, value, highlight }) => (
                  <div key={label} className="rounded-xl border border-border bg-surface-2/50 px-4 py-3">
                    <div className="text-xs text-text-3 mb-0.5">{label}</div>
                    <div className={`text-lg font-bold ${highlight ? 'text-accent' : 'text-text-1'}`}>{value}</div>
                  </div>
                ))}
              </div>

              {/* Token split */}
              <div className="rounded-xl border border-border bg-surface-2/50 px-4 py-3 mb-5 flex gap-6 flex-wrap text-sm">
                <div><span className="text-text-3">Input tokens: </span><span className="font-mono font-semibold text-text-1">{fmtK(s.tokens_in)}</span> <span className="text-text-3 text-xs">({fmtCost((s.tokens_in/1_000_000)*0.80)})</span></div>
                <div><span className="text-text-3">Output tokens: </span><span className="font-mono font-semibold text-text-1">{fmtK(s.tokens_out)}</span> <span className="text-text-3 text-xs">({fmtCost((s.tokens_out/1_000_000)*4.00)})</span></div>
                {s.first_turn && <div className="ml-auto text-xs text-text-3">Since {new Date(s.first_turn).toLocaleDateString()}</div>}
              </div>

              {/* Daily bar chart — last 30 days */}
              {usage.daily.length > 0 && (
                <div className="rounded-xl border border-border bg-surface-2/50 px-4 py-3 mb-5">
                  <div className="text-xs font-semibold text-text-2 mb-3">Daily usage — last 30 days</div>
                  <div className="flex items-end gap-0.5 h-20 w-full">
                    {usage.daily.map(d => {
                      const total = d.tokens_in + d.tokens_out
                      const pct = Math.round((total / maxDaily) * 100)
                      const inPct = total > 0 ? Math.round((d.tokens_in / total) * 100) : 50
                      const label = `${new Date(d.day).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}\n${fmtK(total)} tokens\n${d.turns} turn${d.turns !== 1 ? 's' : ''}\n${fmtCost(d.cost_usd)}`
                      return (
                        <div
                          key={d.day}
                          className="flex-1 flex flex-col justify-end rounded-sm overflow-hidden cursor-default"
                          style={{ height: `${Math.max(pct, 2)}%`, minHeight: '2px' }}
                          title={label}
                        >
                          <div style={{ height: `${100 - inPct}%`, minHeight: '1px', background: 'var(--accent)' }} />
                          <div style={{ height: `${inPct}%`,       minHeight: '1px', background: 'var(--accent-dim)', filter: 'brightness(0.85)' }} />
                        </div>
                      )
                    })}
                  </div>
                  <div className="flex justify-between text-xs text-text-3 mt-1">
                    <span>{new Date(usage.daily[0].day).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
                    <span className="flex gap-3">
                      <span><span className="inline-block w-2 h-2 rounded-sm mr-1" style={{ background: 'var(--accent)' }} />Output</span>
                      <span><span className="inline-block w-2 h-2 rounded-sm mr-1" style={{ background: 'var(--accent-dim)', filter: 'brightness(0.85)' }} />Input</span>
                    </span>
                    <span>{new Date(usage.daily[usage.daily.length-1].day).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
                  </div>
                </div>
              )}

              {/* Per-user table */}
              {usage.by_user.length > 0 && (
                <div className="rounded-xl border border-border overflow-hidden">
                  <div className="px-4 py-2.5 bg-surface-2/50 border-b border-border flex items-center justify-between">
                    <span className="text-xs font-semibold text-text-2">Usage by user</span>
                    {usage.monthly_limit > 0 && (
                      <span className="text-xs text-text-3">
                        Period: {new Date(usage.period_start).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} → {new Date(usage.next_reset).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} · Limit: {fmtK(usage.monthly_limit)} tokens/user
                      </span>
                    )}
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-gray-200 border-b border-gray-300">
                        <tr>
                          {['User', 'Turns', 'Tokens in', 'Tokens out', 'Est. cost',
                            ...(usage.monthly_limit > 0 ? ['This period'] : []),
                            'Last active'].map(h => (
                            <th key={h} className="px-3 py-2 text-xs font-semibold text-gray-500 text-left">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {usage.by_user.map(u => {
                          const pct = usage.monthly_limit > 0 ? Math.min(100, Math.round((u.period_tokens / usage.monthly_limit) * 100)) : 0
                          const exceeded = usage.monthly_limit > 0 && u.period_tokens >= usage.monthly_limit
                          return (
                            <tr key={u.user} className="hover:bg-gray-50">
                              <td className="px-3 py-2 text-xs font-mono text-text-2 max-w-[180px] truncate" title={u.user}>{u.user}</td>
                              <td className="px-3 py-2 text-xs text-right">{u.turns.toLocaleString()}</td>
                              <td className="px-3 py-2 text-xs text-right font-mono">{fmtK(u.tokens_in)}</td>
                              <td className="px-3 py-2 text-xs text-right font-mono">{fmtK(u.tokens_out)}</td>
                              <td className="px-3 py-2 text-xs text-right font-semibold text-accent">{fmtCost(u.cost_usd)}</td>
                              {usage.monthly_limit > 0 && (
                                <td className="px-3 py-2 text-xs min-w-[120px]">
                                  <div className="flex items-center gap-1.5">
                                    <div className="flex-1 h-1.5 rounded-full bg-border overflow-hidden">
                                      <div className="h-full rounded-full transition-all"
                                        style={{ width: `${pct}%`, background: exceeded ? '#DC2626' : pct > 80 ? '#D97706' : 'var(--accent)' }} />
                                    </div>
                                    <span className={`font-mono whitespace-nowrap ${exceeded ? 'text-red-600 font-semibold' : 'text-text-3'}`}>
                                      {fmtK(u.period_tokens)}
                                    </span>
                                  </div>
                                </td>
                              )}
                              <td className="px-3 py-2 text-xs text-text-3">{new Date(u.last_active).toLocaleDateString()}</td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          )
        })()}

        {!usageLoading && !usage && (
          <div className="rounded-xl border border-border bg-surface-2/50 px-4 py-6 text-center text-sm text-text-3">
            Click <strong>Load stats</strong> to see token consumption and cost breakdown.
          </div>
        )}
      </div>

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  )
}

// ── Users Tab ─────────────────────────────────────────────────────────────────

interface AppUser {
  id:            number
  email:         string | null
  name:          string | null
  picture:       string | null
  status:        'pending' | 'active' | 'disabled'
  role_id:       number | null
  role_name:     string | null
  is_dev:        boolean
  scope: ScopeRow[]
  created_at:    string
  last_login_at: string | null
}

interface ScopeRow {
  id?:         number
  scope_type:  'brand_partner' | 'country'
  scope_id:    number
  scope_name?: string | null
  access_mode: 'grant' | 'deny'
  role_id:     number | null
  role_name?:  string | null
}

interface Role {
  id:          number
  name:        string
  description: string | null
  is_system:   boolean
  permissions: Partial<Record<Feature, AccessLevel>>
}

interface BrandPartner {
  id:         number
  name:       string
  countries?: { id: number; name: string }[]
}

interface CountryRef {
  id:                number
  name:              string
  brand_partner_id?: number | null
}

const STATUS_LABELS: Record<AppUser['status'], string> = {
  pending:  'Pending',
  active:   'Active',
  disabled: 'Disabled',
}
const STATUS_CLASSES: Record<AppUser['status'], string> = {
  pending:  'bg-yellow-50 text-yellow-700 border-yellow-200',
  active:   'bg-accent-dim text-accent border-accent/20',
  disabled: 'bg-gray-100 text-gray-500 border-gray-200',
}

function UsersTab() {
  const api = useApi()
  const { user: me, can } = usePermissions()

  const [users, setUsers]   = useState<AppUser[]>([])
  const [roles, setRoles]   = useState<Role[]>([])
  const [bps,   setBps]     = useState<BrandPartner[]>([])
  const [countries, setCountries] = useState<CountryRef[]>([])
  const [loading, setLoading] = useState(true)

  const [editing,    setEditing]    = useState<AppUser | null>(null)
  const [editRoleId, setEditRoleId] = useState<number | null>(null)
  const [editScope,  setEditScope]  = useState<ScopeRow[]>([])
  const [saving, setSaving] = useState(false)

  const [confirming, setConfirming] = useState<{ user: AppUser; action: 'disable' | 'enable' | 'delete' } | null>(null)
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [u, r, b, c] = await Promise.all([
        api.get('/users'),
        api.get('/roles'),
        api.get('/brand-partners'),
        api.get('/countries'),
      ])
      setUsers(u  || [])
      setRoles(r  || [])
      setBps(b    || [])
      setCountries(c || [])
    } catch { /* handled by toast */ }
    finally { setLoading(false) }
  }, [api])

  useEffect(() => { load() }, [load])

  if (!can('users', 'read')) {
    return <EmptyState message="You don't have permission to manage users." />
  }

  const canWrite = can('users', 'write')

  function openEdit(u: AppUser) {
    setEditing(u)
    setEditRoleId(u.role_id)
    setEditScope([...(u.scope || [])])
  }

  async function handleSaveEdit() {
    if (!editing) return
    setSaving(true)
    try {
      // Default role + status update
      await api.put(`/users/${editing.id}`, { role_id: editRoleId })
      // Scope replace — backend computes deltas + writes one audit entry per change
      await api.put(`/users/${editing.id}/scope`, {
        scope: editScope.map(s => ({
          scope_type:  s.scope_type,
          scope_id:    s.scope_id,
          access_mode: s.access_mode,
          role_id:     s.role_id ?? null,
        })),
      })
      setToast({ message: 'User updated', type: 'success' })
      setEditing(null)
      await load()
    } catch (err: any) {
      setToast({ message: err.message || 'Save failed', type: 'error' })
    } finally {
      setSaving(false)
    }
  }

  async function handleStatusChange(u: AppUser, status: 'active' | 'disabled') {
    try {
      await api.put(`/users/${u.id}`, { status })
      setToast({ message: `User ${status === 'active' ? 'approved' : 'disabled'}`, type: 'success' })
      await load()
    } catch (err: any) {
      setToast({ message: err.message || 'Failed', type: 'error' })
    } finally {
      setConfirming(null)
    }
  }

  async function handleDelete(u: AppUser) {
    try {
      await api.delete(`/users/${u.id}`)
      setToast({ message: 'User removed', type: 'success' })
      await load()
    } catch (err: any) {
      setToast({ message: err.message || 'Delete failed', type: 'error' })
    } finally {
      setConfirming(null)
    }
  }

  async function handleToggleDev(u: AppUser) {
    const next = !u.is_dev
    // Optimistic update
    setUsers(prev => prev.map(x => x.id === u.id ? { ...x, is_dev: next } : x))
    try {
      await api.put(`/users/${u.id}`, { is_dev: next })
      setToast({ message: next ? `${u.name || u.email} granted dev access` : `Dev access removed from ${u.name || u.email}`, type: 'success' })
    } catch (err: any) {
      // Revert on error
      setUsers(prev => prev.map(x => x.id === u.id ? { ...x, is_dev: u.is_dev } : x))
      setToast({ message: err.message || 'Failed to update dev access', type: 'error' })
    }
  }

  // ── Live preview: resolve editScope into a per-country effective role map ──
  const previewRows = useMemo(() => {
    if (!editing) return []
    const bpToCountries = new Map<number, CountryRef[]>()
    for (const c of countries) {
      if (c.brand_partner_id) {
        if (!bpToCountries.has(c.brand_partner_id)) bpToCountries.set(c.brand_partner_id, [])
        bpToCountries.get(c.brand_partner_id)!.push(c)
      }
    }
    const effective = new Map<number, { roleId: number | null; via: string }>()
    // BP grants
    for (const s of editScope) {
      if (s.scope_type === 'brand_partner' && s.access_mode === 'grant') {
        const cs = bpToCountries.get(s.scope_id) || []
        for (const c of cs) effective.set(c.id, { roleId: s.role_id ?? editRoleId, via: `BP: ${s.scope_name || s.scope_id}` })
      }
    }
    // BP denies → drop everything from that BP
    for (const s of editScope) {
      if (s.scope_type === 'brand_partner' && s.access_mode === 'deny') {
        const cs = bpToCountries.get(s.scope_id) || []
        for (const c of cs) effective.delete(c.id)
      }
    }
    // Country grants
    for (const s of editScope) {
      if (s.scope_type === 'country' && s.access_mode === 'grant') {
        effective.set(s.scope_id, { roleId: s.role_id ?? editRoleId, via: `Direct grant` })
      }
    }
    // Country denies
    for (const s of editScope) {
      if (s.scope_type === 'country' && s.access_mode === 'deny') effective.delete(s.scope_id)
    }
    const out: { country_id: number; country_name: string; role_name: string; via: string }[] = []
    for (const [cid, val] of effective) {
      const c = countries.find(x => x.id === cid)
      const role = roles.find(r => r.id === val.roleId)
      out.push({
        country_id:   cid,
        country_name: c?.name || `country:${cid}`,
        role_name:    role?.name || (val.roleId ? `role:${val.roleId}` : '— no role —'),
        via:          val.via,
      })
    }
    out.sort((a, b) => a.country_name.localeCompare(b.country_name))
    return out
  }, [editing, editScope, editRoleId, countries, roles])

  if (loading) return <Spinner />

  const pending = users.filter(u => u.status === 'pending')

  return (
    <div>
      {pending.length > 0 && (
        <div className="mb-4 flex items-center gap-3 bg-yellow-50 border border-yellow-200 rounded-xl px-4 py-3">
          <svg className="w-4 h-4 text-yellow-600 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span className="text-sm text-yellow-800 font-medium">
            {pending.length} user{pending.length > 1 ? 's' : ''} awaiting approval
          </span>
        </div>
      )}

      <div className="bg-surface border border-border rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-surface-2 border-b border-border">
              <th className="px-4 py-2.5 text-left text-xs font-semibold text-text-3">User</th>
              <th className="px-4 py-2.5 text-left text-xs font-semibold text-text-3">Status</th>
              <th className="px-4 py-2.5 text-left text-xs font-semibold text-text-3">Role</th>
              <th className="px-4 py-2.5 text-left text-xs font-semibold text-text-3">Market scope</th>
              <th className="px-4 py-2.5 text-left text-xs font-semibold text-text-3">Joined</th>
              {canWrite && <th className="px-4 py-2.5 text-right text-xs font-semibold text-text-3">Actions</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {users.length === 0 && (
              <tr><td colSpan={canWrite ? 6 : 5} className="px-4 py-8 text-center text-sm text-text-3">No users yet</td></tr>
            )}
            {users.map(u => (
              <tr key={u.id} className={`hover:bg-surface-2/50 ${u.id === me?.id ? 'bg-accent-dim/20' : ''}`}>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2.5">
                    {u.picture
                      ? <img src={u.picture} className="w-7 h-7 rounded-full object-cover shrink-0" alt="" />
                      : <div className="w-7 h-7 rounded-full bg-accent-dim flex items-center justify-center text-accent text-xs font-bold shrink-0">
                          {(u.email || u.name || '?')[0].toUpperCase()}
                        </div>
                    }
                    <div className="min-w-0">
                      <div className="font-semibold text-text-1 truncate">{u.name || '—'}</div>
                      <div className="text-xs text-text-3 truncate">{u.email}</div>
                    </div>
                    {u.id === me?.id && <span className="text-[10px] font-semibold text-accent bg-accent-dim px-1.5 py-0.5 rounded shrink-0">you</span>}
                  </div>
                </td>
                <td className="px-4 py-3">
                  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold border ${STATUS_CLASSES[u.status]}`}>
                    {STATUS_LABELS[u.status]}
                  </span>
                </td>
                <td className="px-4 py-3 text-text-2">{u.role_name || <span className="text-text-3 italic">None</span>}</td>
                <td className="px-4 py-3">
                  {(u.scope?.length ?? 0) === 0
                    ? <span className="text-xs text-text-3">All markets</span>
                    : <span className="text-xs text-text-2">
                        {u.scope.map(s => `${s.access_mode === 'deny' ? '✕ ' : ''}${s.scope_name || `${s.scope_type}:${s.scope_id}`}`).join(', ')}
                      </span>
                  }
                </td>
                <td className="px-4 py-3 text-xs text-text-3">
                  {new Date(u.created_at).toLocaleDateString()}
                </td>
                {canWrite && (
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1.5">
                      {u.status === 'pending' && (
                        <button
                          className="text-xs px-2.5 py-1 rounded-lg bg-accent text-white font-semibold hover:bg-accent-mid transition-colors"
                          onClick={() => handleStatusChange(u, 'active')}
                        >
                          Approve
                        </button>
                      )}
                      {u.status === 'active' && u.id !== me?.id && (
                        <button
                          className="text-xs px-2.5 py-1 rounded-lg border border-border text-text-3 hover:text-red-600 hover:border-red-200 transition-colors"
                          onClick={() => setConfirming({ user: u, action: 'disable' })}
                        >
                          Disable
                        </button>
                      )}
                      {u.status === 'disabled' && (
                        <button
                          className="text-xs px-2.5 py-1 rounded-lg border border-border text-text-3 hover:text-accent transition-colors"
                          onClick={() => setConfirming({ user: u, action: 'enable' })}
                        >
                          Enable
                        </button>
                      )}
                      <button
                        className={`p-1.5 rounded transition-colors font-mono text-xs font-bold leading-none
                          ${u.is_dev
                            ? 'bg-purple-100 text-purple-700 hover:bg-purple-200'
                            : 'hover:bg-surface-2 text-text-3 hover:text-purple-600'
                          }`}
                        title={u.is_dev ? 'Revoke dev access' : 'Grant dev access'}
                        onClick={() => handleToggleDev(u)}
                      >
                        {'</>'}
                      </button>
                      <button
                        className="p-1.5 rounded hover:bg-surface-2 text-text-3 hover:text-accent transition-colors"
                        title="Edit role & scope"
                        onClick={() => openEdit(u)}
                      >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                        </svg>
                      </button>
                      {u.id !== me?.id && (
                        <button
                          className="p-1.5 rounded hover:bg-surface-2 text-text-3 hover:text-red-600 transition-colors"
                          title="Remove user"
                          onClick={() => setConfirming({ user: u, action: 'delete' })}
                        >
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      )}
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing && (
        <Modal title={`Edit — ${editing.name || editing.email}`} onClose={() => setEditing(null)} width="max-w-3xl">
          <ScopeEditor
            roles={roles}
            bps={bps}
            countries={countries}
            defaultRoleId={editRoleId}
            setDefaultRoleId={setEditRoleId}
            scope={editScope}
            setScope={setEditScope}
            previewRows={previewRows}
            onSave={handleSaveEdit}
            onCancel={() => setEditing(null)}
            saving={saving}
          />
        </Modal>
      )}

      {confirming?.action === 'disable' && (
        <ConfirmDialog
          message={`Disable ${confirming.user.name || confirming.user.email}? They will no longer be able to sign in.`}
          danger
          onConfirm={() => handleStatusChange(confirming.user, 'disabled')}
          onCancel={() => setConfirming(null)}
        />
      )}
      {confirming?.action === 'enable' && (
        <ConfirmDialog
          message={`Re-enable ${confirming.user.name || confirming.user.email}? They will be able to sign in again.`}
          danger={false}
          onConfirm={() => handleStatusChange(confirming.user, 'active')}
          onCancel={() => setConfirming(null)}
        />
      )}
      {confirming?.action === 'delete' && (
        <ConfirmDialog
          message={`Permanently remove ${confirming.user.name || confirming.user.email}? They can re-register but will start as pending again.`}
          danger
          onConfirm={() => handleDelete(confirming.user)}
          onCancel={() => setConfirming(null)}
        />
      )}

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  )
}

// ── Scope Editor (used by UsersTab edit modal) ────────────────────────────────
//
// Lets the admin pick BP-level and country-level scope rows for a user, with
// an optional per-row role override and grant/deny mode. Includes bulk-add
// (multi-select pickers) and a live preview pane that resolves the scope
// rows into a per-country effective role map. The default user role at the
// top is the fallback for any scope row that doesn't override.

function ScopeEditor({
  roles, bps, countries,
  defaultRoleId, setDefaultRoleId,
  scope, setScope,
  previewRows,
  onSave, onCancel, saving,
}: {
  roles: Role[]
  bps: BrandPartner[]
  countries: CountryRef[]
  defaultRoleId: number | null
  setDefaultRoleId: (id: number | null) => void
  scope: ScopeRow[]
  setScope: (next: ScopeRow[] | ((prev: ScopeRow[]) => ScopeRow[])) => void
  previewRows: { country_id: number; country_name: string; role_name: string; via: string }[]
  onSave: () => void
  onCancel: () => void
  saving: boolean
}) {
  const [bpAddOpen,  setBpAddOpen]  = useState(false)
  const [ctyAddOpen, setCtyAddOpen] = useState(false)
  const [bpPicked,   setBpPicked]   = useState<Set<number>>(new Set())
  const [ctyPicked,  setCtyPicked]  = useState<Set<number>>(new Set())

  const usedBpIds  = useMemo(() => new Set(scope.filter(s => s.scope_type === 'brand_partner').map(s => s.scope_id)), [scope])
  const usedCtyIds = useMemo(() => new Set(scope.filter(s => s.scope_type === 'country').map(s => s.scope_id)), [scope])

  const availableBps      = bps.filter(b => !usedBpIds.has(b.id))
  const availableCountries = countries.filter(c => !usedCtyIds.has(c.id))

  function addPickedBps() {
    const adds: ScopeRow[] = Array.from(bpPicked).map(id => ({
      scope_type: 'brand_partner', scope_id: id, access_mode: 'grant', role_id: null,
      scope_name: bps.find(b => b.id === id)?.name || null,
    }))
    setScope(prev => [...prev, ...adds])
    setBpPicked(new Set())
    setBpAddOpen(false)
  }
  function addPickedCountries() {
    const adds: ScopeRow[] = Array.from(ctyPicked).map(id => ({
      scope_type: 'country', scope_id: id, access_mode: 'grant', role_id: null,
      scope_name: countries.find(c => c.id === id)?.name || null,
    }))
    setScope(prev => [...prev, ...adds])
    setCtyPicked(new Set())
    setCtyAddOpen(false)
  }

  function updateRow(idx: number, patch: Partial<ScopeRow>) {
    setScope(prev => prev.map((r, i) => i === idx ? { ...r, ...patch } : r))
  }
  function removeRow(idx: number) {
    setScope(prev => prev.filter((_, i) => i !== idx))
  }

  const bpRows  = scope.map((s, i) => ({ s, i })).filter(({ s }) => s.scope_type === 'brand_partner')
  const ctyRows = scope.map((s, i) => ({ s, i })).filter(({ s }) => s.scope_type === 'country')

  return (
    <div className="space-y-5">

      {/* Default role */}
      <Field label="Default role" hint="Used for any scope row that doesn't override the role.">
        <select
          className="input w-full"
          value={defaultRoleId ?? ''}
          onChange={e => setDefaultRoleId(e.target.value ? Number(e.target.value) : null)}
        >
          <option value="">No role</option>
          {roles.map(r => (
            <option key={r.id} value={r.id}>{r.name}</option>
          ))}
        </select>
      </Field>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

        {/* Brand Partner scope */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-sm font-semibold text-text-1">Brand Partners</h4>
            <button className="btn-outline text-xs" onClick={() => setBpAddOpen(true)} disabled={availableBps.length === 0}>
              + Add BP
            </button>
          </div>
          <div className="border border-border rounded-lg overflow-hidden">
            {bpRows.length === 0 ? (
              <p className="text-xs text-text-3 px-3 py-3 italic">No BP-level scope rows</p>
            ) : bpRows.map(({ s, i }) => (
              <ScopeRowEditor
                key={`bp-${s.scope_id}`}
                row={s}
                roles={roles}
                onChange={patch => updateRow(i, patch)}
                onRemove={() => removeRow(i)}
              />
            ))}
          </div>
        </div>

        {/* Country scope */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-sm font-semibold text-text-1">Direct countries</h4>
            <button className="btn-outline text-xs" onClick={() => setCtyAddOpen(true)} disabled={availableCountries.length === 0}>
              + Add country
            </button>
          </div>
          <div className="border border-border rounded-lg overflow-hidden">
            {ctyRows.length === 0 ? (
              <p className="text-xs text-text-3 px-3 py-3 italic">No country-level overrides</p>
            ) : ctyRows.map(({ s, i }) => (
              <ScopeRowEditor
                key={`cty-${s.scope_id}`}
                row={s}
                roles={roles}
                onChange={patch => updateRow(i, patch)}
                onRemove={() => removeRow(i)}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Live preview */}
      <div>
        <h4 className="text-sm font-semibold text-text-1 mb-2">Effective access ({previewRows.length} market{previewRows.length !== 1 ? 's' : ''})</h4>
        <div className="border border-border rounded-lg overflow-hidden max-h-48 overflow-y-auto">
          {scope.length === 0 ? (
            <p className="text-xs text-text-3 px-3 py-3">No scope rows — user is unrestricted (access to all markets with default role).</p>
          ) : previewRows.length === 0 ? (
            <p className="text-xs text-text-3 px-3 py-3 italic">No markets resolve from the current scope rows.</p>
          ) : (
            <table className="w-full text-xs">
              <thead className="bg-surface-2 sticky top-0">
                <tr className="text-left text-text-3">
                  <th className="px-3 py-1.5">Country</th>
                  <th className="px-3 py-1.5">Role</th>
                  <th className="px-3 py-1.5">Source</th>
                </tr>
              </thead>
              <tbody>
                {previewRows.map(p => (
                  <tr key={p.country_id} className="border-t border-border">
                    <td className="px-3 py-1.5 text-text-1">{p.country_name}</td>
                    <td className="px-3 py-1.5 text-text-2">{p.role_name}</td>
                    <td className="px-3 py-1.5 text-text-3">{p.via}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div className="flex justify-end gap-2 pt-1 border-t border-border">
        <button className="btn-outline px-4 py-2 text-sm" onClick={onCancel} disabled={saving}>Cancel</button>
        <button className="btn-primary px-4 py-2 text-sm" onClick={onSave} disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>

      {/* Bulk-add BP picker */}
      {bpAddOpen && (
        <Modal title="Add brand partners" onClose={() => setBpAddOpen(false)} width="max-w-md">
          <div className="space-y-2">
            <p className="text-xs text-text-3">Select one or more to add as scope rows.</p>
            <div className="border border-border rounded-lg max-h-72 overflow-y-auto">
              {availableBps.length === 0 ? (
                <p className="text-xs text-text-3 px-3 py-3 italic">All BPs already in scope.</p>
              ) : availableBps.map(bp => (
                <label key={bp.id} className="flex items-center gap-2 px-3 py-1.5 border-b border-border last:border-0 cursor-pointer hover:bg-surface-2">
                  <input
                    type="checkbox"
                    checked={bpPicked.has(bp.id)}
                    onChange={() => setBpPicked(s => { const n = new Set(s); n.has(bp.id) ? n.delete(bp.id) : n.add(bp.id); return n })}
                  />
                  <span className="text-sm text-text-1">{bp.name}</span>
                </label>
              ))}
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <button className="btn-outline px-3 py-1.5 text-sm" onClick={() => setBpAddOpen(false)}>Cancel</button>
              <button className="btn-primary px-3 py-1.5 text-sm disabled:opacity-50" onClick={addPickedBps} disabled={bpPicked.size === 0}>
                Add {bpPicked.size}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Bulk-add country picker */}
      {ctyAddOpen && (
        <Modal title="Add countries" onClose={() => setCtyAddOpen(false)} width="max-w-md">
          <div className="space-y-2">
            <p className="text-xs text-text-3">Select one or more countries to add. Use country grants to add markets that aren't covered by any of the user's BPs, or country denies to punch holes in BP coverage.</p>
            <div className="border border-border rounded-lg max-h-72 overflow-y-auto">
              {availableCountries.length === 0 ? (
                <p className="text-xs text-text-3 px-3 py-3 italic">All countries already in scope.</p>
              ) : availableCountries.map(c => (
                <label key={c.id} className="flex items-center gap-2 px-3 py-1.5 border-b border-border last:border-0 cursor-pointer hover:bg-surface-2">
                  <input
                    type="checkbox"
                    checked={ctyPicked.has(c.id)}
                    onChange={() => setCtyPicked(s => { const n = new Set(s); n.has(c.id) ? n.delete(c.id) : n.add(c.id); return n })}
                  />
                  <span className="text-sm text-text-1 flex-1">{c.name}</span>
                  {c.brand_partner_id && (
                    <span className="text-[10px] text-text-3">via BP</span>
                  )}
                </label>
              ))}
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <button className="btn-outline px-3 py-1.5 text-sm" onClick={() => setCtyAddOpen(false)}>Cancel</button>
              <button className="btn-primary px-3 py-1.5 text-sm disabled:opacity-50" onClick={addPickedCountries} disabled={ctyPicked.size === 0}>
                Add {ctyPicked.size}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}

function ScopeRowEditor({ row, roles, onChange, onRemove }: {
  row: ScopeRow
  roles: Role[]
  onChange: (patch: Partial<ScopeRow>) => void
  onRemove: () => void
}) {
  return (
    <div className="px-3 py-2 border-b border-border last:border-0 flex items-center gap-2">
      <span className="text-sm text-text-1 flex-1 truncate">{row.scope_name || `${row.scope_type}:${row.scope_id}`}</span>
      <select
        className="input text-xs py-0.5 px-1"
        value={row.access_mode}
        onChange={e => onChange({ access_mode: e.target.value as 'grant' | 'deny' })}
        title="Grant or deny access"
      >
        <option value="grant">grant</option>
        <option value="deny">deny</option>
      </select>
      <select
        className="input text-xs py-0.5 px-1 w-32"
        value={row.role_id ?? ''}
        onChange={e => onChange({ role_id: e.target.value ? Number(e.target.value) : null })}
        title="Override role for this scope (blank = inherit default)"
        disabled={row.access_mode === 'deny'}
      >
        <option value="">— inherit —</option>
        {roles.map(r => (
          <option key={r.id} value={r.id}>{r.name}</option>
        ))}
      </select>
      <button
        className="text-text-3 hover:text-red-500 transition-colors"
        onClick={onRemove}
        title="Remove scope row"
      >✕</button>
    </div>
  )
}

// ── Roles Tab ─────────────────────────────────────────────────────────────────

const FEATURES_LIST: { key: Feature | null; label: string; group?: boolean }[] = [
  { key: 'dashboard',              label: 'Dashboard'        },
  { key: 'inventory',              label: 'Inventory'        },
  { key: 'recipes',                label: 'Recipes'          },
  { key: 'menus',                  label: 'Menus'            },
  { key: 'allergens',              label: 'Allergens'        },
  { key: 'haccp',                  label: 'HACCP'            },
  { key: 'markets',                label: 'Markets'          },
  { key: 'categories',             label: 'Categories'       },
  { key: 'settings',               label: 'Settings'         },
  { key: 'import',                 label: 'Import'           },
  { key: 'ai_chat',                label: 'AI Chat'          },
  { key: 'users',                  label: 'Users'            },
  { key: null,                     label: 'Stock Manager', group: true },
  { key: 'stock_overview',         label: 'Overview & Centres'},
  { key: 'stock_purchase_orders',  label: 'Purchase Orders'  },
  { key: 'stock_goods_in',         label: 'Goods In'         },
  { key: 'stock_invoices',         label: 'Invoices'         },
  { key: 'stock_waste',            label: 'Waste'            },
  { key: 'stock_transfers',        label: 'Transfers'        },
  { key: 'stock_stocktake',        label: 'Stocktake'        },
]

const ACCESS_CYCLE: AccessLevel[] = ['none', 'read', 'write']

const ACCESS_CELL: Record<AccessLevel, string> = {
  none:  'text-gray-400 hover:bg-gray-100',
  read:  'bg-blue-50 text-blue-600 hover:bg-blue-100',
  write: 'bg-accent-dim text-accent hover:bg-accent-dim/70',
}

function RolesTab() {
  const api = useApi()
  const { can } = usePermissions()

  const [roles,   setRoles]   = useState<Role[]>([])
  const [loading, setLoading] = useState(true)
  // saving = Set of "roleId:feature" keys currently being saved
  const [saving,  setSaving]  = useState<Set<string>>(new Set())

  const [creating,  setCreating]  = useState(false)
  const [newName,   setNewName]   = useState('')
  const [newDesc,   setNewDesc]   = useState('')
  const [copyFrom,  setCopyFrom]  = useState<number | ''>('')
  const [newSaving, setNewSaving] = useState(false)

  const [renaming,     setRenaming]     = useState<Role | null>(null)
  const [renameName,   setRenameName]   = useState('')
  const [renameDesc,   setRenameDesc]   = useState('')
  const [renameSaving, setRenameSaving] = useState(false)

  const [deleting, setDeleting] = useState<Role | null>(null)
  const [toast,    setToast]    = useState<{ message: string; type: 'success' | 'error' } | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try { setRoles(await api.get('/roles') || []) }
    catch { /* ignore */ }
    finally { setLoading(false) }
  }, [api])

  useEffect(() => { load() }, [load])

  if (!can('users', 'read')) {
    return <EmptyState message="You don't have permission to manage roles." />
  }

  const canWrite = can('users', 'write')

  // Click a cell → cycle access and save immediately
  async function handleCell(role: Role, feature: Feature) {
    if (!canWrite) return
    if (role.is_system && role.name !== 'Admin' && feature === 'users') return

    const cur   = role.permissions[feature] || 'none'
    const next  = ACCESS_CYCLE[(ACCESS_CYCLE.indexOf(cur) + 1) % ACCESS_CYCLE.length]
    const key   = `${role.id}:${feature}`
    const newPerms = { ...role.permissions, [feature]: next }

    // Optimistic update
    setRoles(prev => prev.map(r =>
      r.id === role.id ? { ...r, permissions: { ...r.permissions, [feature]: next } } : r
    ))
    setSaving(s => new Set([...s, key]))

    try {
      await api.put(`/roles/${role.id}`, { permissions: newPerms })
    } catch (err: any) {
      // Revert on error
      setRoles(prev => prev.map(r =>
        r.id === role.id ? { ...r, permissions: { ...r.permissions, [feature]: cur } } : r
      ))
      setToast({ message: err.message || 'Save failed', type: 'error' })
    } finally {
      setSaving(s => { const n = new Set(s); n.delete(key); return n })
    }
  }

  async function handleCreate() {
    if (!newName.trim()) return
    setNewSaving(true)
    try {
      await api.post('/roles', {
        name:              newName.trim(),
        description:       newDesc.trim() || null,
        copy_from_role_id: copyFrom || undefined,
      })
      setToast({ message: 'Role created', type: 'success' })
      setCreating(false); setNewName(''); setNewDesc(''); setCopyFrom('')
      await load()
    } catch (err: any) {
      setToast({ message: err.message || 'Create failed', type: 'error' })
    } finally { setNewSaving(false) }
  }

  async function handleRename() {
    if (!renaming || !renameName.trim()) return
    setRenameSaving(true)
    try {
      await api.put(`/roles/${renaming.id}`, { name: renameName.trim(), description: renameDesc.trim() || null })
      setToast({ message: 'Role renamed', type: 'success' })
      setRenaming(null)
      await load()
    } catch (err: any) {
      setToast({ message: err.message || 'Rename failed', type: 'error' })
    } finally { setRenameSaving(false) }
  }

  async function handleDelete(r: Role) {
    try {
      await api.delete(`/roles/${r.id}`)
      setToast({ message: 'Role deleted', type: 'success' })
      setDeleting(null); await load()
    } catch (err: any) {
      setToast({ message: err.message || 'Delete failed', type: 'error' })
      setDeleting(null)
    }
  }

  if (loading) return <Spinner />

  return (
    <div className="space-y-4">

      {/* Toolbar */}
      <div className="flex items-center justify-between">
        <p className="text-xs text-text-3">Click any cell to cycle: <span className="font-mono">— → R → W</span>. Changes save instantly.</p>
        {canWrite && (
          <button className="btn-primary px-4 py-2 text-sm" onClick={() => setCreating(true)}>
            + New role
          </button>
        )}
      </div>

      {roles.length === 0 && <EmptyState message="No roles defined yet." />}

      {/* Matrix table */}
      {roles.length > 0 && (
        <div className="bg-surface border border-border rounded-xl overflow-hidden overflow-x-auto">
          <table className="text-sm border-separate border-spacing-0" style={{ minWidth: `${180 + roles.length * 110}px` }}>
            <thead>
              <tr>
                {/* Feature column header */}
                <th className="px-4 py-3 text-left text-xs font-semibold text-text-3 bg-surface-2 border-b border-r border-border sticky left-0 z-10 w-36">
                  Feature
                </th>
                {/* One column per role */}
                {roles.map(role => (
                  <th key={role.id} className="px-3 py-2 bg-surface-2 border-b border-r border-border last:border-r-0 text-center min-w-[108px]">
                    <div className="flex flex-col items-center gap-1">
                      <div className="flex items-center gap-1.5 justify-center">
                        <span className="font-bold text-text-1 text-xs leading-tight">{role.name}</span>
                        {role.is_system && (
                          <span className="text-[9px] font-semibold text-accent bg-accent-dim px-1 py-0.5 rounded leading-none shrink-0">SYS</span>
                        )}
                      </div>
                      {role.description && (
                        <span className="text-[10px] text-text-3 truncate max-w-[90px]">{role.description}</span>
                      )}
                      {canWrite && !role.is_system && (
                        <div className="flex items-center gap-1 mt-0.5">
                          <button
                            className="p-0.5 rounded text-text-3 hover:text-accent transition-colors"
                            title="Rename"
                            onClick={() => { setRenaming(role); setRenameName(role.name); setRenameDesc(role.description || '') }}
                          >
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                            </svg>
                          </button>
                          <button
                            className="p-0.5 rounded text-text-3 hover:text-red-500 transition-colors"
                            title="Delete"
                            onClick={() => setDeleting(role)}
                          >
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        </div>
                      )}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {FEATURES_LIST.map(({ key, label, group }, rowIdx) => {
                // Group header row (visual separator)
                if (group) return (
                  <tr key={`group-${label}`} className="bg-gray-100">
                    <td className="px-4 py-1.5 text-[10px] font-bold uppercase tracking-wider text-text-3 border-r border-border sticky left-0 z-10 bg-gray-100" colSpan={1}>
                      {label}
                    </td>
                    {roles.map(role => (
                      <td key={role.id} className="border-r border-border last:border-r-0" />
                    ))}
                  </tr>
                )
                if (!key) return null
                return (
                <tr key={key} className={rowIdx % 2 === 0 ? 'bg-surface' : 'bg-surface-2/40'}>
                  {/* Feature label — sticky */}
                  <td className={`px-4 py-2 font-medium text-text-1 text-xs border-r border-border sticky left-0 z-10 ${key.startsWith('stock_') ? 'pl-7' : ''} ${rowIdx % 2 === 0 ? 'bg-surface' : 'bg-surface-2/40'}`}>
                    {label}
                  </td>
                  {/* Permission cell per role */}
                  {roles.map(role => {
                    const access  = role.permissions[key] || 'none'
                    const cellKey = `${role.id}:${key}`
                    const isSaving = saving.has(cellKey)
                    const isLocked = role.is_system && role.name !== 'Admin' && key === 'users'
                    const isClickable = canWrite && !isLocked && !isSaving

                    return (
                      <td key={role.id} className="px-3 py-2 text-center border-r border-border last:border-r-0">
                        <button
                          onClick={() => isClickable && handleCell(role, key)}
                          disabled={!isClickable}
                          title={isLocked ? 'Locked for this role' : isClickable ? 'Click to change' : undefined}
                          className={`
                            w-9 h-7 rounded-md text-xs font-bold font-mono transition-all mx-auto flex items-center justify-center
                            ${isSaving ? 'opacity-50 cursor-wait' : ''}
                            ${isLocked ? 'opacity-30 cursor-not-allowed bg-gray-100 text-gray-400' : ACCESS_CELL[access]}
                            ${isClickable ? 'cursor-pointer' : ''}
                          `}
                        >
                          {isSaving
                            ? <svg className="w-3 h-3 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path strokeLinecap="round" strokeWidth={2} d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4"/></svg>
                            : access === 'none' ? '—' : access === 'read' ? 'R' : 'W'
                          }
                        </button>
                      </td>
                    )
                  })}
                </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Create modal */}
      {creating && (
        <Modal title="New role" onClose={() => setCreating(false)}>
          <div className="space-y-4">
            <Field label="Name" required>
              <input className="input w-full" value={newName} onChange={e => setNewName(e.target.value)} placeholder="e.g. Kitchen Manager" autoFocus />
            </Field>
            <Field label="Description">
              <input className="input w-full" value={newDesc} onChange={e => setNewDesc(e.target.value)} placeholder="Optional" />
            </Field>
            <Field label="Copy permissions from" hint="Start from an existing role's permission set">
              <select className="input w-full" value={copyFrom} onChange={e => setCopyFrom(e.target.value ? Number(e.target.value) : '')}>
                <option value="">All permissions set to none</option>
                {roles.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </Field>
            <div className="flex justify-end gap-2 pt-1">
              <button className="btn-outline px-4 py-2 text-sm" onClick={() => setCreating(false)}>Cancel</button>
              <button className="btn-primary px-4 py-2 text-sm" onClick={handleCreate} disabled={newSaving || !newName.trim()}>
                {newSaving ? 'Creating…' : 'Create role'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Rename modal */}
      {renaming && (
        <Modal title={`Rename — ${renaming.name}`} onClose={() => setRenaming(null)}>
          <div className="space-y-4">
            <Field label="Name" required>
              <input className="input w-full" value={renameName} onChange={e => setRenameName(e.target.value)} autoFocus />
            </Field>
            <Field label="Description">
              <input className="input w-full" value={renameDesc} onChange={e => setRenameDesc(e.target.value)} placeholder="Optional" />
            </Field>
            <div className="flex justify-end gap-2 pt-1">
              <button className="btn-outline px-4 py-2 text-sm" onClick={() => setRenaming(null)}>Cancel</button>
              <button className="btn-primary px-4 py-2 text-sm" onClick={handleRename} disabled={renameSaving || !renameName.trim()}>
                {renameSaving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {deleting && (
        <ConfirmDialog
          message={`Delete role "${deleting.name}"? Users assigned to this role will have no role. This cannot be undone.`}
          danger
          onConfirm={() => handleDelete(deleting)}
          onCancel={() => setDeleting(null)}
        />
      )}

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  )
}
