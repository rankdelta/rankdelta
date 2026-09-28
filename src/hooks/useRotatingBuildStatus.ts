import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

export const REPORT_BUILD_STATUS_KEYS = [
  'agencyReport.builder.buildStatus.assembling',
  'agencyReport.builder.buildStatus.narrative',
  'agencyReport.builder.buildStatus.finalizing',
] as const

const ROTATION_MS = 4000

export function useRotatingBuildStatus(active: boolean): string {
  const { t } = useTranslation()
  const [index, setIndex] = useState(0)

  useEffect(() => {
    if (!active) {
      setIndex(0)
      return
    }
    const id = window.setInterval(() => {
      setIndex((i) => (i + 1) % REPORT_BUILD_STATUS_KEYS.length)
    }, ROTATION_MS)
    return () => window.clearInterval(id)
  }, [active])

  return t(REPORT_BUILD_STATUS_KEYS[index] ?? REPORT_BUILD_STATUS_KEYS[0])
}
