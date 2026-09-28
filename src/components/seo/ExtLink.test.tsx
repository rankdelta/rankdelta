import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ExtLink, PageLink } from './ExtLink';

describe('PageLink / ExtLink (Site Explorer From/To)', () => {
  it('opens the real referring and destination page URLs, not just hostnames', () => {
    const from = 'https://thefocus.news/pets/omega-3-guide';
    const to = 'https://www.rover.com/it/blog/omega-3';
    const { container } = render(
      <div>
        <PageLink href={from} />
        <PageLink href={to} muted />
      </div>,
    );
    const links = container.querySelectorAll('a');
    expect(links[0]?.getAttribute('href')).toBe(from);
    expect(links[0]?.getAttribute('target')).toBe('_blank');
    expect(links[1]?.getAttribute('href')).toBe(to);
    expect(screen.getByText('thefocus.news')).toBeTruthy();
    expect(screen.getByText('/pets/omega-3-guide')).toBeTruthy();
    expect(screen.getByText('rover.com')).toBeTruthy();
    expect(screen.getByText('/it/blog/omega-3')).toBeTruthy();
  });

  it('rejects javascript: hrefs', () => {
    const { container } = render(<ExtLink href="javascript:alert(1)">bad</ExtLink>);
    expect(container.querySelector('a')).toBeNull();
  });
});
