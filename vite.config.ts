import { TanStackRouterVite } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react-swc";
import path from "node:path";
import { normalizePath } from "vite";
import { viteStaticCopy } from "vite-plugin-static-copy";
import { defineConfig } from "vitest/config";
import tailwindcss from "@tailwindcss/vite";

function asyncCssPlugin() {
	return {
		name: "async-css",
		transformIndexHtml: {
			order: "post",
			handler(html: string) {
				return html.replace(
					/<link rel="stylesheet"( crossorigin)? href="(\/assets\/[^"]+\.css)">/g,
					(_match, cross: string | undefined, href: string) =>
						`<link rel="preload" as="style" href="${href}" onload="this.onload=null;this.rel='stylesheet'"><noscript><link rel="stylesheet"${cross ?? ""} href="${href}"></noscript>`,
				);
			},
		},
	};
}

// https://vitejs.dev/config/
export default defineConfig({
	plugins: [
		// TanStack Router must run before JSX transforms (required by @tanstack/router-plugin).
		// autoCodeSplitting: split every route's component/loader into its own chunk so the entry
		// bundle only ships the code for the current route. Routes load on demand as the user navigates.
		TanStackRouterVite({ autoCodeSplitting: true }),
		react(),
		tailwindcss(),
		asyncCssPlugin(),
		viteStaticCopy({
			targets: [
				{
					src: normalizePath(path.resolve("./src/assets/locales")),
					dest: normalizePath(path.resolve("./dist")),
				},
			],
		}),
	],
	// Strip noisy console.log/info/debug from the production bundle (warn/error stay). `pure` only
	// applies during esbuild's build/minify step, so vitest (which shares this config) is unaffected.
	esbuild: {
		pure: ["console.log", "console.info", "console.debug"],
	},
	build: {
		// Vendor chunking stays on Vite/Rollup DEFAULTS on purpose. Hand-splitting React and TipTap into
		// manual chunks reordered module initialization and white-screened production twice (React
		// `undefined.createContext`, then a TDZ in the split editor chunk). The code-splitting wins are
		// kept WITHOUT manual grouping: autoCodeSplitting splits every route, and the lazy dynamic
		// import()s (RichTextEditor, and jsPDF/docx/html2canvas-pro in export.ts) each get their own chunk
		// automatically — so they still load on demand, just split correctly by the bundler.
		chunkSizeWarningLimit: 1500,
	},
	server: {
		host: true,
		strictPort: true,
	},
	test: {
		environment: "jsdom",
		setupFiles: ["./vitest.setup.ts"],
		// Only the frontend suite runs under vitest. The Deno edge-function tests
		// (supabase/functions/**, run via `deno test`) and the Playwright e2e tests
		// (e2e/**) use runtimes vitest can't load, so a bare `vitest run` otherwise
		// fails those 14 files even though all frontend tests pass.
		include: ["src/**/*.{test,spec}.{ts,tsx}"],
		css: true,
		env: {
			VITE_SUPABASE_URL: "https://example.supabase.co",
			VITE_SUPABASE_ANON_KEY: "test-anon-key",
		},
	},
});
