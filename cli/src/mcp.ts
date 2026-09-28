/**
 * JSON-RPC 2.0 over the hosted Rankdelta MCP endpoint (Streamable HTTP).
 *
 * Pure helpers (request builders, response parser, result extraction) are kept
 * separate from the single network boundary (`McpClient`) so everything except
 * the actual `fetch` is unit-testable offline.
 */

export const MCP_ENDPOINT = 'https://mcp.rankdelta.ai/mcp';
export const PROTOCOL_VERSION = '2024-11-05';
export const CLIENT_INFO = { name: 'rankdelta-cli', version: '0.1.0' } as const;

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number | string;
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcResponse {
  jsonrpc?: string;
  id?: number | string | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

/** MCP tool-call result envelope. */
export interface ToolResultEnvelope {
  content?: Array<{ type: string; text?: string }>;
  isError?: boolean;
  structuredContent?: unknown;
}

// ── Typed errors so the CLI can print friendly messages + choose exit codes ──

export class InvalidKeyError extends Error {
  constructor(message = 'Invalid or expired API key.') {
    super(message);
    this.name = 'InvalidKeyError';
  }
}

export class NetworkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NetworkError';
  }
}

/** A JSON-RPC `error` response, or a tool result flagged `isError`. */
export class McpToolError extends Error {
  readonly detail: unknown;
  constructor(message: string, detail?: unknown) {
    super(message);
    this.name = 'McpToolError';
    this.detail = detail;
  }
}

// ── Pure request builders ──

export function buildInitializeRequest(id: number | string): JsonRpcRequest {
  return {
    jsonrpc: '2.0',
    id,
    method: 'initialize',
    params: {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: CLIENT_INFO,
    },
  };
}

export function buildToolCallRequest(
  id: number | string,
  name: string,
  args: Record<string, unknown> = {},
): JsonRpcRequest {
  return {
    jsonrpc: '2.0',
    id,
    method: 'tools/call',
    params: { name, arguments: args },
  };
}

/**
 * Parse a raw HTTP body into a JSON-RPC response, handling BOTH:
 *  - plain `application/json`
 *  - `text/event-stream` (SSE) where the JSON rides on `data:` lines.
 * For SSE we take the LAST `data:` line that parses as JSON (final message wins).
 */
export function parseRpcBody(bodyText: string, contentType = ''): JsonRpcResponse {
  const trimmed = bodyText.trim();
  const looksSse =
    /text\/event-stream/i.test(contentType) || /^(event:|data:)/m.test(trimmed);

  if (looksSse) {
    const dataPayloads: string[] = [];
    for (const rawLine of trimmed.split(/\r?\n/)) {
      const line = rawLine.trimEnd();
      if (line.startsWith('data:')) {
        dataPayloads.push(line.slice('data:'.length).trim());
      }
    }
    for (let i = dataPayloads.length - 1; i >= 0; i--) {
      const payload = dataPayloads[i];
      if (!payload || payload === '[DONE]') continue;
      try {
        return JSON.parse(payload) as JsonRpcResponse;
      } catch {
        // keep scanning earlier data: frames
      }
    }
    throw new NetworkError('No JSON payload found in server-sent event stream.');
  }

  try {
    return JSON.parse(trimmed) as JsonRpcResponse;
  } catch {
    throw new NetworkError(
      `Unexpected non-JSON response from MCP server: ${trimmed.slice(0, 200)}`,
    );
  }
}

/**
 * Extract usable data from a tools/call JSON-RPC response.
 * Throws McpToolError on a JSON-RPC `error` or an `isError` tool result.
 * Prefers `structuredContent`; otherwise JSON-parses `content[0].text`
 * (Rankdelta stringifies tool payloads into text), falling back to raw text.
 */
export function extractToolResult(resp: JsonRpcResponse): unknown {
  if (resp.error) {
    throw new McpToolError(resp.error.message || 'MCP request failed', resp.error);
  }
  const envelope = resp.result as ToolResultEnvelope | undefined;
  if (!envelope || typeof envelope !== 'object') {
    throw new McpToolError('MCP response had no result.', resp);
  }

  const text = envelope.content?.find((c) => c.type === 'text')?.text ?? '';
  const parsed = tryParseJson(text);

  if (envelope.isError) {
    const detail = envelope.structuredContent ?? parsed ?? text;
    throw new McpToolError(toolErrorMessage(detail), detail);
  }

  if (envelope.structuredContent !== undefined) return envelope.structuredContent;
  if (text) return parsed !== undefined ? parsed : text;
  return null;
}

function tryParseJson(text: string): unknown {
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function toolErrorMessage(detail: unknown): string {
  if (detail && typeof detail === 'object') {
    const rec = detail as Record<string, unknown>;
    const msg = rec.message ?? rec.error;
    if (typeof msg === 'string') return msg;
  }
  if (typeof detail === 'string') return detail;
  return 'MCP tool returned an error.';
}

// ── Network boundary ──

export type FetchLike = (
  input: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body: string;
  },
) => Promise<{
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
}>;

export interface McpClientOptions {
  apiKey: string;
  endpoint?: string;
  fetchImpl?: FetchLike;
}

export class McpClient {
  private readonly apiKey: string;
  private readonly endpoint: string;
  private readonly fetchImpl: FetchLike;
  private nextId = 1;

  constructor(opts: McpClientOptions) {
    this.apiKey = opts.apiKey;
    this.endpoint = opts.endpoint ?? MCP_ENDPOINT;
    const impl = opts.fetchImpl ?? (globalThis.fetch as unknown as FetchLike | undefined);
    if (!impl) {
      throw new NetworkError('global fetch is unavailable — Node 18+ is required.');
    }
    this.fetchImpl = impl;
  }

  private async send(request: JsonRpcRequest): Promise<JsonRpcResponse> {
    let res: Awaited<ReturnType<FetchLike>>;
    try {
      res = await this.fetchImpl(this.endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          'MCP-Protocol-Version': PROTOCOL_VERSION,
        },
        body: JSON.stringify(request),
      });
    } catch (e) {
      throw new NetworkError(
        `Could not reach ${this.endpoint}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }

    if (res.status === 401) {
      throw new InvalidKeyError(
        'Invalid or expired API key (HTTP 401). Check RANKDELTA_API_KEY or --key.',
      );
    }

    const bodyText = await res.text();
    if (!res.ok) {
      throw new NetworkError(`MCP server returned HTTP ${res.status}: ${bodyText.slice(0, 200)}`);
    }
    return parseRpcBody(bodyText, res.headers.get('content-type') ?? '');
  }

  /** Handshake (initialize) then call one tool; returns the extracted result. */
  async callTool(name: string, args: Record<string, unknown> = {}): Promise<unknown> {
    const initResp = await this.send(buildInitializeRequest(this.nextId++));
    if (initResp.error) {
      throw new McpToolError(initResp.error.message || 'initialize failed', initResp.error);
    }
    const callResp = await this.send(buildToolCallRequest(this.nextId++, name, args));
    return extractToolResult(callResp);
  }
}
