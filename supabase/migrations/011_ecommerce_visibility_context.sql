-- E-commerce GEO context (store type + catalog hints for prompt generation)
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS store_platform VARCHAR(32),
  ADD COLUMN IF NOT EXISTS catalog_notes TEXT;

COMMENT ON COLUMN projects.store_platform IS 'shopify | woocommerce | custom | marketplace | other';
COMMENT ON COLUMN projects.catalog_notes IS 'Categories, hero SKUs, collections — used to tailor AI shopping prompts';
