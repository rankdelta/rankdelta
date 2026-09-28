import { describe, expect, it } from 'vitest';
import { buildCategorySeeds } from '../../supabase/functions/visibility-ops/category_seeds';
import {
  BRAND_ELICITING_INTENT_MIN_RATIO,
  brandElicitingRatio,
  buildBrandElicitingGuidance,
  parseBusinessProfile,
  verticalForBusinessType,
  dedupeQueries,
  isQueryLanguageValid,
  marketLocalityLabel,
  parseGeneratedQueries,
  queryGenSystem,
  queryGenUserPrompt,
  queryGenerationChunks,
  resolveLocality,
  resolveQueryLanguage,
} from '../../supabase/functions/visibility-ops/query_generation';

describe('resolveQueryLanguage', () => {
  it('prefers project.language over primary_language', () => {
    expect(resolveQueryLanguage({ language: 'en', primary_language: 'it' })).toBe('en');
    expect(resolveQueryLanguage({ language: null, primary_language: 'de' })).toBe('de');
  });
});

describe('isQueryLanguageValid', () => {
  it('rejects Spanish queries when project language is English', () => {
    expect(isQueryLanguageValid('mejores planificadores de bodas en Sicilia', 'en')).toBe(false);
    expect(isQueryLanguageValid('best wedding planners in Sicily', 'en')).toBe(true);
  });

  it('accepts Italian queries for Italian projects', () => {
    expect(isQueryLanguageValid('migliori wedding planner in Sicilia', 'it')).toBe(true);
  });
});

describe('queryGenerationChunks', () => {
  it('splits large batches to avoid truncated JSON', () => {
    expect(queryGenerationChunks(60)).toEqual([25, 25, 10]);
    expect(queryGenerationChunks(20)).toEqual([20]);
  });
});

describe('brandElicitingRatio', () => {
  it('tracks recommendation-style intents', () => {
    const rows = [
      { text: 'best wedding planners Sicily', intent_type: 'category' as const },
      { text: 'Brand vs Competitor', intent_type: 'comparison' as const },
      { text: 'how to save money on weddings', intent_type: 'problem' as const },
    ];
    expect(brandElicitingRatio(rows)).toBeCloseTo(2 / 3);
  });
});

describe('queryGenSystem', () => {
  it('requires majority brand-eliciting prompts', () => {
    const sys = queryGenSystem('en', 'Soylent');
    expect(sys).toContain(`${Math.round(BRAND_ELICITING_INTENT_MIN_RATIO * 100)}%`);
    expect(sys).toMatch(/BRAND-ELICITING/i);
    expect(sys).not.toMatch(/80% MUST be UNBRANDED.*Share of Voice is measured on these unbranded prompts/i);
  });
});

describe('queryGenUserPrompt', () => {
  it('includes competitor-aware and locality blocks for local service brand', () => {
    const prompt = queryGenUserPrompt({
      lang: 'en',
      count: 14,
      brandName: 'Tuscany Dreams',
      compNames: ['Italian Weddings Co'],
      seeds: ['destination wedding planner', 'Tuscany'],
      vertical: 'other',
      storePlatform: '',
      catalogNotes: 'luxury weddings Sicily and Amalfi',
      siteUrl: 'https://example.com',
      marketLabel: marketLocalityLabel('IT', 'en'),
    });
    expect(prompt).toContain('EXACTLY 14');
    expect(prompt).toContain('Italian Weddings Co');
    expect(prompt).toContain('destination wedding planner');
    expect(prompt).toContain('Sicily');
    expect(prompt).not.toContain('typical wedding planning timeline');
    expect(prompt).not.toContain('how to save money on an Amalfi Coast wedding');
  });

  it('uses project language explicitly in prompt', () => {
    const prompt = queryGenUserPrompt({
      lang: 'en',
      count: 10,
      brandName: 'Soylent',
      compNames: ['Huel'],
      seeds: ['meal replacement'],
      vertical: 'ecommerce',
      storePlatform: 'shopify',
      catalogNotes: '',
      siteUrl: 'https://soylent.com',
      marketLabel: 'United States',
    });
    expect(prompt).toContain('Language: ENGLISH ONLY');
    expect(prompt).toContain('meal replacement');
    expect(prompt).toContain('Huel');
  });
});

describe('parseGeneratedQueries + dedupeQueries', () => {
  it('parses JSON and dedupes by text', () => {
    const raw = JSON.stringify({
      queries: [
        { text: 'best meal replacement brands', intent_type: 'category' },
        { text: 'best meal replacement brands', intent_type: 'category' },
        { text: 'Huel vs Soylent', intent_type: 'comparison' },
      ],
    });
    const parsed = dedupeQueries(parseGeneratedQueries(raw));
    expect(parsed).toHaveLength(2);
    expect(parsed.find((q) => q.intent_type === 'comparison')?.text).toBe('Huel vs Soylent');
  });
});

describe('buildCategorySeeds', () => {
  it('merges seed_keywords with primary_keyword and main_topic', () => {
    expect(
      buildCategorySeeds({
        seed_keywords: ['meal replacement'],
        primary_keyword: 'soylent alternative',
        main_topic: 'nutrition shakes',
      }),
    ).toEqual(['meal replacement', 'soylent alternative', 'nutrition shakes']);
  });
});

describe('locality (local businesses)', () => {
  it('reads projects.metadata.locality and ignores junk', () => {
    expect(resolveLocality({ metadata: { locality: '  Milano ' } })).toBe('Milano');
    expect(resolveLocality({ metadata: { locality: 42 } })).toBe('');
    expect(resolveLocality({ metadata: null })).toBe('');
  });

  it('makes a share of the prompts name the service area', () => {
    const base = {
      lang: 'it',
      count: 20,
      brandName: 'Harborstay',
      compNames: [],
      seeds: ['gestione case vacanza'],
      vertical: 'saas',
      storePlatform: '',
      catalogNotes: '',
      siteUrl: 'https://harborstay.example',
      marketLabel: 'Italia',
    };
    const local = queryGenUserPrompt({ ...base, locality: 'Milano' });
    expect(local).toContain('AREA SERVITA (vincolante): Milano');
    expect(local).toContain('40%');
    expect(local).toContain('migliori X a Milano');
    const national = queryGenUserPrompt(base);
    expect(national).not.toContain('AREA SERVITA');
    expect(national).toContain('almeno 40% delle query deve nominarla');
    const hinted = queryGenUserPrompt({ ...base, profileNotes: 'Gestiamo case vacanza a Milano e hinterland.' });
    expect(hinted).toContain('PROFILO: Gestiamo case vacanza a Milano');
  });
});

describe('no invented places (global and SaaS projects)', () => {
  // A global SEO SaaS used to get "best AI SEO software in Sicily": the market text for global
  // projects literally suggested Sicily and Tuscany, and every pattern was "best X in <place>".
  const saasGlobal = {
    lang: 'en',
    count: 12,
    brandName: 'Rankdelta.ai',
    compNames: ['Athenahq'],
    seeds: ['AI SEO software', 'SEO tools'],
    vertical: 'saas',
    storePlatform: '',
    catalogNotes: '',
    siteUrl: 'https://rankdelta.ai',
    marketLabel: marketLocalityLabel('global', 'en'),
  };

  it('gives a global market no place at all', () => {
    expect(marketLocalityLabel('global', 'en')).toBe('');
    expect(marketLocalityLabel(null, 'it')).toBe('');
    const prompt = queryGenUserPrompt(saasGlobal);
    expect(prompt).not.toMatch(/sicily|sicilia|tuscany|toscana|italy|italia/i);
    expect(prompt).toContain('MARKET: global');
    expect(prompt).toContain('"best AI SEO software"');
  });

  it('keeps the country out of SaaS patterns but mentions the market once', () => {
    const prompt = queryGenUserPrompt({ ...saasGlobal, marketLabel: marketLocalityLabel('IT', 'en') });
    expect(prompt).not.toContain('AI SEO software in Italy');
    expect(prompt).toContain('MARKET: Italy');
  });

  it('still anchors shops and local services to their market or area', () => {
    const shop = buildBrandElicitingGuidance({ lang: 'it', brandName: 'Pawly', compNames: [], seeds: ['integratori per cani'], marketLabel: 'Italia', catalogNotes: '', vertical: 'ecommerce' });
    expect(shop).toContain('migliori integratori per cani in Italia');
    const local = buildBrandElicitingGuidance({ lang: 'en', brandName: 'Harborstay', compNames: [], seeds: ['boutique hotel'], marketLabel: 'Italy', catalogNotes: '', vertical: 'saas', locality: 'Noto' });
    expect(local).toContain('best boutique hotel in Noto');
  });
});

describe('site grounding', () => {
  it('puts what the homepage says into the prompt', () => {
    const prompt = queryGenUserPrompt({
      lang: 'en', count: 12, brandName: 'Example Tours', compNames: [], seeds: ['guided tours'], vertical: 'other',
      storePlatform: '', catalogNotes: '', siteUrl: 'https://example-tours.com', marketLabel: 'Italy',
      siteSummary: 'Title: Guided walking tours in Noto',
    });
    expect(prompt).toContain('SITE (what the business actually does, from its homepage): Title: Guided walking tours in Noto');
    expect(prompt).toContain("Never invent a category the site doesn't support");
  });

  it('leaves the block out when the page could not be read', () => {
    const prompt = queryGenUserPrompt({
      lang: 'en', count: 12, brandName: 'X', compNames: [], seeds: ['y'], vertical: 'other',
      storePlatform: '', catalogNotes: '', siteUrl: 'https://x.example', marketLabel: '',
    });
    expect(prompt).not.toContain('SITE (');
  });
});

describe('parseBusinessProfile', () => {
  it('reads a local business with its service area', () => {
    const p = parseBusinessProfile('{"category":"guided tours","audience":"travellers","business_type":"local","service_area":"Val di Noto"}');
    expect(p).toEqual({ category: 'guided tours', audience: 'travellers', businessType: 'local', serviceArea: 'Val di Noto' });
    expect(verticalForBusinessType(p!.businessType)).toBe('other');
  });

  it('drops the service area for non-local businesses and tolerates code fences', () => {
    const p = parseBusinessProfile('```json\n{"category":"dog supplements","audience":"dog owners","business_type":"ecommerce","service_area":"Italy"}\n```');
    expect(p?.businessType).toBe('ecommerce');
    expect(p?.serviceArea).toBe('');
    expect(verticalForBusinessType('ecommerce')).toBe('ecommerce');
  });

  it('maps unknown types to other and rejects empty or broken answers', () => {
    expect(parseBusinessProfile('{"category":"legal advice","business_type":"agency"}')?.businessType).toBe('other');
    expect(parseBusinessProfile('{"category":"x","business_type":"saas"}')).toBeNull();
    expect(parseBusinessProfile('not json')).toBeNull();
    expect(parseBusinessProfile(null)).toBeNull();
  });
});

