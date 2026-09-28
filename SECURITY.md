# Security

## Reporting a vulnerability

Please **do not open a public issue**. Report it privately through GitHub: on this repository go to
**Security → Advisories → Report a vulnerability**. We acknowledge within 3 working days and keep you
updated until a fix ships. Include the affected edge function or page, steps to reproduce, and the
impact you observed. Any testing against the hosted cloud must stay within your own account's data.

## What is safe in the browser (`VITE_*`)

Vite inlines every `VITE_` variable into the client bundle. Only these belong there:

- `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` — public by design; **RLS** is the control plane
- `VITE_GOOGLE_CLIENT_ID` — OAuth client id (not a secret)
- `VITE_STRIPE_PUBLISHABLE_KEY` — `pk_…` only (hosted cloud; not used by a self-host)
- `VITE_USE_SUPABASE_PROXY` / `VITE_DEPLOYMENT_MODE` / `VITE_ENABLE_AI_ANSWER_RECEIPTS` — flags
- `VITE_MCP_URL` / `VITE_SUPPORT_EMAIL` — public URLs and addresses shown in the app

The anon key is not a secret. If RLS is wrong, anyone with the anon key can read/write. Keep RLS on every table; never ship `SERVICE_ROLE_KEY` to the client.

## What must stay server-side

Set as **Supabase edge-function secrets** (`supabase secrets set …`):

- `DATAFORSEO_LOGIN` / `DATAFORSEO_PASSWORD`
- `OPENROUTER_API_KEY` (required for AI-visibility scans; `OPENAI_API_KEY` is only a text-generation fallback)
- `PERPLEXITY_API_KEY` (optional)
- `PEXELS_API_KEY` / `UNSPLASH_ACCESS_KEY` (optional stock images)
- `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` (hosted cloud only; a self-host has no billing)
- `MCP_API_TOKEN` (optional, for the single-tenant `mcp-api` on a self-host; min 16 chars. The `mcp` server uses per-user `sk_rankdelta_` keys instead)

The `seo-proxy` Edge Function authenticates the caller, rate-limits, SSRF-guards `fetch`, and holds those keys. `src/utils/env.ts` only exposes the public map above.

## Do not follow old docs

Older MVP-era notes (since removed) described a pre-proxy setup that put provider keys in `VITE_*`. That architecture is gone. This file and `SELF_HOSTING.md` are the source of truth.

## WordPress app passwords

`wp_connections.app_password` is stored in Postgres in plaintext. Column-level grants
revoke **SELECT** of `app_password` from `authenticated` (migration 027), so a browser
session cannot read it back. Clients can still INSERT/UPDATE the column when connecting
a site; the publish path uses the `wp-publish` Edge Function with service_role.
Rotate the WP application password if a session is compromised. Vault/encrypt-at-rest
is a follow-up.

## Residual risk (accepted)

- **DNS TOCTOU:** outbound SSRF checks resolve A records via Cloudflare DoH then `fetch` the
  hostname. A resolver that flips to a private IP between lookup and connect is not pinned.
- **Shopify `issued_at`:** entitlement tokens still accept a missing `issued_at` unless
  `ENTITLEMENTS_REQUIRE_ISSUED_AT` is set. Flipping the default needs a Shopify app lockstep.
- **CSP:** `nginx.selfhost.conf` still allows `script-src 'unsafe-inline'`. A nonce/hash rollout is
  a separate change.
- **WordPress passwords** remain plaintext at rest (column-locked for SELECT).
