/**
 * Environment Variables Utility
 * 
 * Safe environment variable access with validation and fallbacks
 * 
 * ⚠️ SECURITY NOTE:
 * - VITE_* variables are exposed in the frontend bundle
 * - Only use VITE_* for public keys (like Supabase ANON_KEY)
 * - NEVER use VITE_* for sensitive API keys in production
 * - For sensitive keys, use Supabase Edge Functions or backend API
 */

/**
 * Public, client-safe env vars only.
 *
 * ⚠️ SECURITY: this is read with STATIC member access (never `import.meta.env[dynamicKey]`).
 * A dynamic key read forces Vite to inline the ENTIRE `import.meta.env` object into the bundle —
 * which would embed every VITE_* value, including the provider API keys. Keeping an explicit
 * static map guarantees only these public values are ever inlined.
 */
const PUBLIC_ENV: Record<string, string | undefined> = {
	VITE_SUPABASE_URL: import.meta.env.VITE_SUPABASE_URL,
	VITE_SUPABASE_ANON_KEY: import.meta.env.VITE_SUPABASE_ANON_KEY,
	VITE_GOOGLE_CLIENT_ID: import.meta.env['VITE_GOOGLE_CLIENT_ID'],
};

/**
 * Get a PUBLIC environment variable with validation.
 *
 * Only the keys in PUBLIC_ENV are resolvable. Sensitive provider keys are deliberately
 * unreachable here — they live as server-side Edge Function secrets (see src/services/edgeProxy.ts).
 */
export const getEnvVar = (key: string, required = false, defaultValue?: string): string => {
	const value = (Object.prototype.hasOwnProperty.call(PUBLIC_ENV, key) ? PUBLIC_ENV[key] : undefined) || defaultValue;

	if (required && !value) {
		console.error(`❌ Required environment variable ${key} is missing`);
		// Don't throw - just log error and return empty string
		// This allows the app to continue loading
	}

	return value || '';
};

/**
 * Check if we're in development mode
 */
export const isDev = (): boolean => {
	return import.meta.env.DEV || import.meta.env.MODE === 'development';
};

/**
 * Check if we're in production mode
 */
export const isProd = (): boolean => {
	return import.meta.env.PROD || import.meta.env.MODE === 'production';
};

/**
 * Supabase configuration
 * 
 * ⚠️ SECURITY NOTE:
 * - ANON_KEY is public by design but still a credential
 * - Security depends on Row Level Security (RLS) policies
 * - Make sure RLS is enabled on ALL tables
 * - For maximum security, use Supabase Edge Functions for sensitive operations
 */
export const getSupabaseConfig = () => {
	// Don't throw errors, just return null if missing
	const url = getEnvVar('VITE_SUPABASE_URL', false);
	const anonKey = getEnvVar('VITE_SUPABASE_ANON_KEY', false);
	
	if (!url || !anonKey) {
		console.error('❌ Supabase configuration is missing');
		return null;
	}
	
	// Warn in production about RLS
	if (isProd()) {
		console.warn('⚠️ In production, ensure RLS policies are enabled on all tables!');
	}
	
	return { url, anonKey };
};

/**
 * Provider API keys (OpenAI / DataForSEO / Perplexity / OpenRouter) are intentionally NOT read
 * here. They live as server-side secrets on the `seo-proxy` Supabase Edge Function and must never
 * be read into the client bundle. All provider calls route through src/services/edgeProxy.ts.
 */

/**
 * Validate all required environment variables
 */
export const validateEnv = (): { valid: boolean; errors: string[] } => {
	const errors: string[] = [];

	// Required for all environments
	const supabaseUrl = getEnvVar('VITE_SUPABASE_URL');
	const supabaseKey = getEnvVar('VITE_SUPABASE_ANON_KEY');

	if (!supabaseUrl) errors.push('VITE_SUPABASE_URL is missing');
	if (!supabaseKey) errors.push('VITE_SUPABASE_ANON_KEY is missing');

	return {
		valid: errors.length === 0,
		errors,
	};
};

