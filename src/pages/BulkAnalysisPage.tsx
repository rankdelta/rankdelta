/**
 * Bulk Analysis — Ahrefs "Batch Analysis" + a cheap Domain Comparison. Paste many domains, get
 * Authority / traffic / keywords / referring domains / backlinks for all of them in a FIXED ~4
 * DataForSEO calls total (bulk endpoints take up to 1000 targets each). Cost does not grow with the
 * number of domains — the most credit-efficient surface in the app.
 */

import { useAccountBudget } from '../hooks/useAccountBudget';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AppShell } from '../components/layout/AppShell';
import { bulkDomainMetrics, type BulkDomainRow } from '../services/siteExplorer';
import { AccountBudgetError } from '../services/edgeProxy';
import { proxyErrorMessage, isProxyQuotaError } from '../lib/proxyErrorMessage';
import { toCsv, downloadText } from '../lib/csv';
import { authorityColor } from '../lib/kd';
import { TableSkeleton } from '../components/ui/Skeletons';
import { EmptyState } from '../components/ui/EmptyState';
import { ExtLink } from '../components/seo/ExtLink';

const fmt = (n: number | null | undefined) =>
  n == null ? '—' : n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1_000 ? `${(n / 1_000).toFixed(1)}k` : String(Math.round(n));
const card = 'rounded-2xl border border-white/[0.08] bg-white/[0.02] p-5';
const th = 'text-left text-xs font-semibold text-white/45 px-3 py-2 border-b border-white/[0.08]';
const td = 'px-3 py-2 text-sm border-b border-white/[0.04]';

type SortKey = 'authority' | 'traffic' | 'keywords' | 'refDomains' | 'backlinks';
const COLS: { key: SortKey; labelKey: string; render: (r: BulkDomainRow) => string; color?: (r: BulkDomainRow) => string | undefined }[] = [
  { key: 'authority', labelKey: 'seoTools.bulkAuthority', render: (r) => (r.authority == null ? '—' : String(r.authority)), color: (r) => (r.authority == null ? undefined : authorityColor(r.authority)) },
  { key: 'traffic', labelKey: 'seoTools.bulkTraffic', render: (r) => fmt(r.traffic) },
  { key: 'keywords', labelKey: 'seoTools.bulkKeywords', render: (r) => fmt(r.keywords) },
  { key: 'refDomains', labelKey: 'seoTools.bulkRefDomains', render: (r) => fmt(r.refDomains) },
  { key: 'backlinks', labelKey: 'seoTools.bulkBacklinks', render: (r) => fmt(r.backlinks) },
];

const MAX_DOMAINS = 50;

export function BulkAnalysisPage() {
  const { t } = useTranslation();
  const { data: apiBudget } = useAccountBudget();
  const budgetCapLabel = `€${Math.round((apiBudget?.capCents ?? 5000) / 100)}`;
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [budgetBlocked, setBudgetBlocked] = useState(false);
  const [rows, setRows] = useState<BulkDomainRow[] | null>(null);
  const [sort, setSort] = useState<SortKey>('authority');

  const domains = useMemo(
    () => [...new Set(input.split(/[\s,]+/).map((d) => d.trim().toLowerCase()).filter(Boolean))].slice(0, MAX_DOMAINS),
    [input],
  );

  const sorted = useMemo(() => {
    if (!rows) return null;
    return [...rows].sort((a, b) => Number(b[sort] ?? -1) - Number(a[sort] ?? -1));
  }, [rows, sort]);

  async function run() {
    if (!domains.length) return;
    setBusy(true); setErr(''); setBudgetBlocked(false); setRows(null);
    try {
      setRows(await bulkDomainMetrics(domains));
    } catch (e) {
      const msg = proxyErrorMessage(t, e);
      if (e instanceof AccountBudgetError) setBudgetBlocked(true);
      else if (isProxyQuotaError(e)) setErr(msg ?? t('seoTools.bulkError'));
      console.error('[BulkAnalysis] failed:', e instanceof Error ? e.message : e);
    }
    setBusy(false);
  }

  return (
    <AppShell maxWidth="5xl">
      <h1 className="text-2xl font-bold mb-1">Bulk Analysis</h1>
      <p className="text-white/50 mb-5">{t('seoTools.bulkSubtitle', { max: MAX_DOMAINS })}</p>

      <div className={`${card} mb-4`}>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          rows={4}
          placeholder={t('seoTools.bulkPlaceholder')}
          className="w-full bg-transparent border border-white/[0.12] focus:border-violet-400/60 rounded-xl px-4 py-3 outline-none text-white placeholder:text-white/30 resize-y"
        />
        <div className="flex items-center justify-between mt-3">
          <span className="text-xs text-white/35">{t('seoTools.bulkDomains', { count: domains.length })}{input && domains.length >= MAX_DOMAINS ? t('seoTools.bulkCapped', { max: MAX_DOMAINS }) : ''}</span>
          <button onClick={run} disabled={busy || !domains.length} className="rounded-full px-6 py-2.5 bg-white text-black font-semibold hover:bg-white/90 disabled:opacity-50">
            {busy ? t('seoTools.bulkAnalyzing') : t('seoTools.bulkAnalyze')}
          </button>
        </div>
      </div>

      {err && <p className="text-rose-300 text-sm mb-3">{err}</p>}

      {budgetBlocked && (
        <div className="mb-4 rounded-2xl border border-amber-400/30 bg-amber-400/[0.06] p-4">
          <p className="text-amber-200 font-semibold text-sm">{t('seoTools.budgetTitle')}</p>
          <p className="text-amber-100/70 text-sm mt-1">{t('seoTools.budgetBody', { cap: budgetCapLabel })}</p>
        </div>
      )}

      {busy && (
        <div className={card}>
          <p className="text-violet-300/80 text-sm mb-4">{t('seoTools.bulkAnalyzingCount', { count: domains.length })}</p>
          <TableSkeleton rows={Math.min(Math.max(domains.length, 3), 8)} cols={6} />
        </div>
      )}

      {sorted && !busy && (
        <div className={card}>
          {!!sorted.length && (
            <div className="flex justify-end mb-2">
              <button
                onClick={() => downloadText('bulk-analysis.csv', toCsv(sorted, [
                  { header: 'Domain', value: (r) => r.domain },
                  { header: 'Authority', value: (r) => r.authority ?? '' },
                  { header: 'Traffic', value: (r) => r.traffic ?? '' },
                  { header: 'Keywords', value: (r) => r.keywords ?? '' },
                  { header: 'Referring domains', value: (r) => r.refDomains ?? '' },
                  { header: 'Backlinks', value: (r) => r.backlinks ?? '' },
                ]))}
                className="text-xs text-white/50 hover:text-white border border-white/[0.12] rounded-full px-3 py-1.5"
              >{t('seoTools.exportCsv')}</button>
            </div>
          )}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px]">
              <thead>
                <tr>
                  <th className={th}>{t('seoTools.bulkDomain')}</th>
                  {COLS.map((c) => (
                    <th key={c.key} className={`${th} cursor-pointer select-none`} onClick={() => setSort(c.key)}>
                      {t(c.labelKey)}{sort === c.key ? ' ↓' : ''}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sorted.map((r, i) => (
                  <tr key={i} className="hover:bg-white/[0.03]">
                    <td className={td}>
                      <div className="flex items-center gap-2 min-w-0">
                        <ExtLink href={r.domain} className="text-violet-300 hover:underline truncate">{r.domain}</ExtLink>
                        <a href={`/site-explorer?domain=${encodeURIComponent(r.domain)}`} className="text-[11px] text-white/40 hover:text-white shrink-0">{t('seoTools.seExplore')}</a>
                      </div>
                    </td>
                    {COLS.map((c) => {
                      const col = c.color?.(r);
                      return <td key={c.key} className={td}>{col ? <span className="font-semibold" style={{ color: col }}>{c.render(r)}</span> : c.render(r)}</td>;
                    })}
                  </tr>
                ))}
                {!sorted.length && <tr><td className={td} colSpan={COLS.length + 1}>{t('seoTools.bulkNoData')}</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {!rows && !busy && (
        <EmptyState
          icon="🗂️"
          title={t('seoTools.bulkTitle')}
          description={t('seoTools.bulkEmptyLead')}
        />
      )}
    </AppShell>
  );
}
