/**
 * Supabase Client Configuration
 * 
 * Initializes the Supabase client for database operations and authentication.
 * Uses environment variables for configuration.
 */

import { createClient } from '@supabase/supabase-js';
import { isRecoveryHash } from './recoveryLink';

const supabaseUrl = (import.meta.env['VITE_SUPABASE_URL'] as string) || '';
const supabaseAnonKey = (import.meta.env['VITE_SUPABASE_ANON_KEY'] as string) || '';

if (!supabaseUrl || !supabaseAnonKey) {
	console.error(
		'⚠️ Missing Supabase environment variables. Please set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in your .env file.'
	);
	console.error('Current values:', {
		url: supabaseUrl ? '✅ Set' : '❌ Missing',
		key: supabaseAnonKey ? '✅ Set' : '❌ Missing',
	});
} else if (import.meta.env.DEV) {
	console.log('✅ Supabase client configured:', {
		url: supabaseUrl.substring(0, 30) + '...',
		keyLength: supabaseAnonKey.length,
	});
}

// Exposed for the few flows that must call the GoTrue REST endpoint directly (e.g. password change
// with `current_password`, a field not yet typed by the pinned supabase-js version).
export const SUPABASE_URL = supabaseUrl;
export const SUPABASE_ANON_KEY = supabaseAnonKey;

// Read before createClient: the client clears the hash while it starts (see recoveryLink.ts).
let recoveryLinkSeen = typeof window !== 'undefined' && isRecoveryHash(window.location.hash);

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
	auth: {
		autoRefreshToken: true,
		persistSession: true,
		detectSessionInUrl: true,
	},
});

supabase.auth.onAuthStateChange((event) => {
	if (event === 'PASSWORD_RECOVERY') recoveryLinkSeen = true;
});

/** True once this page load arrived through a password-reset link (unlocks ResetPasswordPage). */
export const cameFromRecoveryLink = (): boolean => recoveryLinkSeen;

// Export a helper to check if Supabase is properly configured
export const isSupabaseConfigured = (): boolean => {
	return !!(supabaseUrl && supabaseAnonKey && supabaseUrl !== 'https://placeholder.supabase.co');
};
