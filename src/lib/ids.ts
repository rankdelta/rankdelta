/** UUID v4 (RFC) — used to reject junk IDs before hitting the API. */
const UUID_RE =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value: string | undefined): boolean {
	if (!value || typeof value !== 'string') return false;
	return UUID_RE.test(value.trim());
}
