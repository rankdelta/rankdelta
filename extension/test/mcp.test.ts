import { describe, expect, it } from 'vitest';
import {
  buildToolCallRequest,
  buildToolsListRequest,
  extractResultText,
  parseBacklinkSummary,
  parseDomainOverview,
  parseMcpResult,
  MCP_ENDPOINT,
} from '../src/lib/mcp';
import type { McpResponseBody } from '../src/lib/types';

describe('request builders', () => {
  it('builds a tools/call request matching the documented contract', () => {
    const req = buildToolCallRequest('domain_overview', { target: 'example.com' }, 1);
    expect(req).toEqual({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'domain_overview', arguments: { target: 'example.com' } },
    });
  });

  it('builds domain_overview call with target argument', () => {
    const req = buildToolCallRequest('domain_overview', { target: 'example.com' });
    expect(req.params.arguments).toEqual({ target: 'example.com' });
  });

  it('builds backlink_summary call with target argument', () => {
    const req = buildToolCallRequest('backlink_summary', { target: 'example.com' });
    expect(req.params.arguments).toEqual({ target: 'example.com' });
  });

  it('builds a tools/list request', () => {
    expect(buildToolsListRequest(7)).toEqual({ jsonrpc: '2.0', id: 7, method: 'tools/list' });
  });

  it('auto-increments ids when none supplied', () => {
    const a = buildToolCallRequest('audit_page', { url: 'https://x.com' });
    const b = buildToolCallRequest('audit_page', { url: 'https://x.com' });
    expect(b.id).toBe(a.id + 1);
  });

  it('points at the branded MCP host', () => {
    expect(MCP_ENDPOINT).toBe('https://mcp.rankdelta.ai/mcp');
  });
});

describe('extractResultText / parseMcpResult', () => {
  const wrap = (text: string): McpResponseBody => ({
    jsonrpc: '2.0',
    id: 1,
    result: { content: [{ type: 'text', text }] },
  });

  it('reads result.content[0].text', () => {
    expect(extractResultText(wrap('hello'))).toBe('hello');
  });

  it('skips empty blocks and finds the first text', () => {
    const body: McpResponseBody = {
      result: { content: [{ type: 'text', text: '' }, { type: 'text', text: 'second' }] },
    };
    expect(extractResultText(body)).toBe('second');
  });

  it('returns null when no content', () => {
    expect(extractResultText({})).toBeNull();
    expect(extractResultText(null)).toBeNull();
    expect(extractResultText({ result: { content: [] } })).toBeNull();
  });

  it('parses JSON payloads', () => {
    expect(parseMcpResult(wrap('{"a":1}'))).toEqual({ a: 1 });
  });

  it('falls back to the raw string for non-JSON payloads', () => {
    expect(parseMcpResult(wrap('plain text'))).toBe('plain text');
  });

  it('returns null for empty/blank payloads', () => {
    expect(parseMcpResult(wrap('   '))).toBeNull();
    expect(parseMcpResult({})).toBeNull();
  });
});

describe('parseDomainOverview', () => {
  it('reads camelCase fields', () => {
    const m = parseDomainOverview({ organicTraffic: 12000, organicKeywords: 340 });
    expect(m.organicTraffic).toBe(12000);
    expect(m.organicKeywords).toBe(340);
  });

  it('reads snake_case and nested envelopes', () => {
    const m = parseDomainOverview({ data: { organic_traffic: 500, keywords: 42 } });
    expect(m.organicTraffic).toBe(500);
    expect(m.organicKeywords).toBe(42);
  });

  it('coerces numeric strings with separators', () => {
    const m = parseDomainOverview({ traffic: '1,234', organic_keywords: '89' });
    expect(m.organicTraffic).toBe(1234);
    expect(m.organicKeywords).toBe(89);
  });

  it('returns nulls when fields are absent', () => {
    const m = parseDomainOverview({ unrelated: true });
    expect(m.organicTraffic).toBeNull();
    expect(m.organicKeywords).toBeNull();
  });

  it('keeps the raw payload', () => {
    const raw = { organicTraffic: 1 };
    expect(parseDomainOverview(raw).raw).toBe(raw);
  });
});

describe('parseBacklinkSummary', () => {
  it('reads backlinks and referring domains across naming styles', () => {
    expect(parseBacklinkSummary({ backlinks: 900, referringDomains: 120 })).toMatchObject({
      backlinks: 900,
      referringDomains: 120,
    });
    expect(parseBacklinkSummary({ summary: { total_backlinks: 5, referring_domains: 3 } })).toMatchObject({
      backlinks: 5,
      referringDomains: 3,
    });
  });

  it('returns nulls on empty input', () => {
    const m = parseBacklinkSummary(null);
    expect(m.backlinks).toBeNull();
    expect(m.referringDomains).toBeNull();
  });
});
