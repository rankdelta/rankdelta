/**
 * Scheduled report cadence math — shared by UI and vitest.
 * Mirrors SQL functions report_schedule_is_due / report_schedule_next_run.
 */

export type ReportCadence = 'weekly' | 'monthly'

export interface ScheduleCadenceInput {
  cadence: ReportCadence
  dayOfWeek: number | null
  dayOfMonth: number | null
  lastRunAt: string | null
  asOf?: string
}

function parseYmd(ymd: string): Date {
  return new Date(`${ymd}T00:00:00Z`)
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function utcDayOfWeek(d: Date): number {
  return d.getUTCDay()
}

function utcDayOfMonth(d: Date): number {
  return d.getUTCDate()
}

/** True when the schedule should run on asOf (UTC). */
export function isScheduleDue(input: ScheduleCadenceInput): boolean {
  const asOf = input.asOf ?? ymd(new Date())
  const asOfDate = parseYmd(asOf)

  if (input.lastRunAt) {
    const lastRunDate = ymd(new Date(input.lastRunAt))
    if (lastRunDate >= asOf) return false
  }

  if (input.cadence === 'weekly') {
    if (input.dayOfWeek == null) return false
    return utcDayOfWeek(asOfDate) === input.dayOfWeek
  }

  if (input.cadence === 'monthly') {
    if (input.dayOfMonth == null) return false
    return utcDayOfMonth(asOfDate) === input.dayOfMonth
  }

  return false
}

/** Next run date on or after fromDate (UTC). */
export function nextRunAt(
  cadence: ReportCadence,
  dayOfWeek: number | null,
  dayOfMonth: number | null,
  fromDate?: string,
): string | null {
  const start = parseYmd(fromDate ?? ymd(new Date()))

  for (let i = 0; i < 62; i++) {
    const cursor = new Date(start.getTime() + i * 86_400_000)
    const cursorYmd = ymd(cursor)

    if (cadence === 'weekly' && dayOfWeek != null && utcDayOfWeek(cursor) === dayOfWeek) {
      return cursorYmd
    }
    if (cadence === 'monthly' && dayOfMonth != null && utcDayOfMonth(cursor) === dayOfMonth) {
      return cursorYmd
    }
  }

  return null
}

/**
 * Next date the client will actually receive the report (UTC ymd), for the schedules UI.
 * Skips today when the runner already sent today, mirroring `isScheduleDue`.
 */
export function nextSendDate(
  input: Pick<ScheduleCadenceInput, 'cadence' | 'dayOfWeek' | 'dayOfMonth' | 'lastRunAt'>,
  asOf?: string,
): string | null {
  const today = asOf ?? ymd(new Date())
  let from = today
  if (input.lastRunAt) {
    const lastRunDate = ymd(new Date(input.lastRunAt))
    if (lastRunDate >= today) from = ymd(new Date(parseYmd(today).getTime() + 86_400_000))
  }
  return nextRunAt(input.cadence, input.dayOfWeek, input.dayOfMonth, from)
}

/** Human label for a send date: "today", "tomorrow", or a weekday + day + month in the user's locale. */
export function formatSendDate(
  dateYmd: string,
  locale: string,
  labels: { today: string; tomorrow: string },
  asOf?: string,
): string {
  const today = asOf ?? ymd(new Date())
  if (dateYmd === today) return labels.today
  if (dateYmd === ymd(new Date(parseYmd(today).getTime() + 86_400_000))) return labels.tomorrow
  try {
    return parseYmd(dateYmd).toLocaleDateString(locale, {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      timeZone: 'UTC',
    })
  } catch {
    return dateYmd
  }
}

/** Filter schedules that are due on asOf. */
export function selectDueSchedules<T extends ScheduleCadenceInput>(
  schedules: T[],
  asOf?: string,
): T[] {
  return schedules.filter((s) => isScheduleDue({ ...s, asOf }))
}
