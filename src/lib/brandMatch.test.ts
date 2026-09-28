import { describe, expect, it } from 'vitest';
import {
  classifyRecommended,
  foldTokens,
  isBrandName,
} from '../../supabase/functions/ai-visibility-check/brand_match';

describe('foldTokens', () => {
  it('lowercases, strips diacritics, and splits on non-alphanumerics', () => {
    expect(foldTokens("L'Oréal Paris")).toBe('l oreal paris');
    expect(foldTokens('Ben & Jerry’s')).toBe('ben jerry s');
    expect(foldTokens('  Björk-Music ')).toBe('bjork music');
  });
});

describe('isBrandName', () => {
  it('matches on exact and whole-word token overlap', () => {
    expect(isBrandName('Notion', 'notion', 'Notion')).toBe(true);
    expect(isBrandName('Notion', 'notion', 'Notion Calendar')).toBe(true); // brand ⊆ candidate
    expect(isBrandName('Notion Labs', 'notion', 'Notion')).toBe(true); // candidate ⊆ brand
  });

  it('does NOT match a short brand buried inside a longer word (the substring false positive)', () => {
    // "Ora" must not light up "Aurora" — the exact bug that faked a "recommended" verdict.
    expect(isBrandName('Ora', 'ora', 'Aurora')).toBe(false);
    expect(isBrandName('Well', 'well', 'Farewell Co')).toBe(false);
  });

  it('matches multi-word brands to their concatenated domain root', () => {
    // loreal.com ↔ "L'Oréal": domain root "loreal" equals candidate concat "loreal".
    expect(isBrandName("L'Oréal", 'loreal', "L'Oreal")).toBe(true);
    expect(isBrandName('', 'loreal', 'LOreal Paris')).toBe(true); // via domain root startsWith
  });

  it('does not loosely match on a too-short domain root', () => {
    // 3-char root must not startsWith-match an unrelated longer name.
    expect(isBrandName('', 'abc', 'Abcdefg Inc')).toBe(false);
  });

  it('handles accented answers and names symmetrically', () => {
    expect(isBrandName('Nestlé', 'nestle', 'Nestle')).toBe(true);
    expect(isBrandName('Nestle', 'nestle', 'Nestlé')).toBe(true);
  });
});

describe('classifyRecommended', () => {
  it('detects citation and lists the rest as competitors, capped and in order', () => {
    const rec = ['Nike', 'Adidas', 'Hoka', 'Puma', 'Asics', 'Brooks'];
    const { cited, competitors } = classifyRecommended('Hoka', 'hoka', rec, 3);
    expect(cited).toBe(true);
    expect(competitors).toEqual(['Nike', 'Adidas', 'Puma']); // Hoka removed, capped at 3
  });

  it('reports not cited and keeps all as competitors when the brand is absent', () => {
    const rec = ['Nike', 'Adidas'];
    const { cited, competitors } = classifyRecommended('Hoka', 'hoka', rec, 5);
    expect(cited).toBe(false);
    expect(competitors).toEqual(['Nike', 'Adidas']);
  });

  it('does not false-positive a substring brand into a citation', () => {
    const { cited, competitors } = classifyRecommended('Ora', 'ora', ['Aurora', 'Sephora'], 5);
    expect(cited).toBe(false);
    expect(competitors).toEqual(['Aurora', 'Sephora']);
  });
});
