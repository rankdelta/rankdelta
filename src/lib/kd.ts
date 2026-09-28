/**
 * Keyword Difficulty (KD) presentation — Ahrefs-style banding so a KD value can be scanned by color
 * instead of read as a bare number. Purely presentational; the value itself is unchanged.
 *
 * Bands mirror the common 0–100 KD reading: green = winnable, red = entrenched.
 */

export type KdBand = 'easy' | 'moderate' | 'medium' | 'hard' | 'veryhard';

export function kdBand(kd: number | null | undefined): KdBand | null {
  if (kd == null || Number.isNaN(kd)) return null;
  if (kd < 15) return 'easy';
  if (kd < 30) return 'moderate';
  if (kd < 50) return 'medium';
  if (kd < 70) return 'hard';
  return 'veryhard';
}

// Tuned for the dark UI — bright enough to read on near-black rows.
const BAND_COLOR: Record<KdBand, string> = {
  easy: '#34d399', // emerald
  moderate: '#a3e635', // lime
  medium: '#fbbf24', // amber
  hard: '#fb923c', // orange
  veryhard: '#f87171', // red
};

/** Hex color for a KD value, or a muted grey when KD is unknown. */
export function kdColor(kd: number | null | undefined): string {
  const b = kdBand(kd);
  return b ? BAND_COLOR[b] : '#6b7280';
}

/**
 * Authority / Domain-Rating style score (0–100): high = strong (green), low = weak (red) — the
 * inverse reading of KD. Used to color Authority Score so a comparison table ranks at a glance.
 */
export function authorityColor(score: number | null | undefined): string {
  if (score == null || Number.isNaN(score)) return '#6b7280';
  if (score >= 70) return BAND_COLOR.easy; // emerald — strong
  if (score >= 50) return BAND_COLOR.moderate; // lime
  if (score >= 30) return BAND_COLOR.medium; // amber
  if (score >= 15) return BAND_COLOR.hard; // orange
  return BAND_COLOR.veryhard; // red — weak
}
