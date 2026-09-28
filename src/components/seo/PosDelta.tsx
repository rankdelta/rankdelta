import type { RankDelta } from '../../lib/labsMetrics';

/** Ahrefs/SE Ranking position-change chip next to the current rank. */
export function PosDelta({ change }: { change?: RankDelta | null }) {
  if (!change) return null;
  if (change.isNew) {
    return <span className="ml-1 text-[10px] font-semibold text-sky-300/90">NEW</span>;
  }
  if (change.delta == null || change.delta === 0) {
    if (change.isUp) return <span className="ml-1 text-[10px] text-emerald-300">↑</span>;
    if (change.isDown) return <span className="ml-1 text-[10px] text-rose-300">↓</span>;
    return null;
  }
  if (change.delta > 0) {
    return <span className="ml-1 text-[10px] font-semibold text-emerald-300">↑{change.delta}</span>;
  }
  return <span className="ml-1 text-[10px] font-semibold text-rose-300">↓{Math.abs(change.delta)}</span>;
}
