/**
 * Self-host edition in a real browser: a fresh visitor lands on login, never on plans or billing,
 * the MCP sign-in posts to the install's own Supabase, and nothing calls our cloud or a tracker.
 * Build first with VITE_DEPLOYMENT_MODE=selfhost (see playwright.config.ts).
 */
import { expect, test, type Page } from '@playwright/test';

// Hosts a self-hosted install must never contact on its own. Fonts are loaded from Google Fonts.
const FORBIDDEN = /rankdelta\.ai|posthog|google-analytics|googletagmanager|ads-twitter|analytics\.twitter|vercel-insights|stripe\.com/;

function recordRequests(page: Page): string[] {
	const urls: string[] = [];
	page.on('request', (r) => urls.push(r.url()));
	return urls;
}

test('a fresh visitor lands on login, with no marketing page and no cloud calls', async ({ page }) => {
	const urls = recordRequests(page);
	await page.goto('/');
	await expect(page).toHaveURL(/\/login$/);
	await expect(page.locator('input[type="email"]')).toBeVisible();
	await page.waitForLoadState('networkidle');
	expect(urls.filter((u) => FORBIDDEN.test(u))).toEqual([]);
});

for (const path of ['/pricing', '/billing', '/upgrade']) {
	test(`${path} shows no plans on self-host`, async ({ page }) => {
		await page.goto(path);
		await expect(page).toHaveURL(/\/login$/);
	});
}

test('the served CSP lets the app reach this install and nothing of ours', async ({ request }) => {
	const csp = (await request.get('/')).headers()['content-security-policy'];
	test.skip(!csp, 'served without a CSP header (vite preview); the Docker image sets one');
	const directive = (name: string) =>
		(csp!.split(';').map((d) => d.trim()).find((d) => d.startsWith(`${name} `)) ?? '').split(/\s+/);
	const supabase = new URL(process.env['VITE_SUPABASE_URL'] || 'http://127.0.0.1:54321').origin;
	expect(directive('connect-src')).toContain(supabase);
	expect(directive('form-action')).toContain(supabase);
	expect(csp).not.toMatch(/posthog|ads-twitter|googletagmanager|stripe|rankdelta\.ai|__[A-Z_]+__/);
});

test('MCP sign-in posts the key to this install, whatever the link says', async ({ page }) => {
	const urls = recordRequests(page);
	await page.goto('/oauth/mcp-authorize?client_id=c1&redirect_uri=https%3A%2F%2Fclaude.ai%2Fcb&state=s&code_challenge=x&issuer=https%3A%2F%2Fevil.example');
	const action = await page.locator('form').getAttribute('action');
	const supabaseUrl = (process.env['VITE_SUPABASE_URL'] || 'http://127.0.0.1:54321').replace(/\/$/, '');
	expect(action).toBe(`${supabaseUrl}/functions/v1/mcp/authorize`);
	await expect(page.locator('input[name="client_id"]')).toHaveValue('c1');
	await page.waitForLoadState('networkidle');
	expect(urls.filter((u) => FORBIDDEN.test(u))).toEqual([]);
});
