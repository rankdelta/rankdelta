#!/usr/bin/env node
/**
 * CI secret-pattern guard.
 *
 * Fails the build if any tracked source file looks like it contains a hardcoded
 * secret. Patterns are deliberately conservative to avoid false positives on
 * .env.example-style documentation (which uses empty values or placeholder text).
 *
 * Allowed:
 *  - files named *.example, *.md, pnpm-lock.yaml, this script itself
 *  - lines where the value is empty, or an obvious placeholder (<…>, your-…, xxx…, changeme)
 *
 * Usage: node scripts/check-secrets.mjs  (add to a CI workflow or pre-commit hook)
 */

import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const SKIP = /(\.example$|\.md$|pnpm-lock\.yaml$|check-secrets\.mjs$|node_modules|dist\/)/;

// value patterns that indicate a REAL assigned secret (not an empty/placeholder assignment)
const SECRET_PATTERNS = [
  /(?:OPENROUTER|OPENAI|PERPLEXITY)_API_KEY\s*=\s*(?!$|\s|$)(?:sk-|or-)[A-Za-z0-9_\-]{16,}/,
  /DATAFORSEO_(?:LOGIN|PASSWORD)\s*=\s*['"]?[A-Za-z0-9@#$%^&*!]{8,}/,
  /STRIPE_SECRET_KEY\s*=\s*['"]?(?:sk_(?:test|live)_)[A-Za-z0-9]{16,}/,
  /STRIPE_WEBHOOK_SECRET\s*=\s*['"]?whsec_[A-Za-z0-9]{16,}/,
  /RESEND_API_KEY\s*=\s*['"]?re_[A-Za-z0-9_\-]{16,}/,
  /SUPABASE_SERVICE_ROLE_KEY\s*=\s*['"]?eyJ[A-Za-z0-9_\-.]{40,}/,
  /MCP_API_TOKEN\s*=\s*['"]?[A-Za-z0-9_\-]{32,}/,
  /PEXELS_API_KEY\s*=\s*['"]?[A-Za-z0-9]{20,}/,
  /UNSPLASH_ACCESS_KEY\s*=\s*['"]?[A-Za-z0-9_\-]{20,}/,
  // generic private key blocks anywhere in source
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
];

const PLACEHOLDER = /^(?:<[^>]*>|your[_-].*|xxx+|changeme|replace[_-].*|\${.*})$/i;

let files;
try {
  files = execSync('git ls-files', { encoding: 'utf8' }).split('\n').filter(Boolean);
} catch (e) {
  console.error('git ls-files failed — run this from the repo root:', e.message);
  process.exit(2);
}

const hits = [];
for (const file of files) {
  if (SKIP.test(file)) continue;
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    continue; // binary or unreadable — skip
  }
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    for (const re of SECRET_PATTERNS) {
      const m = lines[i].match(re);
      if (!m) continue;
      // extract the value part after the first '=' and allow obvious placeholders
      const eq = lines[i].indexOf('=');
      const value = eq >= 0 ? lines[i].slice(eq + 1).trim().replace(/^['"]|['"]$/g, '') : '';
      if (value && !PLACEHOLDER.test(value)) {
        hits.push(`${file}:${i + 1}: matches ${re.source.slice(0, 60)}…`);
      }
      break;
    }
  }
}

if (hits.length) {
  console.error('❌ Potential secrets found in tracked files:\n');
  for (const h of hits) console.error('  ' + h);
  console.error('\nMove these to environment variables / Supabase edge secrets. See SECURITY.md.');
  process.exit(1);
}
console.log('✅ No secret patterns detected.');
