import { describe, it, expect, vi } from 'vitest';
import {
  buildInitializeRequest,
  buildToolCallRequest,
  parseRpcBody,
  extractToolResult,
  McpClient,
  InvalidKeyError,
  NetworkError,
  McpToolError,
  PROTOCOL_VERSION,
  type FetchLike,
} from '../mcp';

describe('request builders', () => {
  it('builds a valid initialize request', () => {
    const req = buildInitializeRequest(1);
    expect(req).toMatchObject({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
    });
    expect(req.params?.protocolVersion).toBe(PROTOCOL_VERSION);
    expect(req.params?.clientInfo).toMatchObject({ name: 'rankdelta-cli' });
  });

  it('builds a tools/call request with name + arguments', () => {
    const req = buildToolCallRequest(7, 'get_ai_visibility', { site_id: 'abc' });
    expect(req).toEqual({
      jsonrpc: '2.0',
      id: 7,
      method: 'tools/call',
      params: { name: 'get_ai_visibility', arguments: { site_id: 'abc' } },
    });
  });

  it('defaults arguments to an empty object', () => {
    const req = buildToolCallRequest(1, 'list_sites');
    expect(req.params?.arguments).toEqual({});
  });
});

describe('parseRpcBody', () => {
  it('parses plain JSON', () => {
    const body = JSON.stringify({ jsonrpc: '2.0', id: 1, result: { ok: true } });
    expect(parseRpcBody(body, 'application/json')).toMatchObject({ result: { ok: true } });
  });

  it('parses an SSE stream, taking the last data: line', () => {
    const body =
      'event: message\n' +
      'data: {"jsonrpc":"2.0","id":1,"result":{"first":true}}\n' +
      '\n' +
      'event: message\n' +
      'data: {"jsonrpc":"2.0","id":2,"result":{"second":true}}\n\n';
    const parsed = parseRpcBody(body, 'text/event-stream');
    expect(parsed.result).toEqual({ second: true });
  });

  it('detects SSE even when content-type is missing', () => {
    const body = 'data: {"jsonrpc":"2.0","id":1,"result":{"ok":1}}\n\n';
    expect(parseRpcBody(body, '').result).toEqual({ ok: 1 });
  });

  it('handles a single data: line', () => {
    const body = 'data: {"jsonrpc":"2.0","id":1,"result":42}';
    expect(parseRpcBody(body, 'text/event-stream').result).toBe(42);
  });

  it('throws NetworkError on non-JSON', () => {
    expect(() => parseRpcBody('<html>oops</html>', 'text/html')).toThrow(NetworkError);
  });
});

describe('extractToolResult', () => {
  it('parses JSON out of content[0].text', () => {
    const resp = {
      result: { content: [{ type: 'text', text: '[{"id":"1","name":"Acme"}]' }] },
    };
    expect(extractToolResult(resp)).toEqual([{ id: '1', name: 'Acme' }]);
  });

  it('prefers structuredContent when present', () => {
    const resp = {
      result: {
        structuredContent: { results: [{ id: 'x' }] },
        content: [{ type: 'text', text: '{"results":[{"id":"x"}]}' }],
      },
    };
    expect(extractToolResult(resp)).toEqual({ results: [{ id: 'x' }] });
  });

  it('returns raw text when it is not JSON', () => {
    const resp = { result: { content: [{ type: 'text', text: 'hello world' }] } };
    expect(extractToolResult(resp)).toBe('hello world');
  });

  it('throws McpToolError on a JSON-RPC error', () => {
    const resp = { error: { code: -32601, message: 'Method not found' } };
    expect(() => extractToolResult(resp)).toThrow(McpToolError);
  });

  it('throws McpToolError with the tool error message when isError is set', () => {
    const resp = {
      result: { isError: true, content: [{ type: 'text', text: '{"error":"site_not_found"}' }] },
    };
    try {
      extractToolResult(resp);
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(McpToolError);
      expect((e as McpToolError).message).toBe('site_not_found');
    }
  });

  it('does not treat not_configured status as an error', () => {
    const resp = {
      result: {
        content: [{ type: 'text', text: '{"status":"not_configured","message":"use setup"}' }],
      },
    };
    expect(extractToolResult(resp)).toEqual({ status: 'not_configured', message: 'use setup' });
  });
});

// ── McpClient with a mocked fetch (offline) ──

function mockFetch(
  responses: Array<{ status?: number; contentType?: string; body: string }>,
): { fetchImpl: FetchLike; calls: Array<{ url: string; init: any }> } {
  const calls: Array<{ url: string; init: any }> = [];
  let i = 0;
  const fetchImpl: FetchLike = vi.fn(async (url, init) => {
    calls.push({ url, init });
    const r = responses[Math.min(i, responses.length - 1)];
    i++;
    return {
      ok: (r.status ?? 200) < 400,
      status: r.status ?? 200,
      headers: { get: (n: string) => (n.toLowerCase() === 'content-type' ? r.contentType ?? 'application/json' : null) },
      text: async () => r.body,
    };
  }) as unknown as FetchLike;
  return { fetchImpl, calls };
}

describe('McpClient', () => {
  it('sends Bearer auth and returns the extracted tool result', async () => {
    const { fetchImpl, calls } = mockFetch([
      { body: JSON.stringify({ jsonrpc: '2.0', id: 1, result: { protocolVersion: PROTOCOL_VERSION } }) },
      { body: JSON.stringify({ jsonrpc: '2.0', id: 2, result: { content: [{ type: 'text', text: '[{"id":"s1"}]' }] } }) },
    ]);
    const client = new McpClient({ apiKey: 'sk_rankdelta_test', fetchImpl });
    const data = await client.callTool('list_sites');
    expect(data).toEqual([{ id: 's1' }]);
    expect(calls[0].init.headers.Authorization).toBe('Bearer sk_rankdelta_test');
    expect(calls[0].init.headers.Accept).toContain('text/event-stream');
    // initialize first, then tools/call
    expect(JSON.parse(calls[0].init.body).method).toBe('initialize');
    expect(JSON.parse(calls[1].init.body).method).toBe('tools/call');
  });

  it('throws InvalidKeyError on HTTP 401', async () => {
    const { fetchImpl } = mockFetch([
      { status: 401, body: JSON.stringify({ error: 'unauthorized', message: 'nope' }) },
    ]);
    const client = new McpClient({ apiKey: 'bad', fetchImpl });
    await expect(client.callTool('list_sites')).rejects.toBeInstanceOf(InvalidKeyError);
  });

  it('parses an SSE tool response end-to-end', async () => {
    const { fetchImpl } = mockFetch([
      { contentType: 'text/event-stream', body: 'data: {"jsonrpc":"2.0","id":1,"result":{}}\n\n' },
      {
        contentType: 'text/event-stream',
        body: 'data: {"jsonrpc":"2.0","id":2,"result":{"content":[{"type":"text","text":"{\\"overallShareOfVoice\\":42}"}]}}\n\n',
      },
    ]);
    const client = new McpClient({ apiKey: 'k', fetchImpl });
    const data = await client.callTool('get_ai_visibility', { site_id: 'x' });
    expect(data).toEqual({ overallShareOfVoice: 42 });
  });

  it('wraps transport failures in NetworkError', async () => {
    const fetchImpl: FetchLike = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as FetchLike;
    const client = new McpClient({ apiKey: 'k', fetchImpl });
    await expect(client.callTool('list_sites')).rejects.toBeInstanceOf(NetworkError);
  });
});
