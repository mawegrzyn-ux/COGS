import { useState, useRef } from 'react'
import { Modal, Spinner } from './ui'

interface ImportWizardProps {
  boardId: string
  columns: { id: number; name: string }[]
  onClose: () => void
  onComplete: () => void
}

interface PreviewData {
  headers: string[]
  rows: Record<string, string>[]
  suggested_mapping: Record<string, string>
  unique_statuses: string[]
}

type FieldMapping = Record<string, string>
type StatusMapping = Record<string, number>

const CARD_FIELDS = [
  { value: '',             label: '-- Skip --' },
  { value: 'title',        label: 'Title' },
  { value: 'description',  label: 'Description' },
  { value: 'priority',     label: 'Priority' },
  { value: 'labels',       label: 'Labels' },
  { value: 'story_points', label: 'Story Points' },
  { value: 'epic',         label: 'Epic' },
  { value: 'jira_key',     label: 'Jira Key' },
  { value: 'status',       label: 'Status (for column mapping)' },
]

export default function ImportWizard({ boardId, columns, onClose, onComplete }: ImportWizardProps) {
  const [step, setStep] = useState(1)
  const [file, setFile] = useState<File | null>(null)
  const [dragActive, setDragActive] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const [preview, setPreview] = useState<PreviewData | null>(null)
  const [fieldMapping, setFieldMapping] = useState<FieldMapping>({})
  const [statusMapping, setStatusMapping] = useState<StatusMapping>({})
  const [importing, setImporting] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  // Step 1: Upload
  async function handleUpload() {
    if (!file) return
    setUploading(true)
    setError('')
    try {
      const formData = new FormData()
      formData.append('file', file)
      const res = await fetch(`/api/boards/${boardId}/import/preview`, {
        method: 'POST',
        body: formData,
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: { message: 'Upload failed' } }))
        throw new Error(err.error?.message || 'Upload failed')
      }
      const data = await res.json()
      setPreview(data)
      // Auto-fill field mapping from suggestions
      const mapping: FieldMapping = {}
      if (data.suggested_mapping) {
        for (const [header, field] of Object.entries(data.suggested_mapping)) {
          mapping[header] = field as string
        }
      }
      setFieldMapping(mapping)
      // Default status mapping: first column for all statuses
      const sm: StatusMapping = {}
      if (data.unique_statuses && columns.length > 0) {
        for (const s of data.unique_statuses) {
          sm[s] = columns[0].id
        }
      }
      setStatusMapping(sm)
      setStep(2)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragActive(false)
    const f = e.dataTransfer.files[0]
    if (f) setFile(f)
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault()
    setDragActive(true)
  }

  // Step 4: Execute import
  async function handleImport() {
    setImporting(true)
    setError('')
    try {
      const res = await fetch(`/api/boards/${boardId}/import/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          field_mapping: fieldMapping,
          status_mapping: statusMapping,
        }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: { message: 'Import failed' } }))
        throw new Error(err.error?.message || 'Import failed')
      }
      onComplete()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed')
    } finally {
      setImporting(false)
    }
  }

  // Compute mapped preview rows for step 3
  const mappedRows = preview ? preview.rows.slice(0, 10).map(row => {
    const mapped: Record<string, string> = {}
    for (const [header, field] of Object.entries(fieldMapping)) {
      if (field && field !== 'status') {
        mapped[field] = row[header] ?? ''
      }
    }
    // Resolve status to column name
    const statusHeader = Object.entries(fieldMapping).find(([, v]) => v === 'status')?.[0]
    if (statusHeader && row[statusHeader]) {
      const colId = statusMapping[row[statusHeader]]
      const col = columns.find(c => c.id === colId)
      mapped['column'] = col?.name ?? 'Unknown'
    }
    return mapped
  }) : []

  const totalCards = preview?.rows.length ?? 0

  return (
    <Modal title="Import Cards" onClose={onClose} width="max-w-3xl">
      {/* Step indicator */}
      <div className="flex items-center gap-2 mb-6">
        {['Upload', 'Map Fields', 'Preview', 'Confirm'].map((label, i) => {
          const stepNum = i + 1
          const isActive = step === stepNum
          const isDone = step > stepNum
          return (
            <div key={label} className="flex items-center gap-2">
              {i > 0 && <div className={`w-8 h-0.5 ${isDone || isActive ? 'bg-accent' : 'bg-border'}`} />}
              <div className={`flex items-center gap-1.5 ${isActive ? 'text-accent font-bold' : isDone ? 'text-accent' : 'text-text-3'}`}>
                <span className={`w-6 h-6 rounded-full text-xs flex items-center justify-center font-bold ${
                  isActive ? 'bg-accent text-white' : isDone ? 'bg-accent-dim text-accent' : 'bg-surface-2 text-text-3'
                }`}>
                  {isDone ? (
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><path d="M20 6L9 17l-5-5"/></svg>
                  ) : stepNum}
                </span>
                <span className="text-xs hidden sm:inline">{label}</span>
              </div>
            </div>
          )
        })}
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700 mb-4">
          {error}
        </div>
      )}

      {/* Step 1: Upload */}
      {step === 1 && (
        <div>
          <div
            className={`border-2 border-dashed rounded-xl p-12 text-center transition-colors cursor-pointer ${
              dragActive ? 'border-accent bg-accent-dim/30' : 'border-border hover:border-accent/50'
            }`}
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={() => setDragActive(false)}
            onClick={() => fileRef.current?.click()}
          >
            <input
              ref={fileRef}
              type="file"
              accept=".csv,.json"
              className="hidden"
              onChange={e => { if (e.target.files?.[0]) setFile(e.target.files[0]) }}
            />
            <svg className="mx-auto w-12 h-12 text-text-3 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12"/>
            </svg>
            <p className="text-sm text-text-2 font-semibold mb-1">
              {file ? file.name : 'Drop a file here or click to browse'}
            </p>
            <p className="text-xs text-text-3">Accepts .csv and .json files</p>
          </div>
          <div className="flex justify-end mt-6">
            <button
              onClick={handleUpload}
              disabled={!file || uploading}
              className="btn-primary px-6 py-2 text-sm disabled:opacity-50"
            >
              {uploading ? 'Uploading...' : 'Upload & Analyse'}
            </button>
          </div>
        </div>
      )}

      {/* Step 2: Map Fields */}
      {step === 2 && preview && (
        <div>
          <h3 className="text-sm font-bold text-text-1 mb-3">Map columns to card fields</h3>
          <div className="space-y-3 mb-6">
            {preview.headers.map(header => (
              <div key={header} className="flex items-center gap-3">
                <span className="text-sm font-medium text-text-2 w-40 truncate flex-shrink-0" title={header}>{header}</span>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="text-text-3 flex-shrink-0">
                  <path d="M5 12h14M12 5l7 7-7 7"/>
                </svg>
                <select
                  className="flex-1 px-3 py-1.5 text-sm border border-border rounded-lg bg-surface focus:outline-none focus:ring-2 focus:ring-accent/30"
                  value={fieldMapping[header] ?? ''}
                  onChange={e => setFieldMapping(prev => ({ ...prev, [header]: e.target.value }))}
                >
                  {CARD_FIELDS.map(f => (
                    <option key={f.value} value={f.value}>{f.label}</option>
                  ))}
                </select>
              </div>
            ))}
          </div>

          {/* Status-to-column mapping */}
          {preview.unique_statuses.length > 0 && Object.values(fieldMapping).includes('status') && (
            <div className="mt-6">
              <h3 className="text-sm font-bold text-text-1 mb-3">Map statuses to columns</h3>
              <div className="space-y-2">
                {preview.unique_statuses.map(status => (
                  <div key={status} className="flex items-center gap-3">
                    <span className="text-sm text-text-2 w-40 truncate flex-shrink-0">{status}</span>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="text-text-3 flex-shrink-0">
                      <path d="M5 12h14M12 5l7 7-7 7"/>
                    </svg>
                    <select
                      className="flex-1 px-3 py-1.5 text-sm border border-border rounded-lg bg-surface focus:outline-none focus:ring-2 focus:ring-accent/30"
                      value={statusMapping[status] ?? ''}
                      onChange={e => setStatusMapping(prev => ({ ...prev, [status]: Number(e.target.value) }))}
                    >
                      {columns.map(c => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex justify-between mt-6">
            <button onClick={() => setStep(1)} className="btn-ghost px-4 py-2 text-sm">Back</button>
            <button onClick={() => setStep(3)} className="btn-primary px-6 py-2 text-sm">Next: Preview</button>
          </div>
        </div>
      )}

      {/* Step 3: Preview */}
      {step === 3 && preview && (
        <div>
          <h3 className="text-sm font-bold text-text-1 mb-3">Preview (first 10 cards)</h3>
          <div className="overflow-x-auto border border-border rounded-lg">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-surface-2 border-b border-border">
                  {Object.values(fieldMapping).filter(v => v && v !== 'status').map(field => (
                    <th key={field} className="px-3 py-2 text-left text-xs font-semibold text-text-3 uppercase">{field}</th>
                  ))}
                  {Object.values(fieldMapping).includes('status') && (
                    <th className="px-3 py-2 text-left text-xs font-semibold text-text-3 uppercase">Column</th>
                  )}
                </tr>
              </thead>
              <tbody>
                {mappedRows.map((row, i) => {
                  const hasTitle = !!row.title
                  return (
                    <tr key={i} className={`border-b border-border last:border-0 ${!hasTitle ? 'bg-red-50' : ''}`}>
                      {Object.values(fieldMapping).filter(v => v && v !== 'status').map(field => (
                        <td key={field} className="px-3 py-2 text-text-2 max-w-[200px] truncate">{row[field] ?? ''}</td>
                      ))}
                      {row.column && <td className="px-3 py-2 text-text-2">{row.column}</td>}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div className="flex justify-between mt-6">
            <button onClick={() => setStep(2)} className="btn-ghost px-4 py-2 text-sm">Back</button>
            <button onClick={() => setStep(4)} className="btn-primary px-6 py-2 text-sm">Next: Confirm</button>
          </div>
        </div>
      )}

      {/* Step 4: Confirm */}
      {step === 4 && (
        <div>
          {importing ? (
            <Spinner />
          ) : (
            <>
              <div className="bg-accent-dim rounded-xl p-6 text-center mb-6">
                <p className="text-3xl font-extrabold text-accent mb-1">{totalCards}</p>
                <p className="text-sm text-text-2">cards will be created</p>
              </div>
              <div className="flex justify-between">
                <button onClick={() => setStep(3)} className="btn-ghost px-4 py-2 text-sm">Back</button>
                <button onClick={handleImport} className="btn-primary px-6 py-2 text-sm">Import Cards</button>
              </div>
            </>
          )}
        </div>
      )}
    </Modal>
  )
}
