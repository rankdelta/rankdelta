import { defineConfig, devices } from "@playwright/test";

/**
 * Browser tests of the self-host edition: build with VITE_DEPLOYMENT_MODE=selfhost, then
 * `pnpm test:e2e`. Playwright serves dist/ with `vite preview` unless E2E_BASE_URL points at a
 * running instance (for example the Docker frontend on http://localhost:8080).
 */
const baseURL = process.env.E2E_BASE_URL || "http://localhost:4173";

export default defineConfig({
	testDir: "./e2e",
	fullyParallel: true,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 1 : 0,
	workers: process.env.CI ? 1 : undefined,
	reporter: process.env.CI ? "list" : "html",
	use: {
		baseURL,
		trace: "on-first-retry",
	},
	projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
	webServer: process.env.E2E_BASE_URL
		? undefined
		: {
				command: "pnpm exec vite preview --port 4173 --strictPort",
				url: baseURL,
				reuseExistingServer: !process.env.CI,
			},
});
