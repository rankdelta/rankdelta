import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../services/apiKeys', () => ({ mcpOAuthIssuerUrl: () => 'https://self.example/functions/v1/mcp' }));

import { McpAuthorizePage } from './McpAuthorizePage';

const hidden = (container: HTMLElement, name: string) =>
	(container.querySelector(`input[name="${name}"]`) as HTMLInputElement | null)?.value;

describe('McpAuthorizePage', () => {
	it('posts to the configured issuer and carries the OAuth parameters', () => {
		const { container } = render(
			<McpAuthorizePage search="?client_id=c1&redirect_uri=https%3A%2F%2Fclaude.ai%2Fcb&state=s&code_challenge=x" />,
		);
		expect(container.querySelector('form')?.getAttribute('action')).toBe('https://self.example/functions/v1/mcp/authorize');
		expect(hidden(container, 'client_id')).toBe('c1');
		expect(hidden(container, 'redirect_uri')).toBe('https://claude.ai/cb');
		expect(hidden(container, 'scope')).toBe('mcp:tools');
	});

	it('ignores a form target smuggled into the query string', () => {
		const { container } = render(<McpAuthorizePage search="?issuer=https%3A%2F%2Fevil.example&action=https%3A%2F%2Fevil.example" />);
		expect(container.querySelector('form')?.getAttribute('action')).toBe('https://self.example/functions/v1/mcp/authorize');
	});

	it('shows the server error as text', () => {
		render(<McpAuthorizePage search="?error=%3Cb%3Eredirect_uri%20is%20not%20allowed.%3C%2Fb%3E" />);
		expect(screen.getByRole('alert').textContent).toBe('<b>redirect_uri is not allowed.</b>');
	});
});
