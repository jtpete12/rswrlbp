#!/usr/bin/env node
/**
 * Fixture tests for osrs-lint.
 *
 * Two things have to hold for a checker like this to be worth putting in front
 * of anyone's pull request:
 *
 *   - it catches the things it claims to (tests/fixtures/offender), and
 *   - it stays quiet on correct code (tests/fixtures/polite).
 *
 * The second matters more. A reviewer who sees noise stops reading, and then
 * the real finding goes out with the rest.
 *
 * Run: node tests/run.mjs
 */

import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { checkDocs } from './docs.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const LINT = path.join(here, '..', 'plugins', 'osrs-plugin-review', 'scripts', 'osrs-lint.mjs');

function lint(fixture) {
  const out = execFileSync(process.execPath,
    [LINT, path.join(here, 'fixtures', fixture), '--json', '--gate', 'none'],
    { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  return JSON.parse(out);
}

/** Rules the offender fixture must trip, with the line each sits on. */
const MUST_FIRE = {
  'own-okhttp-client': 14,
  'paywalled-feature': 16,
  'per-item-price-request': 24,
  'prices-api-v1': 24,
  'no-user-agent': 24,
  'no-cache-layer': 24,
  'no-retry-backoff': 24,
  'reimplements-item-prices': 24,
  'blocked-default-user-agent': 25,
  'expensive-wiki-query': 33,
  'mediawiki-no-maxlag': 33,
  'no-gzip': 33,
  'network-on-game-thread': 40,
  'getresource-not-stream': 45,
  'no-request-timeout': null, // fires more than once; line not asserted
  'missing-attribution': null,
  'missing-license-file': null,
  'new-dependency': null,
};

let failures = 0;
const fail = (msg) => { failures++; console.log(`  \u001b[31mFAIL\u001b[0m  ${msg}`); };
const pass = (msg) => console.log(`  \u001b[32mok\u001b[0m    ${msg}`);

console.log('\nosrs-lint fixtures\n');

/* ---- the offender trips every rule it is built to trip ---- */
const bad = lint('offender');
// Keep the first hit per rule: findings are sorted, and a rule that fires
// several times should be asserted against its earliest line.
const fired = new Map();
for (const f of bad.findings) if (!fired.has(f.id)) fired.set(f.id, f);

for (const [id, line] of Object.entries(MUST_FIRE)) {
  const hit = fired.get(id);
  if (!hit) {
    fail(`offender: ${id} did not fire`);
    continue;
  }
  if (line !== null && hit.line !== line) {
    fail(`offender: ${id} fired at line ${hit.line}, expected ${line}`);
    continue;
  }
  pass(`offender trips ${id}`);
}

/* ---- every finding carries the prose that makes it actionable ---- */
for (const f of bad.findings) {
  if (!f.why || !f.fix) fail(`finding ${f.id} is missing why/fix`);
}
if (bad.findings.every((f) => f.why && f.fix)) pass('every finding carries why and fix');

/* ---- the polite plugin is clean, at every severity ---- */
const good = lint('polite');
if (good.findings.length) {
  for (const f of good.findings) {
    fail(`polite: false positive ${f.id} at ${f.file}:${f.line}`);
  }
} else {
  pass('polite fixture is clean');
}

/* ---- the gate actually gates ---- */
const exitOf = (fixture, gate) => {
  try {
    execFileSync(process.execPath,
      [LINT, path.join(here, 'fixtures', fixture), '--gate', gate],
      { encoding: 'utf8', stdio: 'pipe' });
    return 0;
  } catch (e) {
    return e.status;
  }
};

if (exitOf('offender', 'error') === 1) pass('offender fails the error gate');
else fail('offender should exit 1 under --gate error');

if (exitOf('polite', 'info') === 0) pass('polite passes even the info gate');
else fail('polite should exit 0 under --gate info');

/* ---- the escape hatch actually silences things ---- */
// This fixture trips a line rule and a file rule and silences both. It exists
// because the markers were once honoured only by line rules, so every `file`
// and `repo` rule ignored them without saying so.
const silenced = lint('ignored');
if (silenced.findings.length === 0) {
  pass('ignore markers silence both line and file rules');
} else {
  for (const f of silenced.findings) {
    fail(`ignored: ${f.id} fired at ${f.file}:${f.line} despite a marker`);
  }
}

/* ---- the asset rules fire on the shape they describe, and only that ---- */
// This fixture does everything else right — User-Agent, timeout, 429, a cache —
// so if anything but these two fires, one of the other rules has gone broad.
const assets = lint('assets');
const assetIds = [...new Set(assets.findings.map((f) => f.id))].sort();
const wanted = ['no-negative-cache', 'wiki-image-by-name'];
if (assetIds.join(',') === wanted.join(',')) {
  pass('assets fixture trips exactly the two asset rules');
} else {
  fail(`assets fixture tripped [${assetIds.join(', ')}], expected [${wanted.join(', ')}]`);
}

// …and the markers are not silencing everything indiscriminately.
if (bad.findings.length > 0) pass(`offender still reports ${bad.findings.length} findings`);
else fail('offender reported nothing — the ignore logic is too broad');

/* ---- the endpoint reference still agrees with the checker ---- */
checkDocs({ pass, fail });

console.log('');
if (failures) {
  console.log(`\u001b[31m  ${failures} failing\u001b[0m\n`);
  process.exit(1);
}
console.log('\u001b[32m  all green\u001b[0m\n');
