/**
 * Hosted Rankdelta MCP — Streamable HTTP (stateless) for remote clients
 * (ChatGPT, Grok, Claude Connectors, Cursor).
 *
 * Auth: Authorization: Bearer sk_rankdelta_…  (Settings → API & MCP)
 * verify_jwt MUST stay false.
 *
 * Paid tools forward to seo-proxy / visibility-ops with the same Bearer key
 * (those functions accept personal API keys and enforce account budget).
 */

import {
  adminClient,
  assertPayingPlan,
  extractBearer,
  PLAN_REQUIRED_CODE,
  resolvePersonalApiKey,
  type Sb,
} from '../_shared/apiKeys.ts';
import { compactClientReport, summarizeClientReport } from '../_shared/reportAgentView.ts';
import { assertProjectQuota, ProjectLimitError } from '../_shared/projectQuota.ts';
import { mapLangToCode, mapMarketToLocation } from '../_shared/marketLocale.ts';
import { detectSiteLocale } from '../_shared/siteLocaleFetch.ts';
import {
  authorizationServerMetadata,
  authorizeHtml,
  exchangeToken,
  handleRegister,
  isRedirectAllowedForClient,
  mintAuthCode,
  protectedResourceMetadata,
  validateApiKeyForAuthorize,
  wwwAuthenticateHeader,
} from './oauth.ts';
import { publishableKey } from '../_shared/supabaseKeys.ts';
import { appOrigin } from '../_shared/appOrigin.ts';
import { pickCompetitorCandidates, type MentionRow } from './competitor_seed.ts';
import { classifyGscSyncFailure, markGscGrantRevoked, refreshAccess } from '../_shared/gscSync.ts';
import { readGoogleRefreshToken } from '../_shared/googleOAuthTokens.ts';
import {
  GSC_HISTORY_MONTHS,
  GSC_MAX_ROWS,
  SEARCH_DIMENSIONS,
  SEARCH_TYPES,
  buildSearchAnalyticsRequest,
  inspectUrl,
  listSitemaps,
  querySearchAnalytics,
  shapeInspection,
  shapeSearchAnalyticsRows,
  urlInProperty,
} from '../_shared/gscLive.ts';

const PROTOCOL_VERSION = '2024-11-05';
const SERVER_INFO = { name: 'rankdelta', version: '0.3.0' };
/** Supabase GET HTML is forced to text/plain + sandbox CSP — the web app serves the authorize UI. */
const AUTHORIZE_UI_URL = `${appOrigin()}/oauth/mcp-authorize`;

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, content-type, accept, mcp-session-id, mcp-protocol-version',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Expose-Headers':
    'mcp-session-id, mcp-protocol-version, www-authenticate',
};

const json = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      ...cors,
      'Content-Type': 'application/json',
      'MCP-Protocol-Version': PROTOCOL_VERSION,
      ...extra,
    },
  });

type JsonRpcId = string | number | null;
type ToolResult = { content: Array<{ type: 'text'; text: string }>; isError?: boolean; structuredContent?: unknown };

const textResult = (v: unknown, isError = false): ToolResult => ({
  content: [{ type: 'text', text: typeof v === 'string' ? v : JSON.stringify(v, null, 2) }],
  ...(isError ? { isError: true } : {}),
});

/**
 * OpenAI deep-research `search`/`fetch` compatibility shape: the same object must be returned
 * BOTH as `structuredContent` and as a JSON-encoded string in `content[0].text`.
 * See https://developers.openai.com/api/docs/mcp (Company knowledge compatibility).
 */
const structuredResult = (structured: unknown): ToolResult => ({
  structuredContent: structured,
  content: [{ type: 'text', text: JSON.stringify(structured) }],
});

const ENGINES = [
  { id: 'chatgpt', label: 'ChatGPT' },
  { id: 'perplexity', label: 'Perplexity' },
  { id: 'gemini', label: 'Gemini' },
  { id: 'google_aio', label: 'Google AI Overview' },
];

interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

const TOOLS: ToolDef[] = [
  // ── ChatGPT deep-research compatibility (search + fetch). Keep these FIRST so ChatGPT's
  //    connector, which looks for exactly these two read-only tools, finds them. ──
  {
    name: 'search',
    description:
      'Search your Rankdelta account for sites to research. Returns citable results ({id,title,url}); pass an id to fetch() for that site\'s AI Share of Voice and details. An empty query returns all your sites.',
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string', description: 'What to look for (a domain or brand); empty returns all your sites.' } },
      required: ['query'],
    },
  },
  {
    name: 'fetch',
    description:
      'Fetch the full research document for a search result id (e.g. "site:<uuid>"): AI Share of Voice per engine plus site details.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'An id returned by search (e.g. "site:<uuid>").' } },
      required: ['id'],
    },
  },
  {
    name: 'list_sites',
    description: 'List the sites tracked in your Rankdelta account (id, name, url).',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'get_ai_visibility',
    description:
      'AI Share of Voice for a site — your mentions vs competitors across ChatGPT, Perplexity, Gemini (last 30 days).',
    inputSchema: {
      type: 'object',
      properties: { site_id: { type: 'string', description: 'site id from list_sites' } },
      required: ['site_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'list_ai_recommendations',
    description: 'Competitors the AI engines recommend instead of you, ranked by mention count.',
    inputSchema: {
      type: 'object',
      properties: { site_id: { type: 'string' } },
      required: ['site_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'list_engines',
    description: 'List the AI engines this Rankdelta account can query.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'run_visibility_scan',
    description:
      'Run a capped AI-visibility scan for a site (default up to 6 active prompts × engines). Costs API credits against your account monthly cap.',
    inputSchema: {
      type: 'object',
      properties: {
        site_id: { type: 'string' },
        engines: {
          type: 'array',
          items: { type: 'string' },
          description: 'engine ids; default chatgpt, perplexity, gemini, google_aio',
        },
        max_queries: { type: 'number', description: '1–12; default 6' },
      },
      required: ['site_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'add_site',
    description:
      'Register a new site/project in the account so other tools can use it. Creates the project row only — no crawl, no scan, no credits spent. Pass the returned id to setup_ai_visibility (or run_visibility_scan / track_rank) as the next step.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Project / client name, e.g. "Acme Gym Italia"' },
        website_url: { type: 'string', description: 'Site URL, with or without scheme, e.g. "acmegym.it" or "https://www.acmegym.it"' },
        language: {
          type: 'string',
          enum: ['en', 'it', 'de', 'fr', 'es', 'pt'],
          description: "Content language of the site. Optional — detected from the site's <html lang>, then its domain; English when unknown.",
        },
        market: {
          type: 'string',
          enum: ['global', 'US', 'IT', 'DE', 'FR', 'ES', 'CH', 'PT'],
          description: 'SEO market for rankings and AI prompts. Optional — from the country domain, else the language; "global" when unknown.',
        },
      },
      required: ['name', 'website_url'],
      additionalProperties: false,
    },
  },
  {
    name: 'setup_ai_visibility',
    description:
      'One-shot AI-visibility activation for a new site: create tracked brand, seed competitors from prior AI answers (if any), generate visibility prompts, and run the first capped scan. Requires a paid plan; the scan spends API credits.',
    inputSchema: {
      type: 'object',
      properties: { site_id: { type: 'string', description: 'site id from list_sites' } },
      required: ['site_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'list_ranks',
    description: "List a site's tracked keywords with their latest Google position.",
    inputSchema: {
      type: 'object',
      properties: { site_id: { type: 'string' } },
      required: ['site_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'track_rank',
    description: "Add a keyword to a site's Rank Tracker (does not run a SERP check by itself).",
    inputSchema: {
      type: 'object',
      properties: { site_id: { type: 'string' }, keyword: { type: 'string' } },
      required: ['site_id', 'keyword'],
      additionalProperties: false,
    },
  },
  {
    name: 'check_ranks',
    description:
      'Run a fresh Google SERP check for tracked keywords on a site (costs DataForSEO credits, ~$0.015 per keyword). Checks the least-recently-checked keywords first, a few in parallel, and returns within about a minute: keywords it had no time for come back as deferred (not charged) — call again to continue. Read results with list_ranks.',
    inputSchema: {
      type: 'object',
      properties: {
        site_id: { type: 'string' },
        limit: { type: 'number', description: 'max keywords to check this call (default 12)' },
      },
      required: ['site_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'keyword_research',
    description:
      'Keyword discovery engine. mode=lookup (default): bulk volume + difficulty for a keyword list. mode=expand: related keyword ideas from a seed (suggestions + category ideas). mode=domain: keywords a domain already ranks for. Each result includes keyword, volume, difficulty, and source. Optional location_code (DataForSEO) and language_code override site/project locale (site_id) or default US/en (2840/en). Costs DataForSEO credits against your plan cap.',
    inputSchema: {
      type: 'object',
      properties: {
        mode: {
          type: 'string',
          enum: ['lookup', 'expand', 'domain'],
          description: 'lookup = metrics for keywords; expand = discover from seed; domain = ranked keywords',
        },
        keywords: {
          type: 'array',
          items: { type: 'string' },
          description: 'lookup mode: keywords to enrich (up to 100)',
        },
        seed: { type: 'string', description: 'expand mode: seed term; lookup shorthand for a single keyword' },
        domain: { type: 'string', description: 'domain mode: domain to discover ranked keywords for' },
        site_id: { type: 'string', description: 'optional: use site market/language when location/language not set' },
        location_code: {
          type: 'number',
          description: 'optional DataForSEO location_code (overrides site_id locale; e.g. 2380 Italy, 2840 US)',
        },
        language_code: {
          type: 'string',
          description: 'optional DataForSEO language_code (overrides site_id locale; e.g. it, en)',
        },
        limit: { type: 'number', description: 'expand/domain: max results (default 40, max 100)' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'audit_page',
    description: 'On-page/technical SEO snapshot for a URL (DataForSEO instant pages).',
    inputSchema: {
      type: 'object',
      properties: { url: { type: 'string' } },
      required: ['url'],
      additionalProperties: false,
    },
  },
  {
    name: 'backlink_summary',
    description:
      'Backlink profile summary — domain rank (DataForSEO 0–1000, not Ahrefs DR), backlinks, referring domains.',
    inputSchema: {
      type: 'object',
      properties: { target: { type: 'string', description: 'domain or URL' } },
      required: ['target'],
      additionalProperties: false,
    },
  },
  {
    name: 'domain_overview',
    description: 'Organic overview — estimated traffic, keyword count, traffic value.',
    inputSchema: {
      type: 'object',
      properties: {
        target: { type: 'string' },
        site_id: { type: 'string', description: 'optional: use site market/language' },
      },
      required: ['target'],
      additionalProperties: false,
    },
  },
  {
    name: 'generate_article',
    description:
      'Generate a GEO-oriented article draft (title + markdown) for a topic via the account LLM. Costs credits.',
    inputSchema: {
      type: 'object',
      properties: {
        topic: { type: 'string' },
        keyword: { type: 'string' },
        language: { type: 'string', description: 'e.g. en or it' },
        word_count: { type: 'number' },
      },
      required: ['topic'],
      additionalProperties: false,
    },
  },
  {
    name: 'mine_fanouts',
    description:
      'Mine already-stored AI answers for fanout sub-questions (People Also Ask / related / explicit "?"). Default is ZERO LLM cost (structural extract only). dry_run=true estimates optional extract=true LLM calls and executes nothing. extract=true spends ~$0.0004/query, cap $0.02.',
    inputSchema: {
      type: 'object',
      properties: {
        site_id: { type: 'string', description: 'site id from list_sites' },
        query_id: { type: 'string', description: 'optional visibility query id' },
        dry_run: { type: 'boolean', description: 'estimate optional LLM extract; execute nothing' },
        extract: { type: 'boolean', description: 'optional cheap LLM extract (spends credits)' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'get_source_gaps',
    description:
      'Rank citation domains from stored AI answers: citation_count, sample_urls, your_presence, gap_score. Pure aggregation, cost_usd=0.',
    inputSchema: {
      type: 'object',
      properties: {
        site_id: { type: 'string' },
        limit: { type: 'number', description: 'max domains (default 20)' },
      },
      required: ['site_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_cannibalization',
    description:
      'Keyword cannibalization from stored rank snapshots. Default cost_usd=0. dry_run=true returns keyword_count + estimated_usd and executes NOTHING. refresh=true spends one batched SERP call (capped, default 100 keywords) — only after the user confirms the dry-run estimate.',
    inputSchema: {
      type: 'object',
      properties: {
        site_id: { type: 'string' },
        limit: { type: 'number' },
        days: { type: 'number', description: 'lookback days (default 90)' },
        dry_run: { type: 'boolean' },
        refresh: { type: 'boolean' },
      },
      required: ['site_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_link_intersect',
    description:
      'Referring domains that link to competitor_domain but NOT the site, from stored backlink_referring_domains. Default cost_usd=0. dry_run=true estimates a domain_intersection call and executes nothing. refresh is refused.',
    inputSchema: {
      type: 'object',
      properties: {
        site_id: { type: 'string' },
        competitor_domain: { type: 'string' },
        limit: { type: 'number' },
        dry_run: { type: 'boolean' },
        refresh: { type: 'boolean' },
      },
      required: ['site_id', 'competitor_domain'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_content_gap',
    description:
      'Keywords where the competitor ranks Google top-20 and the site does not rank top-100, from stored SERP snapshots. cost_usd always 0. Never fires DataForSEO.',
    inputSchema: {
      type: 'object',
      properties: {
        site_id: { type: 'string' },
        competitor_domain: { type: 'string' },
        limit: { type: 'number' },
      },
      required: ['site_id', 'competitor_domain'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_brand_sentiment',
    description:
      'Sentiment (positive/neutral/negative + accuracy) of already-stored AI answers that mention your brand, aggregated per engine. Default never spends. Too few mentions → insufficient_data (no invented %). dry_run=true estimates gpt-4o-mini cost. classify=true spends up to $0.05/run after the user confirms.',
    inputSchema: {
      type: 'object',
      properties: {
        site_id: { type: 'string' },
        days: { type: 'number', description: 'lookback days (default 30)' },
        dry_run: { type: 'boolean' },
        classify: { type: 'boolean' },
      },
      required: ['site_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_gsc_property',
    description:
      'Get the connected Google Search Console property for a site (if any). Reads the project cache only — no OAuth tokens.',
    inputSchema: {
      type: 'object',
      properties: { site_id: { type: 'string', description: 'site id from list_sites' } },
      required: ['site_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_gsc_analytics',
    description:
      'Cached Google Search Console Search Analytics for a site — clicks, impressions, CTR, average position, top queries and top pages (read-only; not a third-party rank tracker).',
    inputSchema: {
      type: 'object',
      properties: {
        site_id: { type: 'string', description: 'site id from list_sites' },
        period_days: { type: 'number', description: '7, 28, or 90 (default 28)' },
      },
      required: ['site_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'query_gsc_search_analytics',
    description:
      `Live Google Search Console Search Analytics for a site, any date range in the last ${GSC_HISTORY_MONTHS} months (Google keeps no more), grouped by any dimensions and filterable — e.g. a query's clicks by month over a year, pages that lost impressions, Discover or image traffic. Read-only, uses the site's connected Search Console. Data lags ~2 days. Note: manual actions, security issues, the Page indexing report, Core Web Vitals and links are not available in Google's API — use inspect_gsc_url for a URL's index status.`,
    inputSchema: {
      type: 'object',
      properties: {
        site_id: { type: 'string', description: 'site id from list_sites' },
        start_date: { type: 'string', description: 'YYYY-MM-DD (default: 28 days before end_date)' },
        end_date: { type: 'string', description: 'YYYY-MM-DD (default: 2 days ago)' },
        dimensions: {
          type: 'array',
          items: { type: 'string', enum: [...SEARCH_DIMENSIONS] },
          description: 'default ["query"]; add "date" for a time series',
        },
        search_type: { type: 'string', enum: [...SEARCH_TYPES], description: 'default web' },
        filters: {
          type: 'array',
          description: 'AND-ed filters, e.g. [{"dimension":"page","operator":"contains","expression":"/blog/"}]',
          items: {
            type: 'object',
            properties: {
              dimension: { type: 'string', enum: ['query', 'page', 'country', 'device', 'searchAppearance'] },
              operator: { type: 'string', enum: ['equals', 'notEquals', 'contains', 'notContains', 'includingRegex', 'excludingRegex'] },
              expression: { type: 'string' },
            },
            required: ['dimension', 'expression'],
            additionalProperties: false,
          },
        },
        row_limit: { type: 'number', description: `1–${GSC_MAX_ROWS} (default 1000)` },
        start_row: { type: 'number', description: 'offset for paging past row_limit' },
        include_fresh_data: { type: 'boolean', description: 'include the last, not yet final, days' },
      },
      required: ['site_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'inspect_gsc_url',
    description:
      "Google Search Console URL Inspection for one URL of the site: whether it is indexed and why not (coverage state), last crawl, robots.txt and fetch state, Google's canonical vs the declared one, sitemaps listing it, mobile usability and rich results. Read-only; Google allows ~2,000 inspections per property per day.",
    inputSchema: {
      type: 'object',
      properties: {
        site_id: { type: 'string', description: 'site id from list_sites' },
        url: { type: 'string', description: 'full URL inside the connected property' },
        language: { type: 'string', description: 'language for Google messages, e.g. en-US or it-IT (default en-US)' },
      },
      required: ['site_id', 'url'],
      additionalProperties: false,
    },
  },
  {
    name: 'list_gsc_sitemaps',
    description:
      'Sitemaps submitted in Google Search Console for the site: last submitted and last read by Google, pending state, errors, warnings and submitted URL counts. Read-only.',
    inputSchema: {
      type: 'object',
      properties: { site_id: { type: 'string', description: 'site id from list_sites' } },
      required: ['site_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_ga4_property',
    description:
      'Get the connected Google Analytics 4 property for a site (if any). Reads the project cache only — no OAuth tokens.',
    inputSchema: {
      type: 'object',
      properties: { site_id: { type: 'string', description: 'site id from list_sites' } },
      required: ['site_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_ga4_analytics',
    description:
      'Cached Google Analytics 4 data for a site — sessions, users, pageviews, bounce rate, top pages and top sources.',
    inputSchema: {
      type: 'object',
      properties: {
        site_id: { type: 'string', description: 'site id from list_sites' },
        period_days: { type: 'number', description: '7, 28, or 90 (default 28)' },
      },
      required: ['site_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'list_client_reports',
    description:
      'Client reports built in Rankdelta (agency reporting): one line per report with period, headline KPIs and the public share link. Optionally for one site.',
    inputSchema: {
      type: 'object',
      properties: {
        site_id: { type: 'string', description: 'site id from list_sites (omit for all sites)' },
        limit: { type: 'number', description: 'max reports (default 20)' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'get_client_report',
    description:
      'Full content of one client report — AI visibility (share of voice, engines, prompts won/missing, competitors), Search Console, GA4, rankings, site health, backlinks, the written summary and next steps, branding and share link. Use it to brief, to answer questions about a client, or to build a presentation (see the rankdelta-client-deck skill). Pass report_id, or site_id for the latest report of that site.',
    inputSchema: {
      type: 'object',
      properties: {
        report_id: { type: 'string', description: 'report id from list_client_reports' },
        site_id: { type: 'string', description: 'site id from list_sites — returns the latest report' },
      },
      additionalProperties: false,
    },
  },
];

function normalizeDomain(raw: string | null | undefined): string | null {
  if (!raw || !String(raw).trim()) return null;
  const s = String(raw).trim();
  try {
    const u = s.includes('://') ? new URL(s) : new URL(`https://${s}`);
    return u.hostname.replace(/^www\./i, '').toLowerCase();
  } catch {
    return s
      .replace(/^https?:\/\//i, '')
      .replace(/^www\./i, '')
      .split('/')[0]
      ?.toLowerCase() ?? null;
  }
}

function domainAliases(domain: string | null, projectName: string): string[] {
  const aliases = new Set<string>();
  if (domain) {
    aliases.add(domain);
    aliases.add(`www.${domain}`);
    const sld = domain.split('.')[0];
    if (sld && sld.length > 2) aliases.add(sld);
  }
  const name = projectName.trim();
  if (name) aliases.add(name);
  return [...aliases];
}

const NOT_CONFIGURED_MESSAGE =
  'AI-visibility non configurata per questo sito: usa setup_ai_visibility';

const GSC_ALLOWED_PERIODS = [7, 28, 90] as const;
const GA4_ALLOWED_PERIODS = [7, 28, 90] as const;

function clampGscPeriodDays(raw: unknown): number {
  const n = Number(raw ?? 28);
  return (GSC_ALLOWED_PERIODS as readonly number[]).includes(n) ? n : 28;
}

function clampGa4PeriodDays(raw: unknown): number {
  const n = Number(raw ?? 28);
  return (GA4_ALLOWED_PERIODS as readonly number[]).includes(n) ? n : 28;
}

/** Site has tracked brand, prompts, and at least one scan in the last 30 days. */
async function isAiVisibilityConfigured(db: Sb, siteId: string): Promise<boolean> {
  const { data: brand } = await db
    .from('tracked_brands')
    .select('id')
    .eq('project_id', siteId)
    .limit(1)
    .maybeSingle();
  if (!brand) return false;

  const { data: query } = await db
    .from('visibility_queries')
    .select('id')
    .eq('project_id', siteId)
    .limit(1)
    .maybeSingle();
  if (!query) return false;

  const runs = await runsForProject(db, siteId);
  return runs.length > 0;
}

/** Ids per `.in(...)` filter — keeps the PostgREST request URL short enough for large projects. */
const IN_CHUNK = 150;
/** Only runs from the last 90 days feed competitor seeding — older runs are stale signal. */
const RUN_WINDOW_DAYS = 90;

function chunk<T>(arr: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function runIdsForQueryIds(db: Sb, queryIds: string[]): Promise<string[]> {
  if (!queryIds.length) return [];
  const since = new Date(Date.now() - RUN_WINDOW_DAYS * 864e5).toISOString();
  const out: string[] = [];
  for (const slice of chunk(queryIds, IN_CHUNK)) {
    const { data } = await db
      .from('visibility_query_runs')
      .select('id')
      .in('query_id', slice)
      .gte('run_at', since);
    for (const r of data ?? []) out.push(r.id as string);
  }
  return out;
}

/**
 * Seed competitor_brands from the brands prior AI answers named (see competitor_seed.ts): only
 * runs of active prompts, never cited source domains, at most 8, each named in 2+ answers.
 */
async function seedCompetitorsFromExistingResponses(
  db: Sb,
  siteId: string,
): Promise<number> {
  const { data: existing } = await db
    .from('competitor_brands')
    .select('name, domain')
    .eq('project_id', siteId);
  const existingNames = new Set(
    (existing ?? []).flatMap((b) => [String(b.name).toLowerCase(), normalizeDomain(b.domain as string)].filter(Boolean)),
  );

  const { data: activeQueries } = await db
    .from('visibility_queries')
    .select('id')
    .eq('project_id', siteId)
    .eq('is_active', true);
  const runIds = await runIdsForQueryIds(db, (activeQueries ?? []).map((q) => q.id as string));
  if (!runIds.length) return 0;

  const mentions: MentionRow[] = [];
  for (const slice of chunk(runIds, IN_CHUNK)) {
    const { data: m } = await db
      .from('visibility_brand_mentions')
      .select('brand_name, query_run_id, tracked_brand_id, competitor_brand_id')
      .in('query_run_id', slice);
    mentions.push(...((m ?? []) as MentionRow[]));
  }

  let inserted = 0;
  for (const name of pickCompetitorCandidates(mentions, existingNames)) {
    const { error } = await db.from('competitor_brands').insert({ project_id: siteId, name, domain: null, aliases: [] });
    if (!error) inserted++;
  }
  return inserted;
}

/**
 * A fresh Google access token for the site's connected Search Console property (live tools).
 * The refresh token never leaves the server; a revoked grant is marked on the property so the
 * app asks the user to reconnect, exactly as the nightly sync does.
 */
async function gscLiveAccess(
  db: Sb,
  siteId: string,
): Promise<{ ok: true; token: string; siteUrl: string } | { ok: false; body: Record<string, unknown> }> {
  const notConnected = {
    ok: false as const,
    body: { error: 'gsc_not_connected', message: 'Search Console is not connected for this site. Connect it in Rankdelta (Rankings → Search Console).' },
  };
  const prop = (await db.from('gsc_properties').select('site_url').eq('project_id', siteId).maybeSingle()).data as
    | { site_url?: string | null }
    | null;
  const siteUrl = prop?.site_url ? String(prop.site_url) : '';
  if (!siteUrl) return notConnected;
  const refreshToken = await readGoogleRefreshToken(db, 'gsc_oauth_tokens', siteId);
  if (!refreshToken) return notConnected;
  try {
    return { ok: true, token: await refreshAccess(refreshToken), siteUrl };
  } catch (e) {
    if (classifyGscSyncFailure(e) === 'revoked') {
      await markGscGrantRevoked(db, siteId, '[mcp]');
      return {
        ok: false,
        body: { error: 'gsc_grant_revoked', message: 'Google access to Search Console was revoked. Reconnect it in Rankdelta to use this tool.' },
      };
    }
    return { ok: false, body: { error: 'gsc_unavailable', message: 'Could not reach Google; try again shortly.' } };
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Server-log text for any thrown value: PostgREST errors are plain objects, not Error instances. */
function describeError(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (e && typeof e === 'object') {
    const o = e as { code?: unknown; message?: unknown };
    if (typeof o.message === 'string') return `${typeof o.code === 'string' ? `${o.code} ` : ''}${o.message}`;
  }
  return String(e);
}

async function assertSiteOwned(db: Sb, userId: string, siteId: string): Promise<boolean> {
  const { data } = await db
    .from('projects')
    .select('id')
    .eq('id', siteId)
    .eq('user_id', userId)
    .maybeSingle();
  return !!data;
}

async function projectLocale(
  db: Sb,
  userId: string,
  siteId?: string,
): Promise<{ locationCode: number; languageCode: string }> {
  if (!siteId) return { locationCode: 2840, languageCode: 'en' };
  const { data } = await db
    .from('projects')
    .select('market, primary_language, user_id')
    .eq('id', siteId)
    .maybeSingle();
  if (!data || data.user_id !== userId) return { locationCode: 2840, languageCode: 'en' };
  return {
    locationCode: mapMarketToLocation(data.market as string),
    languageCode: mapLangToCode(data.primary_language as string),
  };
}

/** keyword_research locale: explicit args → project site locale → US/en default. */
async function resolveKeywordResearchLocale(
  db: Sb,
  userId: string,
  args: Record<string, unknown>,
): Promise<{ locationCode: number; languageCode: string }> {
  const fromProject = await projectLocale(db, userId, args.site_id ? String(args.site_id) : undefined);
  const explicitLocation = Number(args.location_code);
  const explicitLanguage = String(args.language_code ?? '').trim();
  return {
    locationCode:
      Number.isFinite(explicitLocation) && explicitLocation > 0
        ? explicitLocation
        : fromProject.locationCode,
    languageCode: explicitLanguage || fromProject.languageCode,
  };
}

/** Call a sibling Edge Function forwarding the user's API key. */
async function invokeFn(
  name: string,
  token: string,
  body: Record<string, unknown>,
): Promise<{ ok: boolean; status: number; data: unknown }> {
  const base = (Deno.env.get('SUPABASE_URL') ?? '').replace(/\/$/, '');
  const anon = publishableKey();
  const res = await fetch(`${base}/functions/v1/${name}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: anon,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  let data: unknown = null;
  const text = await res.text();
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { error: text.slice(0, 400) };
  }
  return { ok: res.ok, status: res.status, data };
}

interface Run { id: string; provider: string }
async function runsForProject(db: Sb, projectId: string): Promise<Run[]> {
  const { data: qs } = await db.from('visibility_queries').select('id').eq('project_id', projectId);
  const queryIds = (qs ?? []).map((q) => q.id as string);
  if (!queryIds.length) return [];
  const since = new Date(Date.now() - 30 * 864e5).toISOString();
  const out: Run[] = [];
  for (const slice of chunk(queryIds, IN_CHUNK)) {
    const { data } = await db
      .from('visibility_query_runs')
      .select('id, provider')
      .in('query_id', slice)
      .gte('run_at', since);
    out.push(...((data ?? []) as Run[]));
  }
  return out;
}

interface Mention {
  query_run_id: string;
  tracked_brand_id: string | null;
  competitor_brand_id: string | null;
  is_recommended: boolean | null;
}
async function mentionsForRuns(db: Sb, runIds: string[]): Promise<Mention[]> {
  if (!runIds.length) return [];
  const out: Mention[] = [];
  for (const slice of chunk(runIds, IN_CHUNK)) {
    const { data } = await db
      .from('visibility_brand_mentions')
      .select('query_run_id, tracked_brand_id, competitor_brand_id, is_recommended')
      .in('query_run_id', slice);
    out.push(...((data ?? []) as Mention[]));
  }
  return out;
}

function dfsFirstItems(raw: unknown): Record<string, unknown>[] {
  const tasks = (raw as { tasks?: Array<{ result?: Array<{ items?: Record<string, unknown>[] }> }> })
    ?.tasks;
  return tasks?.[0]?.result?.[0]?.items ?? [];
}

function dfsSearchVolumeRows(raw: unknown): Record<string, unknown>[] {
  const tasks = (raw as { tasks?: Array<{ result?: Record<string, unknown>[] }> })?.tasks;
  return tasks?.[0]?.result ?? [];
}

interface KeywordMetricRow {
  keyword: string;
  volume: number | null;
  difficulty: number | null;
  source: string;
  position?: number | null;
}

function mapLabsKeywordItem(it: Record<string, unknown>, source: string): KeywordMetricRow | null {
  const kd = (it['keyword_data'] as Record<string, unknown>) ?? it;
  const keyword = String(kd['keyword'] ?? '').trim();
  if (!keyword) return null;
  const ki = (kd['keyword_info'] as Record<string, unknown>) ?? {};
  const props = (kd['keyword_properties'] as Record<string, unknown>) ?? {};
  return {
    keyword,
    volume: (ki['search_volume'] as number) ?? null,
    difficulty: (props['keyword_difficulty'] as number) ?? null,
    source,
  };
}

function mapRankedKeywordItem(it: Record<string, unknown>): KeywordMetricRow | null {
  const row = mapLabsKeywordItem(it, 'ranked_keywords');
  if (!row) return null;
  const serp = (it['ranked_serp_element'] as Record<string, unknown>) ?? {};
  const serpItem = (serp['serp_item'] as Record<string, unknown>) ?? {};
  row.position = (serpItem['rank_group'] as number) ?? null;
  return row;
}

function normalizeDomainInput(raw: string): string {
  return raw
    .trim()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/.*$/, '');
}

function parseKeywordList(args: Record<string, unknown>): string[] {
  const fromArray = Array.isArray(args.keywords)
    ? (args.keywords as unknown[]).map((k) => String(k).trim()).filter(Boolean)
    : [];
  if (fromArray.length) return [...new Set(fromArray)];
  const seed = String(args.seed ?? '').trim();
  return seed ? [seed] : [];
}

function mergeKeywordRows(rows: KeywordMetricRow[], limit: number): KeywordMetricRow[] {
  const byKey = new Map<string, KeywordMetricRow>();
  for (const row of rows) {
    const key = row.keyword.toLowerCase();
    const prev = byKey.get(key);
    if (!prev) {
      byKey.set(key, row);
      continue;
    }
    byKey.set(key, {
      ...prev,
      volume: prev.volume ?? row.volume,
      difficulty: prev.difficulty ?? row.difficulty,
      source: prev.source === row.source ? prev.source : `${prev.source},${row.source}`,
      position: prev.position ?? row.position,
    });
  }
  return [...byKey.values()].slice(0, limit);
}

async function callTool(
  db: Sb,
  userId: string,
  token: string,
  name: string,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  try {
    // ── ChatGPT deep-research compatibility ──
    if (name === 'search') {
      const q = String(args.query ?? '').trim().toLowerCase();
      const { data, error } = await db
        .from('projects')
        .select('id, name, website_url')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      let rows = (data ?? []) as Array<{ id: string; name: string | null; website_url: string | null }>;
      if (q) rows = rows.filter((r) => `${r.name ?? ''} ${r.website_url ?? ''}`.toLowerCase().includes(q));
      const results = rows.map((r) => ({
        id: `site:${r.id}`,
        title: r.name || r.website_url || 'Untitled site',
        // A non-empty url makes the result citable in ChatGPT.
        url: r.website_url || `${appOrigin()}/site-explorer`,
      }));
      return structuredResult({ results });
    }

    if (name === 'fetch') {
      const rawId = String(args.id ?? '');
      const siteId = rawId.startsWith('site:') ? rawId.slice(5) : rawId;
      if (!siteId || !(await assertSiteOwned(db, userId, siteId))) {
        return structuredResult({ id: rawId, title: 'Not found', text: 'No site with that id in your account.', url: '', metadata: { error: 'not_found' } });
      }
      const { data: proj } = await db
        .from('projects')
        .select('id, name, website_url, main_topic')
        .eq('id', siteId)
        .maybeSingle();
      const p = (proj ?? {}) as { name?: string | null; website_url?: string | null; main_topic?: string | null };
      const title = p.name || p.website_url || 'Site';
      const canonicalUrl = p.website_url || appOrigin();
      const lines: string[] = [`# ${title}`, `Website: ${p.website_url ?? '—'}`];
      if (p.main_topic) lines.push(`Main topic: ${p.main_topic}`);
      if (await isAiVisibilityConfigured(db, siteId)) {
        const runs = await runsForProject(db, siteId);
        const runProvider = new Map(runs.map((r) => [r.id, r.provider]));
        const mentions = await mentionsForRuns(db, [...runProvider.keys()]);
        const per: Record<string, { you: number; comp: number; rec: number }> = {};
        for (const m of mentions) {
          const eng = runProvider.get(m.query_run_id) ?? 'unknown';
          per[eng] ??= { you: 0, comp: 0, rec: 0 };
          if (m.tracked_brand_id) { per[eng].you++; if (m.is_recommended) per[eng].rec++; }
          else if (m.competitor_brand_id) per[eng].comp++;
        }
        const you = Object.values(per).reduce((a, v) => a + v.you, 0);
        const comp = Object.values(per).reduce((a, v) => a + v.comp, 0);
        const sov = you + comp > 0 ? Math.round((you / (you + comp)) * 1000) / 10 : 0;
        lines.push('', `AI Share of Voice (last 30 days): ${sov}%`);
        for (const [eng, v] of Object.entries(per)) {
          const s = v.you + v.comp > 0 ? Math.round((v.you / (v.you + v.comp)) * 1000) / 10 : 0;
          lines.push(`- ${eng}: SoV ${s}% — your mentions ${v.you}, competitors ${v.comp}, recommended ${v.rec}`);
        }
      } else {
        lines.push('', 'AI visibility is not configured for this site yet.');
      }
      return structuredResult({ id: rawId, title, text: lines.join('\n'), url: canonicalUrl, metadata: { type: 'site', site_id: siteId } });
    }

    if (name === 'list_sites') {
      const { data, error } = await db
        .from('projects')
        .select('id, name, website_url')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return textResult(data ?? []);
    }

    if (name === 'list_engines') return textResult(ENGINES);

    if (name === 'get_ai_visibility') {
      const siteId = String(args.site_id ?? '');
      if (!(await assertSiteOwned(db, userId, siteId))) {
        return textResult({ error: 'site_not_found' }, true);
      }
      if (!(await isAiVisibilityConfigured(db, siteId))) {
        return textResult({ status: 'not_configured', message: NOT_CONFIGURED_MESSAGE });
      }
      const runs = await runsForProject(db, siteId);
      const runProvider = new Map(runs.map((r) => [r.id, r.provider]));
      const mentions = await mentionsForRuns(db, [...runProvider.keys()]);
      const per: Record<string, { you: number; comp: number; rec: number }> = {};
      for (const m of mentions) {
        const eng = runProvider.get(m.query_run_id) ?? 'unknown';
        per[eng] ??= { you: 0, comp: 0, rec: 0 };
        if (m.tracked_brand_id) {
          per[eng].you++;
          if (m.is_recommended) per[eng].rec++;
        } else if (m.competitor_brand_id) per[eng].comp++;
      }
      const perEngine = Object.entries(per).map(([engine, v]) => ({
        engine,
        yourMentions: v.you,
        competitorMentions: v.comp,
        yourRecommended: v.rec,
        shareOfVoice: v.you + v.comp > 0 ? Math.round((v.you / (v.you + v.comp)) * 1000) / 10 : 0,
      }));
      const you = perEngine.reduce((a, e) => a + e.yourMentions, 0);
      const comp = perEngine.reduce((a, e) => a + e.competitorMentions, 0);
      return textResult({
        overallShareOfVoice: you + comp > 0 ? Math.round((you / (you + comp)) * 1000) / 10 : 0,
        perEngine,
      });
    }

    if (name === 'list_ai_recommendations') {
      const siteId = String(args.site_id ?? '');
      if (!(await assertSiteOwned(db, userId, siteId))) {
        return textResult({ error: 'site_not_found' }, true);
      }
      if (!(await isAiVisibilityConfigured(db, siteId))) {
        return textResult({ status: 'not_configured', message: NOT_CONFIGURED_MESSAGE });
      }
      const runs = await runsForProject(db, siteId);
      const mentions = await mentionsForRuns(db, runs.map((r) => r.id));
      const { data: brands } = await db
        .from('competitor_brands')
        .select('id, name')
        .eq('project_id', siteId);
      const nameById = new Map((brands ?? []).map((b) => [b.id as string, b.name as string]));
      const tally: Record<string, { mentions: number; recommended: number }> = {};
      for (const m of mentions) {
        if (!m.competitor_brand_id) continue;
        const n = nameById.get(m.competitor_brand_id) ?? 'unknown';
        tally[n] ??= { mentions: 0, recommended: 0 };
        tally[n].mentions++;
        if (m.is_recommended) tally[n].recommended++;
      }
      return textResult(
        Object.entries(tally)
          .map(([n, v]) => ({ name: n, ...v }))
          .sort((a, b) => b.mentions - a.mentions),
      );
    }

    if (name === 'run_visibility_scan') {
      const siteId = String(args.site_id ?? '');
      if (!(await assertSiteOwned(db, userId, siteId))) {
        return textResult({ error: 'site_not_found' }, true);
      }
      const engines = Array.isArray(args.engines)
        ? (args.engines as string[])
        : ['chatgpt', 'perplexity', 'gemini', 'google_aio'];
      const maxQueries = Math.min(12, Math.max(1, Number(args.max_queries) || 6));
      const inv = await invokeFn('visibility-ops', token, {
        action: 'scan_project',
        projectId: siteId,
        providers: engines,
        maxQueries,
        // Answer within about a minute instead of a 504 at 150 s after paying for part of it.
        budgetMs: 45_000,
      });
      if (!inv.ok) return textResult(inv.data ?? { error: 'scan_failed', status: inv.status }, true);
      const deferred = Number((inv.data as { deferred?: unknown })?.deferred ?? 0);
      return textResult({
        ...(inv.data as Record<string, unknown>),
        ...(deferred > 0
          ? { coverage_note: `${deferred} prompt(s) were left for the next call to keep this one under a minute (not charged). Call run_visibility_scan again to continue.` }
          : {}),
      });
    }

    if (name === 'add_site') {
      const rawName = String(args.name ?? '').trim();
      const rawUrl = String(args.website_url ?? '').trim();
      if (!rawName) {
        return textResult({ error: 'name_required', message: 'Pass a non-empty "name" for the project.' }, true);
      }
      if (!rawUrl) {
        return textResult({ error: 'website_url_required', message: 'Pass a non-empty "website_url" for the site.' }, true);
      }

      // Accept "acmegym.it", "https://www.acmegym.it/", "http://acmegym.it/it".
      // Keep any path — a client may legitimately track a section of a site.
      let url: URL;
      try {
        url = new URL(/^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`);
      } catch {
        return textResult(
          { error: 'invalid_url', message: `"${rawUrl}" is not a valid URL. Use a hostname like "acmegym.it" or a full URL.` },
          true,
        );
      }
      if (!url.hostname.includes('.')) {
        return textResult(
          { error: 'invalid_url', message: `"${rawUrl}" has no domain — use a hostname like "acmegym.it".` },
          true,
        );
      }
      const websiteUrl = url.toString().replace(/\/$/, '');

      // The MCP runs as service_role, which bypasses the max_projects trigger
      // (migration 044 returns early for service_role). Enforce the same quota the
      // other Edge project-creators use — one shared rule, not a second copy.
      try {
        const quota = await assertProjectQuota(db, userId);
        if (!quota.ok) {
          return textResult(
            {
              error: 'project_limit_reached',
              message: `Your plan allows ${quota.max} site(s) and you already have ${quota.count}.`,
              max: quota.max,
              count: quota.count,
            },
            true,
          );
        }
      } catch (e) {
        // A plan limit is a user-facing message; anything else is an internal (DB) error: log it,
        // never hand the raw text to the caller.
        if (!(e instanceof ProjectLimitError)) console.error('[mcp] project quota check failed', e instanceof Error ? e.message : String(e));
        const msg = e instanceof ProjectLimitError ? e.message : 'Could not check your site limit. Please try again.';
        return textResult({ error: 'quota_check_failed', message: msg }, true);
      }

      // Never inherit the column defaults: an English site must not become an Italian project.
      const locale = await detectSiteLocale({
        url: websiteUrl,
        language: typeof args.language === 'string' ? args.language : null,
        market: typeof args.market === 'string' ? args.market : null,
      });

      const { data: created, error: createErr } = await db
        .from('projects')
        .insert({ user_id: userId, name: rawName, website_url: websiteUrl, ...locale, primary_language: locale.language })
        .select('id, name, website_url, language, market')
        .single();
      if (createErr || !created) {
        if (createErr) console.error('[mcp] project insert failed', createErr.message);
        return textResult({ error: 'project_create_failed', message: 'Could not create the site. Please try again.' }, true);
      }
      return structuredResult({
        ...(created as Record<string, unknown>),
        next_step: 'Call setup_ai_visibility with this id to activate AI visibility (that step spends credits).',
      });
    }

    if (name === 'setup_ai_visibility') {
      const siteId = String(args.site_id ?? '');
      if (!(await assertSiteOwned(db, userId, siteId))) {
        return textResult({ error: 'site_not_found' }, true);
      }
      if (!(await assertPayingPlan(userId))) {
        return textResult({ error: 'Paid plan required', code: PLAN_REQUIRED_CODE }, true);
      }

      const { data: project, error: projectErr } = await db
        .from('projects')
        .select('id, name, website_url')
        .eq('id', siteId)
        .eq('user_id', userId)
        .single();
      if (projectErr || !project) {
        return textResult({ error: 'site_not_found' }, true);
      }

      const domain = normalizeDomain(project.website_url as string);
      const aliases = domainAliases(domain, String(project.name ?? ''));

      const { data: existingBrand } = await db
        .from('tracked_brands')
        .select('id')
        .eq('project_id', siteId)
        .limit(1)
        .maybeSingle();
      let trackedBrandCreated = false;
      if (!existingBrand) {
        const { error: brandErr } = await db.from('tracked_brands').insert({
          project_id: siteId,
          name: String(project.name ?? domain ?? 'Brand'),
          domain,
          aliases,
        });
        if (brandErr) throw brandErr;
        trackedBrandCreated = true;
      }

      const competitorsSeeded = await seedCompetitorsFromExistingResponses(db, siteId);

      // Only active prompts count: a project whose prompts were all switched off gets a fresh set.
      const { data: existingQueries } = await db
        .from('visibility_queries')
        .select('id')
        .eq('project_id', siteId)
        .eq('is_active', true)
        .limit(1);
      let queriesGenerated = 0;
      if (!existingQueries?.length) {
        // Same size as the web onboarding. skipInitialScan: this tool runs its own capped scan below;
        // without it generate_queries queued a second one and every prompt ran (and was paid) twice.
        const gen = await invokeFn('visibility-ops', token, {
          action: 'generate_queries',
          projectId: siteId,
          count: 12,
          skipInitialScan: true,
        });
        if (!gen.ok) {
          return textResult(gen.data ?? { error: 'generate_queries_failed', status: gen.status }, true);
        }
        queriesGenerated = Number((gen.data as { inserted?: number })?.inserted) || 0;
      }

      const scan = await invokeFn('visibility-ops', token, {
        action: 'scan_project',
        projectId: siteId,
        providers: ['chatgpt', 'perplexity', 'gemini', 'google_aio'],
        maxQueries: 6,
        // Answer within about a minute; prompts left over are picked up by run_visibility_scan.
        budgetMs: 40_000,
      });
      if (!scan.ok) {
        return textResult(scan.data ?? { error: 'scan_failed', status: scan.status }, true);
      }

      return textResult({
        ok: true,
        site_id: siteId,
        tracked_brand_created: trackedBrandCreated,
        competitors_seeded: competitorsSeeded,
        queries_generated: queriesGenerated,
        scan: scan.data,
        message:
          'AI-visibility attivata. Usa get_ai_visibility o list_ai_recommendations per i risultati.',
      });
    }

    if (name === 'list_ranks') {
      const siteId = String(args.site_id ?? '');
      if (!(await assertSiteOwned(db, userId, siteId))) {
        return textResult({ error: 'site_not_found' }, true);
      }
      const { data: kws, error } = await db
        .from('serp_rank_keywords')
        .select('id, phrase, is_active, created_at')
        .eq('project_id', siteId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      const rows = [];
      for (const kw of kws ?? []) {
        const { data: snap } = await db
          .from('serp_rank_snapshots')
          .select('rank_absolute, ranking_url, checked_at, status')
          .eq('keyword_id', kw.id)
          .order('checked_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        rows.push({
          id: kw.id,
          keyword: kw.phrase,
          is_active: kw.is_active,
          latest_position: snap?.rank_absolute ?? null,
          ranking_url: snap?.ranking_url ?? null,
          latest_checked_at: snap?.checked_at ?? null,
          created_at: kw.created_at,
        });
      }
      return textResult(rows);
    }

    if (name === 'track_rank') {
      const siteId = String(args.site_id ?? '');
      const keyword = String(args.keyword ?? '').trim();
      if (!keyword) return textResult({ error: 'keyword_required' }, true);
      if (!(await assertSiteOwned(db, userId, siteId))) {
        return textResult({ error: 'site_not_found' }, true);
      }
      // ilike treats % and _ as wildcards — escape them so "100% cotton" can't match every row
      // (and maybeSingle() then throw on multiple matches).
      const likeSafe = keyword.replace(/[\\%_]/g, (m) => `\\${m}`);
      const { data: existing } = await db
        .from('serp_rank_keywords')
        .select('id, phrase, is_active, created_at')
        .eq('project_id', siteId)
        .ilike('phrase', likeSafe)
        .limit(1)
        .maybeSingle();
      if (existing) {
        if (!existing.is_active) {
          await db.from('serp_rank_keywords').update({ is_active: true }).eq('id', existing.id);
        }
        return textResult({
          id: existing.id,
          keyword: existing.phrase,
          created_at: existing.created_at,
          already_tracked: true,
        });
      }
      const { data, error } = await db
        .from('serp_rank_keywords')
        .insert({ project_id: siteId, phrase: keyword })
        .select('id, phrase, created_at')
        .single();
      if (error) throw error;
      return textResult({
        id: data.id,
        keyword: data.phrase,
        created_at: data.created_at,
        already_tracked: false,
      });
    }

    if (name === 'check_ranks') {
      const siteId = String(args.site_id ?? '');
      if (!(await assertSiteOwned(db, userId, siteId))) {
        return textResult({ error: 'site_not_found' }, true);
      }
      const limit = Math.min(20, Math.max(1, Number(args.limit) || 12));
      // Pick the least-recently-checked keywords, oldest first, never-checked first.
      // Do NOT order by serp_rank_keywords.updated_at: nothing in the check path
      // writes it (visibility-ops/serp_rank.ts only reads the row), so that order is
      // static and the same head of the list would be re-checked forever while the
      // tail is never checked at all. The real "last checked" signal lives in
      // serp_rank_snapshots.checked_at, which is what list_ranks already surfaces.
      const { data: allKws, error } = await db
        .from('serp_rank_keywords')
        .select('id, phrase')
        .eq('project_id', siteId)
        .eq('is_active', true);
      if (error) throw error;
      const candidates = allKws ?? [];
      if (!candidates.length) {
        return textResult({ error: 'no_tracked_keywords', message: 'Use track_rank first.' }, true);
      }
      const lastChecked = new Map<string, string | null>();
      for (const kw of candidates) {
        const { data: snap } = await db
          .from('serp_rank_snapshots')
          .select('checked_at')
          .eq('keyword_id', kw.id as string)
          .order('checked_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        lastChecked.set(kw.id as string, snap?.checked_at ?? null);
      }
      const ordered = [...candidates].sort((a, b) => {
        const aAt = lastChecked.get(a.id as string) ?? null;
        const bAt = lastChecked.get(b.id as string) ?? null;
        if (aAt === bAt) return 0;
        if (aAt === null) return -1; // never checked goes first
        if (bAt === null) return 1;
        return aAt < bAt ? -1 : 1; // then oldest check first
      });
      const selected = ordered.slice(0, limit);
      const ids = selected.map((k) => k.id as string);
      const inv = await invokeFn('visibility-ops', token, {
        action: 'run_serp_rank',
        keywordIds: ids,
      });
      if (!inv.ok) return textResult(inv.data ?? { error: 'check_failed', status: inv.status }, true);
      const neverChecked = selected.filter((k) => lastChecked.get(k.id as string) === null).length;
      // visibility-ops checks a few keywords at a time within a time budget and hands back the
      // ones it had no time to start (not charged) instead of timing out after paying.
      const deferred = Array.isArray((inv.data as { deferred?: unknown })?.deferred)
        ? ((inv.data as { deferred: unknown[] }).deferred.length)
        : 0;
      const checkedCount = ids.length - deferred;
      const remaining = Math.max(0, candidates.length - checkedCount);
      return textResult({
        ...(inv.data as Record<string, unknown>),
        checked_count: checkedCount,
        deferred_count: deferred,
        tracked_total: candidates.length,
        never_checked_in_batch: neverChecked,
        remaining_unchecked_this_run: remaining,
        ...(remaining > 0
          ? {
              coverage_note:
                `${remaining} tracked keyword(s) were not checked in this call` +
                (deferred > 0 ? ` (${deferred} deferred to keep the call under a minute; they were not charged)` : ` (limit ${limit})`) +
                '. Call check_ranks again to continue: least-recently-checked keywords are picked first.',
            }
          : {}),
      });
    }

    if (name === 'keyword_research') {
      let mode = String(args.mode ?? '').toLowerCase();
      if (!mode) {
        if (args.domain || args.target) mode = 'domain';
        else if (Array.isArray(args.keywords) && (args.keywords as unknown[]).length) mode = 'lookup';
        else if (String(args.seed ?? '').trim()) mode = 'expand';
        else mode = 'lookup';
      }
      if (!['lookup', 'expand', 'domain'].includes(mode)) {
        return textResult({ error: 'invalid_mode', message: 'mode must be lookup, expand, or domain' }, true);
      }
      const loc = await resolveKeywordResearchLocale(db, userId, args);
      const limit = Math.min(100, Math.max(5, Number(args.limit) || 40));

      if (mode === 'lookup') {
        const keywords = parseKeywordList(args).slice(0, 100);
        if (!keywords.length) {
          return textResult({ error: 'keywords_required', message: 'Provide keywords[] or seed for lookup mode' }, true);
        }
        const [volInv, kdInv] = await Promise.all([
          invokeFn('seo-proxy', token, {
            action: 'dataforseo',
            endpoint: '/keywords_data/google_ads/search_volume/live',
            payload: {
              keywords,
              location_code: loc.locationCode,
              language_code: loc.languageCode,
            },
          }),
          invokeFn('seo-proxy', token, {
            action: 'dataforseo',
            endpoint: '/dataforseo_labs/google/bulk_keyword_difficulty/live',
            payload: {
              keywords,
              location_code: loc.locationCode,
              language_code: loc.languageCode,
            },
          }),
        ]);
        if (!volInv.ok) return textResult(volInv.data ?? { error: 'keyword_lookup_failed' }, true);
        if (!kdInv.ok) return textResult(kdInv.data ?? { error: 'keyword_lookup_failed' }, true);

        const difficultyByKey = new Map<string, number>();
        for (const it of dfsFirstItems(kdInv.data)) {
          const kw = String(it['keyword'] ?? '').toLowerCase();
          const kd = it['keyword_difficulty'];
          if (kw && typeof kd === 'number') difficultyByKey.set(kw, kd);
        }

        const keywordsOut: KeywordMetricRow[] = dfsSearchVolumeRows(volInv.data).map((row) => {
          const keyword = String(row['keyword'] ?? '').trim();
          return {
            keyword,
            volume: (row['search_volume'] as number) ?? null,
            difficulty: difficultyByKey.get(keyword.toLowerCase()) ?? null,
            source: 'google_ads_search_volume',
          };
        });
        for (const kw of keywords) {
          if (!keywordsOut.some((r) => r.keyword.toLowerCase() === kw.toLowerCase())) {
            keywordsOut.push({
              keyword: kw,
              volume: null,
              difficulty: difficultyByKey.get(kw.toLowerCase()) ?? null,
              source: 'google_ads_search_volume',
            });
          }
        }
        return textResult({ mode: 'lookup', locale: loc, keywords: keywordsOut });
      }

      if (mode === 'expand') {
        const seed = String(args.seed ?? '').trim();
        if (!seed) return textResult({ error: 'seed_required', message: 'expand mode requires seed' }, true);
        const perSourceLimit = Math.min(100, Math.max(limit, Math.ceil(limit / 2)));
        const [sugInv, ideasInv] = await Promise.all([
          invokeFn('seo-proxy', token, {
            action: 'dataforseo',
            endpoint: '/dataforseo_labs/google/keyword_suggestions/live',
            payload: {
              keyword: seed,
              location_code: loc.locationCode,
              language_code: loc.languageCode,
              limit: perSourceLimit,
              order_by: ['keyword_info.search_volume,desc'],
            },
          }),
          invokeFn('seo-proxy', token, {
            action: 'dataforseo',
            endpoint: '/dataforseo_labs/google/keyword_ideas/live',
            payload: {
              keywords: [seed],
              location_code: loc.locationCode,
              language_code: loc.languageCode,
              limit: perSourceLimit,
              order_by: ['keyword_info.search_volume,desc'],
            },
          }),
        ]);
        if (!sugInv.ok && !ideasInv.ok) {
          return textResult(sugInv.data ?? ideasInv.data ?? { error: 'keyword_expand_failed' }, true);
        }
        const rows: KeywordMetricRow[] = [];
        if (sugInv.ok) {
          for (const it of dfsFirstItems(sugInv.data)) {
            const row = mapLabsKeywordItem(it, 'keyword_suggestions');
            if (row) rows.push(row);
          }
        }
        if (ideasInv.ok) {
          for (const it of dfsFirstItems(ideasInv.data)) {
            const row = mapLabsKeywordItem(it, 'keyword_ideas');
            if (row) rows.push(row);
          }
        }
        return textResult({
          mode: 'expand',
          seed,
          locale: loc,
          keywords: mergeKeywordRows(rows, limit),
        });
      }

      const domain = normalizeDomainInput(String(args.domain ?? args.target ?? ''));
      if (!domain) {
        return textResult({ error: 'domain_required', message: 'domain mode requires domain' }, true);
      }
      const inv = await invokeFn('seo-proxy', token, {
        action: 'dataforseo',
        endpoint: '/dataforseo_labs/google/ranked_keywords/live',
        payload: {
          target: domain,
          location_code: loc.locationCode,
          language_code: loc.languageCode,
          limit,
          order_by: ['ranked_serp_element.serp_item.rank_group,asc'],
        },
      });
      if (!inv.ok) return textResult(inv.data ?? { error: 'keyword_domain_failed' }, true);
      const keywords = dfsFirstItems(inv.data)
        .map((it) => mapRankedKeywordItem(it))
        .filter((r): r is KeywordMetricRow => r != null);
      return textResult({ mode: 'domain', domain, locale: loc, keywords });
    }

    if (name === 'audit_page') {
      const url = String(args.url ?? '').trim();
      if (!url) return textResult({ error: 'url_required' }, true);
      const inv = await invokeFn('seo-proxy', token, {
        action: 'dataforseo',
        endpoint: '/on_page/instant_pages',
        payload: { url, enable_javascript: true },
      });
      if (!inv.ok) return textResult(inv.data ?? { error: 'audit_failed' }, true);
      const item = dfsFirstItems(inv.data)[0] ??
        (inv.data as { tasks?: Array<{ result?: Record<string, unknown>[] }> })?.tasks?.[0]
          ?.result?.[0] ??
        inv.data;
      return textResult({ url, result: item });
    }

    if (name === 'backlink_summary') {
      const target = String(args.target ?? '')
        .trim()
        .replace(/^https?:\/\//, '')
        .replace(/^www\./, '')
        .replace(/\/.*$/, '');
      if (!target) return textResult({ error: 'target_required' }, true);
      const inv = await invokeFn('seo-proxy', token, {
        action: 'dataforseo',
        endpoint: '/backlinks/summary/live',
        payload: { target, internal_list_limit: 10, backlinks_status_type: 'live' },
      });
      if (!inv.ok) return textResult(inv.data ?? { error: 'backlinks_failed' }, true);
      const s = (inv.data as { tasks?: Array<{ result?: Record<string, unknown>[] }> })?.tasks?.[0]
        ?.result?.[0] ?? {};
      return textResult({
        target,
        domainRank: s['rank'] ?? null,
        note: 'DataForSEO rank is 0–1000, not Ahrefs DR',
        backlinks: s['backlinks'] ?? null,
        referringDomains: s['referring_domains'] ?? null,
        referringMainDomains: s['referring_main_domains'] ?? null,
        brokenBacklinks: s['broken_backlinks'] ?? null,
      });
    }

    if (name === 'domain_overview') {
      const target = String(args.target ?? '')
        .trim()
        .replace(/^https?:\/\//, '')
        .replace(/^www\./, '')
        .replace(/\/.*$/, '');
      if (!target) return textResult({ error: 'target_required' }, true);
      const loc = await projectLocale(db, userId, args.site_id ? String(args.site_id) : undefined);
      const inv = await invokeFn('seo-proxy', token, {
        action: 'dataforseo',
        endpoint: '/dataforseo_labs/google/domain_rank_overview/live',
        payload: {
          target,
          location_code: loc.locationCode,
          language_code: loc.languageCode,
        },
      });
      if (!inv.ok) return textResult(inv.data ?? { error: 'domain_overview_failed' }, true);
      const item = dfsFirstItems(inv.data)[0] ?? {};
      const metrics = (item['metrics'] as Record<string, unknown>) ?? {};
      const organic = (metrics['organic'] as Record<string, unknown>) ?? {};
      const paid = (metrics['paid'] as Record<string, unknown>) ?? {};
      return textResult({
        target,
        locale: loc,
        organicKeywords: organic['count'] ?? null,
        organicTraffic: organic['etv'] ?? null,
        organicTrafficValue: organic['estimated_paid_traffic_cost'] ?? null,
        paidKeywords: paid['count'] ?? null,
      });
    }

    if (name === 'generate_article') {
      const topic = String(args.topic ?? '').trim();
      if (!topic) return textResult({ error: 'topic_required' }, true);
      const keyword = args.keyword ? String(args.keyword) : topic;
      const language = args.language ? String(args.language) : 'en';
      const wordCount = Math.min(2500, Math.max(600, Number(args.word_count) || 1200));
      const inv = await invokeFn('seo-proxy', token, {
        action: 'llm',
        model: 'moonshotai/kimi-k2',
        temperature: 0.6,
        max_tokens: Math.min(8192, Math.round(wordCount * 2.2)),
        messages: [
          {
            role: 'system',
            content:
              'You are an expert GEO (Generative Engine Optimization) writer. Produce citable, answer-first articles with clear structure, FAQ, and factual tone. Return Markdown only. ' +
              'CRITICAL FACTUALITY GUARDRAILS (E-E-A-T — never violate): ' +
              '(1) NEVER invent statistics, percentages, dollar amounts, dates, rankings, or any specific numeric claims without a real, verifiable source URL. If you lack a source, use general/qualitative language or omit the number. ' +
              '(2) NEVER attribute claims to specific studies, journals, universities, professional bodies, government agencies, brands, or EU/legal directives (e.g. "studies show", named journals, "Directive 96/8/EC", "The Academy of Nutrition and Dietetics") unless you can provide a real, retrievable URL for that source. Do not fabricate citations or reference titles. ' +
              '(3) Prefer honest, hedged phrasing when certainty is limited (e.g. "may", "often", "in many cases") instead of false precision. ' +
              '(4) NEVER invent legal, regulatory, or normative citations; mention laws or regulations only when you are certain of their existence and official title, otherwise avoid specific references.',
          },
          {
            role: 'user',
            content: `Write a ~${wordCount}-word GEO-optimized article in language "${language}" about: ${topic}.
Primary keyword: ${keyword}.
Requirements:
- Start with a direct 2–4 sentence answer
- Use H2/H3 sections
- Include a short FAQ (3–5 Q&As)
- Mention entities and concrete facts where helpful
- End with a brief "Key takeaways" list
Output Markdown with a # title first.`,
          },
        ],
      });
      if (!inv.ok) return textResult(inv.data ?? { error: 'generate_failed' }, true);
      const content =
        (inv.data as { choices?: Array<{ message?: { content?: string } }> })?.choices?.[0]
          ?.message?.content ?? '';
      const titleMatch = content.match(/^#\s+(.+)$/m);
      return textResult({
        topic,
        keyword,
        language,
        title: titleMatch?.[1]?.trim() ?? topic,
        markdown: content,
      });
    }

    if (name === 'mine_fanouts') {
      const siteId = args.site_id ? String(args.site_id) : '';
      const queryId = args.query_id ? String(args.query_id) : '';
      if (siteId && !(await assertSiteOwned(db, userId, siteId))) {
        return textResult({ error: 'site_not_found' }, true);
      }
      const inv = await invokeFn('visibility-ops', token, {
        action: 'mine_fanouts',
        site_id: siteId || undefined,
        query_id: queryId || undefined,
        dry_run: args.dry_run === true,
        extract: args.extract === true,
      });
      if (!inv.ok) return textResult(inv.data ?? { error: 'mine_fanouts_failed', status: inv.status }, true);
      return textResult(inv.data);
    }

    if (name === 'get_source_gaps') {
      const siteId = String(args.site_id ?? '');
      if (!(await assertSiteOwned(db, userId, siteId))) {
        return textResult({ error: 'site_not_found' }, true);
      }
      const inv = await invokeFn('visibility-ops', token, {
        action: 'get_source_gaps',
        site_id: siteId,
        limit: args.limit,
      });
      if (!inv.ok) return textResult(inv.data ?? { error: 'source_gaps_failed', status: inv.status }, true);
      return textResult(inv.data);
    }

    if (name === 'get_cannibalization') {
      const siteId = String(args.site_id ?? '');
      if (!(await assertSiteOwned(db, userId, siteId))) {
        return textResult({ error: 'site_not_found' }, true);
      }
      const inv = await invokeFn('visibility-ops', token, {
        action: 'get_cannibalization',
        site_id: siteId,
        limit: args.limit,
        days: args.days,
        dry_run: args.dry_run === true,
        refresh: args.refresh === true,
      });
      if (!inv.ok) return textResult(inv.data ?? { error: 'cannibalization_failed', status: inv.status }, true);
      return textResult(inv.data);
    }

    if (name === 'get_link_intersect') {
      const siteId = String(args.site_id ?? '');
      if (!(await assertSiteOwned(db, userId, siteId))) {
        return textResult({ error: 'site_not_found' }, true);
      }
      const inv = await invokeFn('visibility-ops', token, {
        action: 'get_link_intersect',
        site_id: siteId,
        competitor_domain: String(args.competitor_domain ?? ''),
        limit: args.limit,
        dry_run: args.dry_run === true,
        refresh: args.refresh === true,
      });
      if (!inv.ok) return textResult(inv.data ?? { error: 'link_intersect_failed', status: inv.status }, true);
      return textResult(inv.data);
    }

    if (name === 'get_content_gap') {
      const siteId = String(args.site_id ?? '');
      if (!(await assertSiteOwned(db, userId, siteId))) {
        return textResult({ error: 'site_not_found' }, true);
      }
      const inv = await invokeFn('visibility-ops', token, {
        action: 'get_content_gap',
        site_id: siteId,
        competitor_domain: String(args.competitor_domain ?? ''),
        limit: args.limit,
      });
      if (!inv.ok) return textResult(inv.data ?? { error: 'content_gap_failed', status: inv.status }, true);
      return textResult(inv.data);
    }

    if (name === 'get_brand_sentiment') {
      const siteId = String(args.site_id ?? '');
      if (!(await assertSiteOwned(db, userId, siteId))) {
        return textResult({ error: 'site_not_found' }, true);
      }
      const inv = await invokeFn('visibility-ops', token, {
        action: 'get_brand_sentiment',
        site_id: siteId,
        days: args.days,
        dry_run: args.dry_run === true,
        classify: args.classify === true,
      });
      if (!inv.ok) return textResult(inv.data ?? { error: 'brand_sentiment_failed', status: inv.status }, true);
      return textResult(inv.data);
    }

    if (name === 'get_gsc_property') {
      const siteId = String(args.site_id ?? '');
      if (!(await assertSiteOwned(db, userId, siteId))) {
        return textResult({ error: 'site_not_found' }, true);
      }
      // NOTE: deliberately does NOT select or filter `verified`.
      // gsc-connect never writes that column (unlike ga4-connect, which sets verified: true),
      // so `.eq('verified', true)` could never match, and selecting a column that may not exist
      // on this table made PostgREST error -> the handler threw -> clients saw `tool_failed`.
      // A row only exists here after gsc-connect verified the property server-side against the
      // Google API (it returns 403 property_not_accessible otherwise), so presence == verified.
      // This mirrors the GSC read in _shared/reportAssemble.ts, which works in production.
      const { data, error } = await db
        .from('gsc_properties')
        .select('id, project_id, site_url, permission_level, connected_at, connected_by')
        .eq('project_id', siteId)
        .order('connected_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return textResult(data ?? null);
    }

    if (name === 'list_client_reports') {
      const siteId = args.site_id ? String(args.site_id) : null;
      if (siteId && !(await assertSiteOwned(db, userId, siteId))) {
        return textResult({ error: 'site_not_found' }, true);
      }
      const limit = Math.min(50, Math.max(1, Number(args.limit ?? 20) || 20));
      let q = db
        .from('client_reports')
        .select('id, project_id, period_start, period_end, created_at, share_token, sections, data, project:projects(name, website_url)')
        .eq('user_id', userId)
        .order('period_end', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(limit);
      if (siteId) q = q.eq('project_id', siteId);
      const { data, error } = await q;
      if (error) throw error;
      return textResult((data ?? []).map((r) => summarizeClientReport(r as never, appOrigin())));
    }

    if (name === 'get_client_report') {
      const reportId = args.report_id ? String(args.report_id) : null;
      const siteId = args.site_id ? String(args.site_id) : null;
      if (!reportId && !siteId) return textResult({ error: 'report_id_or_site_id_required' }, true);
      // A share-link token or a typo is not an id: say so instead of failing the tool.
      if (reportId && !UUID_RE.test(reportId)) {
        return textResult({ error: 'report_not_found', hint: 'report_id is the "id" returned by list_client_reports' }, true);
      }
      if (siteId && !(await assertSiteOwned(db, userId, siteId))) {
        return textResult({ error: 'site_not_found' }, true);
      }
      let q = db
        .from('client_reports')
        .select('id, project_id, period_start, period_end, created_at, share_token, sections, data, narrative, branding, goals, project:projects(name, website_url)')
        .eq('user_id', userId);
      q = reportId ? q.eq('id', reportId) : q.eq('project_id', siteId as string).order('period_end', { ascending: false }).order('created_at', { ascending: false });
      const { data, error } = await q.limit(1).maybeSingle();
      if (error) throw error;
      if (!data) return textResult({ error: 'report_not_found' }, true);
      return textResult(compactClientReport(data as never, appOrigin()));
    }

    if (name === 'get_gsc_analytics') {
      const siteId = String(args.site_id ?? '');
      if (!(await assertSiteOwned(db, userId, siteId))) {
        return textResult({ error: 'site_not_found' }, true);
      }
      const periodDays = clampGscPeriodDays(args.period_days);
      const { data, error } = await db
        .from('gsc_analytics_cache')
        .select(
          'id, project_id, site_url, period_days, clicks, impressions, ctr, avg_position, top_queries, top_pages, daily_data, fetched_at, fetched_by',
        )
        .eq('project_id', siteId)
        .eq('period_days', periodDays)
        .order('fetched_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return textResult(data ?? null);
    }

    if (name === 'query_gsc_search_analytics' || name === 'inspect_gsc_url' || name === 'list_gsc_sitemaps') {
      const siteId = String(args.site_id ?? '');
      if (!(await assertSiteOwned(db, userId, siteId))) {
        return textResult({ error: 'site_not_found' }, true);
      }
      const live = await gscLiveAccess(db, siteId);
      if (!live.ok) return textResult(live.body, true);
      try {
        if (name === 'query_gsc_search_analytics') {
          const built = buildSearchAnalyticsRequest(args);
          if (!built.ok) return textResult(built, true);
          const rows = await querySearchAnalytics(live.token, live.siteUrl, built.request);
          return textResult({
            site_url: live.siteUrl,
            start_date: built.request.startDate,
            end_date: built.request.endDate,
            search_type: built.request.type,
            dimensions: built.request.dimensions,
            row_count: rows.length,
            more_rows_possible: rows.length === built.request.rowLimit,
            rows: shapeSearchAnalyticsRows(built.request.dimensions, rows),
          });
        }
        if (name === 'inspect_gsc_url') {
          const url = String(args.url ?? '').trim();
          if (!urlInProperty(url, live.siteUrl)) {
            return textResult({ error: 'url_outside_property', message: `The URL must belong to ${live.siteUrl}.` }, true);
          }
          const language = typeof args.language === 'string' && /^[a-z]{2}(-[A-Z]{2})?$/.test(args.language) ? args.language : 'en-US';
          const result = await inspectUrl(live.token, live.siteUrl, url, language);
          return textResult({ site_url: live.siteUrl, url, ...shapeInspection(result) });
        }
        return textResult({ site_url: live.siteUrl, sitemaps: await listSitemaps(live.token, live.siteUrl) });
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        const status = Number(message.match(/^google_(\d{3})/)?.[1] ?? 0);
        if (status === 429) return textResult({ error: 'google_quota', message: 'Google Search Console quota reached for now; try again later.' }, true);
        if (status === 403) return textResult({ error: 'google_forbidden', message: 'The connected Google account can no longer read this property. Reconnect Search Console in Rankdelta.' }, true);
        if (status === 400) return textResult({ error: 'google_rejected', message: 'Google rejected the request; check the dates, filters or URL.' }, true);
        console.error('[mcp] live gsc failed', name, message.slice(0, 200));
        return textResult({ error: 'gsc_unavailable', message: 'Search Console did not answer; try again shortly.' }, true);
      }
    }

    if (name === 'get_ga4_property') {
      const siteId = String(args.site_id ?? '');
      if (!(await assertSiteOwned(db, userId, siteId))) {
        return textResult({ error: 'site_not_found' }, true);
      }
      const { data, error } = await db
        .from('ga4_properties')
        .select('id, project_id, property_id, display_name, permission_level, connected_at, connected_by, verified')
        .eq('project_id', siteId)
        .eq('verified', true)
        .maybeSingle();
      if (error) throw error;
      return textResult(data ?? null);
    }

    if (name === 'get_ga4_analytics') {
      const siteId = String(args.site_id ?? '');
      if (!(await assertSiteOwned(db, userId, siteId))) {
        return textResult({ error: 'site_not_found' }, true);
      }
      const periodDays = clampGa4PeriodDays(args.period_days);
      const { data, error } = await db
        .from('ga4_analytics_cache')
        .select(
          'id, project_id, property_id, period_days, sessions, users, pageviews, bounce_rate, top_pages, top_sources, daily_data, fetched_at, fetched_by',
        )
        .eq('project_id', siteId)
        .eq('period_days', periodDays)
        .order('fetched_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return textResult(data ?? null);
    }

    return textResult({ error: 'unknown_tool', name }, true);
  } catch (e) {
    // Never echo raw PostgREST/upstream messages (table/column/constraint names) to the client.
    console.error(`mcp tool ${name} failed:`, describeError(e));
    return textResult({ error: 'tool_failed', tool: name }, true);
  }
}

function rpcResult(id: JsonRpcId, result: unknown) {
  return { jsonrpc: '2.0', id, result };
}
function rpcError(id: JsonRpcId, code: number, message: string) {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

async function handleRpc(
  msg: { jsonrpc?: string; id?: JsonRpcId; method?: string; params?: Record<string, unknown> },
  userId: string,
  token: string,
  db: Sb,
): Promise<unknown | null> {
  const id = msg.id ?? null;
  const method = msg.method ?? '';

  if (method.startsWith('notifications/')) return null;

  if (method === 'initialize') {
    return rpcResult(id, {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: { tools: {} },
      serverInfo: SERVER_INFO,
    });
  }

  if (method === 'ping') return rpcResult(id, {});

  if (method === 'tools/list') {
    // Tool annotations are required by the Claude Connectors Directory and the ChatGPT App
    // review (every tool needs a human title + read/write hint). Injected here so the single
    // TOOLS source of truth stays terse. readOnlyHint=false for every tool that creates records
    // or can spend metered credits (DataForSEO / LLM via seo-proxy or visibility-ops) — including
    // the opt-in spenders (extract / refresh / classify flags), so a client that gates non-read-only
    // calls behind confirmation never charges the account silently. None are destructive (no tool
    // deletes anything). Keep in sync with the tool descriptions in TOOLS.
    const WRITE_TOOLS = new Set([
      // create records
      'add_site',
      // create records + spend
      'run_visibility_scan',
      'setup_ai_visibility',
      'track_rank',
      'check_ranks',
      // spend on every call (live DataForSEO / LLM)
      'keyword_research',
      'audit_page',
      'backlink_summary',
      'domain_overview',
      'generate_article',
      // free by default, spend when the opt-in flag is set
      'mine_fanouts',
      'get_cannibalization',
      'get_brand_sentiment',
    ]);
    const TITLES: Record<string, string> = {
      search: 'Search sites',
      fetch: 'Fetch site research',
      list_sites: 'List sites',
      add_site: 'Add site',
      get_ai_visibility: 'Get AI visibility',
      list_ai_recommendations: 'List AI recommendations',
      list_engines: 'List AI engines',
      run_visibility_scan: 'Run AI-visibility scan',
      setup_ai_visibility: 'Set up AI visibility',
      list_ranks: 'List tracked ranks',
      track_rank: 'Add keyword to Rank Tracker',
      check_ranks: 'Check ranks',
      keyword_research: 'Keyword research',
      audit_page: 'Audit page',
      backlink_summary: 'Backlink summary',
      domain_overview: 'Domain overview',
      generate_article: 'Generate article draft',
      mine_fanouts: 'Mine AI fan-out questions',
      get_source_gaps: 'Get AI citation source gaps',
      get_cannibalization: 'Get keyword cannibalization',
      get_link_intersect: 'Get backlink intersect',
      get_content_gap: 'Get content gap',
      get_brand_sentiment: 'Get brand sentiment',
      get_gsc_property: 'Get Search Console property',
      get_gsc_analytics: 'Get Search Console analytics',
      query_gsc_search_analytics: 'Query Search Console (live, 16 months)',
      inspect_gsc_url: 'Inspect a URL in Search Console',
      list_gsc_sitemaps: 'List Search Console sitemaps',
      get_ga4_property: 'Get GA4 property',
      get_ga4_analytics: 'Get GA4 analytics',
      list_client_reports: 'List client reports',
      get_client_report: 'Get client report',
    };
    const tools = TOOLS.map((t) => ({
      ...t,
      annotations: {
        title: TITLES[t.name] ?? t.name,
        readOnlyHint: !WRITE_TOOLS.has(t.name),
        destructiveHint: false,
      },
    }));
    return rpcResult(id, { tools });
  }

  if (method === 'tools/call') {
    const params = msg.params ?? {};
    const name = String(params.name ?? '');
    const args = (params.arguments && typeof params.arguments === 'object'
      ? params.arguments
      : {}) as Record<string, unknown>;
    if (!name) return rpcError(id, -32602, 'tool name required');
    const result = await callTool(db, userId, token, name, args);
    return rpcResult(id, result);
  }

  if (method === 'resources/list' || method === 'prompts/list') {
    return rpcResult(id, method === 'resources/list' ? { resources: [] } : { prompts: [] });
  }

  return rpcError(id, -32601, `Method not found: ${method}`);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  const url = new URL(req.url);
  const route = mcpRoutePath(url.pathname);

  // ── OAuth discovery + AS endpoints (Claude Desktop / Cowork / claude.ai) ──
  if (
    route === '/.well-known/oauth-protected-resource' ||
    route === '/.well-known/oauth-protected-resource/mcp'
  ) {
    return json(protectedResourceMetadata());
  }
  if (
    route === '/.well-known/oauth-authorization-server' ||
    route === '/.well-known/openid-configuration'
  ) {
    return json(authorizationServerMetadata());
  }

  if (route === '/register' && req.method === 'POST') {
    let body: Record<string, unknown> = {};
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      return json({ error: 'invalid_request' }, 400);
    }
    const res = await handleRegister(body);
    // Preserve CORS on DCR responses
    const headers = new Headers(res.headers);
    for (const [k, v] of Object.entries(cors)) headers.set(k, v);
    return new Response(res.body, { status: res.status, headers });
  }

  if (route === '/authorize') {
    return handleAuthorize(req, url);
  }

  if (route === '/token' && req.method === 'POST') {
    const ct = req.headers.get('content-type') || '';
    let params: URLSearchParams;
    if (ct.includes('application/x-www-form-urlencoded')) {
      params = new URLSearchParams(await req.text());
    } else if (ct.includes('application/json')) {
      const body = (await req.json()) as Record<string, string>;
      params = new URLSearchParams(body);
    } else {
      params = new URLSearchParams(await req.text());
    }
    const res = await exchangeToken(params, adminClient());
    const headers = new Headers(res.headers);
    for (const [k, v] of Object.entries(cors)) headers.set(k, v);
    headers.set('Content-Type', 'application/json');
    return new Response(res.body, { status: res.status, headers });
  }

  // MCP Streamable HTTP endpoint: /mcp or /
  const isMcpEndpoint = route === '/' || route === '/mcp' || route === '';
  if (!isMcpEndpoint) {
    return json({ error: 'not_found', message: `Unknown path ${route}` }, 404);
  }

  // No SSE stream on GET and no sessions to DELETE. A client that already holds a valid key gets
  // 405 (MCP spec: "server does not offer a stream") and carries on over POST; a 401 here sent
  // key-configured Cursor clients into an endless OAuth discovery/registration loop. Without a
  // valid key, answer with OAuth discovery — Claude probes GET during connector setup.
  if (req.method === 'GET' || req.method === 'DELETE') {
    const presented = extractBearer(req);
    if (presented && (await resolvePersonalApiKey(adminClient(), presented))) {
      return new Response(JSON.stringify({ error: 'method_not_allowed', message: 'Use POST; this server does not offer an SSE stream.' }), {
        status: 405,
        headers: { ...cors, 'Content-Type': 'application/json', Allow: 'POST, OPTIONS', 'MCP-Protocol-Version': PROTOCOL_VERSION },
      });
    }
    return new Response(
      JSON.stringify({
        error: 'unauthorized',
        message: 'Rankdelta MCP requires Authorization: Bearer sk_rankdelta_… (or complete OAuth).',
      }),
      {
        status: 401,
        headers: {
          ...cors,
          'Content-Type': 'application/json',
          'WWW-Authenticate': wwwAuthenticateHeader(),
          'MCP-Protocol-Version': PROTOCOL_VERSION,
        },
      },
    );
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'method_not_allowed' }), {
      status: 405,
      headers: { ...cors, 'Content-Type': 'application/json', Allow: 'POST, GET, OPTIONS' },
    });
  }

  const token = extractBearer(req);
  const db = adminClient();
  const resolved = await resolvePersonalApiKey(db, token);
  if (!resolved) {
    return new Response(
      JSON.stringify({
        error: 'unauthorized',
        message: 'Valid sk_rankdelta_… Bearer key required. Create one in Settings → API & MCP.',
      }),
      {
        status: 401,
        headers: {
          ...cors,
          'Content-Type': 'application/json',
          'WWW-Authenticate': wwwAuthenticateHeader(),
          'MCP-Protocol-Version': PROTOCOL_VERSION,
        },
      },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }

  const messages = Array.isArray(body) ? body : [body];
  const responses: unknown[] = [];
  for (const msg of messages) {
    if (!msg || typeof msg !== 'object') continue;
    const out = await handleRpc(
      msg as { jsonrpc?: string; id?: JsonRpcId; method?: string; params?: Record<string, unknown> },
      resolved.userId,
      token,
      db,
    );
    if (out !== null) responses.push(out);
  }

  if (responses.length === 0) {
    return new Response(null, { status: 202, headers: cors });
  }

  const payload = Array.isArray(body) ? responses : responses[0];
  return json(payload);
});

/** Normalize Supabase/Vercel paths to a short route: /, /authorize, /.well-known/... */
function mcpRoutePath(pathname: string): string {
  let p = pathname || '/';
  const fn = '/functions/v1/mcp';
  if (p.startsWith(fn)) p = p.slice(fn.length) || '/';
  // Branded URL is https://mcp.rankdelta.ai/mcp[...]; unwrap that mount.
  if (p === '/mcp') p = '/';
  else if (p.startsWith('/mcp/')) p = p.slice(4);
  if (!p.startsWith('/')) p = `/${p}`;
  return p.replace(/\/+$/, '') || '/';
}

async function handleAuthorize(req: Request, url: URL): Promise<Response> {
  const db = adminClient();

  if (req.method === 'GET') {
    const clientId = url.searchParams.get('client_id') ?? '';
    const redirectUri = url.searchParams.get('redirect_uri') ?? '';
    const state = url.searchParams.get('state') ?? '';
    const codeChallenge = url.searchParams.get('code_challenge') ?? '';
    const method = url.searchParams.get('code_challenge_method') ?? 'S256';
    const scope = url.searchParams.get('scope') ?? 'mcp:tools';
    const responseType = url.searchParams.get('response_type') ?? 'code';

    let error: string | undefined;
    if (responseType !== 'code') error = 'Only response_type=code is supported.';
    else if (method !== 'S256') error = 'PKCE S256 is required.';
    else if (!clientId || !redirectUri || !codeChallenge) error = 'Missing OAuth parameters.';
    else if (!(await isRedirectAllowedForClient(clientId, redirectUri))) error = 'redirect_uri is not allowed.';

    const dest = new URL(AUTHORIZE_UI_URL);
    for (const [k, v] of url.searchParams.entries()) dest.searchParams.set(k, v);
    if (error) dest.searchParams.set('error', error);
    return Response.redirect(dest.toString(), 302);
  }

  if (req.method !== 'POST') {
    return json({ error: 'method_not_allowed' }, 405);
  }

  const form = await req.formData();
  const apiKey = String(form.get('api_key') ?? '');
  const clientId = String(form.get('client_id') ?? '');
  const redirectUri = String(form.get('redirect_uri') ?? '');
  const state = String(form.get('state') ?? '');
  const codeChallenge = String(form.get('code_challenge') ?? '');
  const scope = String(form.get('scope') ?? 'mcp:tools');

  const fail = (msg: string) =>
    new Response(
      authorizeHtml({ error: msg, clientId, redirectUri, state, codeChallenge, scope }),
      { status: 400, headers: { 'Content-Type': 'text/html; charset=utf-8', ...cors } },
    );

  if (!codeChallenge || !clientId) return fail('Missing OAuth parameters.');
  if (!(await isRedirectAllowedForClient(clientId, redirectUri))) return fail('redirect_uri is not allowed.');
  if (!/^[A-Za-z0-9_-]{43,128}$/.test(codeChallenge)) return fail('Invalid code_challenge.');

  const valid = await validateApiKeyForAuthorize(db, apiKey);
  if (!valid) {
    return fail('Invalid or revoked API key. Create one in Settings → API & MCP.');
  }

  const code = await mintAuthCode({
    apiKey: apiKey.trim(),
    userId: valid.userId,
    clientId,
    redirectUri,
    codeChallenge,
  });

  const dest = new URL(redirectUri);
  dest.searchParams.set('code', code);
  if (state) dest.searchParams.set('state', state);
  return Response.redirect(dest.toString(), 302);
}
