import { describe, it, expect } from 'vitest';
import {
  buildAiAttribution,
  matchEngineFromSource,
  aggregateAiSessionsByEngine,
} from './attribution';

describe('reportBuild AI attribution join', () => {
  it('matches AI sources to engines', () => {
    expect(matchEngineFromSource('chatgpt.com')).toBe('chatgpt');
    expect(matchEngineFromSource('www.perplexity.ai')).toBe('perplexity');
    expect(matchEngineFromSource('google')).toBeNull();
  });

  it('aggregates GA4 AI sessions by engine', () => {
    const map = aggregateAiSessionsByEngine([
      { source: 'chatgpt.com', sessions: 40, keyEvents: 4 },
      { source: 'chat.openai.com', sessions: 10, keyEvents: 1 },
      { source: 'perplexity.ai', sessions: 25, keyEvents: 2 },
      { source: 'google', sessions: 500 },
    ]);
    expect(map.get('chatgpt')).toEqual({ sessions: 50, keyEvents: 5 });
    expect(map.get('perplexity')).toEqual({ sessions: 25, keyEvents: 2 });
  });

  it('joins per-engine SoV with GA4 AI traffic', () => {
    const rows = buildAiAttribution(
      [
        { engine: 'chatgpt', sovPercent: 42.5, yourMentions: 17, competitorMentions: 23 },
        { engine: 'perplexity', sovPercent: 30, yourMentions: 9, competitorMentions: 21 },
      ],
      [
        { source: 'chatgpt.com', sessions: 40, keyEvents: 4 },
        { source: 'perplexity.ai', sessions: 20, keyEvents: 2 },
      ],
    );
    const chatgpt = rows.find((r) => r.engine === 'chatgpt');
    expect(chatgpt?.sovPercent).toBe(42.5);
    expect(chatgpt?.aiAssistantSessions).toBe(40);
    expect(chatgpt?.keyEvents).toBe(4);
    expect(chatgpt?.conversionRate).toBe(10);
  });
});
