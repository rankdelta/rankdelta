/**
 * Database Type Definitions
 * 
 * TypeScript types for Supabase database tables.
 * These types ensure type safety when working with database queries.
 */

import type { ContentLanguage } from '../lib/contentLanguages';

export type WorkspaceMarket =
	| 'IT'
	| 'US'
	| 'DE'
	| 'FR'
	| 'ES'
	| 'PT'
	| 'GB'
	| 'CA'
	| 'AU'
	| 'IE'
	| 'IN'
	| 'MX'
	| 'AR'
	| 'CO'
	| 'BR'
	| 'AT'
	| 'CH'
	| 'BE'
	| 'global';
export type WorkspaceVertical = 'saas' | 'ecommerce' | 'other';
/** E-commerce store stack — informs GEO prompt generation */
export type StorePlatform = 'shopify' | 'woocommerce' | 'custom' | 'marketplace' | 'other';
export type RefreshCadence = 'weekly' | 'every_3_days' | 'daily';

export interface Project {
	id: string;
	user_id: string;
	name: string;
	website_url: string | null;
	primary_keyword: string | null;
	main_topic: string | null;
	tone: string;
	content_length: number;
	language: string;
	// Author profile for E-E-A-T and GEO optimization
	author_name: string | null;
	author_bio: string | null;
	author_expertise: string | null;
	// Metadata for additional project settings
	metadata: Record<string, unknown> | null;
	/** Visibility tracker: UI + LLM language */
	primary_language?: ContentLanguage | null;
	market?: WorkspaceMarket | null;
	vertical?: WorkspaceVertical | null;
	refresh_cadence?: RefreshCadence | null;
	/** When true, server cron may run active visibility queries per refresh_cadence */
	visibility_schedule_enabled?: boolean | null;
	/** UTC: last completed automated cron batch for this project */
	visibility_scheduled_last_at?: string | null;
	/** UTC lock while a scheduled visibility batch is running */
	visibility_scan_lock_at?: string | null;
	seed_keywords?: unknown;
	monthly_api_spend_cap_cents?: number | null;
	api_spend_cents_period?: number | null;
	api_spend_period_start?: string | null;
	/** E-commerce: Shopify, WooCommerce, etc. */
	store_platform?: StorePlatform | string | null;
	/** Free-text: categories, hero products, collections */
	catalog_notes?: string | null;
	created_at: string;
	updated_at: string;
}

export type QueryIntentType = 'brand' | 'category' | 'comparison' | 'use_case' | 'problem';
export type LlmProviderKey = 'chatgpt' | 'perplexity' | 'gemini' | 'google_aio' | 'grok';

export interface TrackedBrand {
	id: string;
	project_id: string;
	name: string;
	domain: string | null;
	aliases: string[];
	created_at: string;
	updated_at: string;
}

export interface CompetitorBrand {
	id: string;
	project_id: string;
	name: string;
	domain: string | null;
	aliases: string[];
	created_at: string;
	updated_at: string;
}

export interface VisibilityQueryRow {
	id: string;
	project_id: string;
	text: string;
	language: string;
	intent_type: QueryIntentType;
	vertical: WorkspaceVertical | null;
	is_auto_generated: boolean;
	is_active: boolean;
	created_at: string;
	updated_at: string;
}

export interface VisibilityQueryRunRow {
	id: string;
	query_id: string;
	provider: LlmProviderKey;
	status: string;
	raw_response: Record<string, unknown> | null;
	cited_sources: unknown;
	mentioned_brands: unknown;
	answer_text: string | null;
	run_at: string;
	cost_cents: number;
	cost_usd: number | null;
	error_message: string | null;
	dataforseo_platform: string | null;
	created_at: string;
}

export type MentionSentiment = 'positive' | 'neutral' | 'negative';

export type FanoutSource =
	| 'people_also_ask'
	| 'related_searches'
	| 'people_also_search'
	| 'ai_overview_related'
	| 'answer_explicit'
	| 'llm_extract';

/** Sub-questions mined from stored visibility answers (table fanout_queries). */
export interface FanoutQueryRow {
	id: string;
	query_id: string;
	engine: LlmProviderKey | string;
	question: string;
	source: FanoutSource;
	created_at: string;
}

export interface VisibilityBrandMentionRow {
	id: string;
	query_run_id: string;
	tracked_brand_id: string | null;
	competitor_brand_id: string | null;
	brand_name: string | null;
	mention_position: number | null;
	sentiment: MentionSentiment | null;
	is_recommended: boolean;
	created_at: string;
}

export interface VisibilityCitationRow {
	id: string;
	query_run_id: string;
	source_url: string | null;
	source_domain: string | null;
	rank_in_answer: number | null;
	snippet: string | null;
	created_at: string;
}

export interface VisibilityApiSpendEvent {
	id: string;
	project_id: string;
	user_id: string;
	provider: LlmProviderKey | null;
	action: string;
	cost_cents: number;
	cost_usd: number | null;
	metadata: Record<string, unknown> | null;
	created_at: string;
}

/** Google organic rank checks (DataForSEO SERP) */
export interface SerpRankKeywordRow {
	id: string;
	project_id: string;
	phrase: string;
	is_active: boolean;
	created_at: string;
	updated_at: string;
}

export interface SerpRankSnapshotRow {
	id: string;
	keyword_id: string;
	rank_absolute: number | null;
	ranking_url: string | null;
	result_title: string | null;
	serp_organic_count: number;
	cost_usd: number | null;
	raw_response: Record<string, unknown> | null;
	status: string;
	error_message: string | null;
	checked_at: string;
}

export interface SerpRankCheckJobRow {
	id: string;
	project_id: string;
	user_id: string;
	status: 'pending' | 'running' | 'completed' | 'failed' | 'partial';
	keyword_ids: string[];
	completed_ids: string[];
	failed: Record<string, string>;
	attempts: number;
	max_attempts: number;
	error_message: string | null;
	created_at: string;
	updated_at: string;
	started_at: string | null;
	completed_at: string | null;
}

/** Shared cache of referring-domain rows persisted from already-paid DataForSEO backlink calls. */
export interface BacklinkReferringDomainRow {
	id: string;
	target_domain: string;
	referring_domain: string;
	referring_rank: number | null;
	links_to_target: number | null;
	sample_target_urls: string[];
	source_endpoint: string | null;
	fetched_at: string;
}

/** Cached cheap-LLM sentiment of stored AI answers (table visibility_brand_sentiment). */
export interface VisibilityBrandSentimentRow {
	id: string;
	query_run_id: string;
	engine: string;
	brand_name: string;
	sentiment: MentionSentiment;
	accuracy: number;
	model: string | null;
	cost_usd: number | null;
	created_at: string;
}

export interface Keyword {
	id: string;
	project_id: string;
	keyword: string;
	search_volume: number | null;
	difficulty: number | null;
	cluster_id: string | null;
	created_at: string;
}

export interface Cluster {
	id: string;
	project_id: string;
	cluster_name: string;
	keywords_list: string[];
	content_gaps: Record<string, unknown> | null;
	visualization_data: Record<string, unknown> | null;
	created_at: string;
}

export interface Content {
	id: string;
	project_id: string;
	title: string;
	slug: string | null;
	body: string;
	metadata: Record<string, unknown> | null;
	topic: string | null;
	keywords_used: string[] | null;
	seo_score: number | null;
	readability_score: number | null;
	status: 'draft' | 'generated' | 'published' | 'archived';
	generated_date: string;
	published_date: string | null;
	updated_at: string;
}

export interface Revision {
	id: string;
	content_id: string;
	original_body: string;
	updated_body: string;
	changes: Record<string, unknown> | null;
	created_at: string;
}

export interface ApiLog {
	id: string;
	user_id: string;
	action: string;
	tokens_used: number | null;
	cost_usd: number | null;
	created_at: string;
}

export interface Ranking {
	id: string;
	project_id: string;
	keyword: string;
	position: number | null;
	url: string | null;
	title: string | null;
	search_volume: number | null;
	difficulty: number | null;
	previous_position: number | null;
	change: number;
	location_code: number;
	language_code: string;
	checked_at: string;
	created_at: string;
}

export interface RankingHistory {
	id: string;
	ranking_id: string;
	position: number | null;
	url: string | null;
	checked_at: string;
}

// Re-export subscription types for convenience
export type { 
	Subscription, 
	CreditBalance, 
	CreditTransaction,
	PlanConfiguration,
	CreditCost,
	SubscriptionPlan,
	SubscriptionStatus,
	CreditTransactionType,
} from './subscription';

