import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const MIGRATION = path.resolve(
  process.cwd(),
  'supabase/migrations/20260912180000_lock_report_marts_and_secrets.sql',
);

describe('20260912180000 lock report marts and secrets', () => {
  const sql = readFileSync(MIGRATION, 'utf8');

  it('revokes anon/authenticated access to report marts', () => {
    expect(sql).toContain('REVOKE ALL ON TABLE public.report_geo_daily_mart FROM PUBLIC, anon, authenticated');
    expect(sql).toContain('REVOKE ALL ON TABLE public.report_ranking_daily_mart FROM PUBLIC, anon, authenticated');
    expect(sql).toContain('GRANT SELECT ON TABLE public.report_geo_daily_mart TO service_role');
  });

  it('re-drops keyword_metrics client write policies', () => {
    expect(sql).toContain('DROP POLICY IF EXISTS "auth insert keyword_metrics"');
    expect(sql).toContain('DROP POLICY IF EXISTS "auth update keyword_metrics"');
    expect(sql).toContain('REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER');
  });

  it('column-locks Squarespace OAuth tokens', () => {
    expect(sql).toContain('squarespace_connections');
    expect(sql).not.toMatch(/GRANT SELECT\s*\([^)]*access_token/);
    expect(sql).toContain('squarespace_connections_safe');
  });

  it('prevents clients from setting share_token', () => {
    expect(sql).toContain('client_reports_protect_share_token');
    expect(sql).toContain('NEW.share_token := NULL');
  });

  it('protects project spend columns on INSERT', () => {
    expect(sql).toContain("IF TG_OP = 'INSERT'");
    expect(sql).toContain('BEFORE INSERT OR UPDATE ON public.projects');
  });
});

describe('20260912190500 clamp finalize_account_spend', () => {
  const sql = readFileSync(
    path.resolve(process.cwd(), 'supabase/migrations/20260912190500_clamp_finalize_account_spend.sql'),
    'utf8',
  );

  it('stamps account_cap_cents at reserve and clamps finalize', () => {
    expect(sql).toContain("jsonb_build_object('account_cap_cents', p_cap_cents)");
    expect(sql).toContain('v_cap - v_spent_others');
    expect(sql).toContain('LEAST(GREATEST(0, COALESCE(p_cost_cents, 0))');
  });
});

describe('20260912191000 consume_credits owner guard', () => {
  const sql = readFileSync(
    path.resolve(process.cwd(), 'supabase/migrations/20260912191000_consume_credits_owner_guard.sql'),
    'utf8',
  );

  it('requires auth.uid() = p_user_id for authenticated callers', () => {
    expect(sql).toContain("auth.role() = 'authenticated' AND auth.uid() IS DISTINCT FROM p_user_id");
    expect(sql).toContain("auth.role() = 'anon'");
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.consume_credits');
    expect(sql).toContain('TO authenticated, service_role');
  });
});
