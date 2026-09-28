import { describe, expect, it } from 'vitest';
import {
  FANOUT_COST_CAP_USD,
  collectFanoutsForRun,
  dedupeFanouts,
  estimateFanoutLlmCostUsd,
  extractExplicitQuestions,
  extractStructuralFanouts,
  fanoutDedupeKey,
  fanoutLlmWithinCap,
  parseLlmFanoutContent,
} from '../../supabase/functions/_shared/fanoutExtract';

/** DataForSEO-shaped envelope the way visibility-ops/run_query persists raw_response. */
const googleAioRaw = {
  tasks: [
    {
      status_code: 20000,
      result: [
        {
          keyword: 'best project management software',
          items: [
            {
              type: 'ai_overview',
              items: [
                { type: 'ai_overview_element', text: 'Asana and Monday.com are frequently recommended.' },
                { type: 'people_also_ask_element', title: 'What is the best PM tool for startups?' },
              ],
            },
            {
              type: 'people_also_ask',
              items: [
                { type: 'people_also_ask_element', title: 'Which project management tool is easiest to use?' },
                { type: 'people_also_ask_element', title: 'Is Asana better than Monday.com?' },
                { type: 'people_also_ask_element', title: 'x' }, // too short — dropped
              ],
            },
            {
              type: 'related_searches',
              items: [
                { type: 'related_searches_element', title: 'best project management software for agencies' },
                { query: 'free project management tools' },
              ],
            },
            { type: 'organic', title: 'Not a question — ignore', url: 'https://example.com' },
          ],
        },
      ],
    },
  ],
};

describe('extractStructuralFanouts', () => {
  it('pulls PAA, related searches, and AIO nested questions from a stored SERP payload', () => {
    const got = extractStructuralFanouts(googleAioRaw);
    const questions = got.map((c) => c.question);
    expect(questions).toContain('Which project management tool is easiest to use?');
    expect(questions).toContain('Is Asana better than Monday.com?');
    expect(questions).toContain('best project management software for agencies');
    expect(questions).toContain('free project management tools');
    expect(questions).toContain('What is the best PM tool for startups?');
    expect(got.find((c) => c.question.includes('easiest'))?.source).toBe('people_also_ask');
    expect(got.find((c) => c.question.includes('agencies'))?.source).toBe('related_searches');
    expect(got.find((c) => c.question.includes('startups'))?.source).toBe('people_also_ask');
  });

  it('returns [] when the payload has no extractable blocks (does not fabricate)', () => {
    expect(extractStructuralFanouts({ tasks: [{ result: [{ items: [{ type: 'organic', title: 'Hello' }] }] }] })).toEqual(
      [],
    );
    expect(extractStructuralFanouts(null)).toEqual([]);
    expect(extractStructuralFanouts({})).toEqual([]);
    expect(extractStructuralFanouts('not-json-obj')).toEqual([]);
  });

  it('handles an already-unwrapped items[] array', () => {
    const raw = {
      items: [{ type: 'related_searches', items: ['how to choose a crm', 'crm vs spreadsheet'] }],
    };
    const got = extractStructuralFanouts(raw);
    expect(got.map((c) => c.question)).toEqual(['how to choose a crm', 'crm vs spreadsheet']);
  });
});

describe('extractExplicitQuestions', () => {
  it('takes only sentences that already contain a question mark', () => {
    const answer = [
      'Several tools stand out.',
      'What should a small team look for in a PM tool?',
      'How much does Asana cost per user?',
      'Monday.com also has a free tier.',
    ].join('\n');
    const got = extractExplicitQuestions(answer);
    expect(got.map((c) => c.question)).toEqual([
      'What should a small team look for in a PM tool?',
      'How much does Asana cost per user?',
    ]);
    expect(got.every((c) => c.source === 'answer_explicit')).toBe(true);
  });

  it('returns [] for answers with no questions', () => {
    expect(extractExplicitQuestions('Asana and Monday.com are popular among startups.')).toEqual([]);
    expect(extractExplicitQuestions('')).toEqual([]);
    expect(extractExplicitQuestions(null)).toEqual([]);
  });
});

describe('parseLlmFanoutContent', () => {
  it('parses a structured questions array', () => {
    const got = parseLlmFanoutContent('{"questions":["How do I compare Asana and Jira?","When is Trello enough?"]}');
    expect(got.map((c) => c.question)).toEqual(['How do I compare Asana and Jira?', 'When is Trello enough?']);
    expect(got.every((c) => c.source === 'llm_extract')).toBe(true);
  });

  it('strips markdown fences', () => {
    const got = parseLlmFanoutContent('```json\n{"questions":["Why use a gantt chart?"]}\n```');
    expect(got).toHaveLength(1);
    expect(got[0]!.question).toBe('Why use a gantt chart?');
  });

  it('returns [] on garbage or missing questions — never fabricates', () => {
    expect(parseLlmFanoutContent('sure, here are some ideas: just ask about pricing')).toEqual([]);
    expect(parseLlmFanoutContent('{"questions":[]}')).toEqual([]);
    expect(parseLlmFanoutContent('{"foo":["not used"]}')).toEqual([]);
    expect(parseLlmFanoutContent(null)).toEqual([]);
  });
});

describe('dedupeFanouts', () => {
  it('collapses case/punctuation/whitespace and drops the parent query', () => {
    const got = dedupeFanouts(
      [
        { question: 'Is Asana better than Monday.com?', source: 'people_also_ask' },
        { question: '  is asana better than monday.com  ?', source: 'related_searches' },
        { question: 'best project management software', source: 'related_searches' },
        { question: 'How do agencies pick a PM tool?', source: 'llm_extract' },
      ],
      'Best project management software',
    );
    expect(got.map((c) => c.question)).toEqual([
      'Is Asana better than Monday.com?',
      'How do agencies pick a PM tool?',
    ]);
  });

  it('keeps the first source when two candidates share a key', () => {
    const key = fanoutDedupeKey('Why switch from spreadsheets?');
    expect(key).toBe('why switch from spreadsheets');
    const got = dedupeFanouts([
      { question: 'Why switch from spreadsheets?', source: 'answer_explicit' },
      { question: 'why switch from spreadsheets', source: 'llm_extract' },
    ]);
    expect(got).toHaveLength(1);
    expect(got[0]!.source).toBe('answer_explicit');
  });
});

describe('collectFanoutsForRun + cost cap', () => {
  it('merges structural + explicit + llm extracts and attaches query/engine', () => {
    const rows = collectFanoutsForRun({
      queryId: 'q1',
      engine: 'google_aio',
      rawResponse: googleAioRaw,
      answerText: 'What is a reasonable budget for PM software?\nTeams often start with a free plan.',
      parentQuery: 'best project management software',
      llmQuestions: parseLlmFanoutContent('{"questions":["Which project management tool is easiest to use?"]}'),
    });
    expect(rows.every((r) => r.query_id === 'q1' && r.engine === 'google_aio')).toBe(true);
    const questions = rows.map((r) => r.question);
    expect(questions).toContain('What is a reasonable budget for PM software?');
    // LLM duplicate of a PAA question is collapsed
    expect(questions.filter((q) => q.includes('easiest to use'))).toHaveLength(1);
  });

  it('keeps the worst-case gpt-4o-mini extract well under the $0.02/query cap', () => {
    const worst = estimateFanoutLlmCostUsd(4000, 400);
    expect(worst).toBeLessThan(0.002);
    expect(fanoutLlmWithinCap(worst)).toBe(true);
    expect(fanoutLlmWithinCap(FANOUT_COST_CAP_USD)).toBe(true);
    expect(fanoutLlmWithinCap(FANOUT_COST_CAP_USD + 0.0001)).toBe(false);
  });
});
