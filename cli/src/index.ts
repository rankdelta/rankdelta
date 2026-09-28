/**
 * rankdelta — a thin CLI over the hosted Rankdelta MCP server.
 * Commands: sites | visibility <site> | audit <url> | ranks [site]
 */
import { parseArgs, type ParsedArgs } from './args';
import {
  McpClient,
  InvalidKeyError,
  NetworkError,
  McpToolError,
  type McpClientOptions,
} from './mcp';
import {
  formatSites,
  formatVisibility,
  formatRanks,
  formatAudit,
  resolveSiteId,
  type SiteRecord,
} from './format';

// Injected by esbuild at build time; falls back for ts-node / vitest.
declare const __CLI_VERSION__: string;
const VERSION = typeof __CLI_VERSION__ !== 'undefined' ? __CLI_VERSION__ : '0.0.0-dev';

const NO_KEY_MESSAGE =
  'No API key — set RANKDELTA_API_KEY or pass --key <key>\n' +
  '(get one at rankdelta.ai → Settings → API & MCP).';

const HELP = `rankdelta — AI visibility, ranks & page audits from your terminal.

USAGE
  rankdelta <command> [args] [flags]

COMMANDS
  sites                 List the sites tracked in your account
  visibility <site>     AI Share of Voice for a site (id, name, or domain)
  audit <url>           On-page / technical SEO snapshot for a URL
  ranks [site]          Tracked keywords + latest Google position

FLAGS
  --key <key>           API key (else uses RANKDELTA_API_KEY)
  --json                Print the raw MCP tool result as JSON
  -h, --help            Show this help
  -v, --version         Show version

AUTH
  Set RANKDELTA_API_KEY to an sk_rankdelta_… key, or pass --key.
  Create a key at rankdelta.ai → Settings → API & MCP.

EXAMPLES
  rankdelta sites
  rankdelta visibility example.com
  rankdelta ranks --json
  rankdelta audit https://example.com/pricing`;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface RunDeps {
  log: (msg: string) => void;
  err: (msg: string) => void;
  env: Record<string, string | undefined>;
  /** Factory so tests can inject a fake MCP client. */
  makeClient: (opts: McpClientOptions) => McpClient;
}

export function resolveApiKey(
  parsed: ParsedArgs,
  env: Record<string, string | undefined>,
): string | undefined {
  const fromFlag = parsed.key?.trim();
  if (fromFlag) return fromFlag;
  const fromEnv = env.RANKDELTA_API_KEY?.trim();
  if (fromEnv) return fromEnv;
  return undefined;
}

/** Print output for a command, honoring --json. */
function emit(deps: RunDeps, json: boolean, raw: unknown, pretty: string): void {
  if (json) deps.log(JSON.stringify(raw, null, 2));
  else deps.log(pretty);
}

async function fetchSites(client: McpClient): Promise<SiteRecord[]> {
  const data = await client.callTool('list_sites');
  return Array.isArray(data) ? (data as SiteRecord[]) : [];
}

/** Resolve a site reference to an id, hitting list_sites only when needed. */
async function resolveSite(client: McpClient, query: string | undefined): Promise<string> {
  if (query && UUID_RE.test(query.trim())) return query.trim();

  const sites = await fetchSites(client);
  const outcome = resolveSiteId(sites, query ?? '');
  if ('id' in outcome) return outcome.id;

  let msg = outcome.error;
  if (outcome.candidates && outcome.candidates.length) {
    msg +=
      '\nAvailable sites:\n' +
      outcome.candidates
        .map((s) => `  ${s.id}  ${s.name ?? ''}  ${s.website_url ?? ''}`.trimEnd())
        .join('\n');
  }
  throw new UsageError(msg);
}

class UsageError extends Error {}

async function runCommand(parsed: ParsedArgs, apiKey: string, deps: RunDeps): Promise<number> {
  const client = deps.makeClient({ apiKey });
  const [command, ...rest] = parsed.positionals;

  switch (command) {
    case 'sites': {
      const data = await client.callTool('list_sites');
      emit(deps, parsed.json, data, formatSites(data));
      return 0;
    }
    case 'visibility': {
      const ref = rest[0];
      if (!ref) throw new UsageError('Usage: rankdelta visibility <site>');
      const siteId = await resolveSite(client, ref);
      const data = await client.callTool('get_ai_visibility', { site_id: siteId });
      emit(deps, parsed.json, data, formatVisibility(data, ref));
      return 0;
    }
    case 'ranks': {
      const ref = rest[0];
      const siteId = await resolveSite(client, ref);
      const data = await client.callTool('list_ranks', { site_id: siteId });
      emit(deps, parsed.json, data, formatRanks(data, ref));
      return 0;
    }
    case 'audit': {
      const url = rest[0];
      if (!url) throw new UsageError('Usage: rankdelta audit <url>');
      const data = await client.callTool('audit_page', { url });
      emit(deps, parsed.json, data, formatAudit(data));
      return 0;
    }
    default:
      deps.err(`Unknown command: ${command}\n\n${HELP}`);
      return 2;
  }
}

export async function run(argv: string[], deps: RunDeps): Promise<number> {
  const parsed = parseArgs(argv);

  if (parsed.version) {
    deps.log(VERSION);
    return 0;
  }
  if (parsed.help || !parsed.command) {
    deps.log(HELP);
    return parsed.command ? 0 : parsed.help ? 0 : 1;
  }
  if (parsed.unknown.length) {
    deps.err(`Unknown flag(s): ${parsed.unknown.join(', ')}\n\n${HELP}`);
    return 2;
  }

  const apiKey = resolveApiKey(parsed, deps.env);
  if (!apiKey) {
    deps.err(NO_KEY_MESSAGE);
    return 1;
  }

  try {
    return await runCommand(parsed, apiKey, deps);
  } catch (e) {
    if (e instanceof UsageError) {
      deps.err(e.message);
      return 2;
    }
    if (e instanceof InvalidKeyError) {
      deps.err(`${e.message}`);
      return 1;
    }
    if (e instanceof McpToolError) {
      deps.err(`Rankdelta error: ${e.message}`);
      return 1;
    }
    if (e instanceof NetworkError) {
      deps.err(`Network error: ${e.message}`);
      return 1;
    }
    deps.err(`Unexpected error: ${e instanceof Error ? e.message : String(e)}`);
    return 1;
  }
}

/**
 * Test if an argv[1] path ends with index.js or rankdelta.
 * Handles both forward and backslash separators (POSIX / Windows).
 */
export function isCliEntryPoint(path: string): boolean {
  if (!path) return false;
  // Normalize to forward slashes for consistent matching
  const normalized = path.replace(/\\/g, '/');
  return /(^|\/)(index\.js|rankdelta)$/.test(normalized);
}

// Only auto-run when executed as a binary (not when imported by tests).
const isMain = (() => {
  try {
    return (
      typeof process !== 'undefined' &&
      Array.isArray(process.argv) &&
      isCliEntryPoint(process.argv[1] ?? '')
    );
  } catch {
    return false;
  }
})();

if (isMain) {
  run(process.argv.slice(2), {
    log: (m) => console.log(m),
    err: (m) => console.error(m),
    env: process.env,
    makeClient: (opts) => new McpClient(opts),
  }).then(
    (code) => process.exit(code),
    (e) => {
      console.error(`Fatal: ${e instanceof Error ? e.message : String(e)}`);
      process.exit(1);
    },
  );
}
