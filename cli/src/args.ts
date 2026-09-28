/**
 * Tiny hand-rolled argv parser — zero dependencies.
 * Supports the global flags: --key <k>, --json, --help/-h, --version/-v,
 * and collects the remaining positionals (command + its arguments).
 */

export interface ParsedArgs {
  command?: string;
  positionals: string[];
  key?: string;
  json: boolean;
  help: boolean;
  version: boolean;
  /** Unknown --flags, surfaced so the CLI can warn/reject. */
  unknown: string[];
}

/**
 * @param argv arguments AFTER `node script.js` (i.e. process.argv.slice(2)).
 */
export function parseArgs(argv: string[]): ParsedArgs {
  const result: ParsedArgs = {
    positionals: [],
    json: false,
    help: false,
    version: false,
    unknown: [],
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (arg === '--') {
      // Everything after `--` is a positional.
      result.positionals.push(...argv.slice(i + 1));
      break;
    }

    if (arg === '--json') {
      result.json = true;
    } else if (arg === '--help' || arg === '-h') {
      result.help = true;
    } else if (arg === '--version' || arg === '-v') {
      result.version = true;
    } else if (arg === '--key') {
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('-')) {
        result.key = next;
        i++;
      } else {
        // `--key` with no value: treat as unknown/malformed.
        result.unknown.push('--key');
      }
    } else if (arg.startsWith('--key=')) {
      result.key = arg.slice('--key='.length);
    } else if (arg.startsWith('-') && arg !== '-') {
      result.unknown.push(arg);
    } else {
      result.positionals.push(arg);
    }
  }

  if (result.positionals.length > 0) {
    result.command = result.positionals[0];
  }

  return result;
}
