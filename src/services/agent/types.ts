/**
 * Shared types for the Rankdelta autonomous agent pipeline.
 *
 * Pipeline flow:
 *   AUDIT → PLAN → RESEARCH → WRITE → PUBLISH → MONITOR
 *
 * Each stage is an independent agent that can be retried or skipped.
 */

export type AgentStage =
  | 'audit'
  | 'plan'
  | 'research'
  | 'write'
  | 'publish'
  | 'monitor'

export type AgentRunStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'awaiting_approval'

export interface AgentRun {
  id: string
  projectId: string
  stage: AgentStage
  status: AgentRunStatus
  input: Record<string, unknown>
  output: Record<string, unknown> | null
  errorMessage: string | null
  startedAt: string | null
  completedAt: string | null
  costCents: number
  createdAt: string
}

// ─── AUDIT ───────────────────────────────────────────────────────────────────

export interface SiteAuditResult {
  siteUrl: string
  totalPages: number
  indexedUrls: string[]
  existingTopics: string[]
  contentGaps: ContentGap[]
  technicalIssues: TechnicalIssue[]
  competitors: string[]
  language: string
  niche: string
  auditedAt: string
}

export interface ContentGap {
  keyword: string
  estimatedVolume: number
  difficulty: number
  intent: 'informational' | 'commercial' | 'transactional' | 'navigational'
  priority: 'high' | 'medium' | 'low'
  rationale: string
}

export interface TechnicalIssue {
  type: 'missing_meta' | 'slow_page' | 'no_schema' | 'thin_content' | 'duplicate_title'
  url: string
  description: string
  severity: 'critical' | 'warning' | 'info'
}

// ─── PLAN ─────────────────────────────────────────────────────────────────────

export interface ContentPlanItem {
  id: string
  projectId: string
  keyword: string
  title: string
  slug: string
  intent: ContentGap['intent']
  estimatedVolume: number
  difficulty: number
  scheduledFor: string // ISO date
  status: 'planned' | 'in_progress' | 'completed' | 'failed'
  wpPostId: number | null
  wpPostUrl: string | null
}

// ─── RESEARCH ────────────────────────────────────────────────────────────────

export interface ResearchResult {
  keyword: string
  serpTopUrls: string[]
  peopleAlsoAsk: string[]
  relatedKeywords: string[]
  internalLinks: InternalLink[]
  externalSources: ExternalSource[]
  competitorWordCounts: number[]
  /** H2/H3 headings scraped from the top SERP pages — the real heading-level coverage to match/beat. */
  competitorHeadings: string[]
  recommendedWordCount: number
}

export interface InternalLink {
  url: string
  anchorText: string
  relevanceScore: number
}

export interface ExternalSource {
  url: string
  title: string
  snippet: string
  domain: string
  isAuthoritative: boolean // .edu, .gov, PubMed, etc.
}

// ─── WRITE ────────────────────────────────────────────────────────────────────

export interface ArticleContent {
  title: string
  slug: string
  metaTitle: string
  metaDescription: string
  focusKeyword: string
  gutenbergContent: string  // full WP Gutenberg block HTML
  wordCount: number
  seoScore: number
  geoScore: number
  language: string
  authorLine: string
  imageSearchTerms: string[] // for Pexels search
  /** URL of the featured/hero image (Pexels). Used as WP featured_media on publish. */
  featuredImageUrl?: string
  /** Attribution for the featured image (photographer name + profile URL). */
  featuredImageCredit?: { name: string; url: string }
}

// ─── PUBLISH ─────────────────────────────────────────────────────────────────

export interface PexelsImage {
  id: number
  url: string
  photographer: string
  photographerUrl: string
  altText: string
  wpMediaId?: number
}

export interface PublishResult {
  wpPostId: number
  wpPostUrl: string
  publishedAt: string
  featuredImageUrl: string
  imagesUploaded: number
}

// ─── MONITOR ─────────────────────────────────────────────────────────────────

export interface MonitoringSnapshot {
  snapshotAt: string
  rankPositions: Record<string, number | null>   // keyword → current position
  geoMentions: number                            // count of AI citations found
  siteHealth: {
    isReachable: boolean
    hasSSL: boolean
    loadTimeMs?: number
  }
}

export interface GeoMention {
  keyword: string
  platform: 'chatgpt' | 'perplexity' | 'gemini' | 'google_ai' | 'claude'
  url: string | null
  sentiment: 'positive' | 'neutral' | 'negative'
  mentionCount: number
}

export interface RankingKeyword {
  keyword: string
  position: number
  previousPosition: number | null
  url: string
  searchVolume: number
}

// ─── PIPELINE CONTEXT ────────────────────────────────────────────────────────

/** Passed between stages so each agent has full context */
export interface PipelineContext {
  projectId: string
  siteUrl: string
  siteLanguage: string
  siteNiche: string
  wpConnection: {
    username: string
    appPassword: string
  }
  audit: SiteAuditResult | null
  plan: ContentPlanItem | null
  research: ResearchResult | null
  article: ArticleContent | null
  publishResult: PublishResult | null
}

// ─── OWNER-FACING SUMMARY ────────────────────────────────────────────────────

/** What the non-technical owner sees */
export interface OwnerDashboard {
  projectId: string
  siteName: string
  siteUrl: string
  seoScore: number        // 0-100, was N/A → now X
  geoScore: number        // 0-100
  monthlyProgress: {
    articlesPublished: number
    articlesPlanned: number
    geoMentionsTotal: number
    geoMentionsDelta: number   // vs last month
    topKeywordPosition: number
  }
  recentActivity: ActivityItem[]
  nextScheduled: string | null // ISO date of next planned article
  status: 'healthy' | 'working' | 'needs_attention'
}

export interface ActivityItem {
  type:
    | 'article_published'
    | 'geo_mention'
    | 'ranking_improved'
    | 'ranking_dropped'
    | 'audit_completed'
    | 'plan_created'
    | 'site_health'
    | 'error'
  description: string
  url?: string
  timestamp?: string     // ISO — optional since agent_activity uses created_at
  metadata?: Record<string, unknown>
}
