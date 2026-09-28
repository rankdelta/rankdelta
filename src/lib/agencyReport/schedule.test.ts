import { describe, expect, it } from 'vitest'
import { formatSendDate, isScheduleDue, nextRunAt, nextSendDate, selectDueSchedules } from './schedule'

describe('report schedule cadence', () => {
  it('weekly: due on matching weekday when not run today', () => {
    expect(
      isScheduleDue({
        cadence: 'weekly',
        dayOfWeek: 1,
        dayOfMonth: null,
        lastRunAt: null,
        asOf: '2026-09-07',
      }),
    ).toBe(true)
  })

  it('weekly: not due when already run today', () => {
    expect(
      isScheduleDue({
        cadence: 'weekly',
        dayOfWeek: 1,
        dayOfMonth: null,
        lastRunAt: '2026-09-07T10:00:00Z',
        asOf: '2026-09-07',
      }),
    ).toBe(false)
  })

  it('weekly: not due on wrong weekday', () => {
    expect(
      isScheduleDue({
        cadence: 'weekly',
        dayOfWeek: 1,
        dayOfMonth: null,
        lastRunAt: null,
        asOf: '2026-09-08',
      }),
    ).toBe(false)
  })

  it('monthly: due on matching day of month', () => {
    expect(
      isScheduleDue({
        cadence: 'monthly',
        dayOfWeek: null,
        dayOfMonth: 8,
        lastRunAt: null,
        asOf: '2026-09-08',
      }),
    ).toBe(true)
  })

  it('nextRunAt weekly finds next Monday from Sunday', () => {
    expect(nextRunAt('weekly', 1, null, '2026-09-06')).toBe('2026-09-07')
  })

  it('nextRunAt monthly finds next 15th', () => {
    expect(nextRunAt('monthly', null, 15, '2026-09-08')).toBe('2026-09-15')
  })

  it('selectDueSchedules filters active due rows', () => {
    const rows = [
      {
        id: 'a',
        cadence: 'weekly' as const,
        dayOfWeek: 1,
        dayOfMonth: null,
        lastRunAt: null,
      },
      {
        id: 'b',
        cadence: 'weekly' as const,
        dayOfWeek: 2,
        dayOfMonth: null,
        lastRunAt: null,
      },
    ]
    const due = selectDueSchedules(rows, '2026-09-07')
    expect(due.map((r) => r.id)).toEqual(['a'])
  })
})

describe('nextSendDate / formatSendDate (schedules UI)', () => {
  it('weekly: today when the weekday matches and nothing was sent yet', () => {
    expect(nextSendDate({ cadence: 'weekly', dayOfWeek: 1, dayOfMonth: null, lastRunAt: null }, '2026-09-07')).toBe('2026-09-07')
  })

  it('weekly: skips to next week when the runner already sent today', () => {
    expect(
      nextSendDate({ cadence: 'weekly', dayOfWeek: 1, dayOfMonth: null, lastRunAt: '2026-09-07T06:00:00Z' }, '2026-09-07'),
    ).toBe('2026-09-14')
  })

  it('monthly: rolls over to next month after the day has passed', () => {
    expect(nextSendDate({ cadence: 'monthly', dayOfWeek: null, dayOfMonth: 1, lastRunAt: null }, '2026-09-14')).toBe('2026-10-01')
  })

  it('formats today / tomorrow / a full date in the locale', () => {
    const labels = { today: 'oggi', tomorrow: 'domani' }
    expect(formatSendDate('2026-09-14', 'it-IT', labels, '2026-09-14')).toBe('oggi')
    expect(formatSendDate('2026-09-15', 'it-IT', labels, '2026-09-14')).toBe('domani')
    expect(formatSendDate('2026-09-21', 'it-IT', labels, '2026-09-14')).toBe('lunedì 21 settembre')
    expect(formatSendDate('2026-09-21', 'en-US', labels, '2026-09-14')).toBe('Monday, September 21')
  })
})
