/**
 * Keyword Research — Ahrefs/Semrush-style seed → ideas. Type a keyword, get related keywords with
 * search volume, difficulty, CPC and intent; click any row to see its live Google SERP. Shares the
 * server-side proxy (keys never in the browser) + the per-account spend cap with Site Explorer.
 *
 * Customer-facing copy never names the data backend. Volume/difficulty are estimates.
 */

import { useAccountBudget } from '../hooks/useAccountBudget';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AppShell } from '../components/layout/AppShell';
import {
  keywordIdeas, bulkKeywordDifficulty, serpForKeyword,
  type KeywordIdea, type SerpSnapshot,
} from '../services/siteExplorer';
import { AccountBudgetError, ResearchQuotaError, PlanRequiredError } from '../services/edgeProxy';
import { proxyErrorMessage } from '../lib/proxyErrorMessage';
import { clusterKeywordIdeas, isQuestion } from '../lib/keywordClusters';
import { kdColor } from '../lib/kd';
import { toCsv, downloadText, slug } from '../lib/csv';
import { KeywordClusterPanel } from '../components/keywords/KeywordClusterPanel';
import { defaultResearchMarket, RESEARCH_MARKETS, labsMarket, marketGl, researchMarketByCode } from '../lib/seoMarkets';
import { googleSearchHref } from '../lib/seoUrls';
import { TableSkeleton } from '../components/ui/Skeletons';
import { EmptyState } from '../components/ui/EmptyState';
import { ExtLink } from '../components/seo/ExtLink';
import { MarketSelect } from '../components/seo/MarketSelect';
import { SerpExtras, SerpRows } from '../components/seo/SerpRows';
import { TrackKeywordCta } from '../components/content/TrackKeywordCta';
import { VolumeSparkline } from '../components/seo/VolumeSparkline';
import { CopyKw } from '../components/seo/CopyKw';
import { SerpFeaturePills } from '../components/seo/SerpFeaturePills';
import { competitionPct } from '../lib/labsMetrics';
import { useActiveProject } from '../hooks/useActiveProject';

const fmt = (n: number | null | undefined) =>
  n == null ? '—' : n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1_000 ? `${(n / 1_000).toFixed(1)}k` : String(Math.round(n));

const INTENT_COLORS: Record<string, string> = {
  informational: '#60a5fa', commercial: '#fbbf24', transactional: '#34d399', navigational: '#a78bfa', unknown: '#6b7280',
};
const card = 'rounded-2xl border border-white/[0.08] bg-white/[0.02] p-5';
const th = 'text-left text-xs font-semibold text-white/45 px-3 py-2 border-b border-white/[0.08]';
const td = 'px-3 py-2 text-sm border-b border-white/[0.04]';

type SortKey = 'volume' | 'difficulty' | 'cpc' | 'competition';
type View = 'all' | 'clusters' | 'questions' | 'phrase';
const INTENTS = ['all', 'informational', 'commercial', 'transactional', 'navigational'] as const;
type IntentFilter = (typeof INTENTS)[number];

function Metric({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2">
      <div className={`font-semibold ${color ? '' : 'text-white/90'}`} style={color ? { color } : undefined}>{value}</div>
      <div className="text-xs text-white/40">{label}</div>
    </div>
  );
}

/** Localized label for a search intent (falls back to a capitalized raw value). */
type TFn = (key: string, opts?: Record<string, unknown>) => string;
const intentLabel = (t: TFn, intent: string): string =>
  t(`seoTools.intent_${intent}`, { defaultValue: intent[0]!.toUpperCase() + intent.slice(1) });

/** Shared keyword table — reused by the All, Questions and per-cluster views. Rows open the SERP. */
function KeywordTable({
  rows, onPick, lang, gl,
}: {
  rows: KeywordIdea[];
  onPick: (k: KeywordIdea) => void;
  lang: string;
  gl: string;
}) {
  const { t } = useTranslation();
  if (!rows.length) return <p className="text-white/35 text-sm">{t('seoTools.kwrNoMatch')}</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[760px]">
        <thead>
          <tr>
            <th className={th}>Keyword</th>
            <th className={th}>{t('seoTools.volume')}</th>
            <th className={th}>{t('seoTools.difficulty')}</th>
            <th className={th}>{t('seoTools.cpc')}</th>
            <th className={th}>{t('seoTools.kwrCompetition')}</th>
            <th className={th}>{t('seoTools.kwrResults')}</th>
            <th className={th}>{t('seoTools.intent')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((k, i) => (
            <tr key={i} onClick={() => onPick(k)} className="cursor-pointer hover:bg-white/[0.03]">
              <td className={td}>
                <div className="text-violet-300">{k.keyword}</div>
                <div className="flex gap-2 mt-0.5" onClick={(e) => e.stopPropagation()}>
                  <ExtLink href={googleSearchHref(k.keyword, lang, gl)} className="text-[11px] text-emerald-300/80 hover:underline">
                    {t('seoTools.seOpenGoogle')}
                  </ExtLink>
                  <CopyKw text={k.keyword} />
                  <SerpFeaturePills features={k.features} />
                </div>
              </td>
              <td className={td}>
                <div>{fmt(k.volume)}</div>
                <VolumeSparkline values={k.trend} />
              </td>
              <td className={td}>{k.difficulty == null ? '—' : <span className="font-semibold" style={{ color: kdColor(k.difficulty) }}>{k.difficulty}</span>}</td>
              <td className={td}>{k.cpc == null ? '—' : `$${k.cpc.toFixed(2)}`}</td>
              <td className={td}>{competitionPct(k.competition) == null ? '—' : `${competitionPct(k.competition)}%`}</td>
              <td className={td}>{fmt(k.resultsCount)}</td>
              <td className={td}>
                {k.intent ? (
                  <span className="inline-flex items-center gap-1.5 text-xs">
                    <span className="w-2 h-2 rounded-full" style={{ background: INTENT_COLORS[k.intent] ?? INTENT_COLORS['unknown'] }} />
                    {intentLabel(t, k.intent)}
                  </span>
                ) : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function KeywordResearchPage() {
  const { t, i18n } = useTranslation();
  const { data: apiBudget } = useAccountBudget();
  const budgetCapLabel = `€${Math.round((apiBudget?.capCents ?? 5000) / 100)}`;
  const { activeProjectId } = useActiveProject();
  const [marketCode, setMarketCode] = useState(() => defaultResearchMarket(i18n.language).code);
  const market = researchMarketByCode(marketCode) ?? defaultResearchMarket(i18n.language);
  const labs = labsMarket(market);
  const [seed, setSeed] = useState('');
  const [active, setActive] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [budgetBlocked, setBudgetBlocked] = useState(false);
  const [ideas, setIdeas] = useState<KeywordIdea[]>([]);
  const [sort, setSort] = useState<SortKey>('volume');
  const [view, setView] = useState<View>('all');
  const [fIntent, setFIntent] = useState<IntentFilter>('all');
  const [fMinVol, setFMinVol] = useState(0);
  const [fMaxKd, setFMaxKd] = useState(100);
  const [fInclude, setFInclude] = useState('');
  const [fExclude, setFExclude] = useState('');

  const [showCluster, setShowCluster] = useState(false);
  const [selectedKw, setSelectedKw] = useState<KeywordIdea | null>(null);
  const [serp, setSerp] = useState<SerpSnapshot | null>(null);
  const [serpBusy, setSerpBusy] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const q = params.get('q');
    if (q) setSeed(q);
    if (!import.meta.env.DEV || params.get('preview') !== '1') return;
    setSeed('dog sitter');
    setActive('dog sitter');
    setIdeas([
      {
        keyword: 'dog sitter',
        volume: 8100,
        difficulty: 31,
        cpc: 1.8,
        intent: 'transactional',
        competition: 67,
        trend: [6200, 6500, 6800, 7200, 7600, 8100],
        resultsCount: 18400000,
        features: ['ai', 'paa', 'local'],
      },
      {
        keyword: 'dog sitter basel',
        volume: 2400,
        difficulty: 28,
        cpc: 1.4,
        intent: 'transactional',
        competition: 54,
        trend: [1800, 1900, 2000, 2100, 2200, 2300, 2400],
        resultsCount: 412000,
        features: ['snippet', 'local'],
      },
      {
        keyword: 'how to become a dog sitter',
        volume: 1300,
        difficulty: 18,
        cpc: 0.4,
        intent: 'informational',
        competition: 22,
        trend: [1100, 1150, 1200, 1250, 1300],
        resultsCount: 89000000,
        features: ['paa', 'video'],
      },
    ]);
  }, []);

  // All filtering/sorting/clustering below is client-side on the already-fetched ideas — zero cost.
  const filtered = useMemo(() => {
    const inc = fInclude.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const exc = fExclude.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return ideas.filter((k) => {
      const kw = k.keyword.toLowerCase();
      return (fIntent === 'all' || k.intent === fIntent) &&
        (k.volume ?? 0) >= fMinVol &&
        (k.difficulty ?? 0) <= fMaxKd &&
        inc.every((w) => kw.includes(w)) &&
        !exc.some((w) => kw.includes(w));
    });
  }, [ideas, fIntent, fMinVol, fMaxKd, fInclude, fExclude]);

  const sorted = useMemo(() =>
    [...filtered].sort((a, b) => Number(b[sort] ?? -1) - Number(a[sort] ?? -1)),
    [filtered, sort]);

  const questions = useMemo(() => sorted.filter((k) => isQuestion(k.keyword)), [sorted]);
  const phrase = useMemo(() => {
    const s = active.trim().toLowerCase();
    if (!s) return [];
    return sorted.filter((k) => k.keyword.toLowerCase().includes(s));
  }, [sorted, active]);
  const clusters = useMemo(() => clusterKeywordIdeas(filtered, active), [filtered, active]);

  const totalVolume = useMemo(() => ideas.reduce((s, k) => s + (k.volume ?? 0), 0), [ideas]);
  // The seed's own row (for the overview hero) + an average difficulty when the seed lacks one — free.
  const seedRow = useMemo(
    () => ideas.find((k) => k.keyword.toLowerCase() === active.toLowerCase()) ?? ideas[0],
    [ideas, active],
  );
  const avgDifficulty = useMemo(() => {
    const kds = ideas.map((k) => k.difficulty).filter((d): d is number => d != null);
    return kds.length ? Math.round(kds.reduce((a, b) => a + b, 0) / kds.length) : null;
  }, [ideas]);

  async function research(term?: string) {
    const s = (term ?? seed).trim();
    if (!s) return;
    if (term) setSeed(term);
    setActive(s); setBusy(true); setErr(''); setBudgetBlocked(false); setIdeas([]);
    try {
      const loc = labs.loc;
      const list = await keywordIdeas(s, loc, 1000); // same single call — just more coverage
      setIdeas(list); // show immediately
      // Enrich with real Keyword Difficulty (one cheap bulk call; suggestions don't return KD).
      try {
        const kd = await bulkKeywordDifficulty(list.map((k) => k.keyword), loc);
        if (kd.size) setIdeas(list.map((k) => ({ ...k, difficulty: kd.get(k.keyword) ?? k.difficulty })));
      } catch { /* KD is an enhancement — keep the ideas even if it fails */ }
    } catch (e) {
      const msg = proxyErrorMessage(t, e);
      if (e instanceof AccountBudgetError) setBudgetBlocked(true);
      else if (e instanceof ResearchQuotaError || e instanceof PlanRequiredError) setErr(msg ?? t('seoTools.kwrError'));
      else setErr(msg ?? t('seoTools.kwrError'));
      console.error('[KeywordResearch] failed:', e instanceof Error ? e.message : e);
    }
    setBusy(false);
  }

  function exportCsv() {
    const csv = toCsv(sorted, [
      { header: 'Keyword', value: (k) => k.keyword },
      { header: 'Volume', value: (k) => k.volume ?? '' },
      { header: 'Difficulty', value: (k) => k.difficulty ?? '' },
      { header: 'CPC', value: (k) => k.cpc ?? '' },
      { header: 'Competition', value: (k) => competitionPct(k.competition) ?? '' },
      { header: 'Results', value: (k) => k.resultsCount ?? '' },
      { header: 'SERP features', value: (k) => (k.features ?? []).join(' ') },
    ]);
    downloadText(`keywords-${slug(active)}-${slug(market.name)}.csv`, csv);
  }

  async function openKeyword(k: KeywordIdea) {
    setSelectedKw(k); setSerp(null); setSerpBusy(true);
    try { setSerp(await serpForKeyword(k.keyword, market.loc, labs.loc)); }
      catch (e) { setSerp({ organic: [], paa: [], related: [], featured: null, ads: 0, features: [] }); if (e instanceof AccountBudgetError) setBudgetBlocked(true); }
    setSerpBusy(false);
  }

  return (
    <AppShell maxWidth="5xl">
      <h1 className="text-2xl font-bold mb-1">Keyword Research</h1>
      <p className="text-white/50 mb-5">{t('seoTools.kwrSubtitle')}</p>

      <div className={`${card} mb-4`}>
        <div className="flex flex-col sm:flex-row gap-3">
          <input
            value={seed}
            onChange={(e) => setSeed(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') research(); }}
            placeholder={t('seoTools.kwrPlaceholder')}
            className="flex-1 bg-transparent border border-white/[0.12] focus:border-violet-400/60 rounded-xl px-4 py-3 outline-none text-white placeholder:text-white/30"
          />
          <MarketSelect
            markets={RESEARCH_MARKETS}
            value={marketCode}
            onChange={setMarketCode}
            title={t('seoTools.kwrMarketTitle')}
            className="sm:w-56"
          />
          <button
            onClick={() => void research()}
            disabled={busy}
            className="bg-white text-black font-semibold rounded-xl px-6 py-3 disabled:opacity-50"
          >
            {busy ? '…' : t('seoTools.kwrSearch')}
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

      {active && !budgetBlocked && (
        <>
          {/* Keyword overview hero (free — from the ideas already fetched) */}
          <div className={`${card} mb-4`}>
            <div className="flex flex-wrap items-center gap-2 mb-4">
              <h2 className="text-xl font-bold">{active}</h2>
              <span className="text-xs px-2 py-0.5 rounded-full bg-white/[0.06] text-white/50">{market.name}</span>
              {market.group === 'cities' ? (
                <span className="text-xs text-white/35">{t('seoTools.seCityNote', { city: market.name, country: labs.name })}</span>
              ) : null}
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
              <Metric label={t('seoTools.volume')} value={fmt(seedRow?.volume)} />
              <Metric label={t('seoTools.difficulty')} value={seedRow?.difficulty != null ? String(seedRow.difficulty) : avgDifficulty != null ? `~${avgDifficulty}` : '—'} color={seedRow?.difficulty != null ? kdColor(seedRow.difficulty) : avgDifficulty != null ? kdColor(avgDifficulty) : undefined} />
              <Metric label={t('seoTools.cpc')} value={seedRow?.cpc == null ? '—' : `$${seedRow.cpc.toFixed(2)}`} />
              <Metric label={t('seoTools.kwrCompetition')} value={competitionPct(seedRow?.competition) == null ? '—' : `${competitionPct(seedRow?.competition)}%`} />
              <Metric label={t('seoTools.kwrResults')} value={fmt(seedRow?.resultsCount)} />
              <Metric label={t('seoTools.intent')} value={seedRow?.intent ? intentLabel(t, seedRow.intent) : '—'} />
              <Metric label={t('seoTools.kwrIdeas')} value={fmt(ideas.length)} />
              <Metric label={t('seoTools.kwrTotalVolume')} value={fmt(totalVolume)} />
            </div>
          </div>

          <div className={card}>
            {/* Filters (client-side, free) */}
            <div className="flex flex-wrap items-center gap-2 mb-3 text-xs">
              <select value={fIntent} onChange={(e) => setFIntent(e.target.value as IntentFilter)} className="bg-white/[0.04] border border-white/[0.1] rounded-md px-2 py-1.5 text-white/80 outline-none">
                {INTENTS.map((it) => <option key={it} value={it} className="bg-[#0b0b0f]">{it === 'all' ? t('seoTools.kwrAllIntents') : intentLabel(t, it)}</option>)}
              </select>
              <label className="flex items-center gap-1 text-white/45">{t('seoTools.kwrMinVol')}
                <input type="number" min={0} value={fMinVol} onChange={(e) => setFMinVol(Math.max(0, Number(e.target.value) || 0))} className="w-20 bg-white/[0.04] border border-white/[0.1] rounded-md px-2 py-1.5 text-white/80 outline-none" />
              </label>
              <label className="flex items-center gap-1 text-white/45">{t('seoTools.kwrMaxKd')}
                <input type="number" min={0} max={100} value={fMaxKd} onChange={(e) => setFMaxKd(Math.min(100, Math.max(0, Number(e.target.value) || 0)))} className="w-16 bg-white/[0.04] border border-white/[0.1] rounded-md px-2 py-1.5 text-white/80 outline-none" />
              </label>
              <input value={fInclude} onChange={(e) => setFInclude(e.target.value)} placeholder={t('seoTools.kwrInclude')} className="w-28 bg-white/[0.04] border border-white/[0.1] rounded-md px-2 py-1.5 text-white/80 outline-none placeholder:text-white/25" />
              <input value={fExclude} onChange={(e) => setFExclude(e.target.value)} placeholder={t('seoTools.kwrExclude')} className="w-28 bg-white/[0.04] border border-white/[0.1] rounded-md px-2 py-1.5 text-white/80 outline-none placeholder:text-white/25" />
              <div className="flex-1" />
              {view !== 'clusters' && (['volume', 'difficulty', 'cpc', 'competition'] as SortKey[]).map((k) => (
                <button key={k} onClick={() => setSort(k)} className={`px-2 py-1 rounded-md ${sort === k ? 'bg-white/10 text-white' : 'text-white/40 hover:text-white/70'}`}>
                  {k === 'volume' ? t('seoTools.volume') : k === 'difficulty' ? t('seoTools.difficulty') : k === 'cpc' ? t('seoTools.cpc') : t('seoTools.kwrCompetition')}
                </button>
              ))}
            </div>

            {/* Views */}
            <div className="flex items-center gap-2 mb-2">
              {([['all', `${t('seoTools.kwrViewAll')} (${filtered.length})`], ['phrase', `${t('seoTools.kwrViewPhrase')} (${phrase.length})`], ['clusters', `${t('seoTools.kwrViewTopics')} (${clusters.length})`], ['questions', `${t('seoTools.kwrViewQuestions')} (${questions.length})`]] as [View, string][]).map(([v, lbl]) => (
                <button key={v} onClick={() => setView(v)} className={`px-3 py-1.5 rounded-full text-sm ${view === v ? 'bg-white text-black font-semibold' : 'bg-white/[0.04] text-white/60 hover:text-white'}`}>{lbl}</button>
              ))}
              <div className="flex-1" />
              {!!filtered.length && (
                <button onClick={() => setShowCluster(true)} className="text-xs text-white/50 hover:text-white border border-white/[0.12] rounded-full px-3 py-1.5">{t('seoTools.kwrClusterSerp')}</button>
              )}
              {!!filtered.length && (
                <button onClick={exportCsv} className="text-xs text-white/50 hover:text-white border border-white/[0.12] rounded-full px-3 py-1.5">{t('seoTools.exportCsv')}</button>
              )}
            </div>
            {!!ideas.length && <p className="text-white/30 text-xs mb-4">{t('seoTools.kwrSerpHint')}</p>}

            {busy ? (
              <TableSkeleton rows={8} cols={7} />
            ) : !ideas.length ? (
              <p className="text-white/35 text-sm">{t('seoTools.kwrNoIdeas')}</p>
            ) : view === 'clusters' ? (
              <div className="space-y-4">
                {clusters.map((c, i) => (
                  <div key={i}>
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className="text-sm font-semibold text-white/90 capitalize">{c.topic}</span>
                      <span className="text-xs text-white/35">{t('seoTools.kwrClusterMeta', { count: c.keywords.length, vol: fmt(c.volume) })}</span>
                    </div>
                    <KeywordTable rows={c.keywords} onPick={openKeyword} lang={market.loc.languageCode} gl={marketGl(market)} />
                  </div>
                ))}
              </div>
            ) : (
              <>
                <KeywordTable rows={(view === 'questions' ? questions : view === 'phrase' ? phrase : sorted).slice(0, 300)} onPick={openKeyword} lang={market.loc.languageCode} gl={marketGl(market)} />
                {(view === 'questions' ? questions : view === 'phrase' ? phrase : sorted).length > 300 && (
                  <p className="text-white/30 text-xs mt-3">{t('seoTools.kwrShowingTop', { count: (view === 'questions' ? questions : view === 'phrase' ? phrase : sorted).length })}</p>
                )}
              </>
            )}
          </div>
        </>
      )}

      {!active && !busy && (
        <EmptyState
          icon="🔑"
          title={t('seoTools.kwrEmptyLead')}
          description={t('seoTools.kwrEmptyHint')}
        />
      )}

      {selectedKw && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setSelectedKw(null)}>
          <div className="w-full max-w-2xl max-h-[85vh] overflow-y-auto rounded-2xl border border-white/[0.1] bg-[#0b0b0f] p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-4 mb-4">
              <div className="min-w-0">
                <h3 className="text-lg font-bold">{selectedKw.keyword}</h3>
                <div className="flex flex-wrap gap-3 mt-1">
                  <ExtLink
                    href={googleSearchHref(selectedKw.keyword, market.loc.languageCode, marketGl(market))}
                    className="text-xs text-emerald-300/80 hover:underline"
                  >{t('seoTools.seOpenGoogle')}</ExtLink>
                  {selectedKw.keyword.toLowerCase() !== active.toLowerCase() && (
                    <button
                      type="button"
                      className="text-xs text-violet-300 hover:underline"
                      onClick={() => { const next = selectedKw.keyword; setSelectedKw(null); void research(next); }}
                    >{t('seoTools.seResearchThis')}</button>
                  )}
                  <TrackKeywordCta projectId={activeProjectId ?? undefined} keyword={selectedKw.keyword} compact />
                </div>
              </div>
              <button onClick={() => setSelectedKw(null)} className="text-white/40 hover:text-white text-xl leading-none">×</button>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-5">
              <Metric label={t('seoTools.volume')} value={fmt(selectedKw.volume)} />
              <Metric label={t('seoTools.difficulty')} value={selectedKw.difficulty == null ? '—' : String(selectedKw.difficulty)} color={selectedKw.difficulty == null ? undefined : kdColor(selectedKw.difficulty)} />
              <Metric label={t('seoTools.cpc')} value={selectedKw.cpc == null ? '—' : `$${selectedKw.cpc.toFixed(2)}`} />
              <Metric label={t('seoTools.kwrCompetition')} value={competitionPct(selectedKw.competition) == null ? '—' : `${competitionPct(selectedKw.competition)}%`} />
              <Metric label={t('seoTools.kwrResults')} value={fmt(selectedKw.resultsCount)} />
              <Metric label={t('seoTools.intent')} value={selectedKw.intent ? intentLabel(t, selectedKw.intent) : '—'} />
            </div>
            <div className="flex items-center gap-2 mb-2 mt-4">
              <h4 className="text-sm font-semibold text-white/70">{t('seoTools.serpTitle')}</h4>
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-400/10 text-emerald-300/80">LIVE · {market.name}</span>
            </div>
            {serpBusy ? <p className="text-violet-300 text-sm">{t('seoTools.serpLoading')}</p> : (
              <>
                {serp && serp.organic.length ? <SerpRows rows={serp.organic} /> : null}
                {serp && !serp.organic.length && <p className="text-white/35 text-sm">{t('seoTools.serpUnavailable')}</p>}
                {serp ? (
                  <SerpExtras
                    snap={serp}
                    onPickRelated={(q) => { setSelectedKw(null); void research(q); }}
                  />
                ) : null}
              </>
            )}
          </div>
        </div>
      )}
      {showCluster && (
        <KeywordClusterPanel
          ideas={sorted}
          loc={market.loc}
          marketName={market.name}
          onClose={() => setShowCluster(false)}
        />
      )}
    </AppShell>
  );
}
