import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { motion } from 'framer-motion'
import { ChevronDoubleLeftIcon, Squares2X2Icon } from '@heroicons/react/24/outline'
import { useToast } from '../../../hooks/useToast'
import { Toast } from '../../../components/ui/Toast'
import type { ClientReportSnapshot } from '../../../lib/agencyReport/types'
import type { SectionKey } from '../../../lib/agencyReport/sections'
import { normalizeLayout, type ReportLayout } from '../../../lib/agencyReport/layout'
import { useLayoutHistory } from '../../../hooks/useLayoutHistory'
import type { ReportTemplateRow } from '../../../services/reportTemplates'
import { ReportLayoutView } from '../ReportLayoutView'
import { ReportBuilderCanvas } from './ReportBuilderCanvas'
import { WidgetPalette } from './WidgetPalette'
import { TemplatePicker } from './TemplatePicker'
import { WidgetConfigPanel } from './WidgetConfigPanel'
import { BuilderToolbar } from './BuilderToolbar'

interface ReportLayoutEditorProps {
  layout: ReportLayout
  onChange: (layout: ReportLayout) => void
  enabledSections: SectionKey[]
  previewReport?: ClientReportSnapshot | null
  savedTemplates?: ReportTemplateRow[]
  onSaveTemplate?: (name: string, description?: string) => void | Promise<void>
  onDeleteTemplate?: (id: string) => void
  canSaveTemplate?: boolean
  saveTemplateHint?: string
  readOnly?: boolean
  projectName?: string | null
  websiteUrl?: string | null
}

export function ReportLayoutEditor({
  layout: externalLayout,
  onChange,
  enabledSections,
  previewReport = null,
  savedTemplates = [],
  onSaveTemplate,
  onDeleteTemplate,
  canSaveTemplate = true,
  saveTemplateHint,
  readOnly = false,
  projectName,
  websiteUrl,
}: ReportLayoutEditorProps) {
  const { t } = useTranslation()
  const { toast, showToast, hideToast } = useToast()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [saveName, setSaveName] = useState('')
  const [showSaveForm, setShowSaveForm] = useState(false)
  const [savingTemplate, setSavingTemplate] = useState(false)
  const [mode, setMode] = useState<'edit' | 'preview'>('edit')
  const [paletteOpen, setPaletteOpen] = useState(true)

  const { layout, setLayout, resetLayout, undo, redo, canUndo, canRedo } = useLayoutHistory(externalLayout)
  const lastExternalRef = useRef(JSON.stringify(externalLayout))

  useEffect(() => {
    const serialized = JSON.stringify(externalLayout)
    if (serialized !== lastExternalRef.current) {
      lastExternalRef.current = serialized
      resetLayout(externalLayout)
    }
  }, [externalLayout, resetLayout])

  useEffect(() => {
    onChange(layout)
  }, [layout, onChange])

  const handleApplyTemplate = (next: ReportLayout) => {
    const normalized = normalizeLayout(next)
    lastExternalRef.current = JSON.stringify(normalized)
    resetLayout(normalized)
    setSelectedId(null)
  }

  useEffect(() => {
    if (!canSaveTemplate) {
      setShowSaveForm(false)
    }
  }, [canSaveTemplate])

  const handleSaveTemplate = async () => {
    const name = saveName.trim()
    if (!name || !onSaveTemplate || savingTemplate || !canSaveTemplate) return
    setSavingTemplate(true)
    try {
      await onSaveTemplate(name)
      setSaveName('')
      setShowSaveForm(false)
    } catch (e) {
      showToast(
        e instanceof Error ? e.message : t('agencyReport.builder.templates.saveError'),
        'error',
      )
    } finally {
      setSavingTemplate(false)
    }
  }

  const isPreview = mode === 'preview' || readOnly

  return (
    <>
    <Toast message={toast.message} type={toast.type} isVisible={toast.isVisible} onClose={hideToast} />
    <div
      className={`grid gap-6 ${
        isPreview
          ? ''
          : paletteOpen && selectedId
            ? 'lg:grid-cols-[220px_1fr_220px]'
            : paletteOpen
              ? 'lg:grid-cols-[220px_1fr]'
              : selectedId
                ? 'lg:grid-cols-[1fr_220px]'
                : 'lg:grid-cols-1'
      }`}
    >
      {!isPreview && paletteOpen && (
        <motion.aside
          initial={{ opacity: 0, x: -8 }}
          animate={{ opacity: 1, x: 0 }}
          className="space-y-6 rounded-2xl border border-white/10 bg-white/[0.02] p-4 h-fit lg:sticky lg:top-4"
        >
          <div className="flex items-center justify-between -mt-1">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-white/40">
              {t('agencyReport.builder.showPanel')}
            </span>
            <button
              type="button"
              onClick={() => setPaletteOpen(false)}
              aria-label={t('agencyReport.builder.hidePanel')}
              title={t('agencyReport.builder.hidePanel')}
              className="rounded-md p-1 text-white/40 hover:bg-white/10 hover:text-white/80"
            >
              <ChevronDoubleLeftIcon className="h-4 w-4" />
            </button>
          </div>
          <TemplatePicker
            enabledSections={enabledSections}
            savedTemplates={savedTemplates}
            currentWidgetCount={layout.widgets.length}
            onApply={handleApplyTemplate}
            onSaveCurrent={onSaveTemplate ? () => setShowSaveForm(true) : undefined}
            onDeleteTemplate={onDeleteTemplate}
            saveDisabled={!canSaveTemplate}
            saveDisabledHint={saveTemplateHint}
          />

          {showSaveForm && (
            <div className="space-y-2 rounded-xl border border-violet-500/30 bg-violet-500/5 p-3">
              <input
                type="text"
                value={saveName}
                onChange={(e) => setSaveName(e.target.value)}
                placeholder={t('agencyReport.builder.templates.namePlaceholder')}
                className="w-full rounded-lg border border-white/15 bg-[#151b2e] px-3 py-2 text-sm text-white"
              />
              <button
                type="button"
                onClick={() => void handleSaveTemplate()}
                disabled={!saveName.trim() || savingTemplate}
                className="w-full rounded-lg bg-violet-600 py-1.5 text-xs font-semibold text-white hover:bg-violet-500 disabled:opacity-50"
              >
                {savingTemplate ? t('agencyReport.builder.templates.saving') : t('agencyReport.builder.templates.save')}
              </button>
            </div>
          )}

          <WidgetPalette layout={layout} enabledSections={enabledSections} onChange={setLayout} />
        </motion.aside>
      )}

      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="min-w-0">
        {!isPreview && !paletteOpen && (
          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            className="mb-3 inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-white/70 hover:bg-white/10 hover:text-white"
          >
            <Squares2X2Icon className="h-4 w-4" />
            {t('agencyReport.builder.showPanel')}
          </button>
        )}
        {!readOnly && (
          <BuilderToolbar
            mode={mode}
            onModeChange={setMode}
            canUndo={canUndo}
            canRedo={canRedo}
            onUndo={undo}
            onRedo={redo}
            widgetCount={layout.widgets.length}
          />
        )}

        {isPreview && previewReport ? (
          <ReportLayoutView
            report={previewReport}
            layout={layout}
            projectName={projectName}
            websiteUrl={websiteUrl}
          />
        ) : (
          <ReportBuilderCanvas
            layout={layout}
            report={previewReport}
            onChange={setLayout}
            selectedId={selectedId}
            onSelect={setSelectedId}
            readOnly={readOnly}
          />
        )}
      </motion.div>

      {!isPreview && selectedId && (
        <WidgetConfigPanel
          layout={layout}
          widgetId={selectedId}
          onChange={setLayout}
          onClose={() => setSelectedId(null)}
        />
      )}
    </div>
    </>
  )
}
