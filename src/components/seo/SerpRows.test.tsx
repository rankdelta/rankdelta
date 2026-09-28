import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SerpExtras, SerpRows } from './SerpRows';
import type { SerpSnapshot } from '../../lib/serpSnapshot';

const snap: SerpSnapshot = {
  organic: [{
    position: 1,
    domain: 'rover.com',
    title: 'Dog sitters in Basel',
    url: 'https://www.rover.com/basel',
    sitelinks: [{ title: 'Pricing', url: 'https://www.rover.com/basel/prices' }],
    snippet: null,
  }],
  paa: ['How much is a dog sitter in Basel?'],
  related: ['dog walker basel'],
  featured: { title: 'Best sitters', url: 'https://example.com/a', snippet: 'A short answer' },
  ads: 2,
  features: ['ai_overview'],
};

describe('SERP extras from the advanced payload', () => {
  it('makes organic results and sitelinks real outbound links', () => {
    render(<SerpRows rows={snap.organic} />);
    expect(screen.getByText('Dog sitters in Basel').closest('a')?.getAttribute('href')).toBe('https://www.rover.com/basel');
    expect(screen.getByText('Pricing').closest('a')?.getAttribute('href')).toBe('https://www.rover.com/basel/prices');
  });

  it('surfaces PAA, related searches, featured snippet and ads already in the response', () => {
    render(<SerpExtras snap={snap} />);
    expect(screen.getByText('How much is a dog sitter in Basel?')).toBeTruthy();
    expect(screen.getByText('dog walker basel')).toBeTruthy();
    expect(screen.getByText('Best sitters').closest('a')?.getAttribute('href')).toBe('https://example.com/a');
    expect(screen.getByText(/2 paid result/)).toBeTruthy();
    expect(screen.getByText('AI Overview')).toBeTruthy();
  });

  it('highlights the explored domain in the live SERP', () => {
    render(<SerpRows rows={snap.organic} ownHost="rover.com" />);
    expect(screen.getByText('This domain')).toBeTruthy();
  });
});
