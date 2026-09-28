/**
 * Full self-host stack in a real browser: local Supabase (auth, DB, edge functions with
 * SELF_HOST=true) behind the Docker frontend. Sign up, create a personal API key from the page (so
 * CSP, CORS, the session JWT and RLS all take part), then use that key on the MCP server to add and
 * list a site. Runs only with E2E_FULLSTACK=1 — see the "Self-host full stack" CI job.
 */
import { expect, test, type APIRequestContext } from '@playwright/test';

const SUPABASE = (process.env['VITE_SUPABASE_URL'] || 'http://127.0.0.1:54321').replace(/\/$/, '');
const ANON = process.env['VITE_SUPABASE_ANON_KEY'] || '';

test.skip(!process.env['E2E_FULLSTACK'], 'needs a running local Supabase; set E2E_FULLSTACK=1');
test.describe.configure({ mode: 'serial' });

async function mcp(request: APIRequestContext, key: string, method: string, params: Record<string, unknown> = {}) {
	const res = await request.post(`${SUPABASE}/functions/v1/mcp`, {
		headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
		data: { jsonrpc: '2.0', id: 1, method, params },
	});
	expect(res.status(), await res.text()).toBe(200);
	return res.json();
}

test('sign up, create an API key in the browser, then use it over MCP', async ({ page, request }) => {
	const email = `e2e-${Date.now()}@example.com`;
	const password = 'E2e-selfhost-9fX!';

	await page.goto('/signup');
	await page.locator('#email').fill(email);
	await page.locator('#password').fill(password);
	await page.locator('#confirmPassword').fill(password);
	await page.locator('button[type="submit"]').click();
	await expect(page).not.toHaveURL(/\/(signup|login)(\?|$)/, { timeout: 30_000 });

	// From the app's own origin, with its CSP: the same call Settings → API & MCP makes.
	const created = await page.evaluate(
		async ({ supabase, anon }) => {
			const tokenKey = Object.keys(localStorage).find((k) => k.endsWith('-auth-token'));
			const session = JSON.parse((tokenKey && localStorage.getItem(tokenKey)) || '{}') as { access_token?: string };
			const token = session.access_token ?? '';
			const res = await fetch(`${supabase}/functions/v1/api-keys`, {
				method: 'POST',
				headers: { Authorization: `Bearer ${token}`, apikey: anon, 'Content-Type': 'application/json' },
				body: JSON.stringify({ name: 'e2e' }),
			});
			return { status: res.status, body: (await res.json().catch(() => ({}))) as { key?: string } };
		},
		{ supabase: SUPABASE, anon: ANON },
	);
	expect(created.status, JSON.stringify(created.body)).toBe(201);

	// First run has no provider keys (CI sets none): the page must be able to read which key is
	// missing, not a bare network error.
	const research = await page.evaluate(
		async ({ supabase, anon }) => {
			const tokenKey = Object.keys(localStorage).find((k) => k.endsWith('-auth-token'));
			const session = JSON.parse((tokenKey && localStorage.getItem(tokenKey)) || '{}') as { access_token?: string };
			try {
				const res = await fetch(`${supabase}/functions/v1/seo-proxy`, {
					method: 'POST',
					headers: { Authorization: `Bearer ${session.access_token ?? ''}`, apikey: anon, 'Content-Type': 'application/json' },
					body: JSON.stringify({ action: 'dataforseo', endpoint: '/serp/google/organic/live/advanced', payload: [] }),
				});
				return { status: res.status, text: await res.text() };
			} catch (e) {
				return { status: 0, text: String(e) };
			}
		},
		{ supabase: SUPABASE, anon: ANON },
	);
	expect(research.status, research.text).toBe(500);
	expect(research.text).toContain('DATAFORSEO_LOGIN');
	const key = String(created.body.key ?? '');
	expect(key).toMatch(/^sk_rankdelta_/);

	// No SSE stream on GET: a client holding a valid key gets 405 and keeps using POST. Only a
	// client without a key gets 401 + OAuth discovery (a 401 here sent Cursor into an OAuth loop).
	const getWithKey = await request.get(`${SUPABASE}/functions/v1/mcp`, { headers: { Authorization: `Bearer ${key}` } });
	expect(getWithKey.status()).toBe(405);
	const getWithoutKey = await request.get(`${SUPABASE}/functions/v1/mcp`);
	expect(getWithoutKey.status()).toBe(401);
	expect(getWithoutKey.headers()['www-authenticate'] ?? '').toContain('resource_metadata');

	const tools = await mcp(request, key, 'tools/list');
	const names = (tools.result?.tools ?? []).map((t: { name: string }) => t.name);
	expect(names).toEqual(expect.arrayContaining(['list_sites', 'add_site']));

	const added = await mcp(request, key, 'tools/call', {
		name: 'add_site',
		arguments: { name: 'E2E Coffee Roasters', website_url: 'https://coffee.example' },
	});
	expect(added.result?.isError ?? false, JSON.stringify(added)).toBe(false);

	const sites = await mcp(request, key, 'tools/call', { name: 'list_sites', arguments: {} });
	expect(JSON.stringify(sites.result)).toContain('E2E Coffee Roasters');

	// Self-host has no plans in the database either (supabase/setup/self-host.sql): the new account
	// can schedule a branded report, and the runner does not answer plan_required on a test send.
	const addedResult = (added as { result?: { structuredContent?: { id?: string }; content?: Array<{ text?: string }> } }).result;
	const siteId = String(addedResult?.structuredContent?.id ?? (JSON.parse(addedResult?.content?.[0]?.text ?? '{}') as { id?: string }).id ?? '');
	expect(siteId).not.toBe('');
	const scheduling = await page.evaluate(
		async ({ supabase, anon, projectId }) => {
			const tokenKey = Object.keys(localStorage).find((k) => k.endsWith('-auth-token'));
			const session = JSON.parse((tokenKey && localStorage.getItem(tokenKey)) || '{}') as { access_token?: string; user?: { id?: string } };
			const headers = { Authorization: `Bearer ${session.access_token ?? ''}`, apikey: anon, 'Content-Type': 'application/json' };
			const insert = await fetch(`${supabase}/rest/v1/report_schedules`, {
				method: 'POST',
				headers: { ...headers, Prefer: 'return=representation' },
				body: JSON.stringify({
					project_id: projectId, user_id: session.user?.id, cadence: 'weekly', day_of_week: 1,
					recipients: [], active: true, branding: { agencyName: 'E2E Agency' },
				}),
			});
			const rows = (await insert.json().catch(() => [])) as Array<{ id?: string }> | { message?: string };
			const scheduleId = Array.isArray(rows) ? rows[0]?.id : undefined;
			const test = scheduleId
				? await fetch(`${supabase}/functions/v1/report-schedule-runner`, { method: 'POST', headers, body: JSON.stringify({ dry_run: true, schedule_id: scheduleId }) })
				: null;
			return { insertStatus: insert.status, insertBody: JSON.stringify(rows).slice(0, 300), testStatus: test?.status ?? 0, testBody: test ? await test.text() : '' };
		},
		{ supabase: SUPABASE, anon: ANON, projectId: siteId },
	);
	expect(scheduling.insertStatus, scheduling.insertBody).toBe(201);
	expect(scheduling.testBody).not.toContain('plan_required');
	// No report was built yet, so the dry run stops right after the plan check.
	expect(scheduling.testBody).toContain('no_report');

	// Self-host has no plans: reports, white-label and the portfolio are open to this new account.
	await page.goto('/reports/portal');
	await expect(page.getByRole('button', { name: /Build report/i })).toBeVisible({ timeout: 20_000 });
	await expect(page.getByText(/available on Pro and Agency plans/i)).toHaveCount(0);
	await page.goto('/reports/portfolio');
	await page.waitForLoadState('networkidle');
	await expect(page.getByText(/available on the Agency plan/i)).toHaveCount(0);
});
