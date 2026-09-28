/**
 * Reproducible MV3 build: bundle the popup + options entry points with esbuild
 * and copy the static assets (manifest, HTML, CSS, icons) into `dist/`.
 *
 * No remote code, no dynamic imports — everything ships in the package.
 */
import { build } from 'esbuild';
import { cpSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dist = join(root, 'dist');

mkdirSync(dist, { recursive: true });

await build({
  entryPoints: {
    popup: join(root, 'src/popup/popup.ts'),
    options: join(root, 'src/options/options.ts'),
  },
  bundle: true,
  format: 'esm',
  target: 'chrome110',
  minify: true,
  sourcemap: false,
  legalComments: 'none',
  outdir: dist,
  logLevel: 'info',
});

// Static assets → dist root.
cpSync(join(root, 'manifest.json'), join(dist, 'manifest.json'));
for (const file of readdirSync(join(root, 'public'))) {
  cpSync(join(root, 'public', file), join(dist, file), { recursive: true });
}

console.log('Built extension → dist/');
