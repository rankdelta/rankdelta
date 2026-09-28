/**
 * report-build — assemble unified agency report snapshot + AI narrative.
 *
 * Auth: verified user JWT; caller must own the project (same pattern as gsc-connect).
 * Narrative: calls seo-proxy { action: 'llm' } (metered).
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { assembleReportData } from '../_shared/reportAssemble.ts'
import { checkNarrativeGrounding, fetchNarrativeWithRetries, removeToolTalk } from '../_shared/reportBuild.ts'
import { buildTrimmedNarrativePrompt } from '../_shared/reportNarrativePayload.ts'
import { loadReportHistory } from '../_shared/reportHistory.ts'
import { restrictReportData } from '../_shared/reportScope.ts'
import { publishableKey, secretKey } from '../_shared/supabaseKeys.ts'
import { canShareReports, generateShareToken } from '../_shared/reportShare.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function parseDate(raw: unknown): string | null {
  if (typeof raw !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null
  return raw
}

function degradedNarrative(locale: string, reason = 'generation_failed'): Record<string, unknown> {
  return {
    executiveSummary: '',
    sections: {},
    nextActions: [],
    locale,
    grounding: { grounded: false, ungrounded: [] },
    degraded: true,
    degradedReason: reason,
  }
}

async function generateNarrative(
  supabaseUrl: string,
  anonKey: string,
  authHeader: string,
  data: Record<string, unknown>,
  locale: string,
): Promise<Record<string, unknown>> {
  const { system: systemPrompt, user: userPrompt } = buildTrimmedNarrativePrompt(data, locale)

  const llmResult = await fetchNarrativeWithRetries(
    {
      supabaseUrl,
      headers: {
        Authorization: authHeader,
        apikey: anonKey,
      },
      systemPrompt,
      userPrompt,
    },
    { logPrefix: '[report-build]' },
  )

  if (!llmResult.ok) return degradedNarrative(locale, llmResult.reason)

  const { narrative: parsed, removed } = removeToolTalk(llmResult.parsed)
  if (removed > 0) console.warn('[report-build] removed tool-talk sentences from narrative', removed)
  let grounding = { grounded: true, ungrounded: [] as number[] }
  try {
    grounding = checkNarrativeGrounding(parsed, data)
    if (!grounding.grounded) {
      console.warn('[report-build] narrative grounding failed', grounding.ungrounded.slice(0, 10))
    }
  } catch (groundErr) {
    console.warn('[report-build] narrative grounding check failed', groundErr instanceof Error ? groundErr.message : String(groundErr))
    grounding = { grounded: false, ungrounded: [] }
  }
  return { ...parsed, locale, grounding }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  const anonKey = publishableKey()
  const serviceKey = secretKey()
  const authHeader = req.headers.get('Authorization') ?? ''

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  })
  const { data: { user }, error: userErr } = await userClient.auth.getUser()
  if (userErr || !user) return json({ error: 'unauthorized' }, 401)

  const admin = createClient(supabaseUrl, serviceKey)

  let payload: {
    action?: string
    reportId?: string
    projectId?: string
    periodStart?: string
    periodEnd?: string
    locale?: string
    goals?: unknown
    branding?: unknown
    share?: boolean
    sections?: string[]
    layout?: unknown
  }
  try {
    payload = await req.json()
  } catch {
    return json({ error: 'invalid_json' }, 400)
  }

  // A fresh public link for an existing report (after a revoke, or to retire a leaked one).
  if (payload.action === 'reshare') {
    const reportId = typeof payload.reportId === 'string' ? payload.reportId : ''
    if (!reportId) return json({ error: 'missing_report' }, 400)
    const { data: report } = await admin.from('client_reports').select('id, user_id').eq('id', reportId).maybeSingle()
    if (!report || report.user_id !== user.id) return json({ error: 'forbidden' }, 403)
    if (!(await canShareReports(admin, user.id))) return json({ error: 'plan_required' }, 403)
    const { data: updated, error: updateErr } = await admin
      .from('client_reports')
      .update({ share_token: generateShareToken() })
      .eq('id', reportId)
      .select('id, share_token')
      .single()
    if (updateErr || !updated?.share_token) return json({ error: 'reshare_failed' }, 500)
    return json({ ok: true, report: updated })
  }

  const projectId = payload.projectId
  if (!projectId) return json({ error: 'missing_project' }, 400)

  const { data: project, error: projErr } = await admin
    .from('projects')
    .select('id, user_id, name, website_url, metadata, primary_language, language')
    .eq('id', projectId)
    .single()
  if (projErr || !project || project.user_id !== user.id) return json({ error: 'forbidden' }, 403)

  const periodEnd = parseDate(payload.periodEnd) ?? ymd(new Date())
  const defaultStart = new Date()
  defaultStart.setDate(defaultStart.getDate() - 27)
  const periodStart = parseDate(payload.periodStart) ?? ymd(defaultStart)
  if (periodStart > periodEnd) return json({ error: 'invalid_period' }, 400)

  const locale =
    typeof payload.locale === 'string'
      ? payload.locale
      : (project.language || project.primary_language) === 'it'
        ? 'it'
        : 'en'

  try {
    const assembled = await assembleReportData(admin, {
      projectId,
      periodStart,
      periodEnd,
      websiteUrl: project.website_url,
      locale,
    })

    const requestedSections = Array.isArray(payload.sections)
      ? payload.sections.filter((s): s is string => typeof s === 'string')
      : null
    const finalSections =
      requestedSections && requestedSections.length > 0
        ? assembled.sections.filter((s) => requestedSections.includes(s))
        : assembled.sections

    // Client identity + compact history of the previous reports (share page and PDF read them).
    const history = await loadReportHistory(admin, projectId, '[report-build]')
    const reportData = assembled.data as { meta?: Record<string, unknown> }
    reportData.meta = {
      ...(reportData.meta ?? {}),
      projectName: (project as { name?: string | null }).name ?? null,
      websiteUrl: project.website_url ?? null,
      history,
    }

    // Only the sections the owner chose are stored and written about: the share link returns `data` whole.
    const scopedData = restrictReportData(assembled.data, finalSections)

    const narrative = await generateNarrative(supabaseUrl, anonKey, authHeader, scopedData, locale)

    const branding =
      payload.branding ??
      (project.metadata && typeof project.metadata === 'object'
        ? (project.metadata as Record<string, unknown>).white_label_report ?? null
        : null)

    // The UI only asks for a link on Agency plans; the server holds the same line.
    const shareToken = payload.share === true && (await canShareReports(admin, user.id)) ? generateShareToken() : null

    const { data: inserted, error: insertErr } = await admin
      .from('client_reports')
      .insert({
        project_id: projectId,
        user_id: user.id,
        period_start: periodStart,
        period_end: periodEnd,
        sections: finalSections,
        data: scopedData,
        narrative,
        share_token: shareToken,
        branding,
        goals: payload.goals ?? null,
        layout: payload.layout ?? null,
      })
      .select('id, project_id, period_start, period_end, sections, share_token, created_at')
      .single()

    if (insertErr) {
      console.error('[report-build] insert failed', insertErr.message)
      return json({ error: 'insert_failed' }, 500)
    }

    return json({
      ok: true,
      report: inserted,
      narrativeGenerated: (narrative as { degraded?: boolean }).degraded !== true,
    })
  } catch (e) {
    console.error('[report-build] build failed', e instanceof Error ? e.message : String(e))
    return json({ error: 'build_failed' }, 500)
  }
})
