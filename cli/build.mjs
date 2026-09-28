// Bundle the CLI to a single executable ESM file with a Node shebang.
import { build } from 'esbuild';
import { chmodSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const outfile = join(root, 'dist', 'index.js');

await build({
  entryPoints: [join(root, 'src', 'index.ts')],
  outfile,
  bundle: true,
  platform: 'node',
  target: 'node18',
  format: 'esm',
  minify: false,
  sourcemap: false,
  banner: { js: '#!/usr/bin/env node' },
  define: {
    __CLI_VERSION__: JSON.stringify(pkg.version),
  },
});

chmodSync(outfile, 0o755);
console.log(`Built ${outfile} (v${pkg.version})`);
