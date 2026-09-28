import { useTranslation } from 'react-i18next'
import { motion } from 'framer-motion'
import { useRotatingBuildStatus } from '../../../hooks/useRotatingBuildStatus'

interface ReportBuildProgressProps {
  active: boolean
}

export function ReportBuildProgress({ active }: ReportBuildProgressProps) {
  const { t } = useTranslation()
  const statusMessage = useRotatingBuildStatus(active)

  if (!active) return null

  return (
    <div
      className="rounded-xl border border-violet-500/30 bg-violet-500/10 p-4 space-y-3"
      role="status"
      aria-live="polite"
      data-testid="report-build-progress"
    >
      <div className="flex items-center gap-3">
        <div
          className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-violet-400 border-t-transparent"
          aria-hidden
        />
        <p className="text-sm font-medium text-white">{statusMessage}</p>
      </div>
      <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-white/10">
        <motion.div
          className="absolute inset-y-0 left-0 w-1/3 rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500"
          animate={{ x: ['-100%', '350%'] }}
          transition={{ repeat: Infinity, duration: 1.6, ease: 'easeInOut' }}
        />
      </div>
      <p className="text-xs text-white/50">{t('agencyReport.builder.buildProgressNote')}</p>
    </div>
  )
}
