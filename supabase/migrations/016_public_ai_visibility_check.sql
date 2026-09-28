-- Public "does AI cite you?" landing widget: per-domain result cache, lead capture, and an
-- IP rate-limit log. All tables are RLS-enabled with NO policies, so only the service_role
-- (used by the ai-visibility-check edge function) can read/write — the anon/public client cannot.
-- Applied to production via Supabase MCP on 2026-06-18; this file keeps the repo in sync.

create table if not exists public.public_ai_checks (
  domain text primary key,
  result jsonb not null,
  checked_at timestamptz not null default now(),
  hits int not null default 1
);
alter table public.public_ai_checks enable row level security;

create table if not exists public.public_check_leads (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  domain text not null,
  ip text,
  api_spent boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.public_check_leads enable row level security;

create index if not exists idx_public_check_leads_ip_time on public.public_check_leads (ip, created_at desc);
create index if not exists idx_public_check_leads_created on public.public_check_leads (created_at desc);
