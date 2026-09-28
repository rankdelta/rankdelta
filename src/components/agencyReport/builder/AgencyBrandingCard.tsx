import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CheckIcon } from '@heroicons/react/24/outline'
import type { Project } from '../../../types/database'
import { useUpdateProject } from '../../../hooks/useProjects'
import { getWhiteLabelBranding } from '../../../lib/whiteLabelReport'

const HEX_RE = /^#[0-9a-f]{6}$/i

interface AgencyBrandingCardProps {
  project: Project | null | undefined
}

/**
 * Lets an Agency-plan user set the name, logo and colour that appear on the report cover, footer
 * and PDF. Stored in projects.metadata.white_label_report (merged, never overwriting other keys).
 */
export function AgencyBrandingCard({ project }: AgencyBrandingCardProps) {
  const { t } = useTranslation()
  const updateProject = useUpdateProject()
  const current = getWhiteLabelBranding(project, true)

  const [agencyName, setAgencyName] = useState(current.agencyName ?? '')
  const [logoUrl, setLogoUrl] = useState(current.logoUrl ?? '')
  const [primaryColor, setPrimaryColor] = useState(current.primaryColor)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Re-seed the form when the selected client changes.
  useEffect(() => {
    setAgencyName(current.agencyName ?? '')
    setLogoUrl(current.logoUrl ?? '')
    setPrimaryColor(current.primaryColor)
    setSaved(false)
    setError(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.id])

  const validColor = HEX_RE.test(primaryColor)
  const validLogo = logoUrl.trim() === '' || /^https:\/\//i.test(logoUrl.trim())
  const dirty =
    agencyName.trim() !== (current.agencyName ?? '') ||
    logoUrl.trim() !== (current.logoUrl ?? '') ||
    primaryColor.toLowerCase() !== current.primaryColor.toLowerCase()

  const handleSave = async () => {
    if (!project || !validColor || !validLogo) return
    setError(null)
    try {
      await updateProject.mutateAsync({
        id: project.id,
        metadata: {
          ...(project.metadata ?? {}),
          white_label_report: {
            ...((project.metadata?.['white_label_report'] as Record<string, unknown> | undefined) ?? {}),
            agencyName: agencyName.trim() || null,
            logoUrl: logoUrl.trim() || null,
            primaryColor: primaryColor.toLowerCase(),
          },
        },
      })
      setSaved(true)
      window.setTimeout(() => setSaved(false), 2500)
    } catch (e) {
      setError(e instanceof Error ? e.message : t('agencyReport.branding.error'))
    }
  }

  const previewName = agencyName.trim() || t('agencyReport.reportEyebrow')

  return (
    <div
      className="rounded-xl border border-white/10 p-4"
      style={{ borderLeftWidth: 3, borderLeftColor: validColor ? primaryColor : current.primaryColor }}
      data-testid="agency-branding-card"
    >
      <p className="text-sm font-medium text-white/80">{t('agencyReport.brandingTitle')}</p>
      <p className="mt-0.5 text-xs text-white/45">{t('agencyReport.branding.hint')}</p>

      {!project ? (
        <p className="mt-3 text-xs text-white/40">{t('agencyReport.builder.selectProjectHint')}</p>
      ) : (
        <>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="block text-xs text-white/60">
              {t('agencyReport.branding.agencyName')}
              <input
                type="text"
                value={agencyName}
                onChange={(e) => setAgencyName(e.target.value)}
                placeholder={t('agencyReport.branding.agencyNamePlaceholder')}
                maxLength={80}
                className="mt-1 w-full rounded-lg border border-white/15 bg-[#151b2e] px-3 py-2 text-sm text-white placeholder:text-white/30 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
              />
            </label>
            <label className="block text-xs text-white/60">
              {t('agencyReport.branding.primaryColor')}
              <span className="mt-1 flex items-center gap-2">
                <input
                  type="color"
                  value={validColor ? primaryColor : current.primaryColor}
                  onChange={(e) => setPrimaryColor(e.target.value)}
                  aria-label={t('agencyReport.branding.primaryColor')}
                  className="h-9 w-11 cursor-pointer rounded-md border border-white/15 bg-[#151b2e] p-1"
                />
                <input
                  type="text"
                  value={primaryColor}
                  onChange={(e) => setPrimaryColor(e.target.value)}
                  spellCheck={false}
                  className={`w-full rounded-lg border bg-[#151b2e] px-3 py-2 font-mono text-sm text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 ${
                    validColor ? 'border-white/15' : 'border-red-400/60'
                  }`}
                />
              </span>
            </label>
            <label className="block text-xs text-white/60 sm:col-span-2">
              {t('agencyReport.branding.logoUrl')}
              <input
                type="url"
                value={logoUrl}
                onChange={(e) => setLogoUrl(e.target.value)}
                placeholder="https://youragency.com/logo.png"
                className={`mt-1 w-full rounded-lg border bg-[#151b2e] px-3 py-2 text-sm text-white placeholder:text-white/30 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 ${
                  validLogo ? 'border-white/15' : 'border-red-400/60'
                }`}
              />
              {!validLogo && <span className="mt-1 block text-[11px] text-red-300">{t('agencyReport.branding.logoInvalid')}</span>}
            </label>
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3 rounded-lg border border-white/10 bg-white px-3 py-2">
              {validLogo && logoUrl.trim() && (
                <img src={logoUrl.trim()} alt="" className="h-6 max-w-[96px] object-contain" />
              )}
              <span
                className="truncate text-[11px] font-semibold uppercase tracking-[0.18em]"
                style={{ color: validColor ? primaryColor : current.primaryColor }}
              >
                {previewName}
              </span>
            </div>
            <div className="flex items-center gap-3">
              {error && <span className="text-xs text-red-300">{error}</span>}
              <button
                type="button"
                onClick={() => void handleSave()}
                disabled={!dirty || !validColor || !validLogo || updateProject.isPending}
                className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-4 py-1.5 text-xs font-semibold text-white hover:bg-white/15 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {saved ? (
                  <>
                    <CheckIcon className="h-3.5 w-3.5 text-emerald-300" aria-hidden />
                    {t('agencyReport.branding.saved')}
                  </>
                ) : updateProject.isPending ? (
                  t('agencyReport.branding.saving')
                ) : (
                  t('agencyReport.branding.save')
                )}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
