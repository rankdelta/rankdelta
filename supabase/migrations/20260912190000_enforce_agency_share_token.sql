-- Only Agency / white_label plans may persist a public share_token on client_reports.
-- Closes the bypass where report-build honors { share: true } with no plan check
-- and owners can UPDATE share_token via PostgREST (unrestricted UPDATE policy).
--
-- Entitlement = plan AND a paying status. Checking `plan` alone would leave
-- past-due/paused/incomplete subscriptions fully entitled, because those states
-- leave `plan` at pro/agency (only a definitive cancellation rewrites it to
-- 'free'). `past_due` is included deliberately as a dunning grace window, mirroring
-- src/hooks/useSubscription.ts:320 — revoking a live client-facing link because a
-- card expired is a support incident, and the revenue at risk mid-dunning is small.
-- Comped/off-Stripe grants are unaffected: subscriptions.status is
-- NOT NULL DEFAULT 'active', so a manual grant that sets only `plan` still passes.

CREATE OR REPLACE FUNCTION public.enforce_client_report_share_token()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_plan text;
  v_white_label boolean;
BEGIN
  IF NEW.share_token IS NULL OR btrim(NEW.share_token) = '' THEN
    NEW.share_token := NULL;
    RETURN NEW;
  END IF;

  SELECT s.plan, COALESCE((pc.features ->> 'white_label')::boolean, false)
    INTO v_plan, v_white_label
  FROM public.subscriptions s
  LEFT JOIN public.plan_configurations pc ON pc.plan = s.plan
  WHERE s.user_id = NEW.user_id
    AND s.status IN ('active', 'trialing', 'past_due')
  LIMIT 1;

  IF lower(coalesce(v_plan, '')) = 'agency' OR v_white_label IS TRUE THEN
    RETURN NEW;
  END IF;

  NEW.share_token := NULL;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_client_report_share_token() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_enforce_client_report_share_token ON public.client_reports;
CREATE TRIGGER trg_enforce_client_report_share_token
  BEFORE INSERT OR UPDATE OF share_token, user_id
  ON public.client_reports
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_client_report_share_token();
