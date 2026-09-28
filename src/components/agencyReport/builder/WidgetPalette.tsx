import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { motion } from 'framer-motion'
import { ALL_SECTION_KEYS, type SectionKey } from '../../../lib/agencyReport/sections'
import { bindingsForSection } from '../../../lib/agencyReport/layout'
import { addWidgetFromCatalog, type ReportLayout } from '../../../lib/agencyReport/layout'
import type { WidgetCatalogEntry } from '../../../lib/agencyReport/widgets'

interface WidgetPaletteProps {
  layout: ReportLayout
  enabledSections: SectionKey[]
  onChange: (layout: ReportLayout) => void
}

const SECTION_ORDER: Array<SectionKey | 'narrative' | 'meta'> = [
  'narrative',
  'summary',
  ...ALL_SECTION_KEYS.filter((s) => s !== 'summary'),
  'meta',
]

export function WidgetPalette({ layout, enabledSections, onChange }: WidgetPaletteProps) {
  const { t } = useTranslation()

  const groups = useMemo(() => {
    const enabled = new Set(enabledSections)
    return SECTION_ORDER
      .filter((sec) => sec === 'narrative' || sec === 'meta' || enabled.has(sec as SectionKey))
      .map((sec) => ({
        section: sec,
        label:
          sec === 'narrative'
            ? t('agencyReport.builder.narrativeGroup')
            : sec === 'meta'
              ? t('agencyReport.builder.metaGroup')
              : t(`agencyReport.sections.${sec}` as const),
        entries: bindingsForSection(sec),
      }))
      .filter((g) => g.entries.length > 0)
  }, [enabledSections, t])

  const addWidget = (entry: WidgetCatalogEntry) => {
    onChange(addWidgetFromCatalog(layout, entry))
  }

  return (
    <div className="space-y-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-white/50">
        {t('agencyReport.builder.widgetPalette')}
      </p>
      {groups.map((group) => (
        <div key={group.section}>
          <p className="text-[11px] font-medium text-white/40 mb-2">{group.label}</p>
          <div className="flex flex-wrap gap-1.5">
            {group.entries.map((entry) => (
              <motion.button
                key={`${entry.binding.section}:${entry.binding.metric}`}
                type="button"
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={() => addWidget(entry)}
                className="rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1.5 text-left text-[11px] text-white/70 hover:border-violet-500/40 hover:bg-violet-500/10 hover:text-white"
              >
                {entry.type === 'section_header'
                  ? t('agencyReport.builder.sectionHeaderLabel', { section: t(entry.defaultTitleKey as never) })
                  : t(entry.defaultTitleKey as never)}
              </motion.button>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
