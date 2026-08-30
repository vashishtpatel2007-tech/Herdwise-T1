/**
 * Copy the engine into supabase/functions/_shared/engine so Deno bundles it.
 *
 * The engine is deliberately written once, with explicit .ts import
 * specifiers, so the SAME source runs in vitest, in the browser and in the
 * Edge Function. Copying beats a second implementation: two copies of the
 * risk model would drift, and the one in production would be the untested one.
 *
 *   node scripts/sync_engine.mjs
 */

import { cp, mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'src/engine');
const dest = path.join(root, 'supabase/functions/_shared/engine');

await rm(dest, { recursive: true, force: true });
await mkdir(dest, { recursive: true });
await cp(src, dest, {
  recursive: true,
  filter: (s) => !s.includes('__tests__'),
});

console.log(`engine synced -> ${path.relative(root, dest)}`);
