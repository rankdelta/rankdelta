// TypeScript IntelliSense for VITE_ .env variables.
// VITE_ prefixed variables are exposed to the client. Never put provider API keys here.
// https://vitejs.dev/guide/env-and-mode.html

/// <reference types="vite/client" />

interface ImportMetaEnv {
	readonly VITE_APP_TITLE: string;
	readonly VITE_SUPABASE_URL?: string;
	readonly VITE_SUPABASE_ANON_KEY?: string;
	readonly VITE_GOOGLE_CLIENT_ID?: string;
	readonly VITE_STRIPE_PUBLISHABLE_KEY?: string;
	readonly VITE_USE_SUPABASE_PROXY?: string;
	readonly VITE_DEPLOYMENT_MODE?: string;
	readonly VITE_PRODUCT_MODE?: string;
	readonly VITE_FORCE_LEGACY_AGENT_UI?: string;
	readonly VITE_DISABLE_VISIBILITY_OPS?: string;
	// Analytics / tracking — each provider activates only if its var is set.
	readonly VITE_SUPPORT_EMAIL?: string;
	readonly VITE_POSTHOG_KEY?: string;
	readonly VITE_POSTHOG_HOST?: string;
	readonly VITE_GA_ID?: string;
	readonly VITE_TWITTER_PIXEL_ID?: string;
	// Optional X (Twitter) Ads "event ids" for conversion optimization.
	readonly VITE_TWITTER_EVENT_SIGNUP?: string;
	readonly VITE_TWITTER_EVENT_CHECK?: string;
	readonly VITE_TWITTER_PURCHASE_EVENT_ID?: string;
}

interface ImportMeta {
	readonly env: ImportMetaEnv;
}
