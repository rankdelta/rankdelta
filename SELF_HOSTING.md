# Self-hosting Rankdelta (open edition)

Rankdelta is one codebase. The managed cloud and a self-hosted install run the **same app**; the
self-host switches (`VITE_DEPLOYMENT_MODE=selfhost` for the browser, `SELF_HOST=true` for the edge
functions, and a one-line database setup, all below) turn billing, paywall and pooled credits off
and run everything on your own keys. Self-hosting is free under AGPL-3.0; you pay DataForSEO and
OpenRouter directly, with no markup.

The fastest way to try it on one machine is the README's
[local quick start](README.md#quick-start-self-host); this page covers a real deployment.

## What you need

- Docker, the [Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started), Node 20+ and pnpm 9
- A Supabase instance — the backend (Postgres + Auth + Edge Functions). Self-host it for free with Supabase's own Docker (step 1), or use a Supabase project. The app is built on Supabase specifically; it isn't swappable for another database/auth stack.
- A [DataForSEO account](https://dataforseo.com/?aff=4bd1c0d8-c60a-4ea3-8a20-0761ea9e8224) (SERP, keywords, backlinks, on-page audit; this is a referral link)
- An OpenRouter API key, required: every AI engine (ChatGPT, Perplexity, Gemini) runs through it, as do
  prompt generation and the content writer. An `OPENAI_API_KEY` works only as a fallback for text
  generation, not for AI-visibility scans.

## 1. Bring up Supabase

The app uses Supabase (Postgres + Auth + Edge Functions), which is itself open source. Pick one:

**A Supabase project** (supabase.com, any plan). Link this checkout to it, then apply the schema
and deploy the edge functions:

```bash
supabase link --project-ref <your-project-ref>
supabase db push                         # applies supabase/migrations
supabase functions deploy                # deploys visibility-ops, seo-proxy, mcp, …
```

**Supabase on your own servers.** Follow the official Docker guide:
<https://supabase.com/docs/guides/self-hosting/docker>. It gives you an API URL (default
`http://localhost:8000`) and an anon key. Apply the schema with
`supabase db push --db-url postgresql://postgres:<password>@<db-host>:5432/postgres`, copy
`supabase/functions/*` into the stack's `volumes/functions/` directory, and put the secrets from
step 2 in the functions service's environment (the `supabase secrets set` commands below are for
Supabase projects).

## 2. Give it your keys (BYOK)

Set your API keys as **edge-function secrets** on your own Supabase — they stay server-side and are
never exposed to the browser:

```bash
supabase secrets set \
  SELF_HOST=true \
  DATAFORSEO_LOGIN=... \
  DATAFORSEO_PASSWORD=... \
  OPENROUTER_API_KEY=... \
  PEXELS_API_KEY=... \
  UNSPLASH_ACCESS_KEY=...
```

`SELF_HOST=true` is required: it is the server-side twin of `VITE_DEPLOYMENT_MODE=selfhost`. The database has a third switch: run [`supabase/setup/self-host.sql`](supabase/setup/self-host.sql) once (SQL editor or `psql`) so scheduled reports, their branding, report templates and public share links are not held to the cloud's plans. Without
it the edge functions apply the cloud's plan checks, and every scan or research call answers
"Paid plan required" once the small onboarding allowance is spent.

**Where the app runs.** Set `APP_ORIGIN` to the URL people open, e.g.
`supabase secrets set APP_ORIGIN=https://seo.youragency.com`. It is used for browser CORS, links in
report emails and the MCP sign-in page. Unset, a self-hosted backend assumes the Docker default
`http://localhost:8080`; `pnpm preview` (`:4173`) and `pnpm dev` (`:5173`) always work. Add other
browser origins (a staging domain, say) to `ALLOWED_ORIGINS`, comma-separated. If the app loads but
every scan or research call fails with a CORS error in the browser console, this is the setting.

Optional: `MCP_API_TOKEN` (16+ random chars) if you run the MCP API. It is one shared token that reads every account's projects, so set it only if you are the instance's sole user (and never on a multi-tenant cloud); everyone else uses personal keys (Settings → API & MCP).

## 3. Configure and run the app

```bash
cp .env.selfhost.example .env      # then fill in VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY
pnpm install
pnpm build
pnpm preview                       # or serve dist/ behind your own reverse proxy
```

With `VITE_DEPLOYMENT_MODE=selfhost`, there is no paywall or trial — every action (audit, visibility
scans, keyword research, rank tracking, content generation) is unlocked and runs on your keys.

### Or run the frontend with Docker

Instead of building locally, use the self-host Docker image (builds the SPA, serves it with nginx).
`VITE_*` are compiled in at build time, so they're passed as build args:

```bash
cp .env.selfhost.example .env      # fill in VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY
docker compose -f docker-compose.selfhost.yml up --build
# open http://localhost:8080
```

This serves only the frontend — your Supabase (steps 1–2) is still the backend. If pnpm asks you to
approve native build scripts during the image build, the Dockerfile already runs `pnpm rebuild` to
handle it; on older pnpm you may need to run `pnpm approve-builds` once locally and rebuild.

### Before it is reachable from the internet: lock down sign-ups

A self-host has no plans and no account-wide spend cap, and Supabase accepts new sign-ups by
default. On an instance anyone can reach, a stranger could register and spend your DataForSEO and
OpenRouter credit, or send report emails through your email domain. Create your own account first,
then turn sign-ups off and add teammates yourself:

- **Supabase project (cloud):** Dashboard → Authentication → Sign In / Providers → turn off
  *Allow new users to sign up*.
- **Local `supabase start`:** add to `supabase/config.toml`, then `supabase stop && supabase start`:

  ```toml
  [auth]
  enable_signup = false
  ```

- **Docker Supabase:** set `DISABLE_SIGNUP=true` in its `.env` and restart the stack.

To add people afterwards: Dashboard → Authentication → Users → *Add user* (or *Invite*, which needs
SMTP). Optionally cap what each account can spend on your keys, in cents per month:
`supabase secrets set SELF_HOST_ACCOUNT_MONTHLY_CAP_CENTS=5000`.

## 4. Scheduled jobs, email and Google (optional)

The app works without this step; these turn on the automatic parts.

**Scheduled jobs.** Weekly AI-visibility scans (the cron fires every 15 minutes and scans the one
most overdue project, so each project is rescanned on its own weekly cadence), daily scheduled
client reports with a Search Console refresh, and a daily ops watchdog all run from `pg_cron`. They
read their shared secrets from Supabase Vault, so the only setup is one SQL paste: open
`supabase/setup/cron-secrets.sql`, replace `https://<project-ref>.supabase.co` with your Supabase URL
(as reachable from the database, e.g. the Kong/API URL of your stack), and run it once in the SQL editor. It is idempotent and generates random secrets — you never copy a value anywhere.
Until you run it, the jobs are scheduled but do nothing.

**Email** (scheduled client reports and watchdog alerts) is sent
with [Resend](https://resend.com). Verify a sending domain in Resend, then:

```bash
supabase secrets set RESEND_API_KEY=re_... RESEND_FROM="Your Agency <reports@yourdomain.com>"
# where the daily watchdog sends alerts; without it a self-host sends none
supabase secrets set OPS_ALERT_EMAIL=you@yourdomain.com
```

**Google Search Console and GA4.** Create an OAuth client (type *Web application*) in Google Cloud,
enable the Search Console API and the Google Analytics Data API, and add your app's origin to the
authorized JavaScript origins. The browser only needs the public client id; the edge functions
exchange the code and store the refresh token server-side:

```bash
# .env (browser, public; the Docker build reads it from .env too)
VITE_GOOGLE_CLIENT_ID=1234-abc.apps.googleusercontent.com
# edge-function secrets (server)
supabase secrets set GOOGLE_CLIENT_ID=1234-abc.apps.googleusercontent.com GOOGLE_CLIENT_SECRET=...
```

Scopes requested: `webmasters.readonly` and `analytics.readonly`.

## Cloud vs self-host

Same features, except the content auto-publisher (WordPress/Shopify), which is in progress on the cloud. The
[cloud](https://rankdelta.ai) runs everything above for you — managed Supabase, keys, email, pooled
credits and team seats — so you don't manage infrastructure. That convenience is what the cloud
charges for, not locked features.

## MCP

Your install serves its own remote MCP endpoint at `<VITE_SUPABASE_URL>/functions/v1/mcp` (set
`VITE_MCP_URL` if you proxy it under your own domain); users create personal keys in
Settings → API & MCP.

Agents that connect with OAuth (for example Claude's "Add custom connector") are sent to
`<APP_ORIGIN>/oauth/mcp-authorize`, where the user pastes a personal key. On a Supabase project this
needs no extra setup. On the Docker Supabase and the local `supabase start` stack the functions see
an internal `SUPABASE_URL`, so set the public MCP URL explicitly — the same URL agents connect to:

```bash
supabase secrets set MCP_ISSUER=http://localhost:8000/functions/v1/mcp MCP_RESOURCE=http://localhost:8000/functions/v1/mcp
```

The `rankdelta` CLI and the browser extension in this repo talk to the hosted cloud's MCP
(`mcp.rankdelta.ai`); on a self-host, connect agents to your own endpoint above.

## Spending

On a self-host you pay DataForSEO and OpenRouter directly, and the cloud's plan limits are off: by
default there is no account-wide spend cap. Set one per account with
`SELF_HOST_ACCOUNT_MONTHLY_CAP_CENTS` (cents per month), and keep sign-ups off on an instance
reachable from the internet (see [Lock down sign-ups](#before-it-is-reachable-from-the-internet-lock-down-sign-ups)).
AI-visibility scans can be capped per project, per month, in Visibility → Settings. Set a monthly
budget with each provider as well.

## Notes

- **Never commit your `.env`** — it points at your Supabase; keys live as edge secrets, not in it.
- Set a strong Supabase JWT secret and don't expose the Postgres port publicly.
- WordPress application passwords in `wp_connections` are stored unencrypted in the database. The browser can't read them back (column grants); only the `wp-publish` function does. Rotate them if the database is compromised.