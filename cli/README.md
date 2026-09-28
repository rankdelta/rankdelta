# rankdelta CLI

A thin, zero-runtime-dependency command-line client for the hosted **Rankdelta**
MCP server. It authenticates with your personal API key and calls MCP tools over
JSON-RPC 2.0, printing human-friendly tables — or raw JSON with `--json`.

It talks to the same endpoint as the Rankdelta MCP connector
(`https://mcp.rankdelta.ai/mcp`), so anything you can do from ChatGPT / Cursor /
Claude connectors, you can now do from your terminal and shell scripts.

## Install

> **Not published to npm yet.** For now, build from this folder:

```bash
cd cli
pnpm install        # or: npm install
pnpm build          # bundles to dist/index.js
node dist/index.js --help
```

Once published, it will be a global install:

```bash
npm i -g rankdelta        # (coming soon — not yet on npm)
rankdelta --help
```

You can also link it locally to get the `rankdelta` binary on your PATH:

```bash
cd cli && pnpm build && npm link
rankdelta sites
```

## Authentication

Create a personal API key at **rankdelta.ai → Settings → API & MCP**
(keys start with `sk_rankdelta_…`; legacy `sk_astroseo_…` keys also work).

Provide it either way:

```bash
export RANKDELTA_API_KEY=sk_rankdelta_xxxxxxxx
rankdelta sites

# or per-invocation
rankdelta sites --key sk_rankdelta_xxxxxxxx
```

The key is read only from the environment or the `--key` flag. It is never
logged, printed, or written anywhere.

## Commands

| Command | MCP tool | What it does |
| --- | --- | --- |
| `rankdelta sites` | `list_sites` | List the sites tracked in your account |
| `rankdelta visibility <site>` | `get_ai_visibility` | AI Share of Voice across ChatGPT / Perplexity / Gemini (last 30 days) |
| `rankdelta audit <url>` | `audit_page` | On-page / technical SEO snapshot for a URL |
| `rankdelta ranks [site]` | `list_ranks` | Tracked keywords + latest stored Google position |

`<site>` accepts a **site id, name, or domain** — the CLI resolves it against
your tracked sites. For `ranks`, if you omit the site and you only have one, it
is used automatically.

### Global flags

| Flag | Meaning |
| --- | --- |
| `--key <key>` | API key (overrides `RANKDELTA_API_KEY`) |
| `--json` | Print the raw MCP tool result as JSON instead of a table |
| `-h`, `--help` | Show usage |
| `-v`, `--version` | Show version |

### Examples

```bash
rankdelta sites
rankdelta visibility example.com
rankdelta visibility example.com --json
rankdelta ranks
rankdelta audit https://example.com/pricing
```

## Exit codes

| Code | Meaning |
| --- | --- |
| `0` | Success |
| `1` | No API key, invalid/expired key (HTTP 401), network failure, or MCP tool error |
| `2` | Usage error (unknown command, unknown flag, missing argument) |

## Development

This folder is its **own package root**, isolated from the main app (it ships an
empty `pnpm-workspace.yaml` so `pnpm install` at the repo root is unaffected and
vice-versa). Vanilla TypeScript, bundled with esbuild, tested with vitest.

```bash
pnpm install
pnpm typecheck      # tsc --noEmit
pnpm test           # vitest run (all offline, no network)
pnpm build          # esbuild -> dist/index.js (executable, with shebang)
```

Source layout:

- `src/args.ts` — hand-rolled argv parser (zero deps)
- `src/mcp.ts` — JSON-RPC request builders, SSE/JSON response parser, result
  extraction, and the `McpClient` (network behind an injectable `fetch`)
- `src/format.ts` — table/summary formatters + pure site resolver
- `src/index.ts` — command dispatch and error handling
