/**
 * Calendar Utilities
 * 
 * Helper functions for calendar scheduling and date management
 */

/**
 * Get local date key in YYYY-MM-DD format (timezone-safe)
 */
const getLocalDateKey = (date: Date): string => {
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, '0');
	const day = String(date.getDate()).padStart(2, '0');
	return `${year}-${month}-${day}`;
};

/**
 * Find the next available date in the calendar
 * Returns the next date that doesn't have too many items scheduled
 * Default is 1 item per day (one proposal per day)
 */
export const findNextAvailableDate = (
	existingScheduledDates: Date[],
	maxItemsPerDay: number = 1
): Date => {
	const today = new Date();
	today.setHours(0, 0, 0, 0);

	// Count items per date using local date keys
	const dateCounts = new Map<string, number>();
	existingScheduledDates.forEach((date) => {
		const dateKey = getLocalDateKey(date);
		dateCounts.set(dateKey, (dateCounts.get(dateKey) || 0) + 1);
	});

	// Find next available date
	let currentDate = new Date(today);
	for (let i = 0; i < 90; i++) { // Check next 90 days
		const dateKey = getLocalDateKey(currentDate);
		const count = dateCounts.get(dateKey) || 0;

		if (count < maxItemsPerDay) {
			return currentDate;
		}

		currentDate.setDate(currentDate.getDate() + 1);
	}

	// If no date found in 90 days, return 7 days from today
	currentDate = new Date(today);
	currentDate.setDate(currentDate.getDate() + 7);
	return currentDate;
};

/**
 * Format date for calendar display
 * Uses local date values to avoid timezone issues
 */
export const formatCalendarDate = (date: Date): string => {
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, '0');
	const day = String(date.getDate()).padStart(2, '0');
	return `${year}-${month}-${day}`;
};

/**
 * Serialise a calendar day for a TIMESTAMPTZ column.
 * Writes local NOON as an ISO timestamp, so readers anywhere within ±11h of the writer's
 * timezone still land on the same calendar day (date-only strings are parsed as UTC midnight
 * by `new Date()` and shift a day west of UTC).
 */
export const toCalendarTimestamp = (date: Date): string => {
	return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12, 0, 0, 0).toISOString();
};

/**
 * Parse a date string safely, treating date-only strings as local dates
 * Fixes timezone issues with date-only strings like "2024-11-27"
 * which would otherwise be parsed as UTC midnight.
 * Full ISO timestamps are converted to the LOCAL calendar day (local midnight) so calendar
 * placement matches what `toCalendarTimestamp` wrote.
 */
export const parseLocalDate = (dateString: string): Date => {
	// Check if it's a date-only string (YYYY-MM-DD)
	if (/^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
		const [year, month, day] = dateString.split('-').map(Number);
		if (year !== undefined && month !== undefined && day !== undefined) {
			return new Date(year, month - 1, day);
		}
	}
	// For ISO timestamps or other formats: standard parsing, then snap to the local calendar day
	const parsed = new Date(dateString);
	if (isNaN(parsed.getTime())) return parsed;
	return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
};

/**
 * Compare if two dates represent the same calendar day (local time)
 */
export const isSameLocalDay = (date1: Date, date2: Date): boolean => {
	return (
		date1.getDate() === date2.getDate() &&
		date1.getMonth() === date2.getMonth() &&
		date1.getFullYear() === date2.getFullYear()
	);
};

