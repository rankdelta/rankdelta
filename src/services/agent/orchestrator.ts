/**
 * Agent Orchestrator — Master coordinator of the SEO/GEO pipeline.
 *
 * This is the "brain" that:
 *   1. Reads the project state from Supabase
 *   2. Decides what to do next (audit / plan / write / publish / monitor)
 *   3. Runs each stage in sequence
 *   4. Persists progress so each stage can be retried independently
 *   5. Notifies the owner of progress via simple status updates
 *
 * Designed to run both:
 *   a) On-demand (triggered by owner clicking "Start")
 *   b) On schedule (weekly cron via Supabase pg_cron)
 *
 * Cost tracking: every agent run records token usage and cost in EUR cents.
 */

import { supabase } from '../../lib/supabaseClient'
import { runAuditAgent, resolveAutopilotLanguage, type AuditLocaleContext } from './auditAgent'
import { runResearchAgent } from './researchAgent'
import { runWritingAgent } from './writingAgent'
import { runPublishingAgent } from './publishingAgent'
import { finalizeArticle } from './contentFinalizer'
import { getProjectMoneyPages, rankMoneyPagesForKeyword, boostMoneyPagesIntoResearch, ensureMoneyPageLink } from '../moneyPages'
import { completeGuideTitle } from '../../lib/contentLanguages'
import type {
  AgentRun,
  AgentStage,
  ContentPlanItem,
  PublishResult,
  SiteAuditResult,
} from './types'
import type { WPSiteInfo } from '../wordpress'

// ─── SUPABASE HELPERS ────────────────────────────────────────────────────────

async function createAgentRun(
  projectId: string,
  stage: AgentStage,
  input: Record<string, unknown>
): Promise<string> {
  const { data, error } = await supabase
    .from('agent_runs')
    .insert({
      project_id: projectId,
      stage,
      status: 'running',
      input,
      started_at: new Date().toISOString(),
    })
    .select('id')
    .single()

  if (error) throw new Error(`Failed to create agent run: ${error.message}`)
  return data.id
}

async function completeAgentRun(
  runId: string,
  output: Record<string, unknown>,
  costCents = 0
): Promise<void> {
  await supabase
    .from('agent_runs')
    .update({
      status: 'completed',
      output,
      completed_at: new Date().toISOString(),
      cost_cents: costCents,
    })
    .eq('id', runId)
}

async function failAgentRun(runId: string, errorMessage: string): Promise<void> {
  await supabase
    .from('agent_runs')
    .update({
      status: 'failed',
      error_message: errorMessage,
      completed_at: new Date().toISOString(),
    })
    .eq('id', runId)
}

/**
 * Non-secret connection info only. `app_password` is column-locked for browser clients
 * (migration 027): `select('*')` would fail with 42501, and publishing runs server-side
 * (wp-publish edge function) so the browser never needs the password.
 */
async function getWPConnection(
  projectId: string
): Promise<(WPSiteInfo & { siteLanguage: string | null }) | null> {
  const { data } = await supabase
    .from('wp_connections')
    .select('id, site_url, username, verified, site_language')
    .eq('project_id', projectId)
    .maybeSingle()

  if (!data) return null

  return {
    id: data.id,
    siteUrl: data.site_url,
    username: data.username,
    siteLanguage: data.site_language ?? null,
  }
}

/** Project language + market: fallbacks for the article language and the keyword-volume locale. */
async function getProjectLocale(projectId: string): Promise<{ language: string | null; market: string | null }> {
  const { data } = await supabase
    .from('projects')
    .select('language, market')
    .eq('id', projectId)
    .maybeSingle()
  return { language: data?.language ?? null, market: data?.market ?? null }
}

async function getOrCreateSiteAudit(
  projectId: string,
  wpConnection: WPSiteInfo,
  locale: AuditLocaleContext
): Promise<SiteAuditResult> {
  // Check if we have a recent audit (< 7 days old)
  const { data: existing } = await supabase
    .from('site_audits')
    .select('*')
    .eq('project_id', projectId)
    .order('audited_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (existing) {
    const auditAge =
      Date.now() - new Date(existing.audited_at).getTime()
    const sevenDays = 7 * 24 * 60 * 60 * 1000
    if (auditAge < sevenDays) {
      // Re-resolve the language on cached audits: older audits stored the LLM's guess
      // (defaulting to 'it'), which must not outrank the site's own language.
      const cached = existing.result as SiteAuditResult
      return {
        ...cached,
        language: await resolveAutopilotLanguage(wpConnection.siteUrl, locale, cached.language),
      }
    }
  }

  // Run fresh audit
  const audit = await runAuditAgent(wpConnection, projectId, locale)

  const { error: upsertError } = await supabase.from('site_audits').upsert(
    {
      project_id: projectId,
      result: audit,
      audited_at: audit.auditedAt,
    },
    { onConflict: 'project_id' }
  )
  if (upsertError) throw new Error(`Failed to save site audit: ${upsertError.message}`)

  return audit
}

async function getNextContentPlanItem(
  projectId: string
): Promise<ContentPlanItem | null> {
  const { data } = await supabase
    .from('content_plan')
    .select('*')
    .eq('project_id', projectId)
    .eq('status', 'planned')
    .order('scheduled_for', { ascending: true })
    .limit(1)
    .maybeSingle()

  return (data as ContentPlanItem | null) ?? null
}

/**
 * Atomically claim the next planned item (planned → in_progress, conditional on the row still
 * being 'planned'). Two overlapping runs (double click, two tabs) can read the same item; only
 * the one whose conditional update actually changed the row gets to write and publish it.
 */
async function claimNextContentPlanItem(projectId: string): Promise<ContentPlanItem | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const next = await getNextContentPlanItem(projectId)
    if (!next) return null
    const { data, error } = await supabase
      .from('content_plan')
      .update({ status: 'in_progress' })
      .eq('id', next.id)
      .eq('status', 'planned')
      .select('id')
    if (error) throw new Error(`Failed to claim content plan item: ${error.message}`)
    if (data && data.length > 0) return next
    // Someone else claimed it between the read and the update: try the next one.
  }
  return null
}

/** content_plan columns (snake_case): camelCase keys are rejected by PostgREST and the update is lost. */
type ContentPlanRowUpdate = Partial<{
  status: ContentPlanItem['status']
  wp_post_id: number | null
  wp_post_url: string | null
  word_count: number
  seo_score: number
  geo_score: number
}>

async function updateContentPlanItem(itemId: string, updates: ContentPlanRowUpdate): Promise<void> {
  const { error } = await supabase.from('content_plan').update(updates).eq('id', itemId)
  if (error) console.error('[Orchestrator] content_plan update failed:', error.message)
}

// ─── PLAN GENERATION ─────────────────────────────────────────────────────────

async function generateContentPlan(
  projectId: string,
  audit: SiteAuditResult,
  articlesPerMonth: number
): Promise<void> {
  // Check if we already have a plan
  const { data: existingPlan } = await supabase
    .from('content_plan')
    .select('id')
    .eq('project_id', projectId)
    .in('status', ['planned', 'in_progress'])
    .limit(1)

  if (existingPlan && existingPlan.length > 0) return

  // Create plan from top content gaps
  const topGaps = audit.contentGaps.slice(0, articlesPerMonth)
  const now = new Date()

  const planItems = topGaps.map((gap, i) => {
    const scheduledFor = new Date(now)
    scheduledFor.setDate(now.getDate() + i * Math.floor(30 / articlesPerMonth))

    const slug = gap.keyword
      .toLowerCase()
      .replace(/[àáâãäå]/g, 'a')
      .replace(/[èéêë]/g, 'e')
      .replace(/[ìíîï]/g, 'i')
      .replace(/[òóôõö]/g, 'o')
      .replace(/[ùúûü]/g, 'u')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')

    return {
      project_id: projectId,
      keyword: gap.keyword,
      title: completeGuideTitle(gap.keyword, audit.language, now.getFullYear()),
      slug,
      intent: gap.intent,
      estimated_volume: gap.estimatedVolume,
      difficulty: gap.difficulty,
      scheduled_for: scheduledFor.toISOString(),
      status: 'planned',
      wp_post_id: null,
      wp_post_url: null,
    }
  })

  await supabase.from('content_plan').insert(planItems)
}

// ─── MAIN ORCHESTRATOR ───────────────────────────────────────────────────────

/**
 * Trust dial — how much autonomy the owner grants the agent:
 *   'manual' → agent always creates DRAFTS; the owner reviews & publishes
 *   'review' → auto-publish LIVE when the article passes the QA gate, draft when it fails (DEFAULT).
 *              The UI labels it "Quality gate": it does NOT wait for a human review.
 *   'auto'   → same publish rule as 'review'. No scheduler reads it yet (the level lives in
 *              localStorage), so today it behaves exactly like 'review'.
 */
export type AutonomyLevel = 'manual' | 'review' | 'auto'

export interface OrchestratorOptions {
  projectId: string
  articlesPerMonth?: number
  targetWordCount?: number
  ctaHtml?: string
  siteName: string
  authorLine?: string
  autonomy?: AutonomyLevel
}

export interface OrchestratorResult {
  success: boolean
  stage: AgentStage | 'complete'
  message: string
  publishedUrl?: string
  costCents: number
}

/**
 * Run the full pipeline for one content item.
 * Designed to be called once per scheduled article.
 */
export async function runPipeline(
  options: OrchestratorOptions
): Promise<OrchestratorResult> {
  const {
    projectId,
    articlesPerMonth = 4,
    targetWordCount = 3000,
    ctaHtml,
    siteName,
    authorLine,
    autonomy = 'review',
  } = options

  let totalCostCents = 0
  let runId: string | null = null
  let planItemId: string | null = null
  // Once the wp-publish call starts, WordPress may hold the post even if the call errors
  // client-side (timeout, dropped connection): the item must then never go back to 'planned'.
  let publishAttempted = false
  let publishResult: PublishResult | null = null

  try {
    // ── 1. GET WP CONNECTION ──────────────────────────────────────────────────
    const wpConnection = await getWPConnection(projectId)
    if (!wpConnection) {
      return {
        success: false,
        stage: 'audit',
        message: 'Nessuna connessione WordPress configurata per questo progetto.',
        costCents: 0,
      }
    }

    // ── 2. AUDIT ──────────────────────────────────────────────────────────────
    const project = await getProjectLocale(projectId)
    const locale: AuditLocaleContext = {
      siteLanguage: wpConnection.siteLanguage,
      projectLanguage: project.language,
      projectMarket: project.market,
    }
    runId = await createAgentRun(projectId, 'audit', { siteUrl: wpConnection.siteUrl })
    const audit = await getOrCreateSiteAudit(projectId, wpConnection, locale)
    await completeAgentRun(runId, audit as unknown as Record<string, unknown>)

    // ── 3. PLAN ───────────────────────────────────────────────────────────────
    runId = await createAgentRun(projectId, 'plan', { articlesPerMonth })
    await generateContentPlan(projectId, audit, articlesPerMonth)
    await completeAgentRun(runId, { generated: true })

    // ── 4. GET NEXT ARTICLE TO WRITE ─────────────────────────────────────────
    const planItem = await claimNextContentPlanItem(projectId)
    if (!planItem) {
      return {
        success: true,
        stage: 'complete',
        message: 'Piano contenuti completato. Nessun articolo da scrivere oggi.',
        costCents: totalCostCents,
      }
    }

    planItemId = planItem.id

    // ── 5. RESEARCH ───────────────────────────────────────────────────────────
    runId = await createAgentRun(projectId, 'research', { keyword: planItem.keyword })
    const research = await runResearchAgent(
      planItem.keyword,
      wpConnection.siteUrl,
      wpConnection,
      audit.language
    )
    await completeAgentRun(runId, research as unknown as Record<string, unknown>, 15)
    totalCostCents += 15

    // Money pages — same mechanic as the standalone path: dedicated prompt section +
    // internal-link backstop + deterministic guarantee post-finalize. Read from
    // projects.metadata directly: this pipeline also runs scheduled/headless, so it
    // can't rely on the UI passing them in.
    const moneyPages = await getProjectMoneyPages(projectId)
    const rankedMoney = rankMoneyPagesForKeyword(moneyPages, planItem.keyword)
    boostMoneyPagesIntoResearch(research, rankedMoney)

    // ── 6. WRITE ──────────────────────────────────────────────────────────────
    runId = await createAgentRun(projectId, 'write', { keyword: planItem.keyword, targetWordCount })
    const article = await runWritingAgent(planItem.keyword, research, audit, {
      siteName,
      siteUrl: wpConnection.siteUrl,
      niche: audit.niche,
      language: audit.language,
      targetWordCount,
      ctaHtml,
      authorLine,
      moneyPages,
    })
    // ~4000 output tokens × $2.50/1M × 0.90 EUR/USD = ~$0.009 ≈ 1 cent
    await completeAgentRun(runId, article as unknown as Record<string, unknown>, 3)
    totalCostCents += 3

    // ── 6b. FINALIZE — quality gate (validate + schema + infographics) ─────────
    const finalize = await finalizeArticle(article, research, {
      siteName,
      siteUrl: wpConnection.siteUrl,
      niche: audit.niche,
      targetWordCount,
      publishDateIso: new Date().toISOString(),
      isPillar: targetWordCount >= 3000,
    })
    // Money-page guarantee: if the model skipped the commercial link, insert it deterministically.
    const contentWithMoney = rankedMoney.length > 0
      ? ensureMoneyPageLink(finalize.content, rankedMoney, audit.language)
      : finalize.content
    const finalArticle = {
      ...article,
      gutenbergContent: contentWithMoney,
      seoScore: finalize.validation.seoScore,
      geoScore: finalize.validation.geoScore,
    }
    const qaPassed = finalize.validation.passed
    if (!qaPassed) {
      const errs = finalize.validation.issues
        .filter((i) => i.severity === 'error')
        .map((i) => i.message)
        .join('; ')
      console.warn(`[Orchestrator] QA gate failed. Issues: ${errs}`)
    }

    // ── 7. PUBLISH ────────────────────────────────────────────────────────────
    // Trust dial decides the final status: 'manual' always drafts; otherwise the
    // QA gate decides (pass → publish, fail → draft for human review).
    const publishStatus: 'publish' | 'draft' =
      autonomy === 'manual' ? 'draft' : qaPassed ? 'publish' : 'draft'
    const wasPublished = publishStatus === 'publish'

    runId = await createAgentRun(projectId, 'publish', {
      title: finalArticle.title,
      autonomy,
      qaPassed,
      publishStatus,
      seoScore: finalArticle.seoScore,
      geoScore: finalArticle.geoScore,
    })
    publishAttempted = true
    const published = await runPublishingAgent(
      projectId,
      finalArticle,
      { status: publishStatus }
    )
    publishResult = published
    await completeAgentRun(runId, {
      ...published,
      status: wasPublished ? 'published' : 'draft',
      validationIssues: finalize.validation.issues,
    } as unknown as Record<string, unknown>)

    // ── 8. UPDATE PLAN ITEM ───────────────────────────────────────────────────
    await updateContentPlanItem(planItem.id, {
      status: 'completed',
      wp_post_id: published.wpPostId,
      wp_post_url: published.wpPostUrl,
      word_count: finalArticle.wordCount,
      seo_score: finalArticle.seoScore,
      geo_score: finalArticle.geoScore,
    })

    // ── 9. LOG ACTIVITY ───────────────────────────────────────────────────────
    const activityDesc = wasPublished
      ? `Articolo pubblicato: "${finalArticle.title}"`
      : qaPassed
        ? `Bozza pronta per la tua revisione: "${finalArticle.title}"`
        : `Bozza creata (da revisionare): "${finalArticle.title}" — non ha superato il controllo qualità GEO`
    await supabase.from('agent_activity').insert({
      project_id: projectId,
      type: wasPublished ? 'article_published' : qaPassed ? 'plan_created' : 'error',
      description: activityDesc,
      url: published.wpPostUrl,
      metadata: {
        wordCount: finalArticle.wordCount,
        seoScore: finalArticle.seoScore,
        geoScore: finalArticle.geoScore,
        imagesUploaded: published.imagesUploaded,
        infographics: finalize.addedInfographics,
        qaPassed,
        autonomy,
        status: publishStatus,
        costCents: totalCostCents,
      },
    })

    return {
      success: true,
      stage: 'publish',
      message: wasPublished
        ? `✅ Articolo pubblicato: "${finalArticle.title}" (${finalArticle.wordCount} parole, SEO ${finalArticle.seoScore}/100, GEO ${finalArticle.geoScore}/100)`
        : qaPassed
          ? `📝 Bozza pronta per la tua revisione: "${finalArticle.title}" (autonomia: manuale).`
          : `📝 Bozza creata per revisione: "${finalArticle.title}" — non ha superato il controllo qualità (SEO ${finalArticle.seoScore}/100, GEO ${finalArticle.geoScore}/100).`,
      publishedUrl: published.wpPostUrl,
      costCents: totalCostCents,
    }
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error)
    console.error('[Orchestrator] Pipeline failed:', errMsg)

    if (runId) {
      await failAgentRun(runId, errMsg).catch(() => {})
    }

    if (planItemId) {
      const done = publishResult as PublishResult | null
      if (done) {
        // The post exists on WordPress: record it, never re-queue it.
        await updateContentPlanItem(planItemId, {
          status: 'completed',
          wp_post_id: done.wpPostId,
          wp_post_url: done.wpPostUrl,
        }).catch(() => {})
      } else if (publishAttempted) {
        // The wp-publish call errored, but WordPress may already have created the post (e.g. the
        // request timed out after the insert). Re-queuing it as 'planned' would post it a second
        // time on the next run. content_plan.status is CHECK-constrained to
        // planned|in_progress|completed|failed, so park it as 'failed' for a human to check.
        await updateContentPlanItem(planItemId, { status: 'failed' }).catch(() => {})
        await supabase
          .from('agent_activity')
          .insert({
            project_id: projectId,
            type: 'error',
            description: `Publishing may have failed after WordPress received the post: check WordPress before retrying. (${errMsg})`,
            metadata: { planItemId, publishUnknown: true },
          })
          .then(
            () => undefined,
            () => undefined
          )
      } else {
        // Failed before anything reached WordPress: release the item so the next run can retry
        // it (otherwise it stays 'in_progress' forever and the pipeline is dead).
        await updateContentPlanItem(planItemId, { status: 'planned' }).catch(() => {})
      }
    }

    return {
      success: false,
      stage: 'write',
      message: `❌ Pipeline fallita: ${errMsg}`,
      costCents: totalCostCents,
    }
  }
}

/**
 * Get the current status of the pipeline for a project.
 * Used by the owner dashboard to show progress.
 */
export async function getPipelineStatus(projectId: string): Promise<{
  lastRun: AgentRun | null
  recentRuns: AgentRun[]
  nextScheduled: string | null
  totalCostThisMonth: number
}> {
  const startOfMonth = new Date()
  startOfMonth.setDate(1)
  startOfMonth.setHours(0, 0, 0, 0)

  const [{ data: recentRuns }, { data: nextItem }, { data: costData }] =
    await Promise.all([
      supabase
        .from('agent_runs')
        .select('*')
        .eq('project_id', projectId)
        .order('created_at', { ascending: false })
        .limit(20),
      supabase
        .from('content_plan')
        .select('scheduled_for')
        .eq('project_id', projectId)
        .eq('status', 'planned')
        .order('scheduled_for', { ascending: true })
        .limit(1)
        .maybeSingle(),
      supabase
        .from('agent_runs')
        .select('cost_cents')
        .eq('project_id', projectId)
        .gte('created_at', startOfMonth.toISOString()),
    ])

  const runs = (recentRuns ?? []) as AgentRun[]
  const totalCost = (costData ?? []).reduce(
    (sum: number, r: { cost_cents: number }) => sum + (r.cost_cents ?? 0),
    0
  )

  return {
    lastRun: runs[0] ?? null,
    recentRuns: runs,
    nextScheduled: nextItem?.scheduled_for ?? null,
    totalCostThisMonth: totalCost,
  }
}
