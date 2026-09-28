import type { GscAiOverviewRow } from './types'

function parseCsvLine(line: string): string[] {
  const out: string[] = []
  let cur = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"'
        i++
      } else {
        inQuotes = !inQuotes
      }
      continue
    }
    if (ch === ',' && !inQuotes) {
      out.push(cur.trim())
      cur = ''
      continue
    }
    cur += ch
  }
  out.push(cur.trim())
  return out
}

function num(raw: string | undefined): number | null {
  if (!raw) return null
  const n = Number(raw.replace(/[%\s]/g, ''))
  return Number.isFinite(n) ? n : null
}

function headerIndex(headers: string[], candidates: string[]): number {
  const lower = headers.map((h) => h.toLowerCase().trim())
  for (const c of candidates) {
    const idx = lower.indexOf(c.toLowerCase())
    if (idx >= 0) return idx
  }
  return -1
}

/** Parse a GSC AI Overviews CSV export into normalized rows. */
export function parseGscAiOverviewCsv(text: string): GscAiOverviewRow[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  if (lines.length < 2) return []

  const headers = parseCsvLine(lines[0]!)
  const queryIdx = headerIndex(headers, ['query', 'search query', 'top queries', 'keyword'])
  const impIdx = headerIndex(headers, ['impressions', 'impression'])
  const clickIdx = headerIndex(headers, ['clicks', 'click'])
  const ctrIdx = headerIndex(headers, ['ctr', 'click-through rate'])
  const posIdx = headerIndex(headers, ['position', 'avg. position', 'average position'])

  const rows: GscAiOverviewRow[] = []
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i]!)
    const query = queryIdx >= 0 ? cols[queryIdx] : cols[0]
    if (!query) continue
    rows.push({
      query,
      impressions: impIdx >= 0 ? num(cols[impIdx]) : null,
      clicks: clickIdx >= 0 ? num(cols[clickIdx]) : null,
      ctr: ctrIdx >= 0 ? num(cols[ctrIdx]) : null,
      position: posIdx >= 0 ? num(cols[posIdx]) : null,
    })
  }
  return rows
}
