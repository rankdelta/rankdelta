import { createFileRoute } from '@tanstack/react-router';
import { McpAuthorizePage } from '../pages/McpAuthorizePage';

// Public on purpose: the agent opens it before any app session exists; the API key is the credential.
export const Route = createFileRoute('/oauth/mcp-authorize')({
	component: () => <McpAuthorizePage />,
});
