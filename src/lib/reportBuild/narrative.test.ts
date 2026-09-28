import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  checkNarrativeGrounding,
  collectNumbersFromData,
  extractNumbersFromText,
  fetchNarrativeWithRetries,
  NARRATIVE_LLM_MAX_ATTEMPTS,
  NARRATIVE_LLM_TIMEOUT_MS,
  parseNarrativeContent,
} from './narrative';

describe('reportBuild narrative grounding', () => {
  it('extracts numbers from text', () => {
    expect(extractNumbersFromText('Clicks rose 12.5% to 1240 sessions')).toEqual([12.5, 1240]);
  });

  it('collects numbers from nested data', () => {
    const nums = collectNumbersFromData({
      summary: { healthScore: 72, gscClicks: { value: 1200, delta: 15 } },
      geo: { sovOverall: 42.5 },
    });
    expect(nums.has(72)).toBe(true);
    expect(nums.has(1200)).toBe(true);
    expect(nums.has(42.5)).toBe(true);
  });

  it('passes when all narrative numbers exist in data', () => {
    const data = {
      summary: {
        healthScore: { value: 72, delta: 5 },
        aiSov: { value: 42.5, delta: 2.1 },
        gscClicks: { value: 1200, delta: 15 },
      },
    };
    const narrative = {
      executiveSummary: 'Health score is 72 (+5). AI SoV reached 42.5% with 1200 GSC clicks (+15).',
      sections: { geo: 'Share of voice at 42.5%.' },
      nextActions: ['Improve citations to lift 42.5% SoV.'],
    };
    const result = checkNarrativeGrounding(narrative, data);
    expect(result.grounded).toBe(true);
    expect(result.ungrounded).toEqual([]);
  });

  it('fails when narrative cites numbers not in data', () => {
    const data = { summary: { healthScore: { value: 72 } } };
    const narrative = { executiveSummary: 'Traffic jumped to 9999 sessions.' };
    const result = checkNarrativeGrounding(narrative, data);
    expect(result.grounded).toBe(false);
    expect(result.ungrounded).toContain(9999);
  });
});

describe('parseNarrativeContent', () => {
  it('unwraps a ```json fenced completion (the live report-build bug)', () => {
    const raw = '```json\n{\n  "executiveSummary": "Lo score di salute è 72.",\n  "sections": { "site_health": "Audit ok." },\n  "nextActions": ["Fix title"]\n}\n```';
    const parsed = parseNarrativeContent(raw);
    expect(parsed).not.toBeNull();
    expect(parsed!['executiveSummary']).toBe('Lo score di salute è 72.');
    expect((parsed!['sections'] as Record<string, string>)['site_health']).toBe('Audit ok.');
    expect(parsed!['nextActions']).toEqual(['Fix title']);
  });

  it('parses bare JSON with no fence', () => {
    const parsed = parseNarrativeContent('{"executiveSummary":"x","sections":{},"nextActions":[]}');
    expect(parsed!['executiveSummary']).toBe('x');
  });

  it('strips surrounding prose around the object', () => {
    const parsed = parseNarrativeContent('Here is the report:\n{"executiveSummary":"y"}\nHope it helps!');
    expect(parsed!['executiveSummary']).toBe('y');
  });

  it('returns null for unrecoverable content instead of dumping raw text', () => {
    expect(parseNarrativeContent('sorry, I cannot produce JSON')).toBeNull();
    expect(parseNarrativeContent('')).toBeNull();
    expect(parseNarrativeContent(null)).toBeNull();
  });

  it('rejects a bare JSON array (narrative must be an object)', () => {
    expect(parseNarrativeContent('[1,2,3]')).toBeNull();
  });
});

describe('fetchNarrativeWithRetries', () => {
  const originalFetch = globalThis.fetch;
  const baseRequest = {
    supabaseUrl: 'https://example.supabase.co',
    headers: { Authorization: 'Bearer test', apikey: 'anon' },
    systemPrompt: 'system',
    userPrompt: 'user',
  };

  function llmResponse(content: string, status = 200) {
    return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status });
  }

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.stubGlobal('fetch', originalFetch);
  });

  it('retries on empty executiveSummary then succeeds', async () => {
    const empty = '{"executiveSummary":"","sections":{},"nextActions":[]}';
    const good = '{"executiveSummary":"Traffic grew 12%.","sections":{},"nextActions":[]}';

    vi.mocked(fetch)
      .mockResolvedValueOnce(llmResponse(empty))
      .mockResolvedValueOnce(llmResponse(good));

    const result = await fetchNarrativeWithRetries(baseRequest, {
      sleep: async () => {},
      backoffMs: 0,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.parsed['executiveSummary']).toBe('Traffic grew 12%.');
    }
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('degrades after max attempts when every response is unusable', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: null } }] }), { status: 200 }),
    );

    const result = await fetchNarrativeWithRetries(baseRequest, {
      sleep: async () => {},
      backoffMs: 0,
    });

    expect(result).toEqual({ ok: false, reason: 'missing_content' });
    expect(fetch).toHaveBeenCalledTimes(NARRATIVE_LLM_MAX_ATTEMPTS);
  });

  it('aborts a hung request and retries until attempts are exhausted', async () => {
    const abortError = () => {
      const err = new Error('The operation was aborted.');
      err.name = 'AbortError';
      return err;
    };

    vi.mocked(fetch).mockImplementation((_url, init) => {
      return new Promise((_resolve, reject) => {
        const signal = init?.signal;
        if (signal?.aborted) {
          reject(abortError());
          return;
        }
        signal?.addEventListener('abort', () => {
          reject(abortError());
        });
      });
    });

    const result = await fetchNarrativeWithRetries(baseRequest, {
      sleep: async () => {},
      backoffMs: 0,
      timeoutMs: 20,
    });

    expect(result).toEqual({ ok: false, reason: 'timeout' });
    expect(fetch).toHaveBeenCalledTimes(NARRATIVE_LLM_MAX_ATTEMPTS);
  });

  it('returns degraded within bounded total budget when all attempts hang', async () => {
    const timeoutMs = 30;
    const maxAttempts = 2;
    const backoffMs = 10;
    const budgetMs = timeoutMs * maxAttempts + backoffMs * (maxAttempts - 1);

    const abortError = () => {
      const err = new Error('The operation was aborted.');
      err.name = 'AbortError';
      return err;
    };

    vi.mocked(fetch).mockImplementation((_url, init) => {
      return new Promise((_resolve, reject) => {
        const signal = init?.signal;
        if (signal?.aborted) {
          reject(abortError());
          return;
        }
        signal?.addEventListener('abort', () => {
          reject(abortError());
        });
      });
    });

    const start = Date.now();
    const result = await fetchNarrativeWithRetries(baseRequest, {
      sleep: async () => {},
      timeoutMs,
      maxAttempts,
      backoffMs,
    });
    const elapsed = Date.now() - start;

    expect(result).toEqual({ ok: false, reason: 'timeout' });
    expect(fetch).toHaveBeenCalledTimes(maxAttempts);
    expect(elapsed).toBeLessThan(budgetMs + 200);
    expect(NARRATIVE_LLM_MAX_ATTEMPTS).toBe(2);
    expect(NARRATIVE_LLM_TIMEOUT_MS).toBe(30_000);
  });
});
