/**
 * Which MCP URL the app hands users. Regression (23/09/26): a self-hosted install showed and
 * copied our cloud endpoint (mcp.rankdelta.ai) into agent configs instead of its own.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

const SELF_URL = 'https://selfhost.example.com';

async function load(mode: 'selfhost' | 'cloud', mcpEnv?: string) {
  vi.resetModules();
  vi.doMock('../config/deployment', () => ({ isSelfHost: () => mode === 'selfhost', isCloud: () => mode === 'cloud' }));
  vi.doMock('../lib/supabaseClient', () => ({ supabase: {}, SUPABASE_URL: SELF_URL, SUPABASE_ANON_KEY: 'anon' }));
  if (mcpEnv) vi.stubEnv('VITE_MCP_URL', mcpEnv);
  return import('./apiKeys');
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.doUnmock('../config/deployment');
  vi.doUnmock('../lib/supabaseClient');
});

describe('hosted MCP URL', () => {
  it('cloud: the branded host', async () => {
    const m = await load('cloud');
    expect(m.hostedMcpPrettyUrl()).toBe('https://mcp.rankdelta.ai/mcp');
  });

  it('self-host: the deployment’s own Supabase function, never our cloud', async () => {
    const m = await load('selfhost');
    expect(m.hostedMcpPrettyUrl()).toBe(`${SELF_URL}/functions/v1/mcp`);
    expect(m.hostedMcpUrl()).toBe(`${SELF_URL}/functions/v1/mcp`);
    expect(m.hostedMcpPrettyUrl()).not.toContain('rankdelta.ai');
  });

  it('self-host: VITE_MCP_URL wins when set', async () => {
    const m = await load('selfhost', 'https://mcp.agency.example/mcp/');
    expect(m.hostedMcpPrettyUrl()).toBe('https://mcp.agency.example/mcp');
  });
});

describe('MCP OAuth issuer (authorize form target)', () => {
  it('cloud: the branded host without /mcp', async () => {
    const m = await load('cloud');
    expect(m.mcpOAuthIssuerUrl()).toBe('https://mcp.rankdelta.ai');
  });

  it('self-host: the function URL is its own issuer', async () => {
    const m = await load('selfhost');
    expect(m.mcpOAuthIssuerUrl()).toBe(`${SELF_URL}/functions/v1/mcp`);
  });

  it('self-host with a branded MCP URL: one level up, like MCP_ISSUER', async () => {
    const m = await load('selfhost', 'https://mcp.agency.example/mcp');
    expect(m.mcpOAuthIssuerUrl()).toBe('https://mcp.agency.example');
  });
});
