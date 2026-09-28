-- Additive shared cache of referring-domain rows so get_link_intersect can join
-- already-paid DataForSEO Backlinks responses (seo-proxy persist). Empty until
-- a referring_domains/backlinks live call has been made. No billing changes.

CREATE TABLE IF NOT EXISTS backlink_referring_domains (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  target_domain TEXT NOT NULL,
  referring_domain TEXT NOT NULL,
  referring_rank INT,
  links_to_target INT,
  sample_target_urls JSONB NOT NULL DEFAULT '[]'::jsonb,
  source_endpoint TEXT,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (target_domain, referring_domain)
);

CREATE INDEX IF NOT EXISTS idx_backlink_referring_domains_target
  ON backlink_referring_domains (target_domain);

CREATE INDEX IF NOT EXISTS idx_backlink_referring_domains_fetched
  ON backlink_referring_domains (fetched_at DESC);

COMMENT ON TABLE backlink_referring_domains IS
  'Public link-graph cache: referring domains for a target, persisted from DataForSEO calls the account already paid for. get_link_intersect reads this; it never fires a new Backlinks API call.';

ALTER TABLE backlink_referring_domains ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth read backlink_referring_domains" ON backlink_referring_domains;
CREATE POLICY "auth read backlink_referring_domains"
  ON backlink_referring_domains FOR SELECT TO authenticated USING (true);

-- No INSERT/UPDATE/DELETE policies for authenticated — service_role (seo-proxy) bypasses RLS.
