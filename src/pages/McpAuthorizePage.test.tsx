import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../services/apiKeys', () => ({ mcpOAuthIssuerUrl: () => 'https://self.example/functions/v1/mcp' }));

import { McpAuthorizePage } from './McpAuthorizePage';
import { describeRedirect } from '../lib/mcpConsent';

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

	it('names the app that will receive the access, and warns against links sent by someone else', () => {
		render(<McpAuthorizePage search="?client_id=c1&redirect_uri=https%3A%2F%2Fchatgpt.com%2Fconnector_platform_oauth_redirect&state=s" />);
		expect(screen.getByTestId('mcp-consent-client').textContent).toMatch(/^ChatGPT \(chatgpt\.com\) is requesting access/);
		expect(screen.getByTestId('mcp-consent-warning').textContent).toMatch(/started this connection yourself in ChatGPT/);
	});

	it('describes Claude, local apps and unknown hosts', () => {
		expect(describeRedirect('https://claude.ai/api/mcp/auth_callback')).toEqual({ app: 'Claude', host: 'claude.ai' });
		expect(describeRedirect('http://localhost:6274/callback')).toEqual({ app: 'An app on this computer', host: 'localhost:6274' });
		expect(describeRedirect('https://agent.example/cb')).toEqual({ app: 'agent.example', host: 'agent.example' });
		expect(describeRedirect('not a url')).toBeNull();
		expect(describeRedirect(null)).toBeNull();
	});

	it('keeps the generic text and no warning when there is no redirect to name', () => {
		render(<McpAuthorizePage search="?client_id=c1" />);
		expect(screen.getByTestId('mcp-consent-client').textContent).toMatch(/^An AI assistant is requesting access/);
		expect(screen.queryByTestId('mcp-consent-warning')).toBeNull();
	});

	it('shows the server error as text', () => {
		render(<McpAuthorizePage search="?error=%3Cb%3Eredirect_uri%20is%20not%20allowed.%3C%2Fb%3E" />);
		expect(screen.getByRole('alert').textContent).toBe('<b>redirect_uri is not allowed.</b>');
	});
});
