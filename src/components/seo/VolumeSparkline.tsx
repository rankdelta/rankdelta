/** Tiny 12-point volume trend — Semrush/Ahrefs table sparkline. Pure SVG, no extra call. */
export function VolumeSparkline({ values, className = '' }: { values?: number[] | null; className?: string }) {
  if (!values || values.length < 2) return null;
  const w = 56;
  const h = 16;
  const max = Math.max(1, ...values);
  const n = values.length;
  const pts = values
    .map((v, i) => {
      const x = n === 1 ? w / 2 : (i / (n - 1)) * (w - 2) + 1;
      const y = h - 1 - (v / max) * (h - 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  const last = values[n - 1] ?? 0;
  const first = values[0] ?? 0;
  const up = last >= first;
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      width={w}
      height={h}
      className={`inline-block align-middle ${className}`}
      aria-hidden
    >
      <polyline
        fill="none"
        stroke={up ? '#34d399' : '#fb7185'}
        strokeWidth={1.25}
        strokeLinejoin="round"
        strokeLinecap="round"
        points={pts}
      />
    </svg>
  );
}
