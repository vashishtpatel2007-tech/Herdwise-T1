/**
 * Bundle each Edge Function into a single self-contained Deno module.
 *
 * The functions import the risk engine from ../_shared/engine/. Bundling
 * inlines it so a function deploys as ONE file, which keeps the deployed
 * artifact identical to what the tests ran against — no chance of a stale
 * _shared copy diverging from src/engine.
 *
 *   node scripts/bundle_functions.mjs
 */

import { build } from 'esbuild';
import { readdirSync, statSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const FUNCTIONS_DIR = 'supabase/functions';
const OUT_DIR = 'supabase/.bundled';

const fns = readdirSync(FUNCTIONS_DIR).filter((d) => {
  if (d.startsWith('_') || d.startsWith('.')) return false;
  return statSync(path.join(FUNCTIONS_DIR, d)).isDirectory();
});

mkdirSync(OUT_DIR, { recursive: true });

for (const fn of fns) {
  const entry = path.join(FUNCTIONS_DIR, fn, 'index.ts');
  await build({
    entryPoints: [entry],
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    target: 'es2022',
    outfile: path.join(OUT_DIR, `${fn}.ts`),
    // Emit real UTF-8 rather than \uXXXX escapes. Keeps the deployed artifact
    // readable in function logs and avoids a second layer of backslash
    // escaping when the file is transported as JSON.
    charset: 'utf8',
    // Deno resolves these at runtime from its own registry; bundling them
    // would both bloat the artifact and break the JSR specifier.
    external: ['jsr:*', 'npm:*', 'https://*', 'node:*'],
    logLevel: 'warning',
  });
  console.log(`bundled ${fn} -> ${OUT_DIR}/${fn}.ts`);
}
