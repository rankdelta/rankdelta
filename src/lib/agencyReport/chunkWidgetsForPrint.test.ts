import { describe, expect, it } from 'vitest'
import { chunkWidgetsForPrint, type ReportLayout } from './layout'

type W = ReportLayout['widgets'][number]

const w = (id: string, type: string, row: number, col = 0, colSpan = 12): W =>
  ({ id, type, grid: { row, col, colSpan, rowSpan: 1 }, binding: { section: 'gsc', metric: 'x' } }) as unknown as W

describe('chunkWidgetsForPrint', () => {
  it('glues each section header to the first row below it and lets the rest flow', () => {
    const chunks = chunkWidgetsForPrint([
      w('hero', 'ai_visibility_hero', 0),
      w('h1', 'section_header', 1),
      w('k1', 'kpi', 2, 0, 4),
      w('k2', 'kpi', 2, 4, 4),
      w('k3', 'kpi', 2, 8, 4),
      w('chart', 'line_chart', 3),
      w('h2', 'section_header', 4),
      w('table', 'table', 5),
    ])
    expect(chunks.map((c) => [c.keep.map((x) => x.id), c.rest.map((x) => x.id)])).toEqual([
      [[], ['hero']],
      [['h1', 'k1', 'k2', 'k3'], ['chart']],
      [['h2', 'table'], []],
    ])
  })

  it('handles a trailing header and an empty list', () => {
    expect(chunkWidgetsForPrint([])).toEqual([])
    const header = w('h', 'section_header', 0)
    expect(chunkWidgetsForPrint([header])).toEqual([{ keep: [header], rest: [] }])
  })

  it('marks a header row that holds a table as splittable so a long issues table is not clipped in print', () => {
    const chunks = chunkWidgetsForPrint([
      w('h', 'section_header', 0),
      w('score', 'kpi', 1, 0, 4),
      w('issues', 'table', 1, 4, 8),
      w('h2', 'section_header', 2),
      w('k', 'kpi', 3, 0, 4),
    ])
    expect(chunks[0]?.keep.map((x) => x.id)).toEqual(['h', 'score', 'issues'])
    expect(chunks[0]?.splittable).toBe(true)
    expect(chunks[1]?.splittable).toBeUndefined()
  })
})
