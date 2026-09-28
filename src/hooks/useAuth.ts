/**
 * Authentication Hook
 * 
 * Provides authentication state and methods for login, signup, and logout.
 * Uses Supabase for authentication management.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabaseClient';
import { getSessionSafe } from '../lib/requireAuth';
import { trackSignup } from '../lib/analytics';

interface SignUpData {
	email: string;
	password: string;
}

interface SignInData {
	email: string;
	password: string;
}

/**
 * Get current user session
 */
export const useAuth = () => {
	const queryClient = useQueryClient();

	// Get current session — via getSessionSafe: on a cold page load the raw getSession() can
	// race the client's storage restore and return null; with staleTime Infinity that null would
	// be cached FOREVER, making the whole app treat a logged-in user as logged out.
	const { data: session, isLoading: isLoadingSession } = useQuery({
		queryKey: ['auth', 'session'],
		queryFn: async () => {
			const {
				data: { session },
			} = await getSessionSafe();
			return session;
		},
		staleTime: Infinity,
	});

	// Get current user
	const { data: user, isLoading: isLoadingUser } = useQuery({
		queryKey: ['auth', 'user'],
		queryFn: async () => {
			const {
				data: { user },
			} = await supabase.auth.getUser();
			return user;
		},
		enabled: !!session,
		staleTime: Infinity,
	});

	// Sign up mutation
	const signUpMutation = useMutation({
		mutationFn: async ({ email, password }: SignUpData) => {
			const { data, error } = await supabase.auth.signUp({
				email,
				password,
				options: {
					emailRedirectTo: typeof window !== 'undefined' 
						? `${window.location.origin}/auth/callback`
						: undefined,
				},
			});

			if (error) {
				console.error('Supabase signup error:', error.message);
				throw error;
			}
			
			// If user is created but no session (email confirmation required)
			if (data.user && !data.session) {
				console.log('User created, email confirmation required');
			} else if (data.session) {
				console.log('User created and authenticated');
			}
			
			return data;
		},
		onSuccess: (data) => {
			// Signup conversion — fans out to PostHog + X pixel (see analytics).
			trackSignup({ hasSession: !!data?.session });
			// Only invalidate queries if we have a session
			if (data?.session) {
				queryClient.invalidateQueries({ queryKey: ['auth'] });
			}
		},
	});

	// Sign in mutation
	const signInMutation = useMutation({
		mutationFn: async ({ email, password }: SignInData) => {
			const { data, error } = await supabase.auth.signInWithPassword({
				email,
				password,
			});

			if (error) throw error;
			return data;
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ['auth'] });
		},
	});

	// Google OAuth mutation
	const signInWithGoogleMutation = useMutation({
		mutationFn: async () => {
			const { data, error } = await supabase.auth.signInWithOAuth({
				provider: 'google',
				options: {
					redirectTo: `${window.location.origin}/auth/callback`,
				},
			});

			if (error) throw error;
			return data;
		},
	});

	// Sign out mutation.
	// Best practice: logout must ALWAYS clear local state and land the user on /login, even if the
	// server-side token revoke fails (e.g. the refresh token was already invalidated by a password
	// change). Previously a thrown error skipped the cleanup, leaving a half-logged-out shell (a
	// stale user with no data → "No site"). We swallow revoke errors and redirect in onSettled.
	const signOutMutation = useMutation({
		mutationFn: async () => {
			try {
				await supabase.auth.signOut();
			} catch {
				/* ignore — local cleanup + redirect happen regardless below */
			}
		},
		onSettled: () => {
			queryClient.clear();
			// Drop per-user localStorage state so the next user on this machine doesn't inherit it
			// (active project, GSC property, proposal/onboarding progress, …). The Supabase auth key
			// (sb-*) is handled by signOut(); analytics consent and the i18n language are device-level.
			try {
				if (typeof window !== 'undefined') {
					const stale: string[] = [];
					for (let i = 0; i < localStorage.length; i++) {
						const key = localStorage.key(i);
						if (!key) continue;
						if (
							key.startsWith('astroseo:') ||
							key.startsWith('astroseo_') ||
							key.startsWith('gsc_property_') ||
							key.startsWith('ga4_property_') ||
							key === 'proposalGeneration' ||
							key === 'onboarding_wizard_completed'
						) {
							stale.push(key);
						}
					}
					stale.forEach((key) => localStorage.removeItem(key));
				}
			} catch {
				/* ignore — storage may be unavailable */
			}
			// Hard redirect guarantees a clean in-memory slate and re-runs the route guards.
			if (typeof window !== 'undefined') {
				window.location.href = '/login';
			}
		},
	});

	return {
		user: user ?? null,
		session: session ?? null,
		isLoading: isLoadingSession || (!!session && isLoadingUser),
		isAuthenticated: !!user,
		signUp: signUpMutation.mutateAsync,
		signIn: signInMutation.mutateAsync,
		signInWithGoogle: signInWithGoogleMutation.mutateAsync,
		signOut: signOutMutation.mutateAsync,
		isSigningUp: signUpMutation.isPending,
		isSigningIn: signInMutation.isPending,
		isSigningOut: signOutMutation.isPending,
	};
};

