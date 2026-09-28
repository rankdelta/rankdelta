# Rankdelta

> **Open-source SEO and AI-visibility reporting, for agencies and for your own sites.**

Find out what ChatGPT, Perplexity and Gemini say when someone asks for what you sell. See it next to your Google rankings, Search Console and GA4, and send it as one report your client actually reads. Run it on your own keys, or let us host it.

[![License: AGPL-3.0](https://img.shields.io/badge/license-AGPL--3.0-blue.svg)](LICENSE)
[![MCP server](https://img.shields.io/badge/MCP-32%20tools-8b5cf6.svg)](#connect-your-ai-agent-mcp)
[![Languages](https://img.shields.io/badge/reports-English%20%7C%20Italiano-10b981.svg)](#why-rankdelta)
[![Hosted cloud](https://img.shields.io/badge/cloud-rankdelta.ai-111.svg)](https://rankdelta.ai)

**[Hosted cloud](https://rankdelta.ai)** · **[Self-host guide](SELF_HOSTING.md)** · **[MCP docs](https://rankdelta.ai/docs/mcp)** · **[Discussions](https://github.com/rankdelta/rankdelta/discussions)**

Works with your agent: Claude, ChatGPT, Cursor, OpenCode, or any MCP client.

![A Rankdelta client report: cover, executive briefing, export to PDF and PowerPoint](.github/assets/client-report.png)

## Why Rankdelta

- **Your prompts, asked live.** Not a pre-collected database: Rankdelta asks ChatGPT, Perplexity, Gemini and Google AI Overviews the questions your buyers ask, on a schedule, for about $0.004 per prompt per engine. You see who gets named, who gets named instead of you, and which sources the answers cite.
- **One report per site, ready to send.** AI visibility, rankings, Search Console, GA4, site health and backlinks in one place, with a summary and next steps grounded in the numbers. Keep it for your team or white-label it; share it by link, email it weekly or monthly, export it to PDF or PowerPoint.
- **English and Italian.** Prompts are generated in each market's language, and the interface, reports and emails come in both. New sites pick up their language and market from the site itself.
- **A writer that doesn't make things up.** It drafts the page you're missing from live SERP research, and never invents statistics, experts, quotes or sources: where your own data belongs, it leaves a visible `[Source needed: …]` note.
- **Agent-native.** 32 MCP tools with per-user keys, so your agent can run the same workflows you do.
- **No feature gates.** Self-hosting is bring-your-own-keys (DataForSEO + OpenRouter), with every feature unlocked and no Rankdelta fee.

## What's inside

- AI visibility: share of voice, competitors named instead of you, cited sources, Google AI Overviews
- Reports for your own sites or your clients, scheduled, white-label, PDF and PowerPoint
- Keyword research with SERP clustering
- Rank tracking
- Site audit, technical and GEO
- Site Explorer and backlinks
- GEO content writer
- Coming next: one-click publishing to WordPress and Shopify (hosted cloud)

| AI visibility | Site health and next steps |
|---|---|
| ![AI Share of Voice by engine, prompts won and missed, tracked competitors](.github/assets/ai-visibility.png) | ![Technical health score, issues holding the site back, next steps](.github/assets/site-health.png) |

## One codebase, two editions

| | Self-host (AGPL-3.0) | Hosted cloud |
|---|---|---|
| Code | this repo | this repo, plus hosted billing and the marketing site |
| Keys | **bring your own** (DataForSEO + OpenRouter) | managed |
| Billing | none — every feature unlocked | plans |
| AI visibility, research, audits, rank tracking | yes | yes |
| Reports (own sites or white-label), scheduled delivery, PDF/PPTX | yes | yes |
| MCP server | yes (your instance) | yes (`mcp.rankdelta.ai`) |
| Content auto-publisher (WordPress/Shopify) | — | in progress |

Cloud: [rankdelta.ai](https://rankdelta.ai)

## Connect your AI agent (MCP)

Paste into Cursor (`~/.cursor/mcp.json`), Claude Desktop, or any client that takes `mcpServers`:

```json
{
  "mcpServers": {
    "rankdelta": {
      "url": "https://mcp.rankdelta.ai/mcp",
      "headers": { "Authorization": "Bearer sk_rankdelta_…" }
    }
  }
}
```

Claude Code:

```bash
claude mcp add rankdelta --transport http https://mcp.rankdelta.ai/mcp --header "Authorization: Bearer sk_rankdelta_…"
```

Create the key in **Settings → API & MCP**. Self-hosted? Use your own endpoint, `<your Supabase URL>/functions/v1/mcp`, with a key from your instance. ChatGPT (Developer mode), OpenCode and Grok setups: [rankdelta.ai/docs/mcp](https://rankdelta.ai/docs/mcp). On the cloud, every tool call runs through the same server-side spend cap as the web app, so an agent in a loop can't overspend your account. On a self-host you pay your providers directly: see [Spending](SELF_HOSTING.md#spending).

## Quick start (self-host)

Full guide: **[SELF_HOSTING.md](SELF_HOSTING.md)**. To try it on your machine you need Docker, Node 20, pnpm and the [Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started). CI runs this setup, with the Docker frontend, on every change.

```bash
supabase start                   # Postgres, Auth and the edge runtime, with the migrations applied

# Your provider keys, server-side only (this file is git-ignored)
cat > supabase/functions/.env <<'EOF'
SELF_HOST=true
OPENROUTER_API_KEY=...
DATAFORSEO_LOGIN=...
DATAFORSEO_PASSWORD=...
EOF
psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -f supabase/setup/self-host.sql   # once: no plans on a self-host
supabase functions serve --env-file supabase/functions/.env   # leave it running

cp .env.selfhost.example .env    # VITE_SUPABASE_URL=http://127.0.0.1:54321, ANON_KEY from `supabase status`
pnpm install
pnpm dev                         # http://localhost:5173
```

Prefer containers for the app too? `docker compose -f docker-compose.selfhost.yml up --build` serves it on http://localhost:8080.

Putting it on a public URL? Create your account, then **turn sign-ups off**: every account spends on your provider keys ([Lock down sign-ups](SELF_HOSTING.md#before-it-is-reachable-from-the-internet-lock-down-sign-ups)).

Provider keys (**DataForSEO, OpenRouter, Pexels, …**) are **edge-function secrets**, never `VITE_` variables — anything prefixed `VITE_` is compiled into the browser bundle. On a hosted Supabase project, set them with `supabase secrets set …` and deploy with `supabase functions deploy`.

Scheduled scans, scheduled report emails and the Search Console refresh need one more step — see *Scheduled jobs* in [SELF_HOSTING.md](SELF_HOSTING.md#4-scheduled-jobs-email-and-google-optional).

## What self-hosting costs

You pay your providers directly, per use — there is no Rankdelta fee. Measured on the hosted cloud:

| Action | Typical cost |
|---|---|
| One AI-visibility check (1 prompt × 1 engine, OpenRouter) | ~$0.004 (p90 $0.01) |
| One research lookup (Site Explorer / keyword research, DataForSEO) | ~$0.03 |
| One Google rank check (DataForSEO SERP) | ~$0.002 |
| One full article (draft, sources, fact-check) | ~$0.09 |

A weekly scan of 25 prompts on 3 engines is roughly $0.30–0.75 per site per week. Supabase's free tier is enough to start.

## How it compares to OpenSEO

[OpenSEO](https://github.com/every-app/open-seo) is a great project, and if you only need research data for yourself it may be all you need. Rankdelta is for people who report on SEO and AI visibility, for clients or for their own sites, and who publish content:

| | Rankdelta | OpenSEO |
|---|---|---|
| AI visibility data | **your own prompts, run live** on ChatGPT, Perplexity and Gemini through OpenRouter (~$0.004 per prompt per engine), plus Google AI Overviews through DataForSEO | DataForSEO LLM Mentions: a pre-collected database for ChatGPT and Google AI ($0.10 per request + $0.001 per row) |
| Content creation | **SEO/GEO article writer** grounded in live SERP research, with fact-checking, verified citations and no invented statistics | — (SERP analysis for keyword research) |
| Reports | **built from your data** for your own sites or white-labelled for clients: AI visibility, rankings, Search Console, GA4 and site health, with scheduled email, PDF and PowerPoint export | agent-written HTML reports on demand, with templates and share links |
| Languages | **English and Italian** (interface, prompts, reports, emails) | English |
| License | AGPL-3.0 | MIT |

Built by a team that runs SEO for client sites and our own: the reports are the ones clients ask us for. *Comparison based on OpenSEO's public repository and docs, and DataForSEO's public pricing, as of September 2026.*

## Honest caveats

- Search volumes, difficulty and traffic are estimates from DataForSEO, not an Ahrefs-scale index.
- AI answers are sampled, so Share of Voice is a measurement with noise, not a ranking.
- ChatGPT and Gemini are queried as models through OpenRouter, without web search: they answer from the model, not like the ChatGPT or Gemini apps browsing the web, and never cite sources. Sources and the citation rate come from Perplexity and Google AI Overviews. Reports say so next to the numbers.

## Stack

Vite + React 19 + TypeScript, Supabase (Postgres, Auth, Edge Functions on Deno), Tailwind. Package manager: **pnpm**. More guides in [docs/](docs/).

```bash
pnpm dev            # Vite
pnpm typecheck      # tsc --noEmit
pnpm lint           # eslint (errors only)
pnpm test:unit      # vitest
pnpm build          # tsc && vite build
```

## Security

- Never put OpenAI / DataForSEO / Pexels / Unsplash / Perplexity keys in `.env` as `VITE_*`.
- The anon Supabase key is public by design; **Row Level Security** is the access control.
- Found a vulnerability? Please report it privately — see [SECURITY.md](SECURITY.md).

## Community & contributing

- Questions and ideas: [GitHub Discussions](https://github.com/rankdelta/rankdelta/discussions). Bugs: [issues](https://github.com/rankdelta/rankdelta/issues).
- Contributing: [CONTRIBUTING.md](CONTRIBUTING.md), [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md). First PRs sign the [Contributor License Agreement](ICLA.md) with a one-line comment ([entity version](CCLA.md)). Working with an AI coding agent? It should read [AGENTS.md](AGENTS.md).

## License

[AGPL-3.0](LICENSE) © Agape Group GmbH. The name and logo **Rankdelta** are trademarks — see [TRADEMARK.md](TRADEMARK.md).
