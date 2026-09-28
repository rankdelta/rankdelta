import { describe, it, expect } from 'vitest';
import { parseLocalDate, toCalendarTimestamp, findNextAvailableDate, formatCalendarDate } from './calendar';

describe('calendar utils', () => {
	it('parses date-only strings as local midnight', () => {
		const d = parseLocalDate('2024-11-27');
		expect([d.getFullYear(), d.getMonth(), d.getDate()]).toEqual([2024, 10, 27]);
		expect(d.getHours()).toBe(0);
	});

	it('round-trips a calendar day through a TIMESTAMPTZ value (local noon)', () => {
		const day = new Date(2025, 2, 9); // 9 Mar 2025 local
		const iso = toCalendarTimestamp(day);
		expect(iso.endsWith('Z')).toBe(true);
		const back = parseLocalDate(iso);
		expect(formatCalendarDate(back)).toBe('2025-03-09');
		expect(back.getHours()).toBe(0);
	});

	it('snaps full ISO timestamps to the local calendar day', () => {
		const d = parseLocalDate(new Date(2025, 0, 15, 23, 45).toISOString());
		expect(formatCalendarDate(d)).toBe('2025-01-15');
	});

	it('findNextAvailableDate skips days already taken (ISO-written dates included)', () => {
		const today = new Date();
		today.setHours(0, 0, 0, 0);
		const taken = [parseLocalDate(toCalendarTimestamp(today))];
		const next = findNextAvailableDate(taken, 1);
		const tomorrow = new Date(today);
		tomorrow.setDate(tomorrow.getDate() + 1);
		expect(formatCalendarDate(next)).toBe(formatCalendarDate(tomorrow));
	});
});
