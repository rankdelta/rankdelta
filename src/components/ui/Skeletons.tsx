/**
 * Skeletons — shimmering placeholders shown while data loads, instead of a bare "Loading…" line.
 * Premium loading UX: the user sees the SHAPE of what's coming, so the wait feels shorter and the
 * layout doesn't jump when data arrives. Pure Tailwind (animate-pulse), no dependency.
 */

import type { CSSProperties } from 'react';

export function Bar({ className = '', style }: { className?: string; style?: CSSProperties }) {
  return <div className={`animate-pulse rounded bg-white/[0.06] ${className}`} style={style} />;
}

/** Placeholder rows for a data table (first column wider, like a keyword/domain label). */
export function TableSkeleton({ rows = 6, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <div className="space-y-3 py-1" aria-hidden="true">
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex gap-4 items-center">
          {Array.from({ length: cols }).map((_, c) => (
            <Bar key={c} className={`h-3.5 ${c === 0 ? 'flex-[2.5]' : 'flex-1'}`} />
          ))}
        </div>
      ))}
    </div>
  );
}

/** Placeholder for a row of metric cards (Site Explorer overview). */
export function MetricsSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3" aria-hidden="true">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-5">
          <Bar className="h-6 w-2/3 mb-2" />
          <Bar className="h-2.5 w-1/2" />
        </div>
      ))}
    </div>
  );
}

// Fixed pseudo-chart silhouette (no randomness — deterministic across renders).
const CHART_HEIGHTS = [38, 52, 46, 60, 68, 62, 74, 70, 82, 78, 86, 90, 84, 88, 80, 92, 87, 94, 89, 96, 91, 98, 93, 99];

/** Placeholder for the traffic chart area. */
export function ChartSkeleton() {
  return (
    <div className="h-[220px] flex items-end gap-1.5 pt-6" aria-hidden="true">
      {CHART_HEIGHTS.map((h, i) => (
        <Bar key={i} className="flex-1" style={{ height: `${h}%` }} />
      ))}
    </div>
  );
}
