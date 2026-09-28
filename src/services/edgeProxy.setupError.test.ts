/**
 * A self-hoster without provider keys must see which key is missing, even in a production build
 * where other seo-proxy error bodies stay hidden.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('../lib/supabaseClient', () => ({ supabase: {}, SUPABASE_URL: 'http://127.0.0.1:54321', SUPABASE_ANON_KEY: 'anon' }));

import { setupErrorFromBody } from './edgeProxy';

describe('setupErrorFromBody', () => {
	it('passes through the missing-key messages seo-proxy writes', () => {
		const dataforseo = 'DataForSEO keys not configured: set DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD as edge-function secrets (see SELF_HOSTING.md).';
		expect(setupErrorFromBody(JSON.stringify({ error: dataforseo }))).toBe(dataforseo);
		const llm = 'No LLM key configured: set OPENROUTER_API_KEY (or OPENAI_API_KEY / PERPLEXITY_API_KEY) as an edge-function secret (see SELF_HOSTING.md).';
		expect(setupErrorFromBody(JSON.stringify({ error: llm }))).toBe(llm);
	});

	it('keeps every other upstream body hidden', () => {
		expect(setupErrorFromBody(JSON.stringify({ error: 'relation "keywords" does not exist' }))).toBeNull();
		expect(setupErrorFromBody(JSON.stringify({ error: 'Internal error' }))).toBeNull();
		expect(setupErrorFromBody('<html>502 Bad Gateway</html>')).toBeNull();
		expect(setupErrorFromBody('')).toBeNull();
	});
});
