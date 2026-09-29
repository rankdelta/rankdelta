import type { User } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  clampLimit,
  executeLinkIntersect,
  normalizeDomain,
  type StoredReferringDomainRow,
} from '../_shared/linkIntersect.ts';
import { type Json, type Sb } from './shared.ts';

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === 'string' && !!x.trim());
}

async function loadStoredRows(
  admin: Sb,
  siteDomain: string,
  competitorDomain: string,
): Promise<StoredReferringDomainRow[]> {
  const targets = [...new Set([siteDomain, competitorDomain].filter(Boolean))];
  if (!targets.length) return [];
  const { data, error } = await admin
    .from('backlink_referring_domains')
    .select('target_domain, referring_domain, referring_rank, links_to_target, sample_target_urls')
    .in('target_domain', targets);
  if (error) {
    // Table not migrated yet — treat as empty stored coverage, do not invent rows.
    if (/relation .* does not exist/i.test(error.message) || error.code === '42P01') {
      return [];
    }
    throw new Error(error.message);
  }
  return (data ?? []).map((r) => ({
    target_domain: String(r.target_domain ?? ''),
    referring_domain: String(r.referring_domain ?? ''),
    referring_rank: typeof r.referring_rank === 'number' ? r.referring_rank : null,
    links_to_target: typeof r.links_to_target === 'number' ? r.links_to_target : null,
    sample_target_urls: asStringArray(r.sample_target_urls),
  }));
}

export async function handleGetLinkIntersect(
  supabaseUser: Sb,
  admin: Sb,
  user: User,
  body: Json,
  corsHeaders: Record<string, string>,
): Promise<Response> {
  const siteId = String(body['site_id'] ?? body['siteId'] ?? body['projectId'] ?? '').trim();
  const competitorDomain = String(body['competitor_domain'] ?? body['competitorDomain'] ?? '').trim();
  const limit = clampLimit(body['limit'], 50);
  const dryRun = body['dry_run'] === true || body['dryRun'] === true;
  const refresh = body['refresh'] === true;

  if (!siteId) {
    return new Response(JSON.stringify({ error: 'site_id required', cost_usd: 0 }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
  if (!competitorDomain) {
    return new Response(JSON.stringify({ error: 'competitor_domain required', cost_usd: 0 }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const { data: project, error: pe } = await supabaseUser
    .from('projects')
    .select('id, user_id, website_url')
    .eq('id', siteId)
    .single();

  if (pe || !project || project.user_id !== user.id) {
    return new Response(JSON.stringify({ error: 'Forbidden', cost_usd: 0 }), {
      status: 403,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const siteDomain = normalizeDomain(project.website_url as string);
  if (!siteDomain) {
    return new Response(
      JSON.stringify({ error: 'Store URL missing — add a website URL to this site', cost_usd: 0 }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }

  let rows: StoredReferringDomainRow[] = [];
  try {
    rows = await loadStoredRows(admin, siteDomain, normalizeDomain(competitorDomain));
  } catch (e) {
    console.error('[visibility-ops] link_intersect: backlinks_load_failed', e instanceof Error ? e.message : String(e));
    return new Response(
      JSON.stringify({ error: 'backlinks_load_failed', cost_usd: 0 }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }

  const payload = executeLinkIntersect({
    siteId,
    siteDomain,
    competitorDomain,
    rows,
    limit,
    dryRun,
    refresh,
    estimateRows: limit,
  });

  return new Response(JSON.stringify(payload), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
