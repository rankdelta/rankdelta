/**
 * Minimal MCP (Streamable HTTP, JSON-RPC 2.0) client for the hosted
 * Rankdelta server. All request building and result parsing here is pure and
 * unit-tested; only `callMcpTool` performs I/O.
 */

import type {
  BacklinkMetrics,
  DomainMetrics,
  McpCallOutcome,
  McpResponseBody,
  McpToolCallRequest,
  McpToolName,
  McpToolsListRequest,
} from './types';

/** Hosted MCP endpoint. Host permission is declared for this origin only. */
export const MCP_ENDPOINT = 'https://mcp.rankdelta.ai/mcp';

let requestId = 0;
const nextId = (): number => (requestId += 1);

/** Build a JSON-RPC `tools/call` request body for a hosted tool. */
export function buildToolCallRequest(
  name: McpToolName,
  args: Record<string, unknown>,
  id: number = nextId(),
): McpToolCallRequest {
  return {
    jsonrpc: '2.0',
    id,
    method: 'tools/call',
    params: { name, arguments: args },
  };
}

/** Build a JSON-RPC `tools/list` request body (used by the options "Test key" button). */
export function buildToolsListRequest(id: number = nextId()): McpToolsListRequest {
  return { jsonrpc: '2.0', id, method: 'tools/list' };
}

/**
 * Pull the primary text payload out of an MCP response.
 *
 * The convention is `result.content[0].text`; it may be a JSON string or plain
 * text, so callers parse defensively. Returns `null` when no text is present.
 */
export function extractResultText(body: McpResponseBody | null | undefined): string | null {
  const content = body?.result?.content;
  if (!Array.isArray(content)) return null;
  for (const block of content) {
    if (block && typeof block.text === 'string' && block.text.length > 0) {
      return block.text;
    }
  }
  return null;
}

/**
 * Parse the text payload of an MCP result. Tries JSON first, then falls back to
 * returning the raw string. `null`/empty payloads yield `null`.
 */
export function parseMcpResult(body: McpResponseBody | null | undefined): unknown {
  const text = extractResultText(body);
  if (text == null) return null;
  const trimmed = text.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return trimmed;
  }
}

/** Read the first numeric value found among a list of candidate keys (case-insensitive). */
function pickNumber(source: unknown, keys: string[]): number | null {
  if (!source || typeof source !== 'object') return null;
  const record = source as Record<string, unknown>;
  const lowered = new Map<string, unknown>();
  for (const [k, v] of Object.entries(record)) lowered.set(k.toLowerCase(), v);
  for (const key of keys) {
    const raw = lowered.get(key.toLowerCase());
    if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
    if (typeof raw === 'string') {
      const n = Number(raw.replace(/[,\s]/g, ''));
      if (Number.isFinite(n) && raw.trim() !== '') return n;
    }
  }
  return null;
}

/**
 * Unwrap a metrics object that may be nested under common envelope keys
 * (`data`, `result`, `overview`, `summary`).
 */
function unwrap(value: unknown): unknown {
  if (!value || typeof value !== 'object') return value;
  const record = value as Record<string, unknown>;
  for (const key of ['data', 'result', 'overview', 'summary', 'metrics']) {
    const inner = record[key];
    if (inner && typeof inner === 'object') return inner;
  }
  return value;
}

/** Map a parsed `domain_overview` payload to popup metrics. */
export function parseDomainOverview(parsed: unknown): DomainMetrics {
  const source = unwrap(parsed);
  return {
    organicTraffic: pickNumber(source, [
      'organicTraffic',
      'organic_traffic',
      'traffic',
      'estimatedTraffic',
      'estimated_traffic',
      'visits',
    ]),
    organicKeywords: pickNumber(source, [
      'organicKeywords',
      'organic_keywords',
      'keywords',
      'keywordCount',
      'keyword_count',
    ]),
    raw: parsed,
  };
}

/** Map a parsed `backlink_summary` payload to popup metrics. */
export function parseBacklinkSummary(parsed: unknown): BacklinkMetrics {
  const source = unwrap(parsed);
  return {
    backlinks: pickNumber(source, ['backlinks', 'backlinkCount', 'backlink_count', 'totalBacklinks', 'total_backlinks']),
    referringDomains: pickNumber(source, [
      'referringDomains',
      'referring_domains',
      'refDomains',
      'ref_domains',
      'referringDomainCount',
    ]),
    raw: parsed,
  };
}

export interface CallOptions {
  /** Injectable fetch, defaults to the global. Kept out of tests (tests use pure helpers). */
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}

/**
 * Call a hosted MCP tool with the user's Bearer key. Never logs the key.
 * Returns a normalized outcome so the UI can branch on `unauthorized` vs `error`
 * without touching HTTP details.
 */
export async function callMcpTool(
  apiKey: string,
  name: McpToolName,
  args: Record<string, unknown>,
  options: CallOptions = {},
): Promise<McpCallOutcome> {
  const fetchImpl = options.fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await fetchImpl(MCP_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(buildToolCallRequest(name, args)),
      signal: options.signal,
    });
  } catch {
    return { ok: false, kind: 'error', message: 'Network error — could not reach Rankdelta.' };
  }

  if (res.status === 401) {
    return { ok: false, kind: 'unauthorized', message: 'Invalid or expired key — update it in options.' };
  }

  let body: McpResponseBody | null = null;
  try {
    body = (await res.json()) as McpResponseBody;
  } catch {
    body = null;
  }

  if (!res.ok) {
    const message = body?.error?.message || `Request failed (${res.status}).`;
    return { ok: false, kind: 'error', message };
  }
  if (body?.error) {
    return { ok: false, kind: 'error', message: body.error.message || 'The tool returned an error.' };
  }
  if (body?.result?.isError) {
    const text = extractResultText(body);
    return { ok: false, kind: 'error', message: text || 'The tool returned an error.' };
  }

  return { ok: true, data: parseMcpResult(body) };
}

/**
 * Validate a key by issuing a `tools/list` call. Returns an outcome whose data
 * is the number of tools exposed to that key.
 */
export async function testApiKey(
  apiKey: string,
  options: CallOptions = {},
): Promise<McpCallOutcome<number>> {
  const fetchImpl = options.fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await fetchImpl(MCP_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(buildToolsListRequest()),
      signal: options.signal,
    });
  } catch {
    return { ok: false, kind: 'error', message: 'Network error — could not reach Rankdelta.' };
  }

  if (res.status === 401) {
    return { ok: false, kind: 'unauthorized', message: 'Invalid or expired key.' };
  }

  let body: (McpResponseBody & { result?: { tools?: unknown[] } }) | null = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }

  if (!res.ok || body?.error) {
    return { ok: false, kind: 'error', message: body?.error?.message || `Request failed (${res.status}).` };
  }

  const tools = body?.result?.tools;
  const count = Array.isArray(tools) ? tools.length : 0;
  return { ok: true, data: count };
}
