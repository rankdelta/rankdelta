-- Self-hosted installs have no plans or billing, so the plan-enforcement triggers must not fire
-- there. Every sign-up gets a 'starter'/'incomplete' subscription row (migration 009); without this
-- flag a self-hoster could not create a scheduled report, brand it, save a report template or keep
-- a public share link (the triggers answered plan_required or dropped the token).
--
-- The flag defaults to false: the hosted cloud behaves exactly as before. A self-hoster turns it on
-- once with supabase/setup/self-host.sql (see SELF_HOSTING.md).

CREATE TABLE IF NOT EXISTS public.instance_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  self_host boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.instance_settings (id) VALUES (true) ON CONFLICT (id) DO NOTHING;
ALTER TABLE public.instance_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.instance_settings FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.is_self_host()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce((SELECT self_host FROM public.instance_settings WHERE id), false)
$$;
-- Trigger WHEN clauses run as the calling role, so the roles that write these tables must be able
-- to evaluate it. It only reveals whether this install is self-hosted.
GRANT EXECUTE ON FUNCTION public.is_self_host() TO anon, authenticated, service_role;

-- Recreate the plan triggers so they only fire on the hosted cloud. Function bodies are unchanged.
-- Guarded: an install that never ran the enforcement migrations simply has nothing to recreate.
DO $$
BEGIN
  IF to_regprocedure('public.enforce_client_report_share_token()') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_enforce_client_report_share_token ON public.client_reports;
    CREATE TRIGGER trg_enforce_client_report_share_token
      BEFORE INSERT OR UPDATE OF share_token, user_id
      ON public.client_reports
      FOR EACH ROW
      WHEN (NOT public.is_self_host())
      EXECUTE FUNCTION public.enforce_client_report_share_token();
  END IF;

  IF to_regprocedure('public.enforce_report_schedule_pro_plus()') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_enforce_report_schedule_pro_plus ON public.report_schedules;
    CREATE TRIGGER trg_enforce_report_schedule_pro_plus
      BEFORE INSERT OR UPDATE OF active, user_id, branding
      ON public.report_schedules
      FOR EACH ROW
      WHEN (NOT public.is_self_host())
      EXECUTE FUNCTION public.enforce_report_schedule_pro_plus();
  END IF;

  IF to_regprocedure('public.enforce_report_template_pro_plus()') IS NOT NULL
     AND to_regclass('public.report_templates') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_enforce_report_template_pro_plus ON public.report_templates;
    CREATE TRIGGER trg_enforce_report_template_pro_plus
      BEFORE INSERT OR UPDATE OF user_id, layout
      ON public.report_templates
      FOR EACH ROW
      WHEN (NOT public.is_self_host())
      EXECUTE FUNCTION public.enforce_report_template_pro_plus();
  END IF;
END $$;
