import { describe, expect, it } from 'vitest';
import {
  authorFromByline,
  completeGuideTitle,
  defaultAuthorLine,
  defaultBlogCategoryName,
  frameworkBlockLabels,
  languageCodeFromInput,
  pexelsCaptionLabels,
  resolveContentLanguage,
} from './contentLanguages';
import { buildArticleSchemaBlock } from '../services/agent/schemaGenerator';

describe('languageCodeFromInput', () => {
  it('reads ISO codes and locales', () => {
    expect(languageCodeFromInput('it')).toBe('it');
    expect(languageCodeFromInput('en-US')).toBe('en');
    expect(languageCodeFromInput('pt_BR')).toBe('pt');
    expect(languageCodeFromInput('NL')).toBe('nl');
  });

  it('maps full language names (English, native, Italian) to codes', () => {
    expect(languageCodeFromInput('Italian')).toBe('it');
    expect(languageCodeFromInput('italiano')).toBe('it');
    expect(languageCodeFromInput('English')).toBe('en');
    expect(languageCodeFromInput('inglese')).toBe('en');
    expect(languageCodeFromInput('Deutsch')).toBe('de');
    expect(languageCodeFromInput('Français')).toBe('fr');
    expect(languageCodeFromInput('Español')).toBe('es');
    expect(languageCodeFromInput('English (US)')).toBe('en');
  });

  it('returns null for empty or unrecognisable input', () => {
    expect(languageCodeFromInput(null)).toBeNull();
    expect(languageCodeFromInput('')).toBeNull();
    expect(languageCodeFromInput('klingon')).toBeNull();
  });
});

describe('resolveContentLanguage (autopilot order: html lang → site_language → project → LLM → en)', () => {
  it('the detected site language wins over every stored setting', () => {
    expect(resolveContentLanguage(['en', 'it', 'it', 'it'])).toBe('en');
    expect(resolveContentLanguage(['it', 'en', 'en', 'en'])).toBe('it');
  });

  it('falls through unknown sources in order', () => {
    expect(resolveContentLanguage([null, 'de', 'it', 'en'])).toBe('de');
    expect(resolveContentLanguage([null, null, 'fr', 'it'])).toBe('fr');
    expect(resolveContentLanguage([null, undefined, '', 'Italian'])).toBe('it');
  });

  it('defaults to English, never Italian', () => {
    expect(resolveContentLanguage([])).toBe('en');
    expect(resolveContentLanguage([null, undefined, 'gibberish'])).toBe('en');
  });

  it('an LLM answer of "Italian" is Italian, not English', () => {
    expect(resolveContentLanguage([null, null, null, 'Italian'])).toBe('it');
  });

  it('a recognised but unsupported site language keeps its slot and writes English', () => {
    expect(resolveContentLanguage(['nl', 'it'])).toBe('en');
  });
});

describe('localized autopilot labels', () => {
  it('framework block labels: IT, English otherwise', () => {
    expect(frameworkBlockLabels('it')).toEqual({ kicker: 'Framework esclusivo', howToUse: 'Come usarlo:' });
    expect(frameworkBlockLabels('en')).toEqual({ kicker: 'Exclusive framework', howToUse: 'How to use it:' });
    expect(frameworkBlockLabels('de').kicker).toBe('Exclusive framework');
  });

  it('WordPress category: IT keeps the existing name, English otherwise', () => {
    expect(defaultBlogCategoryName('it')).toBe('Guide e Articoli');
    expect(defaultBlogCategoryName('en')).toBe('Guides and Articles');
    expect(defaultBlogCategoryName('fr')).toBe('Guides and Articles');
  });

  it('plan item title', () => {
    expect(completeGuideTitle('dog food', 'en', 2026)).toBe('Dog food: The Complete Guide 2026');
    expect(completeGuideTitle('cibo cane', 'it', 2026)).toBe('Cibo cane: Guida Completa 2026');
  });

  it('image caption is not "Foto:" on English sites', () => {
    expect(pexelsCaptionLabels('en')).toEqual({ by: 'Photo by', on: 'on' });
    expect(pexelsCaptionLabels('it')).toEqual({ by: 'Foto di', on: 'su' });
  });
});

describe('authorFromByline', () => {
  it('turns "By the X Team" into an Organization named X', () => {
    expect(authorFromByline('By the Acme Team | Published: 1 May 2026', 'Acme')).toEqual({
      name: 'Acme',
      type: 'Organization',
    });
    expect(authorFromByline(defaultAuthorLine('Acme', 'en', '1 May 2026'), 'Acme')).toEqual({
      name: 'Acme',
      type: 'Organization',
    });
  });

  it('turns the Italian and other team bylines into an Organization', () => {
    expect(authorFromByline(defaultAuthorLine('Acme', 'it', '1 maggio 2026'), 'Acme')).toEqual({
      name: 'Acme',
      type: 'Organization',
    });
    expect(authorFromByline(defaultAuthorLine('Acme', 'de'), 'Acme')).toEqual({ name: 'Acme', type: 'Organization' });
    expect(authorFromByline(defaultAuthorLine('Acme', 'fr'), 'Acme')).toEqual({ name: 'Acme', type: 'Organization' });
    expect(authorFromByline(defaultAuthorLine('Acme', 'es'), 'Acme')).toEqual({ name: 'Acme', type: 'Organization' });
    expect(authorFromByline(defaultAuthorLine('Acme', 'pt'), 'Acme')).toEqual({ name: 'Acme', type: 'Organization' });
  });

  it('strips "By" / "A cura di" from a real person', () => {
    expect(authorFromByline('By Jane Doe | Published: 1 May 2026', 'Acme')).toEqual({ name: 'Jane Doe', type: 'Person' });
    expect(authorFromByline('A cura di Marco Rossi', 'Acme')).toEqual({ name: 'Marco Rossi', type: 'Person' });
    expect(authorFromByline('Jane Doe', 'Acme')).toEqual({ name: 'Jane Doe', type: 'Person' });
  });

  it('falls back to the site as Organization', () => {
    expect(authorFromByline('', 'Acme')).toEqual({ name: 'Acme', type: 'Organization' });
    expect(authorFromByline(undefined, 'Acme')).toEqual({ name: 'Acme', type: 'Organization' });
  });

  it('the Article schema uses the author type', () => {
    const html = buildArticleSchemaBlock({
      headline: 'H',
      authorName: 'Acme',
      authorType: 'Organization',
      datePublished: '2026-05-01',
      publisherName: 'Acme',
      publisherUrl: 'https://acme.com',
    });
    expect(html).toContain('"@type": "Organization",\n    "name": "Acme"');
    expect(html).not.toContain('"@type": "Person"');
  });
});
