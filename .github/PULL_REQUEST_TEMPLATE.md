## What

<!-- One or two sentences: what changes and why. Link the issue if there is one. -->

## How it was tested

- [ ] `pnpm typecheck`
- [ ] `pnpm exec vitest run src/`
- [ ] `pnpm build` (or `VITE_DEPLOYMENT_MODE=selfhost pnpm build` for self-host paths)
- [ ] Manually verified in the browser (say where)

## Checklist

- [ ] No secrets, tokens, or real customer data in the diff (the pre-commit secret guard passed)
- [ ] User-facing strings added to **both** `en` and `it` locales
- [ ] Self-host still builds and any cloud-only behaviour is gated (`isCloud()` / `requiresSubscription()`)
- [ ] If this touches the database: a migration is included, is additive/reversible, and RLS is preserved
- [ ] If this touches an edge function: `deno check` introduces no new errors
- [ ] Docs updated where behaviour changed (README / SELF_HOSTING / docs)
