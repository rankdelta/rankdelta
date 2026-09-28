/** Shared types for the Rankdelta MV3 extension. */

/** Name of a hosted MCP tool the extension is allowed to call. */
export type McpToolName = 'domain_overview' | 'backlink_summary' | 'audit_page';

/** JSON-RPC 2.0 request envelope for an MCP `tools/call`. */
export interface McpToolCallRequest {
  jsonrpc: '2.0';
  id: number;
  method: 'tools/call';
  params: {
    name: McpToolName;
    arguments: Record<string, unknown>;
  };
}

/** JSON-RPC 2.0 request envelope for an MCP `tools/list`. */
export interface McpToolsListRequest {
  jsonrpc: '2.0';
  id: number;
  method: 'tools/list';
  params?: Record<string, never>;
}

/** A single content block in an MCP tool result. */
export interface McpContentBlock {
  type: string;
  text?: string;
}

/** The shape of a successful MCP JSON-RPC response body (subset we rely on). */
export interface McpResponseBody {
  jsonrpc?: '2.0';
  id?: number;
  result?: {
    content?: McpContentBlock[];
    isError?: boolean;
  };
  error?: {
    code?: number;
    message?: string;
  };
}

/** Normalized outcome of a tool call, decoupled from transport details. */
export type McpCallOutcome<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; kind: 'unauthorized' | 'error'; message: string };

/** Parsed metrics rendered in the popup card. */
export interface DomainMetrics {
  organicTraffic?: number | null;
  organicKeywords?: number | null;
  raw: unknown;
}

export interface BacklinkMetrics {
  backlinks?: number | null;
  referringDomains?: number | null;
  raw: unknown;
}
