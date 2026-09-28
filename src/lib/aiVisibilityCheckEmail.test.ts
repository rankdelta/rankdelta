/**
 * The free check's result email — the first message most leads get from Rankdelta.
 *
 * Regressions pinned here (23/09/26): the Italian email sent Italian leads to the English
 * /signup; a brand ChatGPT already recommends was told to "fix it"; the footer did not say why
 * the email arrived.
 */
import { describe, expect, it } from 'vitest';
import { buildReport } from '../../supabase/functions/ai-visibility-check/email';

const base = { brand: 'Acme Gym', query: 'best gyms in Milan', competitors: ['FitCo', 'Virgin Active'] };

describe('ai-visibility-check result email', () => {
  it('Italian email links to the Italian signup and home', () => {
    const { html, subject } = buildReport('it', { ...base, level: 'absent' });
    expect(subject).toBe('La tua visibilità su ChatGPT: Acme Gym');
    expect(html).toContain("href='https://rankdelta.ai/it/signup'");
    expect(html).toContain("href='https://rankdelta.ai/it'");
    expect(html).not.toContain("href='https://rankdelta.ai/signup'");
    expect(html).toContain("<html lang='it'>");
  });

  it('English email links to the English signup', () => {
    const { html, subject } = buildReport('en', { ...base, level: 'absent' });
    expect(subject).toBe('Your ChatGPT visibility: Acme Gym');
    expect(html).toContain("href='https://rankdelta.ai/signup'");
    expect(html).toContain("<html lang='en'>");
  });

  it('any other language falls back to English', () => {
    expect(buildReport('pt', { ...base, level: 'absent' }).subject).toBe('Your ChatGPT visibility: Acme Gym');
  });

  it('does not tell a recommended brand to "fix it" or call peers "instead"', () => {
    for (const lang of ['en', 'it']) {
      const { html } = buildReport(lang, { ...base, level: 'recommended' });
      expect(html).not.toMatch(/Fix it|Risolvilo/);
      expect(html).not.toMatch(/instead|invece/);
      expect(html).toMatch(/Track it and stay ahead|Monitoralo e resta davanti/);
    }
  });

  it('absent / known brands get the fix-it call to action', () => {
    expect(buildReport('en', { ...base, level: 'known' }).html).toContain('Fix it with Rankdelta');
    expect(buildReport('it', { ...base, level: 'absent' }).html).toContain('Risolvilo con Rankdelta');
  });

  it('says why the email arrived, in the right language', () => {
    expect(buildReport('en', { ...base, level: 'absent' }).html).toContain('requested a free check');
    expect(buildReport('it', { ...base, level: 'absent' }).html).toContain('hai richiesto un check gratuito');
  });

  it('escapes model-derived text', () => {
    const { html } = buildReport('en', { brand: '<script>x</script>', query: 'a & b', level: 'absent', competitors: ['<i>c</i>'] });
    expect(html).not.toContain('<script>x</script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('a &amp; b');
    expect(html).toContain('&lt;i&gt;c&lt;/i&gt;');
  });
});
