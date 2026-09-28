/**
 * score.ts — one shared visual language for every 0–100 score in the app (Salute, SEO, GEO,
 * citability…). Before this, the generator used a ≥75 green threshold while the Comando used ≥80,
 * so the same number could look "good" in one place and "ok" in another. One helper = consistency.
 *
 * Thresholds: ≥80 ottimo (emerald) · ≥50 da migliorare (amber) · <50 critico (rose).
 */

export type ScoreLevel = 'good' | 'ok' | 'bad'

export interface ScoreTone {
  level: ScoreLevel
  /** Text-only accent (KPI numbers, ring labels). */
  text: string
  /** Chip/pill: text + translucent bg + border. */
  chip: string
  /** SVG stroke colour (donut/ring arcs). */
  stroke: string
  /** Short Italian label. */
  label: string
}

export function scoreTone(value: number | null | undefined): ScoreTone {
  const v = value ?? 0
  if (value == null) {
    return { level: 'ok', text: 'text-white/40', chip: 'text-white/50 bg-white/[0.04] border-white/10', stroke: 'text-white/20', label: '—' }
  }
  if (v >= 80) {
    return { level: 'good', text: 'text-emerald-300', chip: 'text-emerald-300 bg-emerald-500/10 border-emerald-500/20', stroke: 'text-emerald-400', label: 'Ottimo' }
  }
  if (v >= 50) {
    return { level: 'ok', text: 'text-amber-300', chip: 'text-amber-300 bg-amber-500/10 border-amber-500/20', stroke: 'text-amber-400', label: 'Da migliorare' }
  }
  return { level: 'bad', text: 'text-rose-400', chip: 'text-rose-300 bg-rose-500/10 border-rose-500/20', stroke: 'text-rose-400', label: 'Critico' }
}
