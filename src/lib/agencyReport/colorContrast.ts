/**
 * WCAG contrast helpers for agency brand colours. An agency picks its accent for a white page;
 * the AI-visibility hero is dark, where the default violet reads at 3.3:1 (AA wants 4.5:1 for
 * small text). readableOn() lightens (or darkens) the accent just enough to be legible there.
 */

function parseHex(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return null
  const h = m[1]!.length === 3 ? m[1]!.split('').map((c) => c + c).join('') : m[1]!
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
}

function toHex(rgb: [number, number, number]): string {
  return `#${rgb.map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('')}`
}

function luminance([r, g, b]: [number, number, number]): number {
  const lin = (v: number) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

/** WCAG contrast ratio of two hex colours (1–21); null when either is not a hex colour. */
export function contrastRatio(a: string, b: string): number | null {
  const x = parseHex(a)
  const y = parseHex(b)
  if (!x || !y) return null
  const [hi, lo] = [luminance(x), luminance(y)].sort((p, q) => q - p) as [number, number]
  return (hi + 0.05) / (lo + 0.05)
}

/**
 * The colour itself when it already reaches `min` against `background`; otherwise mixed towards
 * white (dark background) or black (light background) in small steps until it does.
 */
export function readableOn(color: string, background: string, min = 4.5): string {
  const c = parseHex(color)
  const bg = parseHex(background)
  if (!c || !bg) return color
  if ((contrastRatio(color, background) ?? 0) >= min) return color
  const target: [number, number, number] = luminance(bg) < 0.5 ? [255, 255, 255] : [0, 0, 0]
  for (let t = 0.05; t <= 1; t += 0.05) {
    const mixed = toHex([0, 1, 2].map((i) => c[i]! + (target[i]! - c[i]!) * t) as [number, number, number])
    if ((contrastRatio(mixed, background) ?? 0) >= min) return mixed
  }
  return toHex(target)
}
