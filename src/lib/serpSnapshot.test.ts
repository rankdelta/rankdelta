import { describe, expect, it } from 'vitest';
import { parseSerpAdvanced } from './serpSnapshot';

describe('parseSerpAdvanced', () => {
  it('keeps organic results and the features the same payload already has', () => {
    const snap = parseSerpAdvanced([
      { type: 'featured_snippet', title: 'Best sitters', url: 'https://example.com/a', description: 'A short answer' },
      {
        type: 'organic',
        rank_group: 1,
        domain: 'rover.com',
        title: 'Dog sitters in Basel',
        url: 'https://www.rover.com/basel',
        links: [{ title: 'Pricing', url: 'https://www.rover.com/basel/prices' }],
      },
      {
        type: 'people_also_ask',
        items: [{ title: 'How much is a dog sitter in Basel?' }, { question: 'Do I need a license?' }],
      },
      { type: 'related_searches', items: [{ title: 'dog walker basel' }, { query: 'petsitter zurich' }] },
      { type: 'ai_overview', items: [{}] },
      { type: 'knowledge_graph', title: 'Rover' },
      { type: 'paid', items: [{}, {}] },
    ]);
    expect(snap.organic[0]).toMatchObject({
      position: 1,
      url: 'https://www.rover.com/basel',
      sitelinks: [{ title: 'Pricing', url: 'https://www.rover.com/basel/prices' }],
    });
    expect(snap.paa).toEqual(['How much is a dog sitter in Basel?', 'Do I need a license?']);
    expect(snap.related).toEqual(['dog walker basel', 'petsitter zurich']);
    expect(snap.featured?.title).toBe('Best sitters');
    expect(snap.ads).toBe(2);
    expect(snap.organic[0]?.snippet).toBeNull();
    expect(snap.features).toEqual(['ai_overview', 'knowledge_graph']);
  });
});
