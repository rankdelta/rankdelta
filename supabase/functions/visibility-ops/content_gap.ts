import type { User } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  buildContentGapResponse,
  clampLimit,
  type RankKeywordInput,
  type RankSnapshotInput,
} from '../_shared/contentGap.ts';
import { mapLangToCode, mapMarketToLocation, type Json, type Sb } from './shared.ts';

async function loadSnapshots(supabaseUser: Sb, keywordIds: string[]): Promise<RankSnapshotInput[]> {
  const snapshots: RankSnapshotInput[] = [];
  for (let i = 0; i < keywordIds.length; i += 200) {
    const chunk = keywordIds.slice(i, i + 200);
    if (!chunk.length) break;
    const { data, error } = await supabaseUser
      .from('serp_rank_snapshots')
      .select('keyword_id, rank_absolute, ranking_url, raw_response, status, checked_at')
      .in('keyword_id', chunk)
      .order('checked_at', { ascending: false });
    if (error) throw new Error(error.message);
    for (const s of data ?? []) {
      snapshots.push({
        keyword_id: s.keyword_id as string,
        rank_absolute: (s.rank_absolute as number | null) ?? null,
        ranking_url: (s.ranking_url as string | null) ?? null,
        raw_response: s.raw_response,
        status: (s.status as string | null) ?? null,
        checked_at: s.checked_at as string,
      });
    }
  }
  return snapshots;
}

async function loadVolumes(
  supabaseUser: Sb,
  phrases: string[],
  locationCode: number,
  languageCode: string,
): Promise<Map<string, number | null>> {
  const volumes = new Map<string, number | null>();
  const keys = [...new Set(phrases.map((p) => p.trim().toLowerCase()).filter(Boolean))];
  for (let i = 0; i < keys.length; i += 200) {
    const chunk = keys.slice(i, i + 200);
    if (!chunk.length) break;
    const { data } = await supabaseUser
      .from('keyword_metrics')
      .select('keyword, volume')
      .eq('location_code', locationCode)
      .eq('language_code', languageCode)
      .in('keyword', chunk);
    for (const row of data ?? []) {
      const kw = String(row.keyword ?? '').toLowerCase();
      if (kw) volumes.set(kw, typeof row.volume === 'number' ? row.volume : null);
    }
  }
  return volumes;
}

export async function handleGetContentGap(
  supabaseUser: Sb,
  _admin: Sb,
  user: User,
  body: Json,
  corsHeaders: Record<string, string>,
): Promise<Response> {
  const siteId = String(body['site_id'] ?? body['siteId'] ?? body['projectId'] ?? '').trim();
  const competitorDomain = String(body['competitor_domain'] ?? body['competitorDomain'] ?? '').trim();
  const limit = clampLimit(body['limit'], 50);

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
    .select('id, user_id, website_url, primary_language, market')
    .eq('id', siteId)
    .single();

  if (pe || !project || project.user_id !== user.id) {
    return new Response(JSON.stringify({ error: 'Forbidden', cost_usd: 0 }), {
      status: 403,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const { data: kwRows, error: kwe } = await supabaseUser
    .from('serp_rank_keywords')
    .select('id, phrase, is_active')
    .eq('project_id', siteId)
    .eq('is_active', true);

  if (kwe) {
    return new Response(JSON.stringify({ error: kwe.message, cost_usd: 0 }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const keywords: RankKeywordInput[] = (kwRows ?? []).map((r) => ({
    id: r.id as string,
    phrase: r.phrase as string,
  }));

  let snapshots: RankSnapshotInput[] = [];
  try {
    snapshots = await loadSnapshots(supabaseUser, keywords.map((k) => k.id));
  } catch (e) {
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : String(e), cost_usd: 0 }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }

  const volumes = await loadVolumes(
    supabaseUser,
    keywords.map((k) => k.phrase),
    mapMarketToLocation(project.market as string),
    mapLangToCode(project.primary_language as string),
  );

  const payload = buildContentGapResponse({
    siteId,
    competitorDomain,
    keywords,
    snapshots,
    siteUrl: (project.website_url as string) || '',
    volumes,
    limit,
  });

  return new Response(JSON.stringify(payload), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
