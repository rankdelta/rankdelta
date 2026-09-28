/**
 * Shared keyword volume / difficulty cache (`keyword_metrics`), written by the server only.
 *
 * The browser used to send the rows back through seo-proxy `keyword-metrics-upsert`, so any account
 * could overwrite volume and difficulty for every tenant ("crm software" → volume 0, KD 100).
 * seo-proxy now derives the rows from the DataForSEO response it just received, for the location
 * and language it asked for. Volume and difficulty come from two separate calls, so each write
 * touches only its own column.
 */

export const KEYWORD_VOLUME_ENDPOINT = '/keywords_data/google_ads/search_volume/live'
export const KEYWORD_DIFFICULTY_ENDPOINT = '/dataforseo_labs/google/bulk_keyword_difficulty/live'

const MAX_ROWS = 1000

type Json = Record<string, unknown>

export interface KeywordVolumeRow {
  keyword: string
  location_code: number
  language_code: string
  volume: number
  fetched_at: string
}

export interface KeywordDifficultyRow {
  keyword: string
  location_code: number
  language_code: string
  difficulty: number
}

export type KeywordMetricRows =
  | { kind: 'volume'; rows: KeywordVolumeRow[] }
  | { kind: 'difficulty'; rows: KeywordDifficultyRow[] }
  | null

function locale(payload: unknown): { location_code: number; language_code: string } | null {
  const p = Array.isArray(payload) ? payload[0] : payload
  if (!p || typeof p !== 'object') return null
  const location = Number((p as Json)['location_code'])
  const language = (p as Json)['language_code']
  if (!Number.isInteger(location) || location <= 0) return null
  if (typeof language !== 'string' || !/^[a-z]{2,3}(-[a-z]{2,4})?$/i.test(language)) return null
  return { location_code: location, language_code: language.toLowerCase() }
}

/** First successful task's result array, or null. */
function taskResult(response: unknown): unknown[] | null {
  const tasks = (response as Json | null)?.['tasks']
  if (!Array.isArray(tasks) || tasks.length === 0) return null
  const task = tasks[0] as Json
  if (task?.['status_code'] !== 20000) return null
  return Array.isArray(task['result']) ? (task['result'] as unknown[]) : null
}

function cleanKeyword(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim().toLowerCase().slice(0, 200) : ''
}

function clampInt(raw: unknown, min: number, max: number): number | null {
  // Number(null) is 0: a missing value must stay missing, not become volume / difficulty 0.
  if (raw == null || raw === '') return null
  const n = Number(raw)
  if (!Number.isFinite(n)) return null
  return Math.round(Math.min(max, Math.max(min, n)))
}

export function extractKeywordMetricRows(endpoint: string, payload: unknown, response: unknown, now = new Date()): KeywordMetricRows {
  if (endpoint !== KEYWORD_VOLUME_ENDPOINT && endpoint !== KEYWORD_DIFFICULTY_ENDPOINT) return null
  const loc = locale(payload)
  const result = taskResult(response)
  if (!loc || !result) return null

  if (endpoint === KEYWORD_VOLUME_ENDPOINT) {
    // search_volume/live: result[] is one object per keyword (no `items`).
    const rows: KeywordVolumeRow[] = []
    for (const r of result.slice(0, MAX_ROWS)) {
      const keyword = cleanKeyword((r as Json)?.['keyword'])
      if (!keyword) continue
      rows.push({ keyword, ...loc, volume: clampInt((r as Json)['search_volume'], 0, 100_000_000) ?? 0, fetched_at: now.toISOString() })
    }
    return rows.length ? { kind: 'volume', rows } : null
  }

  // bulk_keyword_difficulty/live: result[0].items[].keyword_difficulty.
  const items = (result[0] as Json | undefined)?.['items']
  if (!Array.isArray(items)) return null
  const rows: KeywordDifficultyRow[] = []
  for (const it of items.slice(0, MAX_ROWS)) {
    const keyword = cleanKeyword((it as Json)?.['keyword'])
    const difficulty = clampInt((it as Json)?.['keyword_difficulty'], 0, 100)
    if (!keyword || difficulty == null) continue
    rows.push({ keyword, ...loc, difficulty })
  }
  return rows.length ? { kind: 'difficulty', rows } : null
}
