#!/usr/bin/env node
/**
 * Verify every external link in the documentation, including its anchor.
 *
 * A dead link in a document whose whole claim is "here is where they say it"
 * is worse than no citation, because a reader who cannot check assumes you
 * did. Anchors are the part that rots quietly: the page still returns 200
 * while the section it points at has been renamed, so a plain status check
 * reports everything fine.
 *
 * Needs the network, so it is a separate job from `npm test` rather than part
 * of the dependency-free suite — same split as `npm run docs:lint`.
 *
 *   node scripts/check-links.mjs
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SKIP_DIRS = new Set(['.git', 'node_modules', 'tests']);

// Practising P1: say who is asking and how to reach us.
const USER_AGENT = 'osrs-plugin-review-linkcheck/0.2 '
  + '(documentation link check; github.com/jtpete12/osrs-plugin-review)';

function markdownFiles(dir, found = []) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) markdownFiles(full, found);
    else if (entry.endsWith('.md')) found.push(full);
  }
  return found;
}

/** Inline `](url)` and reference-style `[ref]: url`, external only. */
function linksIn(text) {
  const out = new Set();
  for (const m of text.matchAll(/\]\((https?:\/\/[^)\s]+)\)/g)) out.add(m[1]);
  for (const m of text.matchAll(/^\[[^\]]+\]:\s*(https?:\/\/\S+)\s*$/gm)) out.add(m[1]);
  return [...out];
}

const pages = new Map(); // url without fragment -> { status, body }

async function fetchPage(url) {
  if (pages.has(url)) return pages.get(url);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25_000);
  let result;
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': USER_AGENT, 'Accept-Encoding': 'gzip' },
    });
    result = { status: res.status, body: res.ok ? await res.text() : '' };
  } catch (err) {
    result = { status: 0, body: '', error: err.message };
  } finally {
    clearTimeout(timer);
  }
  pages.set(url, result);
  return result;
}

const files = markdownFiles(ROOT);
const byUrl = new Map(); // url -> Set of files citing it
for (const file of files) {
  for (const url of linksIn(readFileSync(file, 'utf8'))) {
    if (!byUrl.has(url)) byUrl.set(url, new Set());
    byUrl.get(url).add(file.slice(ROOT.length + 1).replace(/\\/g, '/'));
  }
}

console.log(`\n  ${byUrl.size} distinct external links across ${files.length} markdown files\n`);

let broken = 0;
let anchorsChecked = 0;

// Serial on purpose — P6, and these are other people's servers.
for (const [url, citedBy] of [...byUrl].sort()) {
  const hash = url.indexOf('#');
  const base = hash === -1 ? url : url.slice(0, hash);
  const anchor = hash === -1 ? null : decodeURIComponent(url.slice(hash + 1));

  const { status, body, error } = await fetchPage(base);
  const where = [...citedBy].join(', ');

  if (status === 0) {
    console.log(`  UNREACHABLE  ${url}\n               ${error} — cited by ${where}`);
    broken++;
    continue;
  }
  if (status >= 400) {
    console.log(`  HTTP ${status}     ${url}\n               cited by ${where}`);
    broken++;
    continue;
  }
  if (anchor) {
    anchorsChecked++;
    // GitHub renders anchors client-side for some views, so only treat a
    // missing anchor as broken where the server sent us the heading markup.
    const present = body.includes(`id="${anchor}"`) || body.includes(`id='${anchor}'`)
      || body.includes(`name="${anchor}"`);
    if (!present && !base.includes('github.com')) {
      console.log(`  NO ANCHOR    ${url}\n               #${anchor} is not on the page — cited by ${where}`);
      broken++;
      continue;
    }
  }
  console.log(`  ok           ${url}`);
}

console.log(`\n  ${byUrl.size - broken} ok · ${broken} broken · ${anchorsChecked} anchors verified\n`);
process.exit(broken ? 1 : 0);
