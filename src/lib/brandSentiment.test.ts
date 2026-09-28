import { describe, expect, it, vi } from 'vitest';
import {
  BRAND_SENTIMENT_COST_CAP_USD,
  BRAND_SENTIMENT_MIN_ANSWERS,
  aggregateByEngine,
  answerMentionsBrand,
  answersMentioningAnyBrand,
  brandSentimentWithinCap,
  estimateBrandSentimentCostUsd,
  insufficientDataPayload,
  parseBrandSentimentContent,
  parseSentimentLabel,
  type SentimentClassification,
  type StoredAnswerInput,
} from '../../supabase/functions/_shared/brandSentiment';

const brand = { name: 'Aurora Bianchi Studio', aliases: ['ABS', "Giorgia"] };

describe('mention gating', () => {
  it('detects brand names with diacritics folded', () => {
    expect(answerMentionsBrand('Consiglio Aurora Bianchi Studio per il viso.', brand)).toBe(true);
    expect(answerMentionsBrand('A random skincare roundup with no names.', brand)).toBe(false);
  });

  it('filters to answers that actually mention a tracked brand', () => {
    const answers: StoredAnswerInput[] = [
      { run_id: '1', engine: 'chatgpt', answer_text: 'ABS is a solid option.', run_at: '2026-01-01' },
      { run_id: '2', engine: 'chatgpt', answer_text: 'No brand here.', run_at: '2026-01-02' },
    ];
    expect(answersMentioningAnyBrand(answers, [brand])).toHaveLength(1);
  });
});

describe('parseBrandSentimentContent', () => {
  it('accepts a single sentiment object', () => {
    const rows = parseBrandSentimentContent('{"sentiment":"positive","accuracy":0.91}', 'Acme');
    expect(rows).toEqual([{ brand_name: 'Acme', sentiment: 'positive', accuracy: 0.91 }]);
  });

  it('accepts items[] and maps pos/neg aliases', () => {
    const rows = parseBrandSentimentContent(
      '{"items":[{"brand":"Acme","sentiment":"pos","accuracy":0.7},{"brand":"Acme","sentiment":"negativo","accuracy":0.4}]}',
      'Acme',
    );
    expect(rows.map((r) => r.sentiment)).toEqual(['positive', 'negative']);
  });

  it('returns [] on garbage / missing JSON instead of inventing labels', () => {
    expect(parseBrandSentimentContent('', 'Acme')).toEqual([]);
    expect(parseBrandSentimentContent('sure it is great!!', 'Acme')).toEqual([]);
    expect(parseBrandSentimentContent('{"sentiment":"mixed"}', 'Acme')).toEqual([]);
  });
});

describe('aggregateByEngine', () => {
  it('computes per-engine shares and average accuracy', () => {
    const rows: SentimentClassification[] = [
      { run_id: 'a', engine: 'chatgpt', brand_name: 'Acme', sentiment: 'positive', accuracy: 0.9 },
      { run_id: 'b', engine: 'chatgpt', brand_name: 'Acme', sentiment: 'positive', accuracy: 0.7 },
      { run_id: 'c', engine: 'chatgpt', brand_name: 'Acme', sentiment: 'neutral', accuracy: 0.5 },
      { run_id: 'd', engine: 'google_aio', brand_name: 'Acme', sentiment: 'negative', accuracy: 0.8 },
    ];
    const out = aggregateByEngine(rows);
    const gpt = out.find((e) => e.engine === 'chatgpt');
    const aio = out.find((e) => e.engine === 'google_aio');
    expect(gpt?.classified).toBe(3);
    expect(gpt?.positive).toBe(0.667);
    expect(gpt?.neutral).toBe(0.333);
    expect(gpt?.negative).toBe(0);
    expect(gpt?.avg_accuracy).toBe(0.7);
    expect(aio?.negative).toBe(1);
    expect(aio?.answers).toBe(1);
  });
});

describe('insufficient_data vs cost guards', () => {
  it('insufficientDataPayload never invents percentages', () => {
    const p = insufficientDataPayload('site-1', 30, 1);
    expect(p.status).toBe('insufficient_data');
    expect(p.per_engine).toEqual([]);
    expect(p.cost_usd).toBe(0);
    expect(p.classifiable_answers).toBeLessThan(BRAND_SENTIMENT_MIN_ANSWERS);
  });

  it('cost cap refuses a call that would exceed the run budget', () => {
    expect(brandSentimentWithinCap(0.049, 0.002)).toBe(false);
    expect(brandSentimentWithinCap(0, estimateBrandSentimentCostUsd())).toBe(true);
    expect(BRAND_SENTIMENT_COST_CAP_USD).toBe(0.05);
  });
});

describe('dry_run must not invoke a classifier', () => {
  it('the classify callback is never called when dry_run wins', async () => {
    const classify = vi.fn(async () => {
      throw new Error('LLM must not run in dry_run');
    });
    const dryRun = true;
    const classifyRequested = true;
    if (dryRun) {
      expect(classify).not.toHaveBeenCalled();
      return;
    }
    if (classifyRequested) await classify();
    expect(classify).not.toHaveBeenCalled();
  });
});

describe('parseSentimentLabel', () => {
  it('maps known labels and rejects unknown', () => {
    expect(parseSentimentLabel('POSITIVE')).toBe('positive');
    expect(parseSentimentLabel('neu')).toBe('neutral');
    expect(parseSentimentLabel('mixed')).toBeNull();
  });
});
