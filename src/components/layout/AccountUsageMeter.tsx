/**
 * Sidebar usage meters — research lookups, visibility checks, API spend vs real plan caps.
 */

import { useTranslation } from 'react-i18next'
import { usePlanUsage } from '../../hooks/usePlanUsage'
import { Link } from '@tanstack/react-router'

function MeterRow({
  label,
  used,
  cap,
  formatValue,
}: {
  label: string
  used: number
  cap: number | null
  formatValue?: (n: number) => string
}) {
  const fmt = formatValue ?? String
  const pct = cap != null && cap > 0 ? Math.min(100, Math.round((used / cap) * 100)) : null
  const over = cap != null && used >= cap
  const near = pct != null && pct >= 80 && !over

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2 text-[11px]">
        <span className="text-white/45 truncate">{label}</span>
        <span className={`font-medium tabular-nums shrink-0 ${over ? 'text-amber-300' : 'text-white/70'}`}>
          {cap == null ? fmt(used) : `${fmt(used)} / ${fmt(cap)}`}
        </span>
      </div>
      {cap != null && (
        <div className="h-1 rounded-full bg-white/[0.06] overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${
              over ? 'bg-amber-400' : near ? 'bg-amber-400/70' : 'bg-violet-400/80'
            }`}
            style={{ width: `${pct ?? 0}%` }}
          />
        </div>
      )}
    </div>
  )
}

export function AccountUsageMeter() {
  const { t, i18n } = useTranslation()
  const { data, isLoading } = usePlanUsage()

  const eur = (cents: number) => `€${(cents / 100).toFixed(0)}`
  const resetLabel = data?.resetAt
    ? new Date(data.resetAt).toLocaleDateString(i18n.language, { month: 'short', day: 'numeric' })
    : null

  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-3.5 py-3 space-y-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-white/55">{t('usage.meterTitle')}</span>
        {isLoading ? (
          <span className="text-[10px] text-white/30">…</span>
        ) : resetLabel ? (
          <span className="text-[10px] text-white/30">{t('usage.resetsOn', { date: resetLabel })}</span>
        ) : null}
      </div>

      {isLoading ? (
        <div className="space-y-2">
          <div className="h-2 w-full rounded bg-white/[0.06] animate-pulse" />
          <div className="h-2 w-2/3 rounded bg-white/[0.05] animate-pulse" />
        </div>
      ) : data ? (
        <>
          <MeterRow
            label={t('usage.researchLookups')}
            used={data.researchUsed}
            cap={data.researchCap}
          />
          {data.visibilityCap != null && (
            <MeterRow
              label={t('usage.visibilityChecks')}
              used={data.visibilityUsed}
              cap={data.visibilityCap}
            />
          )}
          <MeterRow
            label={t('usage.apiSpend')}
            used={data.apiSpentCents}
            cap={data.apiCapCents}
            formatValue={eur}
          />
        </>
      ) : null}

      <Link
        to="/billing"
        className="block text-[10px] text-violet-300/80 hover:text-violet-200 pt-0.5"
      >
        {t('usage.viewPlan')}
      </Link>
    </div>
  )
}
