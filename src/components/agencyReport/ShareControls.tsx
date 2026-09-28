import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LinkIcon, NoSymbolIcon } from '@heroicons/react/24/outline'
import { revokeReportShare } from '../../services/reportBuild'
import { isCloud } from '../../config/deployment'

interface ShareControlsProps {
  reportId: string
  shareToken: string | null
  isAgency: boolean
  onRevoked?: () => void
}

export function ShareControls({ reportId, shareToken, isAgency, onRevoked }: ShareControlsProps) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)
  const [revoking, setRevoking] = useState(false)

  if (!isAgency) return null

  const shareUrl = shareToken ? `${window.location.origin}/r/${shareToken}` : null

  const copy = async () => {
    if (!shareUrl) return
    await navigator.clipboard.writeText(shareUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const revoke = async () => {
    setRevoking(true)
    try {
      await revokeReportShare(reportId)
      onRevoked?.()
    } finally {
      setRevoking(false)
    }
  }

  return (
    <div className="rounded-xl border border-gray-200 p-4 space-y-3">
      <p className="text-sm font-medium text-gray-900">{t('agencyReport.shareLink')}</p>
      {shareUrl ? (
        <>
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              readOnly
              value={shareUrl}
              className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 bg-gray-50"
              aria-label={t('agencyReport.shareLink')}
            />
            <button
              type="button"
              onClick={() => void copy()}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
            >
              <LinkIcon className="h-4 w-4" />
              {copied ? t('agencyReport.linkCopied') : t('agencyReport.copyShareLink')}
            </button>
            <button
              type="button"
              disabled={revoking}
              onClick={() => void revoke()}
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-red-200 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400 disabled:opacity-50"
            >
              <NoSymbolIcon className="h-4 w-4" />
              {t('agencyReport.revokeShare')}
            </button>
          </div>
          {/* Custom report domains are a hosted-cloud service; a self-host already serves its own domain. */}
          {isCloud() && <details className="text-xs text-gray-600">
            <summary className="cursor-pointer font-medium text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 rounded">
              {t('agencyReport.customDomainTitle')}
            </summary>
            <div className="mt-2 space-y-1 pl-1">
              <p>{t('agencyReport.customDomainStep1')}</p>
              <p>{t('agencyReport.customDomainStep2')}</p>
              <p className="font-mono text-[11px] bg-gray-100 rounded px-2 py-1">reports CNAME reports.rankdelta.ai</p>
              <p>{t('agencyReport.customDomainStep3')}</p>
            </div>
          </details>}
        </>
      ) : (
        <p className="text-sm text-gray-500">{t('agencyReport.shareNotEnabled')}</p>
      )}
    </div>
  )
}
