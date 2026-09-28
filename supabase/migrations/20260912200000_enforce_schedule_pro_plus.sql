-- Active report_schedules require the same Pro+ entitlement as report-build
-- (plan pro/agency OR plan_configurations.features.rank_tracking).
-- RLS only checks project ownership, so a non-Pro+ client can INSERT active:true
-- via PostgREST; the runner would then skip them every cron tick.

CREATE OR REPLACE FUNCTION public.enforce_report_schedule_pro_plus()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_plan text;
  v_rank_tracking boolean;
BEGIN
  IF NEW.active IS NOT TRUE THEN
    RETURN NEW;
  END IF;

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

REVOKE ALL ON FUNCTION public.enforce_report_schedule_pro_plus() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_enforce_report_schedule_pro_plus ON public.report_schedules;
CREATE TRIGGER trg_enforce_report_schedule_pro_plus
  BEFORE INSERT OR UPDATE OF active, user_id
  ON public.report_schedules
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_report_schedule_pro_plus();

-- Deactivate schedules that slipped in before this trigger.
-- Same entitlement rule as the trigger above, including the status filter: a
-- churned customer's active schedule would otherwise survive this sweep and keep
-- emailing their clients after they stopped paying.
UPDATE public.report_schedules rs
SET active = false
WHERE rs.active = true
  AND NOT EXISTS (
    SELECT 1
    FROM public.subscriptions s
    LEFT JOIN public.plan_configurations pc ON pc.plan = s.plan
    WHERE s.user_id = rs.user_id
      AND s.status IN ('active', 'trialing', 'past_due')
      AND (
        lower(coalesce(s.plan::text, '')) IN ('pro', 'agency')
        OR COALESCE((pc.features ->> 'rank_tracking')::boolean, false)
      )
  );
