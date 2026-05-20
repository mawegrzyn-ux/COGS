// Shared types + helpers for the QSC Audit Tool pages.

export type AuditType   = 'external' | 'internal'
export type AuditStatus = 'in_progress' | 'completed' | 'cancelled'
export type RespStatus  = 'compliant' | 'not_compliant' | 'not_observed' | 'not_applicable' | 'informational'

export interface Question {
  id: number
  code: string
  version: number
  department: string | null
  category: string | null
  title: string
  risk_level: string
  points: number
  repeat_points: number
  policy: string | null
  auto_unacceptable: boolean
  photo_required: boolean
  temperature_input: boolean
  cross_refs: string[]
  sort_order: number
  active: boolean
}

export interface AuditResponsePhoto {
  id: number
  response_id: number
  url: string
  caption: string | null
  uploaded_at: string
}

export interface AuditResponse {
  id: number
  audit_id: number
  question_code: string
  status: RespStatus
  is_repeat: boolean
  points_deducted: number
  comment: string | null
  temperature_value: number | null
  temperature_unit: 'F' | 'C' | null
  product_name: string | null
  answered_at: string
  photos?: AuditResponsePhoto[]
}

export interface Audit {
  id: number
  key: string
  audit_type: AuditType
  location_id: number | null
  location_name?: string
  template_id: number | null
  template_name?: string
  question_version: number
  auditor_sub: string | null
  auditor_name: string | null
  started_at: string
  completed_at: string | null
  status: AuditStatus
  overall_score: number | null
  overall_rating: string | null
  auto_unacceptable: boolean
  notes: string | null
  response_count?: number
}

export interface AuditTemplate {
  id: number
  name: string
  description: string | null
  question_codes: string[]
  is_system: boolean
  created_by: string | null
  created_at: string
  updated_at: string
}

export const RISK_COLOURS: Record<string, string> = {
  'Critical First Priority': 'bg-red-100 text-red-700 border-red-200',
  'First Priority':          'bg-orange-100 text-orange-700 border-orange-200',
  'Second Priority':         'bg-amber-100 text-amber-700 border-amber-200',
  'Third Priority':          'bg-slate-100 text-slate-700 border-slate-200',
  'Information Only':        'bg-blue-100 text-blue-700 border-blue-200',
}

export const RATING_COLOURS: Record<string, string> = {
  'Acceptable':         'bg-green-100 text-green-700 border-green-200',
  'Needs Improvement':  'bg-amber-100 text-amber-700 border-amber-200',
  'Unacceptable':       'bg-red-100 text-red-700 border-red-200',
}

export function riskChipClass(risk: string): string {
  return RISK_COLOURS[risk] || 'bg-slate-100 text-slate-700 border-slate-200'
}

export function ratingBadgeClass(rating: string | null): string {
  if (!rating) return 'bg-surface-2 text-text-3 border-border'
  return RATING_COLOURS[rating] || 'bg-surface-2 text-text-3 border-border'
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  try { return new Date(iso).toLocaleDateString() } catch { return '—' }
}

export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  try { return new Date(iso).toLocaleString() } catch { return '—' }
}
