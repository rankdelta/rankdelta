import { createFileRoute } from '@tanstack/react-router';
import { McpDocsPage } from '../pages/McpDocsPage';

// Italian MCP docs (the English page lives at /docs/mcp). Same component, locale="it".
export const Route = createFileRoute('/it/docs/mcp')({
	component: () => <McpDocsPage locale="it" />,
});
