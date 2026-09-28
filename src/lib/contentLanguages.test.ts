import { describe, expect, it } from 'vitest';
import {
  CONTENT_LANGUAGES,
  defaultMetaDescription,
  faqSectionTitle,
  infographicQuickGuideTitle,
  marketForContentLanguage,
  normalizeContentLanguage,
  prefersEnglishUi,
  promptLangName,
  verifiedSourcesSectionLabels,
} from './contentLanguages';

describe('contentLanguages', () => {
  it('normalizes locale codes to supported content languages', () => {
    expect(normalizeContentLanguage('de-DE')).toBe('de');
    expect(normalizeContentLanguage('fr')).toBe('fr');
    expect(normalizeContentLanguage('zh')).toBe('en');
    expect(normalizeContentLanguage(null)).toBe('en');
  });

  it('maps content languages to workspace markets', () => {
    expect(marketForContentLanguage('de')).toBe('DE');
    expect(marketForContentLanguage('en')).toBe('global');
    expect(marketForContentLanguage('it')).toBe('IT');
  });

  it('exposes six primary content languages', () => {
    expect([...CONTENT_LANGUAGES]).toEqual(['it', 'en', 'de', 'fr', 'es', 'pt']);
  });

  it('uses English UI copy for non-Italian content languages', () => {
    expect(prefersEnglishUi('it')).toBe(false);
    expect(prefersEnglishUi('de')).toBe(true);
  });

  it('localizes agent prompt names and FAQ titles', () => {
    expect(promptLangName('de')).toBe('German');
    expect(faqSectionTitle('es')).toBe('Preguntas frecuentes');
    expect(defaultMetaDescription('SEO', 'fr')).toContain('guide complet');
  });

  it('localizes infographic and sources labels', () => {
    expect(infographicQuickGuideTitle('SEO', 'de')).toContain('Kurzanleitung');
    expect(verifiedSourcesSectionLabels('fr').header).toContain('Sources et références');
  });
});
