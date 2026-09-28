# AGENTS.md — working on Rankdelta with an AI coding agent

Read this before changing code. It is the short list of rules the codebase depends on; breaking one
usually passes the type checker and fails in production.

## Map

- `src/` — the web app (Vite + React 19 + TypeScript, TanStack Router, react-i18next). Pages in
  `src/pages`, route files in `src/routes` (`routeTree.gen.ts` is generated — don't hand-edit it).
- `supabase/functions/` — Edge Functions (Deno). Shared code in `supabase/functions/_shared`; pure
  helpers there are also imported by the web app (e.g. `_shared/siteLocale.ts`).
- `supabase/migrations/` — Postgres schema and RLS. Every table the browser touches is protected by
  Row Level Security; the anon key is public by design.
- `docs/` — guides. `SELF_HOSTING.md` is the self-host entry point.

## Commands

```bash
pnpm install
pnpm typecheck        # tsc --noEmit — must pass
pnpm lint             # errors only — must pass (CI runs it)
pnpm test:unit        # vitest — must pass
deno test --allow-net --allow-env --allow-read --no-check supabase/functions/_shared/__tests__/<file>.test.ts
```

## Rules that matter

1. **Secrets never reach the browser.** Anything prefixed `VITE_` is compiled into the bundle. Provider
   keys (DataForSEO, OpenRouter, Stripe, Resend…) are Edge Function secrets. Read Supabase keys through
   `_shared/supabaseKeys.ts`, never `SUPABASE_SERVICE_ROLE_KEY` directly.
2. **Every paid call goes through the spend cap.** Edge Functions that spend provider money check
   the account budget (`_shared/accountBudget.ts`); don't add a paid path that skips it.
3. **Generated content never invents facts.** Prompts that write content must include
   `noFabricationRules(language)` from `src/lib/contentIntegrity.ts`: no made-up statistics, studies,
   experts, quotes, sources or first-person experience — the model leaves `[Source needed: …]` /
   `[ADD: …]` placeholders instead. Tests assert the forbidden phrases stay out
   (`src/services/noFabricationPrompts.test.ts`).
4. **English is the default language.** Never fall back to a hardcoded locale. A site's language and
   market come from `inferSiteLocale()` (`_shared/siteLocale.ts`); research calls use
   `projectResearchLocale(project)`; UI dates use `uiLocaleTag()`.
5. **UI text is translated.** New strings go in `src/assets/locales/{en,it}/translations.json` with
   identical key sets in both files. Text that is sent to an LLM or stored in the database is not UI
   text — translate it only at display time.
6. **Never report success on failure.** Check every Supabase `{ error }`; a failed write must not end
   in a success toast or a `200`.
7. **Self-host and cloud share one codebase.** Gate billing and plans behind `src/config/deployment.ts`
   (`isSelfHost()`); self-host has no plans and no marketing pages.

## Pull requests

Conventional commits (`feat:`, `fix:`, `docs:`, `security:`), lowercase subject under 100 characters.
Keep PRs small and include tests for pure logic. See [CONTRIBUTING.md](CONTRIBUTING.md).
