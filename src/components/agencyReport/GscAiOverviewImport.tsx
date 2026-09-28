import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowUpTrayIcon } from '@heroicons/react/24/outline'
import { parseGscAiOverviewCsv } from '../../lib/agencyReport/gscAiOverviewCsv'
import type { GscAiOverviewRow } from '../../lib/agencyReport/types'

interface GscAiOverviewImportProps {
  onImport: (rows: GscAiOverviewRow[]) => Promise<void> | void
  disabled?: boolean
}

export function GscAiOverviewImport({ onImport, disabled }: GscAiOverviewImportProps) {
  const { t } = useTranslation()
  const inputRef = useRef<HTMLInputElement>(null)
  const [status, setStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle')
  const [rowCount, setRowCount] = useState(0)

  const handleFile = async (file: File) => {
    setStatus('loading')
    try {
      const text = await file.text()
      const rows = parseGscAiOverviewCsv(text)
      if (rows.length === 0) throw new Error('empty')
      await onImport(rows)
      setRowCount(rows.length)
      setStatus('done')
    } catch {
      setStatus('error')
    }
  }

  return (
    <div className="rounded-xl border border-gray-200 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-gray-900">{t('agencyReport.gscAiImportTitle')}</p>
          <p className="text-xs text-gray-500 mt-0.5">{t('agencyReport.gscAiImportHint')}</p>
        </div>
        <button
          type="button"
          disabled={disabled || status === 'loading'}
          onClick={() => inputRef.current?.click()}
          className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 disabled:opacity-50"
        >
          <ArrowUpTrayIcon className="h-4 w-4" />
          {t('agencyReport.gscAiImportButton')}
        </button>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept=".csv,text/csv"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) void handleFile(f)
          e.target.value = ''
        }}
      />
      {status === 'done' && (
        <p className="mt-2 text-xs text-emerald-700">{t('agencyReport.gscAiImportSuccess', { count: rowCount })}</p>
      )}
      {status === 'error' && <p className="mt-2 text-xs text-red-600">{t('agencyReport.gscAiImportError')}</p>}
    </div>
  )
}
