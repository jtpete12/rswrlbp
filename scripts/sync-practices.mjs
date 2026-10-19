#!/usr/bin/env node
/**
 * Copy PRACTICES.md into the plugin's skill references.
 *
 * The canonical copy lives at the repository root, because that is what people
 * read on GitHub and what they open an issue against. But a plugin installed
 * from the marketplace ships only its own directory, so the root file is not
 * there at runtime — and `/rswrlbp` audits against the practices, so it needs
 * them locally.
 *
 * Hence one copy, generated rather than hand-maintained, with a test asserting
 * the two match. Duplication you cannot detect is the problem; duplication a
 * test enforces is just a build step.
 *
 *   node scripts/sync-practices.mjs [--check]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const SOURCE = join(ROOT, 'PRACTICES.md');
export const COPY = join(ROOT, 'plugins', 'osrs-plugin-review', 'skills',
  'osrs-plugin-review', 'references', 'practices.md');

const BANNER = `<!-- Generated from PRACTICES.md by scripts/sync-practices.mjs. Do not edit here. -->\n\n`;

export function expected() {
  return BANNER + readFileSync(SOURCE, 'utf8');
}

export function current() {
  try {
    return readFileSync(COPY, 'utf8');
  } catch {
    return null;
  }
}

if (process.argv[1] && process.argv[1].endsWith('sync-practices.mjs')) {
  if (process.argv.includes('--check')) {
    if (current() === expected()) {
      console.log('practices.md is in sync with PRACTICES.md');
      process.exit(0);
    }
    console.error('practices.md is stale — run `npm run sync:practices`');
    process.exit(1);
  }
  writeFileSync(COPY, expected());
  console.log(`wrote ${COPY}`);
}
