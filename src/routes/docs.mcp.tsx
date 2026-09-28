import { createFileRoute } from '@tanstack/react-router';
import { McpDocsPage } from '../pages/McpDocsPage';

export const Route = createFileRoute('/docs/mcp')({
	component: McpDocsPage,
});
