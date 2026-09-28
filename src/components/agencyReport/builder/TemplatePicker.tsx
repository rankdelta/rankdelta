import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { motion, AnimatePresence } from 'framer-motion'
import { BUILTIN_TEMPLATE_PRESETS } from '../../../lib/agencyReport/defaultLayouts'
import type { SectionKey } from '../../../lib/agencyReport/sections'
import type { ReportLayout } from '../../../lib/agencyReport/layout'
import type { ReportTemplateRow } from '../../../services/reportTemplates'

interface TemplatePickerProps {
  enabledSections: SectionKey[]
  savedTemplates: ReportTemplateRow[]
  currentWidgetCount: number
  onApply: (layout: ReportLayout) => void
  onSaveCurrent?: () => void
  onDeleteTemplate?: (id: string) => void
  saveDisabled?: boolean
  saveDisabledHint?: string
}

export function TemplatePicker({
  enabledSections,
  savedTemplates,
  currentWidgetCount,
  onApply,
  onSaveCurrent,
  onDeleteTemplate,
  saveDisabled = false,
  saveDisabledHint,
}: TemplatePickerProps) {
  const { t } = useTranslation()
  const [pending, setPending] = useState<{ layout: ReportLayout; name: string } | null>(null)

  const requestApply = (layout: ReportLayout, name: string) => {
    if (currentWidgetCount === 0) {
      onApply(layout)
      return
    }
    setPending({ layout, name })
  }

  const confirmApply = () => {
    if (pending) {
      onApply(pending.layout)
      setPending(null)
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-white/50">
          {t('agencyReport.builder.templates.title')}
        </p>
        {onSaveCurrent && (
          <button
            type="button"
            onClick={onSaveCurrent}
            disabled={saveDisabled}
            title={saveDisabled ? saveDisabledHint : undefined}
            className="text-[11px] font-medium text-violet-300 hover:text-violet-200 disabled:cursor-not-allowed disabled:opacity-40"
            data-testid="save-template-button"
          >
            {t('agencyReport.builder.templates.saveCurrent')}
          </button>
        )}
      </div>

      {onSaveCurrent && saveDisabled && saveDisabledHint && (
        <p className="text-[11px] text-violet-300/80" data-testid="save-template-hint">
          {saveDisabledHint}
        </p>
      )}

      <div className="grid gap-2">
        {BUILTIN_TEMPLATE_PRESETS.map((preset) => (
          <motion.button
            key={preset.id}
            type="button"
            whileHover={{ scale: 1.01 }}
            onClick={() => requestApply(preset.build(enabledSections), t(preset.nameKey as never))}
            className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5 text-left hover:border-violet-500/30 hover:bg-violet-500/5"
          >
            <p className="text-sm font-medium text-white/90">{t(preset.nameKey as never)}</p>
            <p className="text-[11px] text-white/45 mt-0.5">{t(preset.descriptionKey as never)}</p>
          </motion.button>
        ))}

        {savedTemplates.map((tpl) => (
          <div
            key={tpl.id}
            className="flex items-start gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-3 py-2.5"
          >
            <button
              type="button"
              onClick={() => requestApply(tpl.layout, tpl.name)}
              className="flex-1 text-left"
            >
              <p className="text-sm font-medium text-white/90">{tpl.name}</p>
              {tpl.description && (
                <p className="text-[11px] text-white/45 mt-0.5">{tpl.description}</p>
              )}
            </button>
            {onDeleteTemplate && (
              <button
                type="button"
                onClick={() => onDeleteTemplate(tpl.id)}
                className="text-[10px] text-red-400 hover:text-red-300 shrink-0"
              >
                {t('agencyReport.builder.templates.delete')}
              </button>
            )}
          </div>
        ))}
      </div>

      <AnimatePresence>
        {pending && (
          <motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 space-y-2"
          >
            <p className="text-xs text-amber-100">
              {t('agencyReport.builder.templates.confirmReplace', {
                name: pending.name,
                count: currentWidgetCount,
              })}
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={confirmApply}
                className="flex-1 rounded-lg bg-amber-600 py-1.5 text-xs font-semibold text-white hover:bg-amber-500"
              >
                {t('agencyReport.builder.templates.confirm')}
              </button>
              <button
                type="button"
                onClick={() => setPending(null)}
                className="flex-1 rounded-lg border border-white/15 py-1.5 text-xs text-white/70 hover:bg-white/5"
              >
                {t('agencyReport.builder.templates.cancel')}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
