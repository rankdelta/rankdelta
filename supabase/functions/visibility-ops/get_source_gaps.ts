import type { Json, Sb } from './shared.ts';
import type { User } from 'https://esm.sh/@supabase/supabase-js@2';
import { computeSourceGaps } from '../_shared/sourceGaps.ts';

function pickId(body: Json, ...keys: string[]): string | undefined {
  for (const k of keys) {
    const v = body[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return undefined;
}

const DEFAULT_WINDOW_DAYS = 30;

export async function loadCitedSourcesForSite(
  db: Sb,
  siteId: string,
  windowDays = DEFAULT_WINDOW_DAYS,
): Promise<{ ownDomains: string[]; citedSources: unknown[] }> {
  const { data: project } = await db.from('projects').select('id, website_url').eq('id', siteId).single();
  const { data: brands } = await db.from('tracked_brands').select('domain').eq('project_id', siteId);
  const ownDomains = [
    project?.website_url as string | undefined,
    ...((brands ?? []).map((b) => b.domain as string | null)),
  ].filter((d): d is string => typeof d === 'string' && !!d.trim());

  const { data: qs } = await db.from('visibility_queries').select('id').eq('project_id', siteId);
  const queryIds = (qs ?? []).map((q) => q.id as string);
  if (!queryIds.length) return { ownDomains, citedSources: [] };

  const since = new Date(Date.now() - windowDays * 864e5).toISOString();
  const { data: runs } = await db
    .from('visibility_query_runs')
    .select('cited_sources')
    .in('query_id', queryIds)
    .eq('status', 'completed')
    .gte('run_at', since);

  return {
    ownDomains,
    citedSources: (runs ?? []).map((r) => r.cited_sources),
  };
}

export async function handleGetSourceGaps(
  supabaseUser: Sb,
  user: User,
  body: Json,
  corsHeaders: Record<string, string>,
): Promise<Response> {
  const siteId = pickId(body, 'siteId', 'site_id', 'projectId', 'project_id');
  if (!siteId) {
    return new Response(JSON.stringify({ error: 'site_id is required' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const { data: project } = await supabaseUser.from('projects').select('id, user_id').eq('id', siteId).single();
  if (!project || project.user_id !== user.id) {
    return new Response(JSON.stringify({ error: 'Forbidden' }), {
      status: 403,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const limit = body['limit'];
  const windowDays = Number(body['windowDays'] ?? body['window_days'] ?? DEFAULT_WINDOW_DAYS);
  const { ownDomains, citedSources } = await loadCitedSourcesForSite(supabaseUser, siteId, windowDays);
  const result = computeSourceGaps({
    siteId,
    ownDomains,
    citedSources,
    limit: typeof limit === 'number' ? limit : Number(limit ?? 20),
    windowDays,
  });

  return new Response(JSON.stringify({ ok: true, ...result }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
