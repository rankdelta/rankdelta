import { ResponsiveBar } from '@nivo/bar'
import { ResponsiveLine } from '@nivo/line'
import { ResponsivePie } from '@nivo/pie'

const CHART_THEME = {
  text: { fill: '#6b7280', fontSize: 11 },
  axis: {
    domain: { line: { stroke: '#e5e7eb' } },
    ticks: { line: { stroke: '#e5e7eb' }, text: { fill: '#6b7280', fontSize: 10 } },
  },
  grid: { line: { stroke: '#f3f4f6' } },
  tooltip: {
    container: { background: '#fff', color: '#111827', fontSize: 12, borderRadius: 8, boxShadow: '0 2px 8px rgba(0,0,0,0.1)' },
  },
}

const VIOLET = '#7c3aed'
const CYAN = '#06b6d4'

/** 35000 → 35k, 1500 → 1.5k; keeps the left axis narrow and legible in print. */
const compactTick = (v: unknown): string => {
  const n = Number(v)
  if (!Number.isFinite(n)) return String(v ?? '')
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
  if (Math.abs(n) >= 1000) return `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1).replace(/\.0$/, '')}k`
  return String(n)
}

export function NivoLineChart({
  data,
  indexKey,
  valueKeys,
  seriesLabels,
  maxBottomTicks = 8,
  height = 160,
  hideBottomAxis = false,
  showPoints = false,
}: {
  data: Record<string, unknown>[]
  indexKey: string
  valueKeys: string[]
  /** Human names for the series (legend/tooltip), keyed by value key. */
  seriesLabels?: Record<string, string>
  /** Daily series have 28-90 points; only this many x labels are drawn (first and last always). */
  maxBottomTicks?: number
  height?: number
  hideBottomAxis?: boolean
  /** Draw a dot per reading — for short series (one point per report) where the line alone hides the data. */
  showPoints?: boolean
}) {
  if (!data.length) return null
  // Clicks (thousands) next to impressions (hundreds of thousands) on one axis flattens the
  // smaller series into a zero line. Give each its own panel and scale instead.
  if (valueKeys.length === 2) {
    const peak = (key: string) => Math.max(0, ...data.map((d) => Number(d[key] ?? 0)))
    const [a, b] = valueKeys as [string, string]
    const ratio = Math.max(peak(a), peak(b)) / Math.max(1, Math.min(peak(a), peak(b)))
    if (ratio > 10) {
      const panel = Math.max(110, Math.floor((height * 1.5) / 2))
      return (
        <div>
          {valueKeys.map((key, i) => (
            <div key={key}>
              <p className="text-[10px] font-medium uppercase tracking-wide text-gray-400 mb-0.5">{seriesLabels?.[key] ?? key}</p>
              <NivoLineChart
                data={data}
                indexKey={indexKey}
                valueKeys={[key]}
                seriesLabels={seriesLabels}
                maxBottomTicks={maxBottomTicks}
                height={i === 0 ? panel - 20 : panel}
                hideBottomAxis={i === 0}
                showPoints={showPoints}
              />
            </div>
          ))}
        </div>
      )
    }
  }
  const xs = data.map((d) => String(d[indexKey] ?? ''))
  const step = Math.max(1, Math.ceil(xs.length / maxBottomTicks))
  const tickValues = xs.filter((_, i) => i % step === 0)
  const lastTickIndex = Math.floor((xs.length - 1) / step) * step
  if (xs.length - 1 - lastTickIndex > step * 0.6 && xs.length > 1) tickValues.push(xs[xs.length - 1] as string)
  const series = valueKeys.map((key, i) => ({
    id: seriesLabels?.[key] ?? key,
    color: i === 0 ? VIOLET : CYAN,
    // A missing reading (null) leaves a gap instead of a fake zero.
    data: data.map((d) => ({ x: String(d[indexKey] ?? ''), y: d[key] == null ? null : Number(d[key]) })),
  }))
  return (
    <div style={{ height }}>
      <ResponsiveLine
        data={series}
        margin={{ top: 8, right: 28, bottom: hideBottomAxis ? 8 : 28, left: 44 }}
        xScale={{ type: 'point' }}
        yScale={{ type: 'linear', min: 'auto', max: 'auto' }}
        curve="monotoneX"
        axisBottom={hideBottomAxis ? null : { tickRotation: 0, tickSize: 0, tickPadding: 8, tickValues }}
        axisLeft={{ tickSize: 0, tickValues: 4, format: compactTick }}
        enablePoints={showPoints}
        pointSize={6}
        pointColor="#fff"
        pointBorderWidth={2}
        pointBorderColor={{ from: 'seriesColor' }}
        enableGridX={false}
        colors={(s) => s.color}
        theme={CHART_THEME}
        useMesh
      />
    </div>
  )
}

export function NivoBarChart({
  data,
  indexKey,
  keys,
  height = 180,
}: {
  data: Record<string, unknown>[]
  indexKey: string
  keys: string[]
  height?: number
}) {
  if (!data.length) return null
  return (
    <div style={{ height }}>
      <ResponsiveBar
        data={data as Array<Record<string, string | number>>}
        keys={keys}
        indexBy={indexKey}
        margin={{ top: 8, right: 12, bottom: 36, left: 40 }}
        padding={0.3}
        colors={[VIOLET, CYAN]}
        axisBottom={{ tickRotation: -25, tickSize: 0 }}
        axisLeft={{ tickSize: 0 }}
        enableLabel={false}
        theme={CHART_THEME}
      />
    </div>
  )
}

export function NivoPieChart({
  data,
  height = 180,
}: {
  data: Array<{ id: string; label: string; value: number }>
  height?: number
}) {
  if (!data.length) return null
  return (
    <div style={{ height }}>
      <ResponsivePie
        data={data}
        margin={{ top: 8, right: 8, bottom: 8, left: 8 }}
        innerRadius={0.55}
        padAngle={1}
        cornerRadius={3}
        colors={{ scheme: 'purple_blue' }}
        enableArcLinkLabels={false}
        arcLabelsSkipAngle={20}
        theme={CHART_THEME}
      />
    </div>
  )
}
