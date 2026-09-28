import { useTranslation } from 'react-i18next'
import { ReportBuildProgress } from './ReportBuildProgress'

interface ReportBuilderStickyBarProps {
  building: boolean
  canBuild: boolean
  projectSelected: boolean
  hasSections: boolean
  onBuild: () => void
  onFocusProject?: () => void
  /** One-line recap of what will be built ("Acme · Last 30 days · 8 sections"). */
  summary?: string | null
}

export function ReportBuilderStickyBar({
  building,
  canBuild,
  projectSelected,
  hasSections,
  onBuild,
  onFocusProject,
  summary,
}: ReportBuilderStickyBarProps) {
  const { t } = useTranslation()

  const buildDisabled = !canBuild || !projectSelected || !hasSections || building

  const handleBuildClick = () => {
    if (!projectSelected) {
      onFocusProject?.()
      return
    }
    if (buildDisabled) return
    onBuild()
  }

  return (
    <div
      className="sticky bottom-0 z-20 -mx-4 mt-6 border-t border-white/10 bg-[#0b0b0f]/95 px-4 py-4 backdrop-blur-md sm:-mx-0 sm:rounded-2xl sm:border sm:mt-8"
      data-testid="report-builder-sticky-bar"
    >
      <div className="mx-auto flex max-w-4xl flex-col gap-3">
        <ReportBuildProgress active={building} />

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            {!projectSelected && (
              <button
                type="button"
                onClick={onFocusProject}
                className="text-left text-sm text-violet-300 hover:text-violet-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 rounded"
                data-testid="select-project-hint"
              >
                {t('agencyReport.builder.selectProjectHint')}
              </button>
            )}
            {projectSelected && !hasSections && (
              <p className="text-sm text-amber-300/90">{t('agencyReport.builder.noSectionsHint')}</p>
            )}
            {projectSelected && hasSections && summary && !building && (
              <p className="truncate text-sm text-white/60" data-testid="build-summary">
                <span className="mr-2 text-xs font-semibold uppercase tracking-wide text-white/40">
                  {t('agencyReport.builder.readyToBuild')}
                </span>
                {summary}
              </p>
            )}
          </div>

          <button
            type="button"
            disabled={buildDisabled}
            onClick={handleBuildClick}
            aria-busy={building}
            data-testid="build-report-button"
            className="inline-flex shrink-0 items-center justify-center rounded-full bg-violet-600 px-6 py-2.5 text-sm font-semibold text-white hover:bg-violet-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {building ? t('agencyReport.building') : t('agencyReport.buildReport')}
          </button>
        </div>
      </div>
    </div>
  )
}
