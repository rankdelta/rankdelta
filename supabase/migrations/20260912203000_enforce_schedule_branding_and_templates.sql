-- 1) Agency-only branding on report_schedules (same white_label rule as share_token).
-- 2) Pro+ required to persist report_templates (UI already gates on isProPlusPlan).

CREATE OR REPLACE FUNCTION public.enforce_report_schedule_pro_plus()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_plan text;
  v_rank_tracking boolean;
  v_white_label boolean;
BEGIN
  SELECT s.plan,
         COALESCE((pc.features ->> 'rank_tracking')::boolean, false),
         COALESCE((pc.features ->> 'white_label')::boolean, false)
    INTO v_plan, v_rank_tracking, v_white_label
  FROM public.subscriptions s
  LEFT JOIN public.plan_configurations pc ON pc.plan = s.plan
  WHERE s.user_id = NEW.user_id
    AND s.status IN ('active', 'trialing', 'past_due')
  LIMIT 1;

  IF NEW.active IS TRUE THEN
    IF NOT (lower(coalesce(v_plan, '')) IN ('pro', 'agency') OR v_rank_tracking IS TRUE) THEN
      RAISE EXCEPTION 'plan_required'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  IF lower(coalesce(v_plan, '')) <> 'agency' AND v_white_label IS NOT TRUE THEN
    NEW.branding := NULL;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_report_schedule_pro_plus ON public.report_schedules;
CREATE TRIGGER trg_enforce_report_schedule_pro_plus
  BEFORE INSERT OR UPDATE OF active, user_id, branding
  ON public.report_schedules
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_report_schedule_pro_plus();

UPDATE public.report_schedules rs
SET branding = NULL
WHERE rs.branding IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM public.subscriptions s
    LEFT JOIN public.plan_configurations pc ON pc.plan = s.plan
    WHERE s.user_id = rs.user_id
      AND s.status IN ('active', 'trialing', 'past_due')
      AND (
        lower(coalesce(s.plan::text, '')) = 'agency'
        OR COALESCE((pc.features ->> 'white_label')::boolean, false)
      )
  );

CREATE OR REPLACE FUNCTION public.enforce_report_template_pro_plus()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_plan text;
  v_rank_tracking boolean;
BEGIN
  SELECT s.plan, COALESCE((pc.features ->> 'rank_tracking')::boolean, false)
    INTO v_plan, v_rank_tracking
  FROM public.subscriptions s
  LEFT JOIN public.plan_configurations pc ON pc.plan = s.plan
  WHERE s.user_id = NEW.user_id
    AND s.status IN ('active', 'trialing', 'past_due')
  LIMIT 1;

  IF lower(coalesce(v_plan, '')) IN ('pro', 'agency') OR v_rank_tracking IS TRUE THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'plan_required'
    USING ERRCODE = '42501';
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_report_template_pro_plus() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_enforce_report_template_pro_plus ON public.report_templates;
CREATE TRIGGER trg_enforce_report_template_pro_plus
  BEFORE INSERT OR UPDATE OF user_id, layout
  ON public.report_templates
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_report_template_pro_plus();
