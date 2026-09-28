import { describe, it, expect } from 'vitest';
import {
  renderTable,
  formatSites,
  formatVisibility,
  formatRanks,
  formatAudit,
  resolveSiteId,
  type SiteRecord,
} from '../format';

describe('renderTable', () => {
  it('aligns columns and adds a separator row', () => {
    const out = renderTable(['A', 'BB'], [['1', '2'], ['long', 'x']]);
    const lines = out.split('\n');
    expect(lines[0]).toMatch(/^A\s+BB$/);
    expect(lines[1]).toMatch(/^-+\s+-+$/);
    expect(lines[2]).toContain('1');
    expect(lines[3]).toContain('long');
  });

  it('returns the empty message for no rows', () => {
    expect(renderTable(['A'], [], 'nothing')).toBe('nothing');
  });

  it('renders null/undefined cells as dashes', () => {
    const out = renderTable(['A', 'B'], [[null, undefined]]);
    expect(out).toContain('-');
  });
});

describe('formatSites', () => {
  it('lists sites with a count', () => {
    const out = formatSites([
      { id: 's1', name: 'Acme', website_url: 'https://acme.com' },
      { id: 's2', name: 'Beta', website_url: 'https://beta.io' },
    ]);
    expect(out).toContain('Acme');
    expect(out).toContain('https://beta.io');
    expect(out).toContain('2 site(s).');
  });

  it('handles the empty case', () => {
    expect(formatSites([])).toMatch(/No sites yet/);
  });

  it('unwraps an object payload with a results array', () => {
    const out = formatSites({ results: [{ id: 's1', name: 'X', website_url: 'x.com' }] });
    expect(out).toContain('s1');
  });
});

describe('formatVisibility', () => {
  it('shows overall SoV and a per-engine table', () => {
    const out = formatVisibility(
      {
        overallShareOfVoice: 37.5,
        perEngine: [
          { engine: 'chatgpt', shareOfVoice: 40, yourMentions: 4, competitorMentions: 6, yourRecommended: 2 },
        ],
      },
      'acme.com',
    );
    expect(out).toContain('acme.com');
    expect(out).toContain('37.5%');
    expect(out).toContain('chatgpt');
    expect(out).toContain('40%');
  });

  it('handles not_configured', () => {
    const out = formatVisibility({ status: 'not_configured', message: 'use setup_ai_visibility' });
    expect(out).toMatch(/not configured/i);
    expect(out).toContain('use setup_ai_visibility');
  });
});

describe('formatRanks', () => {
  it('renders a keyword table with a count', () => {
    const out = formatRanks(
      [
        { keyword: 'dog food', latest_position: 3, is_active: true, ranking_url: 'https://x/1', latest_checked_at: '2026-09-01T00:00:00Z' },
        { keyword: 'cat toys', latest_position: null, is_active: false, ranking_url: null, latest_checked_at: null },
      ],
      'acme',
    );
    expect(out).toContain('dog food');
    expect(out).toContain('paused');
    expect(out).toContain('2026-09-01');
    expect(out).toContain('2 keyword(s).');
  });

  it('handles no keywords', () => {
    expect(formatRanks([])).toMatch(/No tracked keywords/);
  });
});

describe('formatAudit', () => {
  it('summarizes key on-page fields', () => {
    const out = formatAudit({
      url: 'https://acme.com/pricing',
      result: {
        status_code: 200,
        meta: {
          title: 'Pricing',
          title_length: 7,
          description: 'Our plans',
          internal_links_count: 12,
          external_links_count: 3,
          images_count: 5,
          htags: { h1: ['Pricing that scales'] },
        },
        checks: { no_h1_tag: false, is_https: true, canonical: false },
        page_timing: { dom_complete: 850 },
      },
    });
    expect(out).toContain('https://acme.com/pricing');
    expect(out).toContain('Pricing');
    expect(out).toContain('200');
    expect(out).toContain('Pricing that scales');
    // checks are reported neutrally with their boolean values
    expect(out).toMatch(/Checks reported/);
    expect(out).toContain('is_https=true');
    expect(out).toContain('no_h1_tag=false');
    expect(out).toContain('canonical=false');
  });
});

describe('resolveSiteId', () => {
  const sites: SiteRecord[] = [
    { id: 'aaaaaaaa-0000-0000-0000-000000000001', name: 'Acme', website_url: 'https://www.acme.com/' },
    { id: 'bbbbbbbb-0000-0000-0000-000000000002', name: 'Beta Shop', website_url: 'https://beta.io' },
  ];

  it('matches an exact id', () => {
    expect(resolveSiteId(sites, sites[0].id)).toEqual({ id: sites[0].id });
  });

  it('matches by domain ignoring www/protocol', () => {
    expect(resolveSiteId(sites, 'acme.com')).toEqual({ id: sites[0].id });
    expect(resolveSiteId(sites, 'https://acme.com/pricing')).toEqual({ id: sites[0].id });
  });

  it('matches by name substring', () => {
    expect(resolveSiteId(sites, 'beta')).toEqual({ id: sites[1].id });
  });

  it('errors with candidates when nothing matches', () => {
    const r = resolveSiteId(sites, 'nope.example');
    expect('error' in r).toBe(true);
    if ('error' in r) expect(r.candidates).toHaveLength(2);
  });

  it('uses the only site when the query is empty', () => {
    expect(resolveSiteId([sites[0]], '')).toEqual({ id: sites[0].id });
  });

  it('errors on empty query with multiple sites', () => {
    const r = resolveSiteId(sites, '');
    expect('error' in r).toBe(true);
  });
});
