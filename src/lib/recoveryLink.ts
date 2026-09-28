/**
 * A password-reset email link lands as `#access_token=…&type=recovery`. supabase-js reads that
 * hash when the client starts, clears it and emits PASSWORD_RECOVERY right away, which can be
 * before the lazily loaded reset page has mounted. supabaseClient.ts records it at startup with this.
 */
export function isRecoveryHash(hash: string): boolean {
	return new URLSearchParams(hash.replace(/^#/, '')).get('type') === 'recovery';
}
