import { describe, expect, it } from 'vitest';
import {
  parseMcpToolsListResponse,
  openCodeMcpConfigSnippet,
  claudeCodeMcpAddCommand,
} from './apiKeys';

describe('openCodeMcpConfigSnippet', () => {
  it('emits the OpenCode remote shape, not the Cursor mcpServers shape', () => {
    const cfg = JSON.parse(
      openCodeMcpConfigSnippet('https://mcp.rankdelta.ai/mcp', 'sk_rankdelta_TEST'),
    ) as {
      $schema: string;
      mcpServers?: unknown;
      mcp: { rankdelta: { type: string; enabled: boolean; url: string; headers: { Authorization: string } } };
    };
    expect(cfg.mcpServers).toBeUndefined();
    expect(cfg.mcp.rankdelta.type).toBe('remote');
    expect(cfg.mcp.rankdelta.enabled).toBe(true);
    expect(cfg.mcp.rankdelta.url).toBe('https://mcp.rankdelta.ai/mcp');
    expect(cfg.mcp.rankdelta.headers.Authorization).toBe('Bearer sk_rankdelta_TEST');
    expect(cfg['$schema']).toContain('opencode.ai');
  });
});

describe('claudeCodeMcpAddCommand', () => {
  it('builds an http-transport add command with a bearer header', () => {
    const cmd = claudeCodeMcpAddCommand('https://mcp.rankdelta.ai/mcp', 'sk_rankdelta_TEST');
    expect(cmd).toContain('claude mcp add rankdelta');
    expect(cmd).toContain('--transport http https://mcp.rankdelta.ai/mcp');
    expect(cmd).toContain('--header "Authorization: Bearer sk_rankdelta_TEST"');
  });
});

describe('parseMcpToolsListResponse', () => {
  it('returns tool count on successful tools/list', () => {
    const result = parseMcpToolsListResponse(200, {
      jsonrpc: '2.0',
      id: 1,
      result: { tools: [{ name: 'a' }, { name: 'b' }] },
    });
    expect(result).toEqual({ ok: true, toolCount: 2 });
  });

  it('maps 401 to auth failure', () => {
    const result = parseMcpToolsListResponse(401, {
      error: 'unauthorized',
      message: 'Valid sk_astroseo_… Bearer key required.',
    });
    expect(result).toEqual({
      ok: false,
      status: 401,
      message: 'Valid sk_astroseo_… Bearer key required.',
    });
  });

  it('handles JSON-RPC error object', () => {
    const result = parseMcpToolsListResponse(200, {
      jsonrpc: '2.0',
      id: 1,
      error: { code: -32601, message: 'Method not found' },
    });
    expect(result).toEqual({ ok: false, message: 'Method not found' });
  });

  it('rejects missing tools array', () => {
    const result = parseMcpToolsListResponse(200, { jsonrpc: '2.0', id: 1, result: {} });
    expect(result).toEqual({ ok: false, message: 'Invalid tools/list response' });
  });
});
