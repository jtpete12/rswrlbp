/**
 * Drift checks between the endpoint reference and the checker.
 *
 * The same knowledge is written down in three places — the rules in
 * `osrs-lint.mjs`, the catalogue in `references/rules.md`, and the costs in
 * `docs/openapi.yaml` — and nothing stops two of them disagreeing. Prose that
 * quietly stops matching the code is worse than no prose, because people trust
 * it. These assertions make that failure loud.
 *
 * The YAML is read textually rather than parsed, because the repo has no
 * dependencies and these checks only need lines, not structure. Structural
 * validation of the spec is a separate job (`npm run docs:lint`), which runs a
 * real OpenAPI validator in CI where installing one is free.
 */

import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { current, expected } from '../scripts/sync-practices.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(here, '..');
const LINT = path.join(ROOT, 'plugins', 'osrs-plugin-review', 'scripts', 'osrs-lint.mjs');
const SPEC = path.join(ROOT, 'docs', 'openapi.yaml');
const PAGE = path.join(ROOT, 'docs', 'index.html');
const CATALOGUE = path.join(ROOT, 'plugins', 'osrs-plugin-review', 'skills',
  'osrs-plugin-review', 'references', 'rules.md');

/** The cost vocabulary the spec's own description defines. */
const COSTS = ['cheap', 'moderate', 'expensive', 'avoid'];

/** Every rule id the checker actually has, straight from the source of truth. */
function ruleIds() {
  const out = execFileSync(process.execPath, [LINT, '--rules'], { encoding: 'utf8' });
  return out.trim().split('\n')
    .map((line) => line.trim().split(/\s+/)[1])
    .filter(Boolean);
}

export function checkDocs({ pass, fail }) {
  const spec = readFileSync(SPEC, 'utf8');
  const page = readFileSync(PAGE, 'utf8');
  const catalogue = readFileSync(CATALOGUE, 'utf8');
  const ids = new Set(ruleIds());

  /* ---- every operation's summary opens with a known cost token ---- */
  const summaries = [...spec.matchAll(/^ {6}summary: "(.+)"$/gm)].map((m) => m[1]);
  if (!summaries.length) fail('spec: found no operation summaries to check');

  let badCost = 0;
  for (const summary of summaries) {
    const head = summary.split('—')[0].trim();
    const tokens = head.split('/').map((t) => t.trim().split(/[\s(]/)[0]).filter(Boolean);
    const unknown = tokens.filter((t) => !COSTS.includes(t));
    if (unknown.length) {
      fail(`spec: summary opens with unknown cost ${unknown.join(', ')} — "${summary.slice(0, 60)}…"`);
      badCost++;
    }
  }
  if (!badCost) pass(`spec: all ${summaries.length} summaries open with a known cost token`);

  /* ---- x-osrs-lint-rules name rules that exist ---- */
  const referenced = new Set();
  for (const m of spec.matchAll(/x-osrs-lint-rules:\s*\[([^\]]+)\]/g)) {
    for (const id of m[1].split(',').map((s) => s.trim()).filter(Boolean)) referenced.add(id);
  }
  if (!referenced.size) {
    fail('spec: no x-osrs-lint-rules found — the spec is no longer tied to the checker');
  } else {
    const ghosts = [...referenced].filter((id) => !ids.has(id));
    if (ghosts.length) {
      for (const g of ghosts) fail(`spec: x-osrs-lint-rules names "${g}", which the checker does not have`);
    } else {
      pass(`spec: all ${referenced.size} referenced rule ids exist in the checker`);
    }
  }

  /* ---- the catalogue lists every rule ---- */
  const undocumented = [...ids].filter((id) => !catalogue.includes(`\`${id}\``));
  if (undocumented.length) {
    for (const id of undocumented) fail(`references/rules.md does not document "${id}"`);
  } else {
    pass(`references/rules.md documents all ${ids.size} rules`);
  }

  /* ---- the page's badge vocabulary matches the spec's ---- */
  const pageCosts = /var COSTS = \[([^\]]+)\]/.exec(page);
  if (!pageCosts) {
    fail('docs/index.html: could not find the COSTS badge vocabulary');
  } else {
    const listed = pageCosts[1].split(',').map((s) => s.trim().replace(/^'|'$/g, ''));
    const same = listed.length === COSTS.length && COSTS.every((c) => listed.includes(c));
    if (same) pass('docs/index.html badges the same cost vocabulary the spec uses');
    else fail(`docs/index.html badges [${listed}] but the spec uses [${COSTS}]`);
  }

  /* ---- the practices are numbered contiguously and counted honestly ---- */
  // P30 says prose that can go stale should fail loudly, so the count the
  // README quotes is checked rather than trusted.
  const practices = readFileSync(path.join(ROOT, 'PRACTICES.md'), 'utf8');
  const readme = readFileSync(path.join(ROOT, 'README.md'), 'utf8');
  const numbers = [...practices.matchAll(/^### P(\d+)\b/gm)].map((m) => Number(m[1]));

  if (!numbers.length) {
    fail('PRACTICES.md: no numbered practices found');
  } else {
    const gap = numbers.findIndex((n, i) => n !== i + 1);
    if (gap !== -1) fail(`PRACTICES.md: numbering breaks at position ${gap + 1} (found P${numbers[gap]})`);
    else pass(`PRACTICES.md: P1..P${numbers.length} numbered contiguously`);

    const claimed = /(\d+)\s+numbered working\s*\n?\s*rules/.exec(readme);
    if (!claimed) {
      fail('README no longer states how many practices there are');
    } else if (Number(claimed[1]) !== numbers.length) {
      fail(`README claims ${claimed[1]} practices, PRACTICES.md has ${numbers.length}`);
    } else {
      pass(`README's practice count matches PRACTICES.md (${numbers.length})`);
    }
  }

  /* ---- the practices' enforcement table names rules that exist ---- */
  // Claiming a practice is enforced by a rule that was renamed or removed is
  // the most misleading thing this document could do, so it is checked.
  const claimedRuleIds = new Set();
  for (const row of practices.matchAll(/^\| P\d+[^|]*\|([^|]+)\|/gm)) {
    for (const m of row[1].matchAll(/`([a-z0-9-]+)`/g)) claimedRuleIds.add(m[1]);
  }
  if (!claimedRuleIds.size) {
    fail('PRACTICES.md: enforcement table found no rule ids');
  } else {
    const ghosts = [...claimedRuleIds].filter((id) => !ids.has(id));
    if (ghosts.length) {
      for (const g of ghosts) fail(`PRACTICES.md claims enforcement by "${g}", which does not exist`);
    } else {
      pass(`PRACTICES.md: all ${claimedRuleIds.size} enforcement rule ids exist`);
    }
  }

  /* ---- the README's rule count matches the checker ---- */
  const claimedRules = /static checker, (\d+) rules/.exec(readme);
  if (!claimedRules) {
    fail('README no longer states how many rules the checker has');
  } else if (Number(claimedRules[1]) !== ids.size) {
    fail(`README claims ${claimedRules[1]} rules, the checker has ${ids.size}`);
  } else {
    pass(`README's rule count matches the checker (${ids.size})`);
  }

  /* ---- the plugin's copy of the practices matches the canonical one ---- */
  // The plugin ships only its own directory, so it carries a copy of
  // PRACTICES.md for /rswrlbp to audit against. A copy nobody checks is just
  // two documents disagreeing in a year's time.
  if (current() === expected()) {
    pass('plugin practices.md is in sync with PRACTICES.md');
  } else {
    fail('plugin practices.md is stale — run `npm run sync:practices`');
  }

  /* ---- every command the README advertises exists ---- */
  const commandDir = path.join(ROOT, 'plugins', 'osrs-plugin-review', 'commands');
  for (const name of ['rswrlbp', 'osrs-review']) {
    const exists = existsSync(path.join(commandDir, `${name}.md`));
    if (exists) pass(`command /${name} exists`);
    else fail(`README advertises /${name}, but commands/${name}.md is missing`);
  }

  /* ---- every plugin-root path a command cites actually ships ---- */
  // These resolve only once installed, so a typo here is invisible locally and
  // breaks the command for everyone who installs it.
  const pluginRoot = path.join(ROOT, 'plugins', 'osrs-plugin-review');
  let citedPaths = 0;
  let brokenPaths = 0;
  for (const name of ['rswrlbp', 'osrs-review']) {
    const file = path.join(commandDir, `${name}.md`);
    if (!existsSync(file)) continue;
    const body = readFileSync(file, 'utf8');
    for (const m of body.matchAll(/\$\{CLAUDE_PLUGIN_ROOT\}\/([A-Za-z0-9_\-./]+)/g)) {
      citedPaths++;
      if (!existsSync(path.join(pluginRoot, m[1]))) {
        fail(`/${name} cites \${CLAUDE_PLUGIN_ROOT}/${m[1]}, which does not exist in the plugin`);
        brokenPaths++;
      }
    }
  }
  if (citedPaths && !brokenPaths) pass(`all ${citedPaths} plugin-root paths cited by commands exist`);
  else if (!citedPaths) fail('no ${CLAUDE_PLUGIN_ROOT} paths found in any command — did they lose their script references?');

  /* ---- the page points at a spec that is actually there ---- */
  const url = /url:\s*'([^']+)'/.exec(page);
  if (url && url[1] === 'openapi.yaml') pass('docs/index.html loads openapi.yaml');
  else fail(`docs/index.html loads "${url ? url[1] : '?'}" — expected openapi.yaml`);
}
