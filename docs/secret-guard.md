# Secret Guard

Prevents hardcoded API secrets from landing in the repo. Two layers:

Both layers are already enabled; there is nothing to set up.

## 1. Pre-commit hook

`.husky/pre-commit` runs `node scripts/check-secrets.mjs` on every commit (installed by `pnpm install`).

## 2. CI

The **Secret scan** job in `.github/workflows/ci.yml` runs the same script on every pull request.

## What it catches

Assigned values that look like real credentials for: OpenRouter / OpenAI / Perplexity keys (`sk-…`, `or-…`), DataForSEO login/password, Stripe secret & webhook signing keys (`sk_test_…`, `whsec_…`), Resend (`re_…`), Supabase service-role JWTs, MCP_API_TOKEN, Pexels/Unsplash keys, and PEM private-key blocks.

Empty values and obvious placeholders (`<…>`, `your-…`, `${VAR}`) are allowed, so `.env.example` files pass.
