# Contributing

Rankdelta is AGPL-3.0. Contributions are accepted under the [Individual Contributor License Agreement](ICLA.md) (FLA 2.1): on your first pull request the CLA check asks you to sign it with a one-line comment. Contributing for your employer? Your company accepts the [Entity version](CCLA.md) — email info@rankdelta.ai.

## Setup

```bash
pnpm install
cp .env.selfhost.example .env
pnpm dev
```

Never commit `.env` or API keys. Provider keys go in edge-function secrets, not `VITE_*`. Using an AI coding agent? Point it at [AGENTS.md](AGENTS.md).

### Supabase API keys in edge functions

Supabase is retiring the legacy JWT keys, and both reserved secrets are already marked DEPRECATED in
the dashboard. Do **not** read them directly. Use the resolver in
[`supabase/functions/_shared/supabaseKeys.ts`](supabase/functions/_shared/supabaseKeys.ts):

```ts
import { publishableKey, secretKey } from '../_shared/supabaseKeys.ts'

const admin = createClient(Deno.env.get('SUPABASE_URL') ?? '', secretKey())
```

`secretKey()` reads `SUPABASE_SECRET_KEYS` and falls back to `SUPABASE_SERVICE_ROLE_KEY`;
`publishableKey()` reads `SUPABASE_PUBLISHABLE_KEYS` and falls back to `SUPABASE_ANON_KEY`. The new
variables hold a JSON dictionary of keys (the migration flow names its key `default`), the legacy
ones a bare string — the resolver handles both and never throws. `keySource()` reports which path
each key took, for logging.

## Checks

```bash
pnpm typecheck
pnpm lint
pnpm test:unit
pnpm build
```

`pnpm run build` runs `tsc` then Vite. Do not skip typecheck.

`pnpm lint` fails on errors only (CI runs it). `pnpm lint:all` also lists the type-safety warnings still being paid down (`no-unsafe-*`, `no-explicit-any`, floating promises); please don't add new ones in the files you touch.

## Commits

Conventional commits (`feat:`, `fix:`, `docs:`, `security:`). Keep PRs small.

## Scope

Self-host and cloud share this codebase. Gate billing/credits behind `src/config/deployment.ts`. Do not add cloud-only secrets to the client bundle.
