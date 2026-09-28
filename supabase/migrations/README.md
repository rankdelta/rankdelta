# Database migrations

SQL migrations in this directory define the Rankdelta database schema. Apply them in filename
order with the [Supabase CLI](https://supabase.com/docs/guides/cli).

## Local development

```bash
supabase start      # local Postgres + Supabase services
supabase db reset   # recreate the local database and apply every migration
```

## Applying to a hosted project

```bash
supabase link --project-ref <project-ref>
supabase db push
```

`supabase db push` applies only the migrations the target database has not recorded yet.
Use `supabase db push --dry-run` to list them first.

## Adding a migration

```bash
supabase migration new <short_description>
```

Write migrations to be idempotent where practical (`IF NOT EXISTS`, `CREATE OR REPLACE`,
`DROP ... IF EXISTS`), keep Row Level Security enabled on every table, and restrict
`SECURITY DEFINER` functions to `service_role` unless clients must call them.
