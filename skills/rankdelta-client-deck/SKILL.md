---
name: rankdelta-client-deck
description: Turn a Rankdelta client report (AI visibility + SEO) into a client-ready presentation. Use when the user asks for a deck, slides, a presentation or a "riunione col cliente" for a site tracked in Rankdelta. Needs the Rankdelta MCP connector (tools list_sites, list_client_reports, get_client_report) and a way to write .pptx (the pptx skill or python-pptx).
---

# Rankdelta client deck

You are preparing the deck an agency presents to its client. The numbers come from Rankdelta;
the story must be the agency's. One idea per slide, real numbers with their movement, no filler.

## 1. Get the report

1. If the user named the client, call `list_sites` and pick the matching site (name or domain).
2. Call `list_client_reports` with that `site_id` to see the periods available; take the latest
   unless the user asked for a specific month. If the user gave a report link (`/r/<token>` or
   `/reports/portal/<id>`), the id after `/portal/` is the `report_id`.
3. Call `get_client_report` with `report_id` (or `site_id` for the latest).

The result has: `project_name`, `website_url`, `period_start/period_end`, `locale` (`it` or
`en` — write the deck in that language unless told otherwise), `share_url`, `branding`
(`agencyName`, `logoUrl`, `primaryColor`, `hideAstroSeoFooter`), `narrative`
(`executiveSummary`, `nextActions`, per-section `sections` text), `history` (KPI points from
previous reports, when present) and `sections`:

- `summary` — headline KPIs as `{ value, delta, deltaPct }` (`delta: null` = first reading, say so)
- `geo` — AI visibility: `sovOverall`, `sovByEngine[]`, `topPromptsMentioned[]`,
  `topPromptsNotMentioned[]`, `competitorLeaderboard[]`, `citationRate`, `topCitedSources[]`,
  `trend[]`
- `gsc` — Search Console: `clicks`, `impressions`, `ctr`, `avgPosition`, `topQueries[]`,
  `topPages[]`, `trend[]`
- `ga4` — sessions, users, AI-assistant sessions, `topLandingPages[]`
- `rankings` — `avgPosition`, `topMovers[]`, distribution buckets
- `site_health`, `backlinks`, `ai_attribution`

A section that is `null` or `{ status: 'not_connected' }` is not connected: skip it silently —
never put "not connected" in front of a client.

## 2. Build the slides (16:9)

Use the agency's `primaryColor` as the single accent and `agencyName` as the sender; only show
"Powered by Rankdelta" on the closing slide when `hideAstroSeoFooter` is false. Percentages
and decimals follow the locale (`14,3%` in Italian, `14.3%` in English). Movements: green ▲ /
red ▼, positions flip (lower is better). A first reading has no arrow — write "prima lettura" /
"first reading".

1. **Cover** — client name, domain, period, agency name/logo.
2. **In breve / In short** — 3 columns: Risultati · Da tenere d'occhio · Prossime azioni.
   Derive them from `narrative.executiveSummary` and the biggest movements; max 3 bullets each,
   each bullet carries a number.
3. **Visibilità AI / AI visibility** — share of voice as the hero number; bar chart of
   `sovByEngine`; the prompts where the brand is cited and where it is missing (quote the actual
   prompt texts); competitors ranked by mentions. Speaker notes: `narrative.sections.geo`.
4. **Andamento / Trend** (only if `history` has ≥ 2 points) — line chart of share of voice and
   clicks across reports.
5. **Google Search Console** — 4 KPI tiles; line chart of clicks (impressions on its own axis or
   its own chart — never on the same axis as clicks); top queries and top pages tables (8 rows,
   locale-formatted numbers). Notes: `narrative.sections.gsc`.
6. **Traffico / Traffic (GA4)** — sessions, users, AI-assistant sessions, top landing pages.
7. **Posizionamenti / Rankings** — biggest wins and drops (`#14 → #8`), distribution.
8. **Salute del sito e backlink / Site health & backlinks** — score /100 with the top issues,
   referring domains.
9. **Prossimi passi / Next steps** — `narrative.nextActions`, numbered, impact first.
10. **Closing** — "Report preparato da <agency>", the `share_url` as the live report link.

Use the `pptx` skill (or python-pptx) to write the file. Name it
`<client>-<period>-<agency|rankdelta>.pptx`. Before handing it over, re-open it and check:
no empty placeholders, no "undefined"/"NaN", every chart has data, the locale is consistent.

## 3. Tone

Write for a business owner, not an SEO. Lead with what changed and why it matters; put the
method in the notes. Italian must read like a native PM wrote it (no "fai l'upgrade", no calques).
