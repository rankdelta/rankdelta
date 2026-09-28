import { lazy, Suspense, type ComponentProps } from 'react'
import type { AreaChartProps, BarChartProps } from '@tremor/react'
import type { NivoBarChart as NivoBarChartImpl, NivoLineChart as NivoLineChartImpl } from './widgets/ReportCharts'

/**
 * Report charts, loaded on demand. The chart libraries (Tremor + Recharts, Nivo + d3) were more
 * than half of the JavaScript a shared report downloaded before it could show anything; now the
 * text, KPIs and tables render first and each chart fills its own reserved space when it arrives.
 */
const TremorAreaChart = lazy(() => import('@tremor/react').then(({ AreaChart }) => ({ default: AreaChart })))
const TremorBarChart = lazy(() => import('@tremor/react').then(({ BarChart }) => ({ default: BarChart })))
const LazyNivoLineChart = lazy(() => import('./widgets/ReportCharts').then(({ NivoLineChart }) => ({ default: NivoLineChart })))
const LazyNivoBarChart = lazy(() => import('./widgets/ReportCharts').then(({ NivoBarChart }) => ({ default: NivoBarChart })))

export function AreaChart(props: AreaChartProps) {
  return (
    <Suspense fallback={<div className={props.className} aria-hidden />}>
      <TremorAreaChart {...props} />
    </Suspense>
  )
}

export function BarChart(props: BarChartProps) {
  return (
    <Suspense fallback={<div className={props.className} aria-hidden />}>
      <TremorBarChart {...props} />
    </Suspense>
  )
}

export function NivoLineChart(props: ComponentProps<typeof NivoLineChartImpl>) {
  return (
    <Suspense fallback={<div style={{ height: props.height ?? 160 }} aria-hidden />}>
      <LazyNivoLineChart {...props} />
    </Suspense>
  )
}

export function NivoBarChart(props: ComponentProps<typeof NivoBarChartImpl>) {
  return (
    <Suspense fallback={<div style={{ height: props.height ?? 180 }} aria-hidden />}>
      <LazyNivoBarChart {...props} />
    </Suspense>
  )
}
