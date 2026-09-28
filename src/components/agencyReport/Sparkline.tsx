import { useId } from 'react'

/** Reject anything that is not a plain finite number so a broken series renders nothing, not NaN paths. */
export function cleanSparklineSeries(values: ReadonlyArray<unknown> | null | undefined): number[] {
  if (!Array.isArray(values)) return []
  return values.filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
}

const VIEW_W = 120
const VIEW_H = 32
const PAD_Y = 2

/** Polyline + area path coordinates in a fixed viewBox; the SVG stretches to its container. */
export function sparklinePaths(values: number[]): { line: string; area: string } | null {
  if (values.length < 2) return null
  let min = Math.min(...values)
  let max = Math.max(...values)
  if (max === min) {
    // Flat series: draw a level line through the middle instead of collapsing to the top edge.
    min -= 1
    max += 1
  }
  const span = max - min
  const stepX = VIEW_W / (values.length - 1)
  const points = values.map((v, i) => {
    const x = i * stepX
    const y = PAD_Y + (1 - (v - min) / span) * (VIEW_H - PAD_Y * 2)
    return [Number(x.toFixed(2)), Number(y.toFixed(2))] as const
  })
  const line = points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x} ${y}`).join(' ')
  const last = points[points.length - 1]!
  const area = `${line} L${last[0]} ${VIEW_H} L0 ${VIEW_H} Z`
  return { line, area }
}

/**
 * Dependency-free inline sparkline for KPI cards. Renders nothing for fewer than two finite points.
 * Stroke follows the report accent (`--report-accent`, set on the report root) so it matches the brand.
 */
export function Sparkline({
  values,
  className = 'h-8 w-full',
  color = 'var(--report-accent, #7c3aed)',
}: {
  values: ReadonlyArray<number | null | undefined> | null | undefined
  className?: string
  color?: string
}) {
  const gradientId = useId()
  const series = cleanSparklineSeries(values)
  const paths = sparklinePaths(series)
  if (!paths) return null

  return (
    <svg
      className={`block overflow-visible ${className}`}
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
      data-testid="kpi-sparkline"
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.22" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={paths.area} fill={`url(#${gradientId})`} stroke="none" />
      <path
        d={paths.line}
        fill="none"
        stroke={color}
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  )
}
