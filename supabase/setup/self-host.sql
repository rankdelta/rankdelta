-- One-time setup for a self-hosted install: no plans, every report feature unlocked.
-- Run once in the Supabase SQL editor (or psql) after the migrations. Idempotent.
--
-- It turns off the plan-enforcement triggers of the hosted cloud (scheduled reports, their
-- branding, report templates, public share links). The edge functions read SELF_HOST=true and the
-- web app VITE_DEPLOYMENT_MODE=selfhost for the same purpose; this is the database's half.

UPDATE public.instance_settings SET self_host = true, updated_at = now() WHERE id;

-- Check: should return true.
SELECT public.is_self_host() AS self_host;
