-- Re-run enforce_client_report_share_token on existing public links.
-- The trigger only fires on INSERT/UPDATE; tokens minted before it landed
-- would otherwise stay reachable at /r/:token.
UPDATE public.client_reports
SET share_token = share_token
WHERE share_token IS NOT NULL AND btrim(share_token) <> '';
