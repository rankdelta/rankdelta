/**
 * Self-host with REAL provider keys (OpenRouter + DataForSEO): the paid paths a self-hoster runs
 * first, kept to the smallest calls (one prompt on one engine, one keyword, one page) — a few cents
 * per run. Runs only with E2E_REAL_KEYS=1, from the manual "Self-host real keys" workflow.
 */
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

const SUPABASE = (process.env['VITE_SUPABASE_URL'] || 'http://127.0.0.1:54321').replace(/\/$/, '');
const ANON = process.env['VITE_SUPABASE_ANON_KEY'] || '';

test.skip(!process.env['E2E_REAL_KEYS'], 'spends real API credits; set E2E_REAL_KEYS=1');
test.setTimeout(240_000);

type ToolResult = { isError?: boolean; content?: Array<{ text?: string }>; structuredContent?: Record<string, unknown> };

async function call(request: APIRequestContext, key: string, name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
	const res = await request.post(`${SUPABASE}/functions/v1/mcp`, {
		headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
		data: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } },
		timeout: 180_000,
	});
	expect(res.status(), await res.text()).toBe(200);
	const body = (await res.json()) as { result?: ToolResult };
	const result = body.result ?? {};
	const text = result.content?.[0]?.text ?? '';
	expect(result.isError ?? false, `${name}: ${text.slice(0, 500)}`).toBe(false);
	return (result.structuredContent as Record<string, unknown> | undefined) ?? (JSON.parse(text || '{}') as Record<string, unknown>);
}

async function signUpAndCreateKey(page: Page): Promise<string> {
	const password = 'E2e-realkeys-9fX!';
	await page.goto('/signup');
	await page.locator('#email').fill(`realkeys-${Date.now()}@example.com`);
	await page.locator('#password').fill(password);
	await page.locator('#confirmPassword').fill(password);
	await page.locator('button[type="submit"]').click();
	await expect(page).not.toHaveURL(/\/(signup|login)(\?|$)/, { timeout: 30_000 });
	const created = await page.evaluate(
		async ({ supabase, anon }) => {
			const tokenKey = Object.keys(localStorage).find((k) => k.endsWith('-auth-token'));
			const session = JSON.parse((tokenKey && localStorage.getItem(tokenKey)) || '{}') as { access_token?: string };
			const res = await fetch(`${supabase}/functions/v1/api-keys`, {
				method: 'POST',
				headers: { Authorization: `Bearer ${session.access_token ?? ''}`, apikey: anon, 'Content-Type': 'application/json' },
				body: JSON.stringify({ name: 'realkeys' }),
			});
			return (await res.json().catch(() => ({}))) as { key?: string };
		},
		{ supabase: SUPABASE, anon: ANON },
	);
	expect(created.key ?? '').toMatch(/^sk_rankdelta_/);
	return created.key as string;
}

test('real keys: AI visibility, keyword research and a page audit work on a self-hosted install', async ({ page, request }) => {
	const key = await signUpAndCreateKey(page);

	const site = await call(request, key, 'add_site', { name: 'Rankdelta', website_url: 'https://rankdelta.ai' });
	const siteId = String(site['id'] ?? '');
	expect(siteId).not.toBe('');

	// OpenRouter: generate the tracked prompts, then one prompt on one web-grounded engine.
	await call(request, key, 'setup_ai_visibility', { site_id: siteId });
	const scan = await call(request, key, 'run_visibility_scan', { site_id: siteId, engines: ['perplexity'], max_queries: 1 });
	expect(JSON.stringify(scan)).not.toMatch(/not configured|OPENROUTER_API_KEY/i);
	const visibility = await call(request, key, 'get_ai_visibility', { site_id: siteId });
	expect(JSON.stringify(visibility)).toMatch(/perplexity/i);

	// DataForSEO: one keyword lookup and one page audit.
	const kw = await call(request, key, 'keyword_research', { mode: 'lookup', seed: 'seo reporting software' });
	expect(JSON.stringify(kw)).toMatch(/volume|search_volume/i);
	const audit = await call(request, key, 'audit_page', { url: 'https://rankdelta.ai' });
	expect(JSON.stringify(audit)).not.toMatch(/not configured|DATAFORSEO_LOGIN/i);
});
