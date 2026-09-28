-- New rows default to English / global instead of Italian. Only affects inserts that omit the
-- column (the app now derives language + market from the site); existing rows are untouched.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'projects' AND column_name = 'language') THEN
    ALTER TABLE public.projects ALTER COLUMN language SET DEFAULT 'en';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'projects' AND column_name = 'market') THEN
    ALTER TABLE public.projects ALTER COLUMN market SET DEFAULT 'global';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'visibility_queries' AND column_name = 'language') THEN
    ALTER TABLE public.visibility_queries ALTER COLUMN language SET DEFAULT 'en';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'user_preferences' AND column_name = 'language') THEN
    ALTER TABLE public.user_preferences ALTER COLUMN language SET DEFAULT 'en';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'wp_connections' AND column_name = 'site_language') THEN
    ALTER TABLE public.wp_connections ALTER COLUMN site_language SET DEFAULT 'en';
  END IF;
END $$;
