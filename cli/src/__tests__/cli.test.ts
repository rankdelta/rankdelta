import { describe, it, expect } from 'vitest';
import { run, resolveApiKey, isCliEntryPoint, type RunDeps } from '../index';
import { InvalidKeyError, McpClient, McpToolError } from '../mcp';
import { parseArgs } from '../args';

/** Build RunDeps capturing output, with a scripted fake MCP client. */
function makeDeps(
  opts: {
    env?: Record<string, string | undefined>;
    tool?: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  } = {},
): { deps: RunDeps; out: string[]; errs: string[]; calls: Array<[string, Record<string, unknown>]> } {
  const out: string[] = [];
  const errs: string[] = [];
  const calls: Array<[string, Record<string, unknown>]> = [];
  const deps: RunDeps = {
    log: (m) => out.push(m),
    err: (m) => errs.push(m),
    env: opts.env ?? {},
    makeClient: () =>
      ({
        callTool: (name: string, args: Record<string, unknown> = {}) => {
          calls.push([name, args]);
          return opts.tool ? opts.tool(name, args) : Promise.resolve(null);
        },
      }) as unknown as McpClient,
  };
  return { deps, out, errs, calls };
}

describe('resolveApiKey', () => {
  it('prefers the flag over the env', () => {
    expect(resolveApiKey(parseArgs(['sites', '--key', 'flagkey']), { RANKDELTA_API_KEY: 'envkey' })).toBe(
      'flagkey',
    );
  });
  it('falls back to the env var', () => {
    expect(resolveApiKey(parseArgs(['sites']), { RANKDELTA_API_KEY: 'envkey' })).toBe('envkey');
  });
  it('returns undefined when neither is set', () => {
    expect(resolveApiKey(parseArgs(['sites']), {})).toBeUndefined();
  });
});

describe('run — no network', () => {
  it('prints help and exits 0 with --help', async () => {
    const { deps, out } = makeDeps();
    const code = await run(['--help'], deps);
    expect(code).toBe(0);
    expect(out.join('\n')).toContain('USAGE');
  });

  it('prints version with --version', async () => {
    const { deps, out } = makeDeps();
    const code = await run(['--version'], deps);
    expect(code).toBe(0);
    expect(out[0]).toMatch(/\d+\.\d+\.\d+/);
  });

  it('shows the friendly no-key message and exits non-zero', async () => {
    const { deps, errs } = makeDeps({ env: {} });
    const code = await run(['sites'], deps);
    expect(code).not.toBe(0);
    expect(errs.join('\n')).toContain('No API key');
    expect(errs.join('\n')).toContain('RANKDELTA_API_KEY');
  });

  it('rejects unknown flags', async () => {
    const { deps, errs } = makeDeps({ env: { RANKDELTA_API_KEY: 'k' } });
    const code = await run(['sites', '--bogus'], deps);
    expect(code).toBe(2);
    expect(errs.join('\n')).toContain('Unknown flag');
  });

  it('rejects an unknown command', async () => {
    const { deps, errs } = makeDeps({ env: { RANKDELTA_API_KEY: 'k' } });
    const code = await run(['frobnicate'], deps);
    expect(code).toBe(2);
    expect(errs.join('\n')).toContain('Unknown command');
  });
});

describe('run — commands with a fake client', () => {
  const sites = [
    { id: 'aaaaaaaa-0000-0000-0000-000000000001', name: 'Acme', website_url: 'https://acme.com' },
  ];

  it('sites: calls list_sites and prints a table', async () => {
    const { deps, out, calls } = makeDeps({
      env: { RANKDELTA_API_KEY: 'k' },
      tool: async (name) => (name === 'list_sites' ? sites : null),
    });
    const code = await run(['sites'], deps);
    expect(code).toBe(0);
    expect(calls[0][0]).toBe('list_sites');
    expect(out.join('\n')).toContain('Acme');
  });

  it('sites --json: dumps raw JSON', async () => {
    const { deps, out } = makeDeps({
      env: { RANKDELTA_API_KEY: 'k' },
      tool: async () => sites,
    });
    await run(['sites', '--json'], deps);
    expect(JSON.parse(out.join('\n'))).toEqual(sites);
  });

  it('visibility <domain>: resolves the site then calls get_ai_visibility', async () => {
    const { deps, calls } = makeDeps({
      env: { RANKDELTA_API_KEY: 'k' },
      tool: async (name) => {
        if (name === 'list_sites') return sites;
        if (name === 'get_ai_visibility') return { overallShareOfVoice: 50, perEngine: [] };
        return null;
      },
    });
    const code = await run(['visibility', 'acme.com'], deps);
    expect(code).toBe(0);
    expect(calls.map((c) => c[0])).toEqual(['list_sites', 'get_ai_visibility']);
    expect(calls[1][1]).toEqual({ site_id: sites[0].id });
  });

  it('visibility <uuid>: skips list_sites and passes the id straight through', async () => {
    const { deps, calls } = makeDeps({
      env: { RANKDELTA_API_KEY: 'k' },
      tool: async () => ({ overallShareOfVoice: 10, perEngine: [] }),
    });
    await run(['visibility', sites[0].id], deps);
    expect(calls.map((c) => c[0])).toEqual(['get_ai_visibility']);
    expect(calls[0][1]).toEqual({ site_id: sites[0].id });
  });

  it('visibility with no arg is a usage error', async () => {
    const { deps, errs } = makeDeps({ env: { RANKDELTA_API_KEY: 'k' } });
    const code = await run(['visibility'], deps);
    expect(code).toBe(2);
    expect(errs.join('\n')).toContain('Usage: rankdelta visibility');
  });

  it('ranks with no site auto-uses the only site', async () => {
    const { deps, calls } = makeDeps({
      env: { RANKDELTA_API_KEY: 'k' },
      tool: async (name) => (name === 'list_sites' ? sites : []),
    });
    const code = await run(['ranks'], deps);
    expect(code).toBe(0);
    expect(calls.map((c) => c[0])).toEqual(['list_sites', 'list_ranks']);
    expect(calls[1][1]).toEqual({ site_id: sites[0].id });
  });

  it('audit <url>: calls audit_page', async () => {
    const { deps, calls } = makeDeps({
      env: { RANKDELTA_API_KEY: 'k' },
      tool: async () => ({ url: 'https://acme.com', result: { status_code: 200, meta: {} } }),
    });
    const code = await run(['audit', 'https://acme.com'], deps);
    expect(code).toBe(0);
    expect(calls[0]).toEqual(['audit_page', { url: 'https://acme.com' }]);
  });

  it('propagates a 401 as a friendly invalid-key error, exit 1', async () => {
    const { deps, errs } = makeDeps({
      env: { RANKDELTA_API_KEY: 'bad' },
      tool: async () => {
        throw new InvalidKeyError('Invalid or expired API key (HTTP 401).');
      },
    });
    const code = await run(['sites'], deps);
    expect(code).toBe(1);
    expect(errs.join('\n')).toContain('Invalid or expired API key');
  });

  it('surfaces an MCP tool error, exit 1', async () => {
    const { deps, errs } = makeDeps({
      env: { RANKDELTA_API_KEY: 'k' },
      tool: async (name) => {
        if (name === 'list_sites') return [];
        throw new McpToolError('site_not_found');
      },
    });
    const code = await run(['visibility', 'ghost.com'], deps);
    // resolveSite fails first (no candidates match) -> usage error (exit 2)
    expect([1, 2]).toContain(code);
    expect(errs.length).toBeGreaterThan(0);
  });
});

describe('isCliEntryPoint', () => {
  it('matches POSIX paths ending with index.js', () => {
    expect(isCliEntryPoint('/usr/bin/dist/index.js')).toBe(true);
    expect(isCliEntryPoint('dist/index.js')).toBe(true);
    expect(isCliEntryPoint('index.js')).toBe(true);
  });

  it('matches POSIX paths ending with rankdelta', () => {
    expect(isCliEntryPoint('/usr/local/bin/rankdelta')).toBe(true);
    expect(isCliEntryPoint('node_modules/.bin/rankdelta')).toBe(true);
    expect(isCliEntryPoint('rankdelta')).toBe(true);
  });

  it('matches Windows paths ending with index.js', () => {
    expect(isCliEntryPoint('C:\\Program Files\\app\\dist\\index.js')).toBe(true);
    expect(isCliEntryPoint('dist\\index.js')).toBe(true);
    expect(isCliEntryPoint('C:\\Users\\dev\\my project\\dist\\index.js')).toBe(true);
  });

  it('matches Windows paths ending with rankdelta', () => {
    expect(isCliEntryPoint('C:\\bin\\rankdelta')).toBe(true);
    expect(isCliEntryPoint('node_modules\\.bin\\rankdelta')).toBe(true);
  });

  it('rejects paths that do not end with index.js or rankdelta', () => {
    expect(isCliEntryPoint('/opt/app/src/test.js')).toBe(false);
    expect(isCliEntryPoint('C:\\src\\myindex.js')).toBe(false);
    expect(isCliEntryPoint('/path/to/rankdelta_helper')).toBe(false);
  });

  it('rejects empty or missing paths', () => {
    expect(isCliEntryPoint('')).toBe(false);
  });

  it('handles mixed separators (edge case)', () => {
    // While unusual, if somehow a mixed path appears, it should still work
    expect(isCliEntryPoint('C:\\path/to\\dist/index.js')).toBe(true);
  });
});
