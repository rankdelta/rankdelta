import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

describe('MCP OAuth secret fail-closed', () => {
  const source = readFileSync(path.resolve(process.cwd(), 'supabase/functions/mcp/oauth.ts'), 'utf8');

  it('does not fall back to a hardcoded AES key', () => {
    expect(source).not.toContain('astroseo-mcp-oauth-dev-only');
    expect(source).toContain('MCP OAuth secret not configured');
  });
});

describe('webhook secrets fail-closed in source', () => {
  it('squarespace-webhook refuses an unset signing secret', () => {
    const source = readFileSync(path.resolve(process.cwd(), 'supabase/functions/squarespace-webhook/index.ts'), 'utf8');
    expect(source).toContain('Webhook not configured');
    expect(source).toContain("SQUARESPACE_WEBHOOK_SECRET")
    expect(source).not.toMatch(/SQUARESPACE_WEBHOOK_SECRET\)!/);
  });
});
