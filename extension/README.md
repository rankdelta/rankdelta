# Rankdelta SEO Toolbar (Chrome MV3)

An Ahrefs-style toolbar that shows Rankdelta SEO metrics for the domain of the
tab you are currently browsing. It talks to the hosted Rankdelta **MCP server**
(`https://mcp.rankdelta.ai/mcp`, JSON-RPC 2.0) using your personal API key.

This folder is **self-contained** and independent from the main Rankdelta web
app — it has its own `package.json`, build, and tests, and does not touch the
Vite app or its CI.

## What the popup shows

Click the toolbar icon on any normal website and the popup:

1. reads the active tab's hostname (stripping `www.`),
2. calls `domain_overview` and `backlink_summary` for that domain **in parallel**, and
3. renders a compact card:
   - **Organic overview** — organic traffic / month, organic keywords
   - **Backlinks** — backlinks, referring domains

States are handled explicitly:

- **No key** → prompt to open settings
- **Loading** → skeleton
- **401** → "invalid or expired key — update it"
- **Error / empty** → graceful message per card

A footer link opens [rankdelta.ai](https://rankdelta.ai).

Plan/budget limits are enforced **server-side** by the API — the extension just
surfaces whatever the key is entitled to, and shows any tool error plainly.

## Get / enter your API key

1. Sign in at [rankdelta.ai](https://rankdelta.ai) → **Settings → API & MCP** and
   create a personal key (it looks like `sk_rankdelta_…`).
2. Open the extension **Options** page (right-click the icon → *Options*, or the
   "Settings" link in the popup).
3. Paste the key and click **Save**. Use **Test key** to validate it
   (runs a `tools/list` call and reports OK / invalid).

The key is stored only in this browser via `chrome.storage.local`, is sent only
to `mcp.rankdelta.ai`, and is never logged.

## Build

Requires Node 18+ and [pnpm](https://pnpm.io).

```bash
cd extension
pnpm install
pnpm build      # → extension/dist
```

`pnpm build` regenerates the icons, bundles the popup/options TypeScript with
esbuild, and copies the manifest + static assets into `dist/`.

Other scripts:

```bash
pnpm test        # unit tests (vitest) — no network
pnpm typecheck   # tsc --noEmit
```

## Load unpacked in Chrome

1. Run `pnpm build`.
2. Open `chrome://extensions`.
3. Enable **Developer mode** (top-right).
4. Click **Load unpacked** and select the `extension/dist` folder.
5. Pin the Rankdelta icon and click it on any website.

## Manifest / permissions

Manifest V3. Permissions are intentionally minimal:

- `activeTab` — read the current tab's URL when you click the icon
- `storage` — persist the API key locally
- host permission for `https://mcp.rankdelta.ai/*` only — the sole network target

All network calls happen from the popup/options context (never a content
script), so the API key never enters page context. No remote code, no broad
host access, CSP-safe (external scripts only, no inline JS).

## Architecture

```
extension/
  manifest.json            MV3 manifest
  public/
    popup.html/.css        toolbar popup UI
    options.html/.css      settings page
    icons/                 generated PNG icons (16/32/48/128)
  src/
    lib/
      hostname.ts          normalizeHostname, looksLikeApiKey  (pure, tested)
      mcp.ts               JSON-RPC builders + result parsing  (pure, tested)
                           + callMcpTool / testApiKey (network)
      storage.ts           chrome.storage.local wrapper
      types.ts
    popup/popup.ts         reads tab → calls MCP → renders card
    options/options.ts     save + test key
  scripts/
    build.mjs              esbuild bundle + asset copy
    gen-icons.mjs          dependency-free PNG icon generator
  test/                    vitest unit tests
```

## Notes

- Chrome Web Store submission (zipping `dist`, listing assets, review) is a
  later step and is **out of scope** for this MVP.
