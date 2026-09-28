import { hostOf } from '../../lib/seoUrls';
import type { LiveSerpFeature, SerpOrganic, SerpSnapshot } from '../../lib/serpSnapshot';
import { ExtLink } from './ExtLink';

function sameHost(a?: string | null, b?: string | null): boolean {
  if (!a || !b) return false;
  return hostOf(a).toLowerCase() === hostOf(b).toLowerCase();
}

/** Live SERP list — title, URL and sitelinks are real outbound links. */
export function SerpRows({ rows, ownHost }: { rows: SerpOrganic[]; ownHost?: string | null }) {
  return (
    <div className="space-y-1.5">
      {rows.map((r, i) => {
        const mine = sameHost(r.url ?? r.domain, ownHost);
        return (
        <div
          key={`${r.url ?? r.domain ?? i}`}
          className={`flex items-start gap-3 rounded-lg border px-3 py-2 ${mine ? 'border-violet-400/40 bg-violet-500/[0.08]' : 'border-white/[0.06] bg-white/[0.02]'}`}
        >
          <span className="flex-shrink-0 w-6 h-6 rounded-md bg-white/[0.06] text-white/60 text-xs font-semibold grid place-items-center mt-0.5">
            {r.position ?? i + 1}
          </span>
          <div className="min-w-0">
            {mine ? <div className="text-[10px] uppercase tracking-wide text-violet-300/80 mb-0.5">This domain</div> : null}
            {r.url ? (
              <ExtLink href={r.url} className="text-sm text-white/90 hover:underline block truncate">
                {r.title || r.domain || hostOf(r.url)}
              </ExtLink>
            ) : (
              <div className="text-sm text-white/90 truncate">{r.title || r.domain}</div>
            )}
            <div className="text-xs text-emerald-300/70 truncate">
              {r.url ? (
                <ExtLink href={r.url} className="text-emerald-300/70 hover:underline">
                  {hostOf(r.url) + (r.url.replace(/^https?:\/\/[^/]+/, '') || '')}
                </ExtLink>
              ) : (r.domain ?? '—')}
            </div>
            {r.snippet ? <p className="text-[11px] text-white/40 mt-0.5 line-clamp-2">{r.snippet}</p> : null}
            {r.sitelinks?.length ? (
              <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1">
                {r.sitelinks.map((s) => (
                  <ExtLink key={s.url} href={s.url} className="text-[11px] text-violet-300/80 hover:underline truncate max-w-[12rem]">
                    {s.title || hostOf(s.url)}
                  </ExtLink>
                ))}
              </div>
            ) : null}
          </div>
        </div>
        );
      })}
    </div>
  );
}

const FEATURE_LABEL: Record<LiveSerpFeature, string> = {
  ai_overview: 'AI Overview',
  knowledge_graph: 'Knowledge graph',
  local_pack: 'Local pack',
  images: 'Images',
  video: 'Videos',
  top_stories: 'Top stories',
  discussions: 'Discussions',
};

export function SerpExtras({
  snap,
  onPickRelated,
}: {
  snap: SerpSnapshot;
  onPickRelated?: (q: string) => void;
}) {
  const hasFeatures = snap.features?.length;
  if (!snap.featured && !snap.paa.length && !snap.related.length && !snap.ads && !hasFeatures) return null;
  return (
    <div className="mt-4 space-y-3">
      {hasFeatures ? (
        <div className="flex flex-wrap gap-1.5">
          {snap.features.map((f) => (
            <span key={f} className={`text-[10px] px-2 py-0.5 rounded-full ${f === 'ai_overview' ? 'bg-amber-400/15 text-amber-200' : 'bg-white/[0.06] text-white/50'}`}>
              {FEATURE_LABEL[f]}
            </span>
          ))}
        </div>
      ) : null}
      {snap.ads > 0 && <p className="text-[11px] text-white/35">{snap.ads} paid result{snap.ads === 1 ? '' : 's'} on this SERP</p>}
      {snap.featured && (
        <div className="rounded-lg border border-amber-400/20 bg-amber-400/[0.04] px-3 py-2">
          <div className="text-[11px] uppercase tracking-wide text-amber-200/70 mb-1">Featured snippet</div>
          {snap.featured.url ? (
            <ExtLink href={snap.featured.url} className="text-sm text-white/90 hover:underline block">
              {snap.featured.title || snap.featured.url}
            </ExtLink>
          ) : (
            <div className="text-sm text-white/90">{snap.featured.title}</div>
          )}
          {snap.featured.snippet ? <p className="text-xs text-white/50 mt-1">{snap.featured.snippet}</p> : null}
        </div>
      )}
      {snap.paa.length > 0 && (
        <div>
          <div className="text-[11px] uppercase tracking-wide text-white/40 mb-1">People also ask</div>
          <ul className="space-y-1">
            {snap.paa.map((q) => (
              <li key={q}>
                {onPickRelated ? (
                  <button type="button" className="text-sm text-violet-300 hover:underline text-left" onClick={() => onPickRelated(q)}>{q}</button>
                ) : (
                  <span className="text-sm text-white/70">{q}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      {snap.related.length > 0 && (
        <div>
          <div className="text-[11px] uppercase tracking-wide text-white/40 mb-1">Related searches</div>
          <div className="flex flex-wrap gap-1.5">
            {snap.related.map((q) => (
              onPickRelated ? (
                <button key={q} type="button" className="text-xs px-2 py-1 rounded-full bg-white/[0.06] text-white/70 hover:text-white" onClick={() => onPickRelated(q)}>{q}</button>
              ) : (
                <span key={q} className="text-xs px-2 py-1 rounded-full bg-white/[0.06] text-white/70">{q}</span>
              )
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
