import { posDistributionTotal, type PosDistribution } from '../../lib/labsMetrics';

const BUCKETS: Array<{ key: keyof Pick<PosDistribution, 'pos1' | 'pos2_3' | 'pos4_10' | 'pos11_20' | 'pos21plus'>; label: string; color: string }> = [
  { key: 'pos1', label: '#1', color: '#34d399' },
  { key: 'pos2_3', label: '2–3', color: '#6ee7b7' },
  { key: 'pos4_10', label: '4–10', color: '#a78bfa' },
  { key: 'pos11_20', label: '11–20', color: '#818cf8' },
  { key: 'pos21plus', label: '21–100', color: '#64748b' },
];

/**
 * Ahrefs/Semrush/SE Ranking overview widget: where the domain ranks,
 * using the full-index counts from domain_rank_overview (not the sampled table).
 */
export function PositionDistribution({
  positions,
  newLabel,
  upLabel,
  downLabel,
  lostLabel,
}: {
  positions: PosDistribution;
  newLabel: string;
  upLabel: string;
  downLabel: string;
  lostLabel: string;
}) {
  const total = posDistributionTotal(positions);
  if (total <= 0) return null;
  const fmt = (n: number) =>
    n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1_000 ? `${(n / 1_000).toFixed(1)}k` : String(n);
  return (
    <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-5 mb-4">
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs mb-3">
        {BUCKETS.map((b) => (
          <span key={b.key} className="tabular-nums text-white/70">
            <span className="text-white/40 mr-1">{b.label}</span>
            {fmt(positions[b.key])}
          </span>
        ))}
      </div>
      <div className="h-2 rounded-full bg-white/[0.06] overflow-hidden flex">
        {BUCKETS.map((b) => {
          const w = (positions[b.key] / total) * 100;
          if (w <= 0) return null;
          return <div key={b.key} style={{ width: `${w}%`, background: b.color }} />;
        })}
      </div>
      {(positions.isNew != null || positions.isUp != null) && (
        <div className="flex flex-wrap gap-3 mt-3 text-[11px] text-white/45">
          {positions.isNew != null ? <span className="text-sky-300/80">{newLabel} {fmt(positions.isNew)}</span> : null}
          {positions.isUp != null ? <span className="text-emerald-300/80">{upLabel} {fmt(positions.isUp)}</span> : null}
          {positions.isDown != null ? <span className="text-rose-300/80">{downLabel} {fmt(positions.isDown)}</span> : null}
          {positions.isLost != null ? <span className="text-white/40">{lostLabel} {fmt(positions.isLost)}</span> : null}
        </div>
      )}
    </div>
  );
}
