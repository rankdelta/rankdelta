/**
 * Site Explorer — an in-depth look at any domain's estimated organic traffic, keywords and
 * backlinks (Ahrefs-style: one domain in, explore it). Competitor comparison lives in the separate
 * Content Gap tab. Uses the cloud's design system, wired to the shared siteExplorer service.
 *
 * Customer-facing copy never names the data backend. Each section loads independently, so if one
 * data source is unavailable the rest of the page still works.
 */

import { useAccountBudget } from '../hooks/useAccountBudget';
import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { AppShell } from '../components/layout/AppShell';
import { ExtLink, PageLink } from '../components/seo/ExtLink';
import { MarketSelect } from '../components/seo/MarketSelect';
import { SerpExtras, SerpRows } from '../components/seo/SerpRows';
import { TrackKeywordCta } from '../components/content/TrackKeywordCta';
import { VolumeSparkline } from '../components/seo/VolumeSparkline';
import { PosDelta } from '../components/seo/PosDelta';
import { SerpFeaturePills } from '../components/seo/SerpFeaturePills';
import { CopyKw } from '../components/seo/CopyKw';
import { PositionDistribution } from '../components/seo/PositionDistribution';
import { useActiveProject } from '../hooks/useActiveProject';
import {
  domainOverview, rankedKeywords, backlinkSummary, referringDomains, backlinksList, trafficHistory, serpForKeyword, competitorDomains, topPages, trafficByCountry, TRAFFIC_BY_COUNTRY_CALLS, backlinkAnchors, backlinkHistory, linkIntersect, openPageRank, hostOf,
  type DomainOverview, type RankedKeyword, type BacklinkSummary, type ReferringDomain, type Backlink, type TrafficPoint, type Competitor, type TopPage, type CountryTraffic, type Anchor, type BacklinkTimepoint, type LinkGapRow, type SerpSnapshot,
} from '../services/siteExplorer';
import { AccountBudgetError, ResearchQuotaError, PlanRequiredError } from '../services/edgeProxy';
import { proxyErrorMessage } from '../lib/proxyErrorMessage';
import { toCsv, downloadText } from '../lib/csv';
import { kdColor, authorityColor } from '../lib/kd';
import { defaultResearchMarket, RESEARCH_MARKETS, labsMarket, marketGl, researchMarketByCode } from '../lib/seoMarkets';
import { googleSearchHref, hostOf as urlHost, pathOf } from '../lib/seoUrls';
import { TableSkeleton, MetricsSkeleton, ChartSkeleton } from '../components/ui/Skeletons';
import { EmptyState } from '../components/ui/EmptyState';

const fmt = (n: number | null | undefined) =>
  n == null ? '—' : n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1_000 ? `${(n / 1_000).toFixed(1)}k` : String(Math.round(n));
const usd = (n: number | null | undefined) => (n == null ? '—' : `$${fmt(n)}`);
const norm = (k: string) => k.trim().toLowerCase();

type Tab = 'keywords' | 'pages' | 'competitors' | 'countries' | 'refdomains' | 'links' | 'anchors' | 'blhistory' | 'linkgap' | 'gap';
type RangeKey = '3M' | '6M' | '1Y' | '2Y';
const RANGE_MONTHS: Record<RangeKey, number> = { '3M': 3, '6M': 6, '1Y': 12, '2Y': 24 };
interface GapRow { keyword: string; theirPos: number | null; yourPos: number | null; volume: number | null }

// 24 months back (YYYY-MM-DD) so the chart can offer up to a 2-year range from one fetch.
function twoYearsAgo(): string {
  const d = new Date();
  d.setMonth(d.getMonth() - 24);
  return d.toISOString().slice(0, 10);
}

const INTENT_COLORS: Record<string, string> = {
  informational: '#60a5fa', commercial: '#fbbf24', transactional: '#34d399', navigational: '#a78bfa', unknown: '#6b7280',
};
// DataForSEO domain rank is 0–1000; present it as a 0–100 authority estimate (÷10). Honest: it's an
// estimate from a backlink index, NOT Ahrefs DR. Open PageRank (free) shows alongside as a 2nd signal.
const authorityFromRank = (rank: number | null | undefined): number | null =>
  rank == null ? null : Math.max(0, Math.min(100, Math.round(rank / 10)));
const card = 'rounded-2xl border border-white/[0.08] bg-white/[0.02] p-5';
const th = 'text-left text-xs font-semibold text-white/45 px-3 py-2 border-b border-white/[0.08]';
const td = 'px-3 py-2 text-sm border-b border-white/[0.04]';
const inputCls = 'w-full px-4 py-2.5 bg-white/[0.03] border border-white/[0.1] rounded-xl text-white placeholder-white/30 focus:border-violet-500/50 outline-none';

const EMPTY_SERP: SerpSnapshot = { organic: [], paa: [], related: [], featured: null, ads: 0, features: [] };
const TABLE_PAGE = 50;
type TFn = (key: string, opts?: Record<string, unknown>) => string;
const intentLabelSE = (t: TFn, intent: string): string =>
  t(`seoTools.intent_${intent}`, { defaultValue: intent[0]!.toUpperCase() + intent.slice(1) });

export function SiteExplorerPage() {
  const { t, i18n } = useTranslation();
  const { data: apiBudget } = useAccountBudget();
  const budgetCapLabel = `€${Math.round((apiBudget?.capCents ?? 5000) / 100)}`;
  const { activeProjectId } = useActiveProject();
  const [target, setTarget] = useState('');
  const [marketCode, setMarketCode] = useState(() => defaultResearchMarket(i18n.language).code);
  const selectedMarket = researchMarketByCode(marketCode) ?? defaultResearchMarket(i18n.language);
  const labs = labsMarket(selectedMarket);
  const loc = labs.loc;
  const [activeLoc, setActiveLoc] = useState(loc);
  const [serpLoc, setSerpLoc] = useState(selectedMarket.loc);
  const [active, setActive] = useState('');
  const [tab, setTab] = useState<Tab>('keywords');
  const [range, setRange] = useState<RangeKey>('6M');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const [overview, setOverview] = useState<DomainOverview | null>(null);
  const [backlinks, setBacklinks] = useState<BacklinkSummary | null>(null);
  const [opr, setOpr] = useState<number | null>(null);
  const [traffic, setTraffic] = useState<TrafficPoint[]>([]);
  const [keywords, setKeywords] = useState<RankedKeyword[]>([]);
  const [kwIntent, setKwIntent] = useState<'all' | string>('all');
  const [kwQuery, setKwQuery] = useState('');
  const [kwSort, setKwSort] = useState<'traffic' | 'position' | 'volume'>('traffic');
  const [linkFollow, setLinkFollow] = useState<'all' | 'dofollow' | 'nofollow'>('all');
  const [linkQuery, setLinkQuery] = useState('');
  const [refDomains, setRefDomains] = useState<ReferringDomain[] | null>(null);
  const [refdomainsBusy, setRefdomainsBusy] = useState(false);
  const [links, setLinks] = useState<Backlink[] | null>(null);
  const [linksBusy, setLinksBusy] = useState(false);
  const [competitors, setCompetitors] = useState<Competitor[] | null>(null);
  const [competitorsBusy, setCompetitorsBusy] = useState(false);
  const [pages, setPages] = useState<TopPage[] | null>(null);
  const [pagesBusy, setPagesBusy] = useState(false);
  const [countryTraffic, setCountryTraffic] = useState<CountryTraffic[] | null>(null);
  const [countriesBusy, setCountriesBusy] = useState(false);
  const [anchors, setAnchors] = useState<Anchor[] | null>(null);
  const [anchorsBusy, setAnchorsBusy] = useState(false);
  const [blHistory, setBlHistory] = useState<BacklinkTimepoint[] | null>(null);
  const [blHistoryBusy, setBlHistoryBusy] = useState(false);
  const [unavailable, setUnavailable] = useState<Set<string>>(new Set());
  // True when the seo-proxy refused calls because the account hit its monthly spend cap (HTTP 402).
  const [budgetBlocked, setBudgetBlocked] = useState(false);
  const [quotaErr, setQuotaErr] = useState('');

  // Keyword detail (click a keyword → live SERP + metrics). SERP is fetched on demand (cheap, cached).
  const [selectedKw, setSelectedKw] = useState<RankedKeyword | null>(null);
  const [serp, setSerp] = useState<SerpSnapshot | null>(null);
  const [serpBusy, setSerpBusy] = useState(false);
  const [shown, setShown] = useState({ kw: TABLE_PAGE, links: TABLE_PAGE, pages: TABLE_PAGE, refs: TABLE_PAGE, comps: TABLE_PAGE, anchors: TABLE_PAGE, gap: TABLE_PAGE, linkgap: TABLE_PAGE });

  async function openKeyword(k: RankedKeyword) {
    setSelectedKw(k); setSerp(null); setSerpBusy(true);
    try { setSerp(await serpForKeyword(k.keyword, serpLoc, activeLoc)); }
    catch (e) { setSerp(EMPTY_SERP); if (e instanceof AccountBudgetError) setBudgetBlocked(true); }
    setSerpBusy(false);
  }

  // Content Gap (separate — its own "your domain").
  const [yourSite, setYourSite] = useState('');
  const [comparedYou, setComparedYou] = useState('');
  const [gapBusy, setGapBusy] = useState(false);
  const [yourKeywords, setYourKeywords] = useState<RankedKeyword[]>([]);
  const [linkYou, setLinkYou] = useState('');
  const [linkGap, setLinkGap] = useState<LinkGapRow[] | null>(null);
  const [linkGapBusy, setLinkGapBusy] = useState(false);
  const prefilled = useRef(false);
  useEffect(() => {
    if (prefilled.current || typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const q = params.get('domain');
    if (q) {
      prefilled.current = true;
      setTarget(q);
      return;
    }
    // Dev-only: paint the real Site Explorer chrome with sample rows (no DataForSEO).
    if (!import.meta.env.DEV || params.get('preview') !== '1') return;
    prefilled.current = true;
    setTarget('rover.com');
    setActive('rover.com');
    setTab('links');
    setOverview({
      target: 'rover.com',
      organicKeywords: 18420,
      organicTraffic: 90200,
      organicTrafficValue: 41000,
      paidKeywords: 120,
      positions: {
        pos1: 420, pos2_3: 980, pos4_10: 3100, pos11_20: 4200, pos21plus: 9720,
        isNew: 640, isUp: 2100, isDown: 1480, isLost: 390,
      },
    });
    setBacklinks({
      target: 'rover.com',
      domainRank: 720,
      backlinks: 15400,
      referringDomains: 2100,
      referringMainDomains: 1800,
      brokenBacklinks: 42,
      referringDomainsNofollow: 310,
    });
    setOpr(61);
    setTraffic([
      { date: '2026-03', traffic: 72000, keywords: 16000 },
      { date: '2026-04', traffic: 78000, keywords: 16800 },
      { date: '2026-05', traffic: 81000, keywords: 17200 },
      { date: '2026-06', traffic: 86000, keywords: 17800 },
      { date: '2026-07', traffic: 88000, keywords: 18100 },
      { date: '2026-08', traffic: 90200, keywords: 18420 },
    ]);
    setKeywords([
      { keyword: 'dog sitter basel', position: 4, volume: 2400, url: 'https://www.rover.com/it/s/basel', intent: 'transactional', difficulty: 28, cpc: 1.4, traffic: 120, change: { previous: 7, delta: 3, isNew: false, isUp: true, isDown: false }, trend: [1800, 1900, 2000, 2100, 2200, 2300, 2400], features: ['snippet'] },
      { keyword: 'petsitter zurich', position: 7, volume: 1600, url: 'https://www.rover.com/it/s/zurich', intent: 'commercial', difficulty: 22, cpc: 1.1, traffic: 64, change: { previous: 5, delta: -2, isNew: false, isUp: false, isDown: true }, trend: [1700, 1650, 1600, 1580, 1600], features: [] },
    ]);
    setLinks([
      {
        from: 'https://thefocus.news/pets/omega-3-guide',
        to: 'https://www.rover.com/it/blog/omega-3',
        fromTitle: 'Omega-3 for dogs: a vet guide',
        anchor: 'omega-3 for dogs',
        dofollow: true,
        rank: 72,
        firstSeen: '2025-11-02T00:00:00+00:00',
        lastSeen: '2026-08-12T00:00:00+00:00',
        itemType: 'anchor',
        broken: false,
        attributes: [],
        domainFromRank: 68,
      },
      {
        from: 'https://livelycity.com/post/best-sitters',
        to: 'https://www.rover.com/it/s/basel',
        fromTitle: 'Best sitters in Basel',
        anchor: 'rover',
        dofollow: false,
        rank: 41,
        firstSeen: '2026-01-18T00:00:00+00:00',
        lastSeen: '2026-08-01T00:00:00+00:00',
        itemType: 'anchor',
        broken: true,
        attributes: ['ugc'],
        domainFromRank: 22,
      },
    ]);
    setPages([
      { url: 'https://www.rover.com/it/s/basel', keywords: 84, traffic: 12000, trafficValue: 5400 },
      { url: 'https://www.rover.com/it/blog/omega-3', keywords: 36, traffic: 4100, trafficValue: 2100 },
    ]);
    setRefDomains([
      { domain: 'thefocus.news', rank: 68, backlinks: 4, firstSeen: '2025-11-02T00:00:00+00:00', lastSeen: '2026-08-12T00:00:00+00:00', dofollow: 3, country: 'US' },
    ]);
  }, []);

  const gap = useMemo<GapRow[]>(() => {
    if (!comparedYou) return [];
    const yours = new Map(yourKeywords.map((k) => [norm(k.keyword), k.position]));
    return keywords
      .filter((k) => k.position != null && k.position <= 20)
      .map((k) => ({ keyword: k.keyword, theirPos: k.position, yourPos: yours.get(norm(k.keyword)) ?? null, volume: k.volume }))
      .filter((g) => g.yourPos == null || g.yourPos > 20)
      .sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0));
  }, [keywords, yourKeywords, comparedYou]);

  // Keywords-by-intent breakdown (Ahrefs-style), computed from the fetched keywords — no extra API cost.
  const intents = useMemo(() => {
    const t: Record<string, { count: number; volume: number }> = {};
    for (const k of keywords) {
      const key = k.intent || 'unknown';
      t[key] ??= { count: 0, volume: 0 };
      t[key].count++; t[key].volume += k.volume ?? 0;
    }
    const total = keywords.length || 1;
    return Object.entries(t).map(([intent, v]) => ({ intent, ...v, share: Math.round((v.count / total) * 100) })).sort((a, b) => b.count - a.count);
  }, [keywords]);

  const posBuckets = useMemo(() => {
    const b = { top3: 0, p4to10: 0, p11to20: 0, p21: 0 };
    for (const k of keywords) {
      const p = k.position;
      if (p == null) continue;
      if (p <= 3) b.top3++;
      else if (p <= 10) b.p4to10++;
      else if (p <= 20) b.p11to20++;
      else b.p21++;
    }
    return b;
  }, [keywords]);

  const shownKeywords = useMemo(() => {
    const q = kwQuery.trim().toLowerCase();
    const rows = keywords.filter((k) => {
      if (kwIntent !== 'all' && (k.intent || 'unknown') !== kwIntent) return false;
      if (q && !k.keyword.toLowerCase().includes(q) && !(k.url ?? '').toLowerCase().includes(q)) return false;
      return true;
    });
    const dir = kwSort === 'position' ? 1 : -1;
    return [...rows].sort((a, b) => {
      const av = kwSort === 'position' ? (a.position ?? 999) : (a[kwSort] ?? -1);
      const bv = kwSort === 'position' ? (b.position ?? 999) : (b[kwSort] ?? -1);
      return dir * (Number(av) - Number(bv)) || (kwSort === 'position' ? 0 : Number(b.traffic ?? 0) - Number(a.traffic ?? 0));
    });
  }, [keywords, kwIntent, kwQuery, kwSort]);

  const topKeywordByPage = useMemo(() => {
    const m = new Map<string, RankedKeyword>();
    for (const k of keywords) {
      if (!k.url) continue;
      const key = `${urlHost(k.url)}${pathOf(k.url)}`.toLowerCase();
      const prev = m.get(key);
      if (!prev || (k.traffic ?? 0) > (prev.traffic ?? 0)) m.set(key, k);
    }
    return m;
  }, [keywords]);

  const shownLinks = useMemo(() => {
    const q = linkQuery.trim().toLowerCase();
    return (links ?? []).filter((b) => {
      if (linkFollow === 'dofollow' && b.dofollow !== true) return false;
      if (linkFollow === 'nofollow' && b.dofollow !== false) return false;
      if (!q) return true;
      const hay = `${b.from ?? ''} ${b.to ?? ''} ${b.anchor ?? ''} ${b.fromTitle ?? ''}`.toLowerCase();
      return hay.includes(q);
    });
  }, [links, linkFollow, linkQuery]);

  // Each source loads independently; a failure marks that section unavailable but never breaks the page.
  async function section<T>(key: string, run: () => Promise<T>, set: (v: T) => void, fallback: T) {
    try { set(await run()); }
    catch (e) {
      set(fallback);
      const msg = proxyErrorMessage(t, e);
      if (e instanceof AccountBudgetError) setBudgetBlocked(true);
      else if (e instanceof ResearchQuotaError || e instanceof PlanRequiredError) setQuotaErr(msg ?? '');
      else setUnavailable((s) => new Set(s).add(key));
      console.error(`[SiteExplorer] ${key} failed:`, e instanceof Error ? e.message : e);
    }
  }

  async function explore(domainArg?: string) {
    const t = hostOf((domainArg ?? target).trim());
    if (!t) return;
    if (domainArg) setTarget(domainArg);
    setTab('keywords');
    setActive(t); setActiveLoc(loc); setBusy(true); setErr(''); setQuotaErr('');
    setOverview(null); setBacklinks(null); setOpr(null); setTraffic([]); setKeywords([]); setRefDomains(null); setLinks(null); setCompetitors(null); setPages(null); setCountryTraffic(null); setAnchors(null); setBlHistory(null); setLinkGap(null); setLinkYou('');
    setYourSite(''); setComparedYou(''); setYourKeywords([]); setUnavailable(new Set()); setBudgetBlocked(false);
    setKwIntent('all'); setKwQuery(''); setKwSort('traffic'); setLinkFollow('all'); setLinkQuery('');
    setShown({ kw: TABLE_PAGE, links: TABLE_PAGE, pages: TABLE_PAGE, refs: TABLE_PAGE, comps: TABLE_PAGE, anchors: TABLE_PAGE, gap: TABLE_PAGE, linkgap: TABLE_PAGE });
    setActiveLoc(loc);
    setSerpLoc(selectedMarket.loc);
    await Promise.all([
      section('overview', () => domainOverview(t, loc), setOverview, null),
      section('backlinks', () => backlinkSummary(t), setBacklinks, null),
      section('traffic', () => trafficHistory(t, loc, twoYearsAgo()), setTraffic, []),
      section('keywords', () => rankedKeywords(t, loc, 500), setKeywords, []),
      section('opr', () => openPageRank(t), setOpr, null),
    ]);
    setBusy(false);
  }

  async function openRefdomains() {
    setTab('refdomains');
    if (refDomains !== null || refdomainsBusy || !active) return;
    setRefdomainsBusy(true);
    try { setRefDomains(await referringDomains(active, 200)); }
    catch (e) { setRefDomains([]); if (e instanceof AccountBudgetError) setBudgetBlocked(true); else setUnavailable((s) => new Set(s).add('refdomains')); }
    setRefdomainsBusy(false);
  }

  async function openAnchors() {
    setTab('anchors');
    if (anchors !== null || anchorsBusy || !active) return;
    setAnchorsBusy(true);
    try { setAnchors(await backlinkAnchors(active, 100)); }
    catch (e) { setAnchors([]); if (e instanceof AccountBudgetError) setBudgetBlocked(true); else setUnavailable((s) => new Set(s).add('anchors')); }
    setAnchorsBusy(false);
  }

  async function openBlHistory() {
    setTab('blhistory');
    if (blHistory !== null || blHistoryBusy || !active) return;
    setBlHistoryBusy(true);
    try { setBlHistory(await backlinkHistory(active)); }
    catch (e) { setBlHistory([]); if (e instanceof AccountBudgetError) setBudgetBlocked(true); else setUnavailable((s) => new Set(s).add('blhistory')); }
    setBlHistoryBusy(false);
  }

  async function openLinks() {
    setTab('links');
    if (links !== null || linksBusy || !active) return;
    setLinksBusy(true);
    try { setLinks(await backlinksList(active, 200)); }
    catch (e) { setLinks([]); if (e instanceof AccountBudgetError) setBudgetBlocked(true); else setUnavailable((s) => new Set(s).add('links')); }
    setLinksBusy(false);
  }

  async function openCompetitors() {
    setTab('competitors');
    if (competitors !== null || competitorsBusy || !active) return;
    setCompetitorsBusy(true);
    try { setCompetitors(await competitorDomains(active, activeLoc, 100)); }
    catch (e) { setCompetitors([]); if (e instanceof AccountBudgetError) setBudgetBlocked(true); else setUnavailable((s) => new Set(s).add('competitors')); }
    setCompetitorsBusy(false);
  }

  async function openPages() {
    setTab('pages');
    if (pages !== null || pagesBusy || !active) return;
    setPagesBusy(true);
    try { setPages(await topPages(active, activeLoc, 100)); }
    catch (e) { setPages([]); if (e instanceof AccountBudgetError) setBudgetBlocked(true); else setUnavailable((s) => new Set(s).add('pages')); }
    setPagesBusy(false);
  }

  // Opening the tab must NOT spend — traffic-by-country costs one lookup per market. The user opts in
  // explicitly with the button (runCountries), so we never fan out ~6 DataForSEO calls silently.
  function openCountries() { setTab('countries'); }
  async function runCountries() {
    if (countryTraffic !== null || countriesBusy || !active) return;
    setCountriesBusy(true);
    try { setCountryTraffic(await trafficByCountry(active)); }
    catch (e) { setCountryTraffic([]); if (e instanceof AccountBudgetError) setBudgetBlocked(true); else setUnavailable((s) => new Set(s).add('countries')); }
    setCountriesBusy(false);
  }

  async function runGap() {
    const you = hostOf(yourSite.trim());
    if (!you || !active) return;
    setComparedYou(you); setGapBusy(true);
    try { setYourKeywords(await rankedKeywords(you, activeLoc, 500)); }
    catch (e) { setYourKeywords([]); if (e instanceof AccountBudgetError) setBudgetBlocked(true); }
    setGapBusy(false);
  }

  async function runLinkGap() {
    const you = hostOf(linkYou.trim());
    if (!you || !active) return;
    setLinkGapBusy(true);
    try { setLinkGap(await linkIntersect(active, you, 100)); }
    catch (e) { setLinkGap([]); if (e instanceof AccountBudgetError) setBudgetBlocked(true); else setUnavailable((s) => new Set(s).add('linkgap')); }
    setLinkGapBusy(false);
  }

  const pill = (on: boolean) =>
    `rounded-full px-4 py-1.5 text-sm font-semibold border transition ${on ? 'bg-white text-black border-white' : 'bg-white/[0.04] text-white/70 border-white/15 hover:text-white'}`;
  const na = (k: string) => unavailable.has(k);

  return (
    <AppShell maxWidth="5xl">
      <div className="mb-5">
        <h1 className="text-2xl font-extrabold tracking-tight">Site Explorer</h1>
        <p className="text-white/45 text-sm mt-1">{t('seoTools.seSubtitle')}</p>
        {active ? (
          <p className="text-white/35 text-xs mt-1">
            {active} · {selectedMarket.name}
            {selectedMarket.group === 'cities' ? ` · ${t('seoTools.seCityNote', { city: selectedMarket.name, country: labs.name })}` : ''}
          </p>
        ) : null}
      </div>

      <div className={`${card} mb-4`}>
        <div className="flex flex-col sm:flex-row gap-2.5">
          <input className={inputCls} placeholder={t('seoTools.sePlaceholder')}
            value={target} onChange={(e) => setTarget(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && explore()} />
          <MarketSelect
            markets={RESEARCH_MARKETS}
            value={marketCode}
            onChange={setMarketCode}
            title={t('seoTools.kwrMarketTitle')}
            className="sm:w-56"
          />
          <button className="rounded-full px-6 py-2.5 bg-white text-black font-semibold hover:bg-white/90 disabled:opacity-60 whitespace-nowrap" onClick={() => explore()} disabled={busy || !target.trim()}>
            {busy ? t('seoTools.seAnalyzing') : t('seoTools.seExplore')}
          </button>
        </div>
      </div>

      {err && <p className="text-rose-300 text-sm mb-3">{err}</p>}

      {quotaErr && (
        <div className="mb-4 rounded-2xl border border-rose-400/30 bg-rose-400/[0.06] p-4">
          <p className="text-rose-200 text-sm">{quotaErr}</p>
        </div>
      )}

      {budgetBlocked && (
        <div className="mb-4 rounded-2xl border border-amber-400/30 bg-amber-400/[0.06] p-4">
          <p className="text-amber-200 font-semibold text-sm">{t('seoTools.budgetTitle')}</p>
          <p className="text-amber-100/70 text-sm mt-1">{t('seoTools.budgetBody', { cap: budgetCapLabel })}</p>
        </div>
      )}

      {active && (
        <>
          {/* Metric cards */}
          {busy && !overview && !backlinks ? <div className="mb-4"><MetricsSkeleton /></div> : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-4">
            <Metric
              label={t('seoTools.seAuthority')}
              value={authorityFromRank(backlinks?.domainRank) == null ? '—' : String(authorityFromRank(backlinks?.domainRank))}
              color={authorityFromRank(backlinks?.domainRank) == null ? undefined : authorityColor(authorityFromRank(backlinks?.domainRank))}
              sub={opr == null ? undefined : `Open PageRank ${opr}`}
            />
            <Metric label={t('seoTools.seEstTraffic')} value={fmt(overview?.organicTraffic)} />
            <Metric label={t('seoTools.seOrganicKw')} value={fmt(overview?.organicKeywords)} sub={overview?.paidKeywords ? `${fmt(overview.paidKeywords)} ${t('seoTools.sePaidKw')}` : undefined} />
            <Metric label={t('seoTools.seTrafficValue')} value={usd(overview?.organicTrafficValue)} />
            <Metric
              label={t('seoTools.seRefDomains')}
              value={fmt(backlinks?.referringDomains)}
              sub={backlinks?.referringDomainsNofollow ? `${fmt(backlinks.referringDomainsNofollow)} nofollow` : undefined}
            />
            <Metric
              label={t('seoTools.seBacklinks')}
              value={fmt(backlinks?.backlinks)}
              sub={backlinks?.brokenBacklinks ? `${fmt(backlinks.brokenBacklinks)} ${t('seoTools.seBroken')}` : undefined}
            />
          </div>
          )}

          {overview?.positions && (
            <PositionDistribution
              positions={overview.positions}
              newLabel={t('seoTools.seRankNew')}
              upLabel={t('seoTools.seRankUp')}
              downLabel={t('seoTools.seRankDown')}
              lostLabel={t('seoTools.seRankLost')}
            />
          )}

          {/* Traffic-over-time chart (centerpiece) + keywords-by-intent, side by side like Ahrefs */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
            <div className={`${card} lg:col-span-2`}>
              <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
                <h3 className="text-sm font-semibold text-white/80">{t('seoTools.seChartTitle')}</h3>
                <div className="flex gap-1">
                  {(Object.keys(RANGE_MONTHS) as RangeKey[]).map((r) => (
                    <button key={r} onClick={() => setRange(r)}
                      className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition ${range === r ? 'bg-white/[0.1] text-white' : 'text-white/40 hover:text-white/70'}`}>
                      {r}
                    </button>
                  ))}
                </div>
              </div>
              {busy ? <ChartSkeleton />
                : traffic.length >= 2 ? <TrafficChart data={traffic.slice(-RANGE_MONTHS[range])} />
                : <p className="text-white/35 text-sm">{na('traffic') ? t('seoTools.seDataNa') : t('seoTools.seNotEnoughHistory')}</p>}
            </div>
            <div className={card}>
              <h3 className="text-sm font-semibold text-white/80 mb-3">{t('seoTools.seKwByIntent')}</h3>
              {intents.length === 0 ? <p className="text-white/35 text-sm">{na('keywords') ? t('seoTools.seNaNow') : t('seoTools.seNoKwYet')}</p> : (
                <div className="space-y-3">
                  {intents.map((it) => (
                    <div key={it.intent}>
                      <div className="flex items-center justify-between text-xs mb-1">
                        <button
                          type="button"
                          className="text-left hover:underline"
                          style={{ color: INTENT_COLORS[it.intent] ?? '#9a9ab0' }}
                          onClick={() => { setKwIntent(it.intent); setTab('keywords'); }}
                        >{intentLabelSE(t, it.intent)}</button>
                        <span className="text-white/45">{it.count} · {it.share}%</span>
                      </div>
                      <div className="h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
                        <div className="h-full rounded-full" style={{ width: `${it.share}%`, background: INTENT_COLORS[it.intent] ?? '#9a9ab0' }} />
                      </div>
                    </div>
                  ))}
                  <p className="text-white/25 text-[11px] pt-1">{t('seoTools.seBasedOnTop', { count: keywords.length })}</p>
                </div>
              )}
            </div>
          </div>

          <div className="flex flex-wrap gap-2 mb-3">
            <button className={pill(tab === 'keywords')} onClick={() => setTab('keywords')}>{t('seoTools.seTabKeywords')}{keywords.length ? ` (${keywords.length})` : ''}</button>
            <button className={pill(tab === 'pages')} onClick={openPages}>{t('seoTools.seTabPages')}{pages?.length ? ` (${pages.length})` : ''}</button>
            <button className={pill(tab === 'competitors')} onClick={openCompetitors}>{t('seoTools.seTabCompetitors')}{competitors?.length ? ` (${competitors.length})` : ''}</button>
            <button className={pill(tab === 'countries')} onClick={openCountries}>{t('seoTools.seTabCountries')}</button>
            <button className={pill(tab === 'refdomains')} onClick={openRefdomains}>{t('seoTools.seTabRefdomains')}{refDomains?.length ? ` (${refDomains.length})` : ''}</button>
            <button className={pill(tab === 'links')} onClick={openLinks}>{t('seoTools.seTabBacklinks')}{links?.length ? ` (${links.length})` : ''}</button>
            <button className={pill(tab === 'anchors')} onClick={openAnchors}>{t('seoTools.seTabAnchors')}{anchors?.length ? ` (${anchors.length})` : ''}</button>
            <button className={pill(tab === 'blhistory')} onClick={openBlHistory}>{t('seoTools.seTabNewlost')}</button>
            <button className={pill(tab === 'linkgap')} onClick={() => setTab('linkgap')}>{t('seoTools.seTabLinkgap')}</button>
            <button className={pill(tab === 'gap')} onClick={() => setTab('gap')}>{t('seoTools.seTabContentgap')}</button>
          </div>

          <div className={`${card} overflow-x-auto`}>
            {tab === 'keywords' && (
              <>
              {!!keywords.length && (
                <div className="flex flex-wrap items-center gap-2 mb-3 text-xs">
                  {overview?.positions ? (
                    <>
                      <span className="text-white/45">{t('seoTools.sePosTop3')} {fmt(overview.positions.pos1 + overview.positions.pos2_3)}</span>
                      <span className="text-white/25">·</span>
                      <span className="text-white/45">{t('seoTools.sePos4to10')} {fmt(overview.positions.pos4_10)}</span>
                      <span className="text-white/25">·</span>
                      <span className="text-white/45">{t('seoTools.sePos11to20')} {fmt(overview.positions.pos11_20)}</span>
                      <span className="text-white/25">·</span>
                      <span className="text-white/45">{t('seoTools.sePos21plus')} {fmt(overview.positions.pos21plus)}</span>
                    </>
                  ) : (
                    <>
                      <span className="text-white/45">{t('seoTools.sePosTop3')} {posBuckets.top3}</span>
                      <span className="text-white/25">·</span>
                      <span className="text-white/45">{t('seoTools.sePos4to10')} {posBuckets.p4to10}</span>
                      <span className="text-white/25">·</span>
                      <span className="text-white/45">{t('seoTools.sePos11to20')} {posBuckets.p11to20}</span>
                      <span className="text-white/25">·</span>
                      <span className="text-white/45">{t('seoTools.sePos21plus')} {posBuckets.p21}</span>
                    </>
                  )}
                  <div className="flex-1" />
                  {(['traffic', 'position', 'volume'] as const).map((k) => (
                    <button key={k} type="button" onClick={() => setKwSort(k)} className={`px-2 py-1 rounded-md ${kwSort === k ? 'bg-white/10 text-white' : 'text-white/40 hover:text-white/70'}`}>
                      {k === 'traffic' ? t('seoTools.seColTraffic') : k === 'position' ? t('seoTools.seColPos') : t('seoTools.volume')}
                    </button>
                  ))}
                  <select value={kwIntent} onChange={(e) => setKwIntent(e.target.value)} className="bg-white/[0.04] border border-white/[0.1] rounded-md px-2 py-1.5 text-white/80 outline-none">
                    <option value="all" className="bg-[#0b0b0f]">{t('seoTools.kwrAllIntents')}</option>
                    {intents.map((it) => <option key={it.intent} value={it.intent} className="bg-[#0b0b0f]">{intentLabelSE(t, it.intent)}</option>)}
                  </select>
                  <input value={kwQuery} onChange={(e) => setKwQuery(e.target.value)} placeholder={t('seoTools.kwrInclude')} className="w-36 bg-white/[0.04] border border-white/[0.1] rounded-md px-2 py-1.5 text-white/80 outline-none placeholder:text-white/25" />
                  <button
                    onClick={() => downloadText(`keywords-${hostOf(active)}.csv`, toCsv(shownKeywords, [
                      { header: 'Keyword', value: (k) => k.keyword },
                      { header: 'Position', value: (k) => k.position ?? '' },
                      { header: 'Volume', value: (k) => k.volume ?? '' },
                      { header: 'Difficulty', value: (k) => k.difficulty ?? '' },
                      { header: 'CPC', value: (k) => k.cpc ?? '' },
                      { header: 'Traffic', value: (k) => k.traffic ?? '' },
                      { header: 'Change', value: (k) => k.change?.delta ?? '' },
                      { header: 'Intent', value: (k) => k.intent ?? '' },
                      { header: 'URL', value: (k) => k.url ?? '' },
                      { header: 'SERP features', value: (k) => (k.features ?? []).join(' ') },
                    ]))}
                    className="text-xs text-white/50 hover:text-white border border-white/[0.12] rounded-full px-3 py-1.5"
                  >{t('seoTools.exportCsv')}</button>
                </div>
              )}
              <table className="w-full border-collapse">
                <thead><tr>
                  <th className={th}>{t('seoTools.seColKeyword')}</th>
                  <th className={th}>{t('seoTools.seColPos')}</th>
                  <th className={th}>{t('seoTools.volume')}</th>
                  <th className={th}>KD</th>
                  <th className={th}>{t('seoTools.seColTraffic')}</th>
                  <th className={th}>CPC</th>
                  <th className={th}>{t('seoTools.intent')}</th>
                  <th className={th}>{t('seoTools.seColUrl')}</th>
                </tr></thead>
                <tbody>
                  {shownKeywords.slice(0, shown.kw).map((k, i) => (
                    <tr key={i} onClick={() => openKeyword(k)} className="cursor-pointer hover:bg-white/[0.03]">
                      <td className={td}>
                        <div className="text-violet-300">{k.keyword}</div>
                        <div className="flex flex-wrap items-center gap-2 mt-0.5">
                          <KeywordActions
                            keyword={k.keyword}
                            lang={activeLoc.languageCode}
                            gl={marketGl(selectedMarket)}
                            researchLabel={t('seoTools.seResearchThis')}
                            googleLabel={t('seoTools.seOpenGoogle')}
                          />
                          <CopyKw text={k.keyword} />
                          <SerpFeaturePills features={k.features} />
                        </div>
                      </td>
                      <td className={`${td} whitespace-nowrap`}>
                        {k.position ?? '—'}
                        <PosDelta change={k.change} />
                      </td>
                      <td className={td}>
                        <div>{fmt(k.volume)}</div>
                        <VolumeSparkline values={k.trend} />
                      </td>
                      <td className={td}>{k.difficulty == null ? '—' : <span className="font-semibold" style={{ color: kdColor(k.difficulty) }}>{k.difficulty}</span>}</td>
                      <td className={td}>{fmt(k.traffic)}</td>
                      <td className={td}>{k.cpc == null ? '—' : `$${k.cpc.toFixed(2)}`}</td>
                      <td className={td}>{k.intent ? <span className="text-xs" style={{ color: INTENT_COLORS[k.intent] ?? '#9a9ab0' }}>{intentLabelSE(t, k.intent)}</span> : '—'}</td>
                      <td className={`${td} max-w-xs`}><PageLink href={k.url} muted /></td>
                    </tr>
                  ))}
                  {!busy && !keywords.length && <tr><td className={td} colSpan={8}>{na('keywords') ? t('seoTools.seDataNa') : t('seoTools.seNoneFor', { domain: active })}</td></tr>}
                  {!busy && !!keywords.length && !shownKeywords.length && <tr><td className={td} colSpan={8}>{t('seoTools.kwrNoMatch')}</td></tr>}
                </tbody>
              </table>
              <ShowMore shown={shown.kw} total={shownKeywords.length} label={t('seoTools.seShowMore')} onMore={() => setShown((s) => ({ ...s, kw: s.kw + TABLE_PAGE }))} />
              </>
            )}

            {tab === 'pages' && (
              pagesBusy ? <TableSkeleton cols={5} /> : (
                <>
                {!!pages?.length && (
                  <div className="flex justify-end mb-2">
                    <button
                        onClick={() => downloadText(`pages-${hostOf(active)}.csv`, toCsv(pages, [
                        { header: 'Page', value: (p) => p.url },
                        { header: 'Keywords', value: (p) => p.keywords ?? '' },
                        { header: 'Traffic', value: (p) => p.traffic ?? '' },
                        { header: 'Traffic value', value: (p) => p.trafficValue ?? '' },
                        { header: 'Top keyword', value: (p) => topKeywordByPage.get(`${urlHost(p.url)}${pathOf(p.url)}`.toLowerCase())?.keyword ?? '' },
                      ]))}
                      className="text-xs text-white/50 hover:text-white border border-white/[0.12] rounded-full px-3 py-1.5"
                    >{t('seoTools.exportCsv')}</button>
                  </div>
                )}
                <table className="w-full border-collapse">
                  <thead><tr>
                    <th className={th}>{t('seoTools.seColPage')}</th>
                    <th className={th}>{t('seoTools.bulkKeywords')}</th>
                    <th className={th}>{t('seoTools.seEstTraffic')}</th>
                    <th className={th}>{t('seoTools.seTrafficValue')}</th>
                    <th className={th}>{t('seoTools.seColTopKw')}</th>
                  </tr></thead>
                  <tbody>
                    {(pages ?? []).slice(0, shown.pages).map((p, i) => {
                      const top = topKeywordByPage.get(`${urlHost(p.url)}${pathOf(p.url)}`.toLowerCase());
                      return (
                      <tr key={i}>
                        <td className={`${td} max-w-0`}>
                          <PageLink href={p.url} />
                        </td>
                        <td className={td}>{fmt(p.keywords)}</td>
                        <td className={td}>{fmt(p.traffic)}</td>
                        <td className={td}>{usd(p.trafficValue)}</td>
                        <td className={`${td} max-w-[14rem]`}>
                          {top ? (
                            <button type="button" className="text-violet-300 hover:underline text-left truncate block w-full" onClick={() => openKeyword(top)}>
                              {top.keyword}
                            </button>
                          ) : <span className="text-white/25">—</span>}
                        </td>
                      </tr>
                      );
                    })}
                    {pages && !pages.length && <tr><td className={td} colSpan={5}>{na('pages') ? t('seoTools.seDataNa') : t('seoTools.seNoneFor', { domain: active })}</td></tr>}
                  </tbody>
                </table>
                <ShowMore shown={shown.pages} total={(pages ?? []).length} label={t('seoTools.seShowMore')} onMore={() => setShown((s) => ({ ...s, pages: s.pages + TABLE_PAGE }))} />
                </>
              )
            )}

            {tab === 'countries' && (
              countriesBusy ? <TableSkeleton cols={4} /> :
              countryTraffic === null ? (
                <div className="text-center py-6">
                  <p className="text-white/55 text-sm mb-1">{t('seoTools.seCountriesEstimate', { domain: active })}</p>
                  <p className="text-white/35 text-xs mb-4">{t('seoTools.seCountriesMarkets')}</p>
                  <button onClick={runCountries} className="rounded-full px-5 py-2.5 bg-white text-black font-semibold hover:bg-white/90">{t('seoTools.seCountriesRun')}</button>
                  <p className="text-white/30 text-xs mt-3">{t('seoTools.seCountriesCost', { count: TRAFFIC_BY_COUNTRY_CALLS })}</p>
                </div>
              ) : (
                <div className="space-y-2">
                  <p className="text-white/40 text-xs mb-3">{t('seoTools.seCountriesDesc')}</p>
                  {countryTraffic.map((c, i) => {
                    const max = countryTraffic?.[0]?.traffic ?? 1;
                    const pct = max ? Math.max(3, Math.round(((c.traffic ?? 0) / max) * 100)) : 0;
                    return (
                      <div key={i} className="flex items-center gap-3">
                        <span className="w-36 text-sm text-white/70 truncate">{c.country}</span>
                        <div className="flex-1 h-2.5 bg-white/[0.06] rounded-full overflow-hidden">
                          <div className="h-full bg-gradient-to-r from-violet-500 to-emerald-400 rounded-full" style={{ width: `${pct}%` }} />
                        </div>
                        <span className="w-16 text-right text-sm tabular-nums text-white/80">{fmt(c.traffic)}</span>
                      </div>
                    );
                  })}
                  {countryTraffic && !countryTraffic.length && <p className="text-white/35 text-sm">{na('countries') ? t('seoTools.seNaNow') : t('seoTools.seNoneFor', { domain: active })}</p>}
                </div>
              )
            )}

            {tab === 'competitors' && (
              competitorsBusy ? <TableSkeleton cols={4} /> : (
                <>
                <table className="w-full border-collapse">
                  <thead><tr><th className={th}>{t('seoTools.seColCompetitor')}</th><th className={th}>{t('seoTools.seColCommonKw')}</th><th className={th}>{t('seoTools.seColTheirKw')}</th><th className={th}>{t('seoTools.seEstTraffic')}</th><th className={th}>{t('seoTools.seColAvgPos')}</th></tr></thead>
                  <tbody>
                    {(competitors ?? []).slice(0, shown.comps).map((c, i) => (
                      <tr key={i} className="cursor-pointer hover:bg-white/[0.03]" onClick={() => explore(c.domain)}>
                        <td className={td}>
                          <div className="flex items-center gap-2 min-w-0">
                            <ExtLink href={c.domain} className="text-violet-300 hover:underline truncate">{c.domain}</ExtLink>
                            <button type="button" className="text-[11px] text-white/40 hover:text-white shrink-0" onClick={(e) => { e.stopPropagation(); explore(c.domain); }}>{t('seoTools.seExplore')}</button>
                          </div>
                        </td>
                        <td className={td}>{fmt(c.commonKeywords)}</td>
                        <td className={td}>{fmt(c.theirKeywords)}</td>
                        <td className={td}>{fmt(c.theirTraffic)}</td>
                        <td className={td}>{c.avgPosition == null ? '—' : c.avgPosition.toFixed(1)}</td>
                      </tr>
                    ))}
                    {competitors && !competitors.length && <tr><td className={td} colSpan={5}>{na('competitors') ? t('seoTools.seDataNa') : t('seoTools.seNoneFor', { domain: active })}</td></tr>}
                  </tbody>
                </table>
                <ShowMore shown={shown.comps} total={(competitors ?? []).length} label={t('seoTools.seShowMore')} onMore={() => setShown((s) => ({ ...s, comps: s.comps + TABLE_PAGE }))} />
                </>
              )
            )}

            {tab === 'refdomains' && (
              refdomainsBusy ? <TableSkeleton cols={4} /> : (
                <>
                <table className="w-full border-collapse">
                  <thead><tr>
                    <th className={th}>{t('seoTools.seColRefDomain')}</th>
                    <th className={th}>{t('seoTools.seColRank')}</th>
                    <th className={th}>{t('seoTools.seBacklinks')}</th>
                    <th className={th}>{t('seoTools.seColDofollow')}</th>
                    <th className={th}>{t('seoTools.seColCountry')}</th>
                    <th className={th}>{t('seoTools.seColLastSeen')}</th>
                    <th className={th}>{t('seoTools.seColFirstSeen')}</th>
                  </tr></thead>
                  <tbody>
                    {(refDomains ?? []).slice(0, shown.refs).map((d, i) => (
                      <tr key={i}>
                        <td className={td}>
                          <div className="flex items-center gap-2 min-w-0">
                            <ExtLink href={d.domain} className="text-violet-300 hover:underline truncate">{d.domain}</ExtLink>
                            <button type="button" className="text-[11px] text-white/40 hover:text-white shrink-0" onClick={() => explore(d.domain)}>{t('seoTools.seExplore')}</button>
                          </div>
                        </td>
                        <td className={td}>{d.rank ?? '—'}</td>
                        <td className={td}>{fmt(d.backlinks)}</td>
                        <td className={td}>{fmt(d.dofollow)}</td>
                        <td className={`${td} uppercase text-white/50`}>{d.country || '—'}</td>
                        <td className={`${td} text-white/40`}>{d.lastSeen ? d.lastSeen.slice(0, 10) : '—'}</td>
                        <td className={`${td} text-white/40`}>{d.firstSeen ? d.firstSeen.slice(0, 10) : '—'}</td>
                      </tr>
                    ))}
                    {refDomains && !refDomains.length && <tr><td className={td} colSpan={7}>{na('refdomains') ? t('seoTools.seDataNa') : t('seoTools.seNoneFor', { domain: active })}</td></tr>}
                  </tbody>
                </table>
                <ShowMore shown={shown.refs} total={(refDomains ?? []).length} label={t('seoTools.seShowMore')} onMore={() => setShown((s) => ({ ...s, refs: s.refs + TABLE_PAGE }))} />
                </>
              )
            )}

            {tab === 'links' && (
              linksBusy ? <TableSkeleton cols={6} /> : (
                <>
                  {!!links?.length && (
                    <div className="flex flex-wrap items-center gap-2 mb-2">
                      <select value={linkFollow} onChange={(e) => setLinkFollow(e.target.value as 'all' | 'dofollow' | 'nofollow')} className="bg-white/[0.04] border border-white/[0.1] rounded-md px-2 py-1.5 text-xs text-white/80 outline-none">
                        <option value="all" className="bg-[#0b0b0f]">{t('seoTools.seFilterFollow')}</option>
                        <option value="dofollow" className="bg-[#0b0b0f]">dofollow</option>
                        <option value="nofollow" className="bg-[#0b0b0f]">nofollow</option>
                      </select>
                      <input value={linkQuery} onChange={(e) => setLinkQuery(e.target.value)} placeholder={t('seoTools.kwrInclude')} className="w-40 bg-white/[0.04] border border-white/[0.1] rounded-md px-2 py-1.5 text-xs text-white/80 outline-none placeholder:text-white/25" />
                      <div className="flex-1" />
                      <button
                        onClick={() => downloadText(`backlinks-${hostOf(active)}.csv`, toCsv(shownLinks, [
                          { header: 'From', value: (b) => b.from ?? '' },
                          { header: 'To', value: (b) => b.to ?? '' },
                          { header: 'Title', value: (b) => b.fromTitle ?? '' },
                          { header: 'Anchor', value: (b) => b.anchor ?? '' },
                          { header: 'Type', value: (b) => b.dofollow == null ? '' : b.dofollow ? 'dofollow' : 'nofollow' },
                          { header: 'Item type', value: (b) => b.itemType ?? '' },
                          { header: 'Rank', value: (b) => b.rank ?? '' },
                          { header: 'Ref. rank', value: (b) => b.domainFromRank ?? '' },
                          { header: 'First seen', value: (b) => b.firstSeen ?? '' },
                          { header: 'Last seen', value: (b) => b.lastSeen ?? '' },
                        ]))}
                        className="text-xs text-white/50 hover:text-white border border-white/[0.12] rounded-full px-3 py-1.5"
                      >{t('seoTools.exportCsv')}</button>
                    </div>
                  )}
                <table className="w-full border-collapse">
                  <thead><tr>
                    <th className={th}>{t('seoTools.seColFrom')}</th>
                    <th className={th}>{t('seoTools.seColTo')}</th>
                    <th className={th}>{t('seoTools.seColAnchor')}</th>
                    <th className={th}>{t('seoTools.seColType')}</th>
                    <th className={th}>{t('seoTools.seColRank')}</th>
                    <th className={th}>{t('seoTools.seColFirstSeen')}</th>
                    <th className={th}>{t('seoTools.seColLastSeen')}</th>
                  </tr></thead>
                  <tbody>
                    {shownLinks.slice(0, shown.links).map((b, i) => (
                      <tr key={i}>
                        <td className={`${td} max-w-[16rem]`}>
                          <PageLink href={b.from} />
                          {b.fromTitle ? <div className="text-[11px] text-white/40 truncate mt-0.5">{b.fromTitle}</div> : null}
                        </td>
                        <td className={`${td} max-w-[16rem]`}><PageLink href={b.to} muted /></td>
                        <td className={`${td} max-w-[12rem] truncate`}>{b.anchor || <span className="text-white/25">—</span>}</td>
                        <td className={td}>
                          {b.dofollow == null ? '—' : b.dofollow ? <span className="text-emerald-300">dofollow</span> : <span className="text-white/40">nofollow</span>}
                          {b.itemType && b.itemType !== 'anchor' ? <span className="block text-[11px] text-white/35">{b.itemType}</span> : null}
                          {b.broken ? <span className="block text-[11px] text-rose-300">{t('seoTools.seBroken')}</span> : null}
                          {b.attributes?.filter((a) => a !== 'nofollow').map((a) => (
                            <span key={a} className="block text-[11px] uppercase text-white/35">{a}</span>
                          ))}
                        </td>
                        <td className={td}>
                          {b.rank ?? '—'}
                          {b.domainFromRank != null ? (
                            <div className="text-[11px] text-white/35">{t('seoTools.seColRefRank')} {b.domainFromRank}</div>
                          ) : null}
                        </td>
                        <td className={`${td} text-white/40`}>{b.firstSeen ? b.firstSeen.slice(0, 10) : '—'}</td>
                        <td className={`${td} text-white/40`}>{b.lastSeen ? b.lastSeen.slice(0, 10) : '—'}</td>
                      </tr>
                    ))}
                    {links && !links.length && <tr><td className={td} colSpan={7}>{na('links') ? t('seoTools.seDataNa') : t('seoTools.seNoneFor', { domain: active })}</td></tr>}
                    {!!links?.length && !shownLinks.length && <tr><td className={td} colSpan={7}>{t('seoTools.kwrNoMatch')}</td></tr>}
                  </tbody>
                </table>
                <ShowMore shown={shown.links} total={shownLinks.length} label={t('seoTools.seShowMore')} onMore={() => setShown((s) => ({ ...s, links: s.links + TABLE_PAGE }))} />
                </>
              )
            )}

            {tab === 'anchors' && (
              anchorsBusy ? <TableSkeleton cols={4} /> : (
                <>
                <table className="w-full border-collapse">
                  <thead><tr><th className={th}>{t('seoTools.seColAnchorText')}</th><th className={th}>{t('seoTools.seBacklinks')}</th><th className={th}>{t('seoTools.bulkRefDomains')}</th><th className={th}>{t('seoTools.seColNofollowRds')}</th></tr></thead>
                  <tbody>
                    {(anchors ?? []).slice(0, shown.anchors).map((a, i) => (
                      <tr key={i}>
                        <td className={`${td} max-w-0`}>
                          <span className="block truncate">{a.anchor}</span>
                          {a.anchor && a.anchor !== '(empty)' ? (
                            <ExtLink
                              href={googleSearchHref(a.anchor, activeLoc.languageCode, marketGl(selectedMarket))}
                              className="text-[11px] text-emerald-300/80 hover:underline"
                            >{t('seoTools.seOpenGoogle')}</ExtLink>
                          ) : null}
                        </td>
                        <td className={td}>{fmt(a.backlinks)}</td><td className={td}>{fmt(a.referringDomains)}</td>
                        <td className={`${td} text-white/50`}>{a.refDomainsNofollow == null ? '—' : fmt(a.refDomainsNofollow)}</td>
                      </tr>
                    ))}
                    {anchors && !anchors.length && <tr><td className={td} colSpan={4}>{na('anchors') ? t('seoTools.seDataNa') : t('seoTools.seNoneFor', { domain: active })}</td></tr>}
                  </tbody>
                </table>
                <ShowMore shown={shown.anchors} total={(anchors ?? []).length} label={t('seoTools.seShowMore')} onMore={() => setShown((s) => ({ ...s, anchors: s.anchors + TABLE_PAGE }))} />
                </>
              )
            )}

            {tab === 'blhistory' && (
              blHistoryBusy ? <TableSkeleton cols={4} /> : (
                <>
                  <p className="text-white/40 text-xs mb-3">{t('seoTools.seBlHistoryDesc')}</p>
                  {blHistory && blHistory.length >= 2 ? <NewLostChart data={blHistory} /> : null}
                  <table className="w-full border-collapse">
                    <thead><tr><th className={th}>{t('seoTools.seColMonth')}</th><th className={th}>{t('seoTools.seColNewRd')}</th><th className={th}>{t('seoTools.seColLostRd')}</th><th className={th}>{t('seoTools.seColNewBl')}</th><th className={th}>{t('seoTools.seColLostBl')}</th></tr></thead>
                    <tbody>
                      {(blHistory ?? []).map((p, i) => (
                        <tr key={i}><td className={`${td} text-white/60`}>{p.date}</td>
                          <td className={`${td} text-emerald-300`}>{p.newRefDomains == null ? '—' : `+${fmt(p.newRefDomains)}`}</td>
                          <td className={`${td} text-rose-300`}>{p.lostRefDomains == null ? '—' : `-${fmt(p.lostRefDomains)}`}</td>
                          <td className={`${td} text-emerald-300`}>{p.newBacklinks == null ? '—' : `+${fmt(p.newBacklinks)}`}</td>
                          <td className={`${td} text-rose-300`}>{p.lostBacklinks == null ? '—' : `-${fmt(p.lostBacklinks)}`}</td></tr>
                      ))}
                      {blHistory && !blHistory.length && <tr><td className={td} colSpan={5}>{na('blhistory') ? t('seoTools.seDataNa') : t('seoTools.seNoneFor', { domain: active })}</td></tr>}
                    </tbody>
                  </table>
                </>
              )
            )}

            {tab === 'linkgap' && (
              <>
                <p className="text-white/50 text-sm mb-3">{t('seoTools.seLinkGapDesc', { domain: active })}</p>
                <div className="flex flex-col sm:flex-row gap-2.5 mb-4 max-w-xl">
                  <input className={inputCls} placeholder={t('seoTools.seYourDomain')} value={linkYou} onChange={(e) => setLinkYou(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && runLinkGap()} />
                  <button className="rounded-full px-5 py-2.5 bg-white text-black font-semibold hover:bg-white/90 disabled:opacity-60 whitespace-nowrap" onClick={runLinkGap} disabled={linkGapBusy || !linkYou.trim()}>{linkGapBusy ? t('seoTools.seFinding') : t('seoTools.seFindLinks')}</button>
                </div>
                {linkGap && (
                  <>
                  <table className="w-full border-collapse">
                    <thead><tr><th className={th}>{t('seoTools.seColRefDomain')}</th><th className={th}>{t('seoTools.seColRank')}</th><th className={th}>{t('seoTools.seBacklinks')}</th><th className={th}>{t('seoTools.seColFirstSeen')}</th></tr></thead>
                    <tbody>
                      {linkGap.slice(0, shown.linkgap).map((r, i) => (
                        <tr key={i}>
                          <td className={td}>
                            <div className="flex items-center gap-2 min-w-0">
                              <ExtLink href={r.domain} className="text-violet-300 hover:underline truncate">{r.domain}</ExtLink>
                              <button type="button" className="text-[11px] text-white/40 hover:text-white shrink-0" onClick={() => explore(r.domain)}>{t('seoTools.seExplore')}</button>
                            </div>
                          </td>
                          <td className={td}>{r.rank ?? '—'}</td><td className={td}>{fmt(r.backlinks)}</td>
                          <td className={`${td} text-white/40`}>{r.firstSeen ? r.firstSeen.slice(0, 10) : '—'}</td></tr>
                      ))}
                      {!linkGapBusy && !linkGap.length && <tr><td className={td} colSpan={4}>{na('linkgap') ? t('seoTools.seNaNow') : t('seoTools.seNoneFor', { domain: active })}</td></tr>}
                    </tbody>
                  </table>
                  <ShowMore shown={shown.linkgap} total={linkGap.length} label={t('seoTools.seShowMore')} onMore={() => setShown((s) => ({ ...s, linkgap: s.linkgap + TABLE_PAGE }))} />
                  </>
                )}
              </>
            )}

            {tab === 'gap' && (
              <>
                <p className="text-white/50 text-sm mb-3">{t('seoTools.seContentGapDesc', { domain: active })}</p>
                <div className="flex flex-col sm:flex-row gap-2.5 mb-4 max-w-xl">
                  <input className={inputCls} placeholder={t('seoTools.seYourDomain')} value={yourSite} onChange={(e) => setYourSite(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && runGap()} />
                  <button className="rounded-full px-5 py-2.5 bg-white text-black font-semibold hover:bg-white/90 disabled:opacity-60 whitespace-nowrap" onClick={runGap} disabled={gapBusy || !yourSite.trim()}>{gapBusy ? t('seoTools.seComparing') : t('seoTools.seCompare')}</button>
                </div>
                {comparedYou && (
                  <>
                  <table className="w-full border-collapse">
                    <thead><tr><th className={th}>{t('seoTools.seColKeyword')}</th><th className={th}>{t('seoTools.volume')}</th><th className={th}>{t('seoTools.seColTheirPos')}</th><th className={th}>{t('seoTools.seColYourPos')}</th></tr></thead>
                    <tbody>
                      {gap.slice(0, shown.gap).map((g, i) => (
                        <tr key={i} className="cursor-pointer hover:bg-white/[0.03]" onClick={() => openKeyword({ keyword: g.keyword, position: g.theirPos, volume: g.volume, url: null, intent: null, difficulty: null, cpc: null, traffic: null })}>
                          <td className={td}>
                            <div className="text-violet-300">{g.keyword}</div>
                            <KeywordActions
                              keyword={g.keyword}
                              lang={activeLoc.languageCode}
                              gl={marketGl(selectedMarket)}
                              researchLabel={t('seoTools.seResearchThis')}
                              googleLabel={t('seoTools.seOpenGoogle')}
                            />
                          </td>
                          <td className={td}>{fmt(g.volume)}</td>
                          <td className={`${td} text-emerald-300`}>{g.theirPos ?? '—'}</td>
                          <td className={`${td} ${g.yourPos == null ? 'text-rose-300' : 'text-white/50'}`}>{g.yourPos == null ? t('seoTools.seNotRanking') : g.yourPos}</td>
                        </tr>
                      ))}
                      {!gapBusy && !gap.length && <tr><td className={td} colSpan={4}>{t('seoTools.seNoneFor', { domain: active })}</td></tr>}
                    </tbody>
                  </table>
                  <ShowMore shown={shown.gap} total={gap.length} label={t('seoTools.seShowMore')} onMore={() => setShown((s) => ({ ...s, gap: s.gap + TABLE_PAGE }))} />
                  </>
                )}
              </>
            )}
          </div>
        </>
      )}

      {!active && !busy && (
        <EmptyState
          icon="🔭"
          title={t('seoTools.seEmptyLead')}
          description={t('seoTools.seEmptyHint', { tab: t('seoTools.seTabContentgap') })}
        />
      )}

      {selectedKw && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setSelectedKw(null)}>
          <div className="w-full max-w-2xl max-h-[85vh] overflow-y-auto rounded-2xl border border-white/[0.1] bg-[#0b0b0f] p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-4 mb-4">
              <div className="min-w-0">
                <h3 className="text-lg font-bold">{selectedKw.keyword}</h3>
                <div className="flex flex-wrap items-center gap-3 mt-1">
                  <ExtLink
                    href={googleSearchHref(selectedKw.keyword, serpLoc.languageCode, marketGl(selectedMarket))}
                    className="text-xs text-emerald-300/80 hover:underline"
                  >{t('seoTools.seOpenGoogle')}</ExtLink>
                  <a
                    href={`/keyword-research?q=${encodeURIComponent(selectedKw.keyword)}`}
                    className="text-xs text-violet-300 hover:underline"
                  >{t('seoTools.seResearchThis')}</a>
                  <TrackKeywordCta projectId={activeProjectId ?? undefined} keyword={selectedKw.keyword} compact />
                </div>
              </div>
              <button onClick={() => setSelectedKw(null)} className="text-white/40 hover:text-white text-xl leading-none">×</button>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
              <Metric label={t('seoTools.volume')} value={fmt(selectedKw.volume)} />
              <Metric label={t('seoTools.difficulty')} value={selectedKw.difficulty == null ? '—' : String(selectedKw.difficulty)} />
              <Metric label={t('seoTools.cpc')} value={selectedKw.cpc == null ? '—' : `$${selectedKw.cpc.toFixed(2)}`} />
              <Metric label={t('seoTools.seColTraffic')} value={fmt(selectedKw.traffic)} />
            </div>
            <h4 className="text-sm font-semibold text-white/70 mb-2">{t('seoTools.serpTitle')}</h4>
            {serpBusy ? <p className="text-violet-300 text-sm">{t('seoTools.serpLoading')}</p> : (
              <>
                {serp && serp.organic.length ? <SerpRows rows={serp.organic} ownHost={active} /> : null}
                {serp && !serp.organic.length && <p className="text-white/35 text-sm">{t('seoTools.seNaNow')}</p>}
                {serp ? <SerpExtras snap={serp} /> : null}
              </>
            )}
          </div>
        </div>
      )}
    </AppShell>
  );
}

function ShowMore({ shown, total, label, onMore }: { shown: number; total: number; label: string; onMore: () => void }) {
  if (total <= shown) return null;
  return (
    <button type="button" onClick={onMore} className="mt-3 text-xs text-violet-300 hover:underline">
      {label} ({shown}/{total})
    </button>
  );
}

function KeywordActions({
  keyword, lang, gl, researchLabel, googleLabel,
}: {
  keyword: string; lang: string; gl: string; researchLabel: string; googleLabel: string;
}) {
  return (
    <div className="flex flex-wrap gap-2 mt-0.5" onClick={(e) => e.stopPropagation()}>
      <ExtLink href={googleSearchHref(keyword, lang, gl)} className="text-[11px] text-emerald-300/80 hover:underline">
        {googleLabel}
      </ExtLink>
      <a href={`/keyword-research?q=${encodeURIComponent(keyword)}`} className="text-[11px] text-white/40 hover:text-white">
        {researchLabel}
      </a>
    </div>
  );
}

function Metric({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className={card}>
      <div className="text-2xl font-extrabold tabular-nums truncate" style={color ? { color } : undefined}>{value}</div>
      <div className="text-white/40 text-xs mt-1">{label}</div>
      {sub && <div className="text-white/30 text-[11px] mt-0.5 truncate">{sub}</div>}
    </div>
  );
}

// Inline SVG area chart of estimated organic traffic over time. No chart library.
function TrafficChart({ data }: { data: TrafficPoint[] }) {
  const { t } = useTranslation();
  const [hover, setHover] = useState<number | null>(null);
  const W = 900, H = 220, padL = 46, padR = 12, padT = 12, padB = 26;
  const iw = W - padL - padR, ih = H - padT - padB;
  const vals = data.map((d) => d.traffic ?? 0);
  const max = Math.max(1, ...vals);
  const n = data.length;
  const x = (i: number) => padL + (n === 1 ? iw / 2 : (i / (n - 1)) * iw);
  const y = (v: number) => padT + ih - (v / max) * ih;
  const line = data.map((d, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(d.traffic ?? 0).toFixed(1)}`).join(' ');
  const area = `${line} L ${x(n - 1).toFixed(1)} ${(padT + ih).toFixed(1)} L ${x(0).toFixed(1)} ${(padT + ih).toFixed(1)} Z`;
  const first = data[0];
  const last = data[n - 1];
  if (!first || !last) return null;
  const gridVals = [0, 0.5, 1].map((f) => Math.round(max * f));
  const onMove = (e: MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    let best = 0, bestD = Infinity;
    for (let i = 0; i < n; i++) { const dd = Math.abs(x(i) - px); if (dd < bestD) { bestD = dd; best = i; } }
    setHover(best);
  };
  const point = hover != null ? data[hover] ?? last : last;
  return (
    <div>
      <div className="flex items-baseline gap-2 mb-2">
        <span className="text-2xl font-extrabold text-emerald-300 tabular-nums">{fmt(point.traffic)}</span>
        <span className="text-white/40 text-xs">{t('seoTools.seTrafficChartVisits')} · {point.date}{point.keywords != null ? ` · ${fmt(point.keywords)} ${t('seoTools.seKeywordsSuffix')}` : ''}</span>
      </div>
      <div className="overflow-x-auto">
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ minWidth: 480, display: 'block' }} onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
          {gridVals.map((g, i) => (
            <g key={i}>
              <line x1={padL} x2={W - padR} y1={y(g)} y2={y(g)} stroke="rgba(255,255,255,0.06)" strokeWidth={1} />
              <text x={padL - 8} y={y(g) + 3} textAnchor="end" fontSize={10} fill="rgba(255,255,255,0.3)">{fmt(g)}</text>
            </g>
          ))}
          <path d={area} fill="rgba(139,92,246,0.14)" />
          <path d={line} fill="none" stroke="#8b5cf6" strokeWidth={2} strokeLinejoin="round" />
          {hover != null && data[hover] && (
            <g>
              <line x1={x(hover)} x2={x(hover)} y1={padT} y2={padT + ih} stroke="rgba(255,255,255,0.25)" strokeWidth={1} strokeDasharray="3 3" />
              <circle cx={x(hover)} cy={y(data[hover]!.traffic ?? 0)} r={4} fill="#8b5cf6" stroke="#fff" strokeWidth={1.5} />
            </g>
          )}
          <text x={padL} y={H - 6} fontSize={10} fill="rgba(255,255,255,0.3)">{first.date}</text>
          <text x={W - padR} y={H - 6} textAnchor="end" fontSize={10} fill="rgba(255,255,255,0.3)">{last.date}</text>
        </svg>
      </div>
    </div>
  );
}

/** New vs lost referring domains from the already-fetched timeseries — no extra API call. */
function NewLostChart({ data }: { data: BacklinkTimepoint[] }) {
  const { t } = useTranslation();
  const W = 900, H = 160, padL = 36, padR = 12, padT = 10, padB = 22;
  const iw = W - padL - padR, ih = H - padT - padB;
  const n = data.length;
  const max = Math.max(1, ...data.flatMap((d) => [d.newRefDomains ?? 0, d.lostRefDomains ?? 0]));
  const slot = iw / n;
  return (
    <div className="mb-4">
      <div className="flex gap-3 text-[11px] text-white/40 mb-1">
        <span className="text-emerald-300">+ {t('seoTools.seColNewRd')}</span>
        <span className="text-rose-300">− {t('seoTools.seColLostRd')}</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ minWidth: 480, display: 'block' }}>
        {data.map((d, i) => {
          const cx = padL + i * slot + slot / 2;
          const up = ((d.newRefDomains ?? 0) / max) * (ih / 2);
          const down = ((d.lostRefDomains ?? 0) / max) * (ih / 2);
          const mid = padT + ih / 2;
          return (
            <g key={d.date}>
              <rect x={cx - 6} y={mid - up} width={5} height={Math.max(1, up)} fill="#34d399" rx={1} />
              <rect x={cx + 1} y={mid} width={5} height={Math.max(1, down)} fill="#fb7185" rx={1} />
            </g>
          );
        })}
        <line x1={padL} x2={W - padR} y1={padT + ih / 2} y2={padT + ih / 2} stroke="rgba(255,255,255,0.08)" />
        <text x={padL} y={H - 4} fontSize={10} fill="rgba(255,255,255,0.3)">{data[0]?.date}</text>
        <text x={W - padR} y={H - 4} textAnchor="end" fontSize={10} fill="rgba(255,255,255,0.3)">{data[n - 1]?.date}</text>
      </svg>
    </div>
  );
}
