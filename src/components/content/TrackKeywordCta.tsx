/**
 * TrackKeywordCta
 *
 * Closes the create→measure loop: right after a user generates or refreshes content for a target
 * keyword, offer to start tracking that keyword across BOTH surfaces the product measures —
 * Google rankings (SERP rank tracker) and AI answers (a visibility prompt). One click adds it to
 * whichever isn't already tracked; then the user can kick off a first AI check right here so a
 * baseline starts populating (explicit click — never auto-spends). Once tracked we link to both
 * dashboards.
 *
 * Rendered in the content generation / refresh success states.
 */

import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from '@tanstack/react-router';
import { ArrowTrendingUpIcon, CheckCircleIcon, BoltIcon } from '@heroicons/react/24/outline';
import { useSerpRankKeywords, useInsertSerpKeyword } from '../../hooks/useSerpRankTracker';
import {
  useVisibilityQueries,
  useInsertVisibilityQuery,
  useRunBatchMutation,
} from '../../hooks/useVisibilityTracker';
import { useProject } from '../../hooks/useProjects';

export function TrackKeywordCta({
  projectId,
  keyword,
  compact,
}: {
  projectId?: string;
  keyword?: string;
  /** Inline text control for explorer/KWR modals — does not change the content-success banner. */
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const kw = (keyword ?? '').trim();
  const { data: project } = useProject(projectId);
  const { data: rankKeywords } = useSerpRankKeywords(projectId);
  const { data: aiQueries } = useVisibilityQueries(projectId);
  const insertK = useInsertSerpKeyword(projectId ?? '');
  const insertQ = useInsertVisibilityQuery(projectId ?? '');
  const runBatch = useRunBatchMutation(projectId ?? '');
  const [justAdded, setJustAdded] = useState(false);
  const [aiQueryId, setAiQueryId] = useState<string | null>(null);
  const [checkStarted, setCheckStarted] = useState(false);

  const lc = kw.toLowerCase();
  const rankTracked = useMemo(
    () => (rankKeywords ?? []).some((k) => k.phrase.trim().toLowerCase() === lc),
    [rankKeywords, lc],
  );
  // The id of the AI-visibility prompt for this keyword — from the row we just inserted, or an
  // existing matching prompt. Powers the "run first check" action.
  const existingAiId = useMemo(
    () => (aiQueries ?? []).find((q) => q.text.trim().toLowerCase() === lc)?.id ?? null,
    [aiQueries, lc],
  );
  const aiTracked = existingAiId != null;

  // Nothing to offer without both a project and a concrete keyword.
  if (!projectId || !kw) return null;

  const tracked = justAdded || (rankTracked && aiTracked);
  const pending = insertK.isPending || insertQ.isPending;
  const language = (project?.language as string) || (project?.primary_language as string) || 'en';
  const effectiveAiId = aiQueryId ?? existingAiId;

  const handleTrack = async () => {
    // Add to whichever surface isn't already tracking it; best-effort (one failing shouldn't block the other).
    if (!rankTracked) await insertK.mutateAsync(kw).catch(() => {});
    if (!aiTracked) {
      const row = await insertQ
        .mutateAsync({ text: kw, language, intent_type: 'category' })
        .catch(() => null);
      if (row && typeof (row as { id?: string }).id === 'string') setAiQueryId((row as { id: string }).id);
    }
    setJustAdded(true);
  };

  if (compact) {
    if (tracked) {
      return (
        <Link
          to="/rankings/$projectId"
          params={{ projectId }}
          search={{ tab: 'keywords' }}
          className="text-xs text-emerald-300/80 hover:underline"
          onClick={(e) => e.stopPropagation()}
        >
          {t('trackKeyword.viewRankings')}
        </Link>
      );
    }
    return (
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); void handleTrack(); }}
        disabled={pending}
        className="text-xs text-amber-200/80 hover:underline disabled:opacity-50"
      >
        {pending ? t('trackKeyword.adding') : t('trackKeyword.cta')}
      </button>
    );
  }

  const runFirstCheck = () => {
    if (!effectiveAiId) return;
    // Fire-and-forget: the run mutation polls + invalidates the dashboards, so results appear there
    // even if the user navigates away. Explicit click only — we never auto-run (cost discipline).
    runBatch.mutate({ queryIds: [effectiveAiId], providers: ['chatgpt', 'google_aio'] });
    setCheckStarted(true);
  };

  return (
    <div className="mt-4 rounded-xl border border-emerald-500/20 bg-emerald-500/[0.06] px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-start gap-2.5 min-w-0">
          <ArrowTrendingUpIcon className="w-5 h-5 text-emerald-300 shrink-0 mt-0.5" strokeWidth={1.7} />
          <div className="min-w-0">
            <p className="text-sm font-medium text-white">{t('trackKeyword.title', { keyword: kw })}</p>
            <p className="text-xs text-white/50 mt-0.5">
              {checkStarted ? t('trackKeyword.checkStarted') : tracked ? t('trackKeyword.trackingDesc') : t('trackKeyword.desc')}
            </p>
          </div>
        </div>

        {!tracked ? (
          <button
            type="button"
            onClick={handleTrack}
            disabled={pending}
            className="shrink-0 inline-flex items-center gap-1.5 rounded-full bg-white text-black px-4 py-2 text-sm font-semibold hover:bg-white/90 transition-colors disabled:opacity-50"
          >
            <ArrowTrendingUpIcon className="w-4 h-4" strokeWidth={1.9} />
            {pending ? t('trackKeyword.adding') : t('trackKeyword.cta')}
          </button>
        ) : (
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {effectiveAiId && !checkStarted && (
              <button
                type="button"
                onClick={runFirstCheck}
                className="inline-flex items-center gap-1.5 rounded-full bg-white text-black px-3.5 py-2 text-sm font-semibold hover:bg-white/90 transition-colors"
              >
                <BoltIcon className="w-4 h-4" strokeWidth={1.9} /> {t('trackKeyword.runFirstCheck')}
              </button>
            )}
            <Link
              to="/rankings/$projectId"
              params={{ projectId }}
              search={{ tab: 'keywords' }}
              className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-200 px-3.5 py-2 text-sm font-medium hover:bg-emerald-500/25 transition-colors"
            >
              <CheckCircleIcon className="w-4 h-4" strokeWidth={1.8} /> {t('trackKeyword.viewRankings')}
            </Link>
            <Link
              to="/visibility/$projectId/queries"
              params={{ projectId }}
              className="inline-flex items-center gap-1.5 rounded-full bg-white/[0.06] border border-white/[0.12] text-white/80 px-3.5 py-2 text-sm font-medium hover:bg-white/[0.12] transition-colors"
            >
              {t('trackKeyword.viewAiVisibility')}
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}

export default TrackKeywordCta;
