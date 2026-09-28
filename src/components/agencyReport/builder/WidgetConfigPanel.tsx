import { useTranslation } from 'react-i18next'
import { motion } from 'framer-motion'
import { ALL_SECTION_KEYS, type SectionKey } from '../../../lib/agencyReport/sections'
import { updateWidget, type ReportLayout, type ReportWidget } from '../../../lib/agencyReport/layout'
import { catalogEntryFor } from '../../../lib/agencyReport/widgets'

interface WidgetConfigPanelProps {
  layout: ReportLayout
  widgetId: string
  onChange: (layout: ReportLayout) => void
  onClose: () => void
}

export function WidgetConfigPanel({ layout, widgetId, onChange, onClose }: WidgetConfigPanelProps) {
  const { t } = useTranslation()
  const widget = layout.widgets.find((w) => w.id === widgetId)
  if (!widget) return null

  const entry = catalogEntryFor(widget.binding)
  const defaultTitle = entry ? t(entry.defaultTitleKey as never) : widget.binding.metric

  const patch = (p: Partial<Pick<ReportWidget, 'title' | 'config' | 'binding'>>) => {
    onChange(updateWidget(layout, widgetId, p))
  }

  return (
    <motion.aside
      initial={{ opacity: 0, x: 8 }}
      animate={{ opacity: 1, x: 0 }}
      className="rounded-2xl border border-white/10 bg-white/[0.02] p-4 h-fit lg:sticky lg:top-4 space-y-4"
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-white/50">
          {t('agencyReport.builder.config.title')}
        </p>
        <button
          type="button"
          onClick={onClose}
          className="text-[11px] text-white/40 hover:text-white/70"
        >
          {t('agencyReport.builder.config.close')}
        </button>
      </div>

      <div>
        <label className="block text-[11px] text-white/50 mb-1">{t('agencyReport.builder.config.widgetType')}</label>
        <p className="text-sm text-white/80 capitalize">{widget.type.replace(/_/g, ' ')}</p>
      </div>

      <div>
        <label className="block text-[11px] text-white/50 mb-1">{t('agencyReport.builder.config.dataSource')}</label>
        <p className="text-sm text-white/80">
          {widget.binding.section === 'narrative'
            ? t('agencyReport.builder.narrativeGroup')
            : widget.binding.section === 'meta'
              ? t('agencyReport.builder.metaGroup')
              : t(`agencyReport.sections.${widget.binding.section}` as const)}
          {' · '}
          <span className="text-white/50">{defaultTitle}</span>
        </p>
      </div>

      <div>
        <label className="block text-[11px] text-white/50 mb-1" htmlFor="widget-title">
          {t('agencyReport.builder.config.customTitle')}
        </label>
        <input
          id="widget-title"
          type="text"
          value={widget.title ?? ''}
          onChange={(e) => patch({ title: e.target.value || undefined })}
          placeholder={defaultTitle}
          className="w-full rounded-lg border border-white/15 bg-[#151b2e] px-3 py-2 text-sm text-white"
        />
      </div>

      <div className="grid grid-cols-2 gap-2 text-[11px] text-white/50">
        <div>
          <span className="block">{t('agencyReport.builder.config.width')}</span>
          <span className="text-white/80 font-medium">{widget.grid.colSpan} / 12</span>
        </div>
        <div>
          <span className="block">{t('agencyReport.builder.config.height')}</span>
          <span className="text-white/80 font-medium">{widget.grid.rowSpan} rows</span>
        </div>
      </div>

      {widget.type === 'narrative' && (
        <div>
          <label className="block text-[11px] text-white/50 mb-1" htmlFor="narrative-section">
            {t('agencyReport.builder.config.narrativeSection')}
          </label>
          <select
            id="narrative-section"
            value={widget.config?.narrativeSection ?? 'summary'}
            onChange={(e) =>
              patch({
                config: { ...widget.config, narrativeSection: e.target.value as SectionKey },
                binding: { section: 'narrative', metric: e.target.value },
              })
            }
            className="w-full rounded-lg border border-white/15 bg-[#151b2e] px-3 py-2 text-sm text-white"
          >
            {ALL_SECTION_KEYS.map((key) => (
              <option key={key} value={key}>{t(`agencyReport.sections.${key}` as const)}</option>
            ))}
          </select>
        </div>
      )}

      {widget.type === 'table' && (
        <div>
          <label className="block text-[11px] text-white/50 mb-1" htmlFor="row-limit">
            {t('agencyReport.builder.config.rowLimit')}
          </label>
          <input
            id="row-limit"
            type="number"
            min={5}
            max={50}
            value={widget.config?.tableRowLimit ?? 15}
            onChange={(e) =>
              patch({ config: { ...widget.config, tableRowLimit: Number(e.target.value) || 15 } })
            }
            className="w-full rounded-lg border border-white/15 bg-[#151b2e] px-3 py-2 text-sm text-white"
          />
        </div>
      )}
    </motion.aside>
  )
}
