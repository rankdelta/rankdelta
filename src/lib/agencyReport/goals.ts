export type GoalRag = 'green' | 'amber' | 'red' | 'none'

export interface GoalEvalInput {
  value: number | null | undefined
  target: number | null | undefined
  /** When false, lower values are better (e.g. avg position). */
  higherIsBetter?: boolean
}

const AMBER_TOLERANCE = 0.1

/**
 * Red / amber / green vs a per-KPI target.
 * Green = at or above target (or at/below when lower is better).
 * Amber = within 10% of target.
 * Red = worse than amber band.
 */
export function evaluateGoalRag({
  value,
  target,
  higherIsBetter = true,
}: GoalEvalInput): GoalRag {
  if (value == null || target == null || !Number.isFinite(value) || !Number.isFinite(target)) {
    return 'none'
  }

  if (target === 0) {
    if (higherIsBetter) return value >= 0 ? 'green' : 'red'
    return value <= 0 ? 'green' : 'red'
  }

  const ratio = higherIsBetter ? value / target : target / value
  if (ratio >= 1) return 'green'
  if (ratio >= 1 - AMBER_TOLERANCE) return 'amber'
  return 'red'
}

/**
 * How far the KPI is toward its target, as a 0–1 fraction for a progress bar.
 * Higher-is-better: value / target. Lower-is-better (avg position): target / value, so being
 * at or below the target reads as full. Null when either side is missing or the ratio is undefined.
 */
export function goalProgressRatio({ value, target, higherIsBetter = true }: GoalEvalInput): number | null {
  if (value == null || target == null || !Number.isFinite(value) || !Number.isFinite(target)) return null
  if (higherIsBetter) {
    if (target <= 0) return value >= target ? 1 : 0
    if (value <= 0) return 0
    return Math.min(1, value / target)
  }
  if (value <= 0 || target <= 0) return value <= target ? 1 : 0
  return Math.min(1, target / value)
}

export function goalRagClasses(rag: GoalRag): string {
  switch (rag) {
    case 'green':
      return 'bg-emerald-100 text-emerald-800 border-emerald-200'
    case 'amber':
      return 'bg-amber-100 text-amber-800 border-amber-200'
    case 'red':
      return 'bg-red-100 text-red-800 border-red-200'
    default:
      return 'bg-gray-100 text-gray-500 border-gray-200'
  }
}
