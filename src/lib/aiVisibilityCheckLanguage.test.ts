import { describe, expect, it } from 'vitest';
import {
  forcedLanguageInstruction,
  languageMismatch,
  normalizeLang,
  publicCheckCacheKey,
  requestedCheckLang,
  wrongLanguageBody,
} from '../../supabase/functions/ai-visibility-check/language_guard';

describe('ai-visibility-check language guard', () => {
  it('normalises and validates the requested language', () => {
    expect(normalizeLang(' EN-us ')).toBe('en');
    expect(requestedCheckLang('it')).toBe('it');
    expect(requestedCheckLang('de')).toBe('');
    expect(requestedCheckLang(undefined)).toBe('');
  });

  it('caches per domain, and per language when one is requested', () => {
    expect(publicCheckCacheKey('example-legal.com', '')).toBe('v2:example-legal.com');
    expect(publicCheckCacheKey('example-legal.com', 'en')).toBe('v2:example-legal.com:en');
  });

  it('flags a probe in another language only when one was requested', () => {
    expect(languageMismatch('en', 'es')).toBe(true); // site language differs from the UI language
    expect(languageMismatch('en', 'de')).toBe(true); // ClientWhys case
    expect(languageMismatch('en', 'EN')).toBe(false);
    expect(languageMismatch('', 'de')).toBe(false); // site-detected mode: nothing to enforce
    expect(languageMismatch('en', '')).toBe(false); // detector gave nothing: do not refuse
  });

  it('builds the forced-language instruction and a machine-readable refusal', () => {
    expect(forcedLanguageInstruction('en')).toContain('in English');
    expect(forcedLanguageInstruction('it', true)).toContain('mandatory');
    const body = wrongLanguageBody('en', 'de', 'Welche Kanzleisoftware ist die beste?');
    expect(body.error).toBe('wrong_language');
    expect(body.requested).toBe('en');
    expect(body.detected).toBe('de');
  });
});
