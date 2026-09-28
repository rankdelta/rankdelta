-- Free AI-visibility check funnel: record the result-email outcome per lead, tag the request
-- source, and add the columns the (flag-gated, default OFF) nurture follow-up needs.
--
-- Rows come from two callers: the landing widget and server-to-server integrations (no
-- `formStartedAt`). `source` separates the two so the nurture runner can address widget leads ONLY.
--
-- Idempotent: safe to re-run. Nothing here changes behaviour by itself — the edge functions write
-- the new columns tolerantly, and the nurture runner is gated behind LEAD_NURTURE_ENABLED=1.

-- Result-email outcome (written by ai-visibility-check right after the lead insert).
ALTER TABLE public.public_check_leads ADD COLUMN IF NOT EXISTS email_sent boolean;
ALTER TABLE public.public_check_leads ADD COLUMN IF NOT EXISTS email_error text;
ALTER TABLE public.public_check_leads ADD COLUMN IF NOT EXISTS lang text;
-- 'widget' (landing form, sent formStartedAt) | 'programmatic' (server-to-server integration).
-- NULL = legacy row created before this migration (treated as NOT widget by the nurture runner).
ALTER TABLE public.public_check_leads ADD COLUMN IF NOT EXISTS source text;

-- Nurture follow-up (lead-nurture-runner) + unsubscribe (lead-unsubscribe).
ALTER TABLE public.public_check_leads ADD COLUMN IF NOT EXISTS nurture_sent_at timestamptz;
ALTER TABLE public.public_check_leads ADD COLUMN IF NOT EXISTS nurture_error text;
ALTER TABLE public.public_check_leads ADD COLUMN IF NOT EXISTS unsubscribed_at timestamptz;
ALTER TABLE public.public_check_leads ADD COLUMN IF NOT EXISTS unsubscribe_token text;

COMMENT ON COLUMN public.public_check_leads.email_sent IS 'Whether the result email was accepted by Resend (NULL = unknown / pre-migration).';
COMMENT ON COLUMN public.public_check_leads.email_error IS 'unconfigured | rate_capped | resend_<status> | exception when email_sent = false.';
COMMENT ON COLUMN public.public_check_leads.lang IS 'Language of the check result (drives EN/IT follow-up copy).';
COMMENT ON COLUMN public.public_check_leads.source IS 'widget | programmatic. NULL = legacy row; never nurtured.';
COMMENT ON COLUMN public.public_check_leads.nurture_sent_at IS 'When the one-off nurture follow-up was sent (NULL = not yet).';
COMMENT ON COLUMN public.public_check_leads.nurture_error IS 'Why the nurture send failed or was skipped for this row (one attempt only).';
COMMENT ON COLUMN public.public_check_leads.unsubscribed_at IS 'Set by lead-unsubscribe for every row of that email.';
COMMENT ON COLUMN public.public_check_leads.unsubscribe_token IS 'Random 32-hex token minted at nurture time; looked up by lead-unsubscribe.';

-- Nurture candidates are a tiny slice of the table (widget rows, emailed, not yet nurtured).
CREATE INDEX IF NOT EXISTS idx_public_check_leads_nurture_pending
  ON public.public_check_leads (created_at)
  WHERE source = 'widget' AND email_sent = true AND nurture_sent_at IS NULL AND nurture_error IS NULL;

CREATE INDEX IF NOT EXISTS idx_public_check_leads_unsubscribe_token
  ON public.public_check_leads (unsubscribe_token)
  WHERE unsubscribe_token IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_public_check_leads_email
  ON public.public_check_leads (email);

-- Does a lead already have an account? auth.admin.listUsers is paginated and slow for this; a
-- SECURITY DEFINER lookup on auth.users is exact and cheap. Service-role only (the nurture runner).
CREATE OR REPLACE FUNCTION public.lead_email_has_account(p_email text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT EXISTS (
    SELECT 1 FROM auth.users u
    WHERE lower(u.email) = lower(trim(p_email))
  );
$$;

REVOKE ALL ON FUNCTION public.lead_email_has_account(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lead_email_has_account(text) TO service_role;

-- Reload PostgREST schema cache so the new columns / RPC are served immediately.
NOTIFY pgrst, 'reload schema';
