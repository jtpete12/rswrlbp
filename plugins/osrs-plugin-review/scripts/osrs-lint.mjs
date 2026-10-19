#!/usr/bin/env node
/**
 * osrs-lint — a static reviewer for Old School RuneScape plugins, apps and
 * extensions, aimed at the two failure modes that actually get third-party
 * tools blocked or pulled:
 *
 *   1. Being expensive to the services they read. Hammering per-item endpoints,
 *      sending a pre-emptively-blocked User-Agent, never caching, polling far
 *      faster than the data changes, or reaching for a parser/Cargo query when
 *      a bulk dump exists.
 *
 *   2. Charging for, or gating, something built on data that was given away on
 *      non-commercial terms — and the Plugin Hub hygiene that goes with it.
 *
 * Every rule carries a `why` and a `fix`, because a finding nobody understands
 * gets suppressed rather than fixed. Rule sources are cited in
 * `references/` next to the skill that wraps this script.
 *
 * Zero dependencies, Node >= 18.
 *
 * osrs-lint-disable-file — this file is a catalogue of the patterns it looks
 * for, so scanning it finds every one of them.
 *
 * Usage:
 *   node osrs-lint.mjs [path] [--json|--github] [--min warn|error] [--quiet]
 *
 * Exit codes: 0 nothing at or above the gate, 1 gate tripped, 2 bad usage.
 */

import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';

/* ------------------------------------------------------------------ *
 * What we read
 * ------------------------------------------------------------------ */

const CODE_EXT = new Set([
  '.java', '.kt', '.kts', '.cs',
  '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.vue', '.svelte',
  '.py', '.rb', '.go', '.rs', '.php', '.lua',
  '.html', '.htm',
]);

/** Read as text for repo-level checks, but never scanned line-by-line. */
const META_FILES = new Set([
  'package.json', 'build.gradle', 'build.gradle.kts', 'settings.gradle',
  'runelite-plugin.properties', 'pom.xml', 'manifest.json', 'requirements.txt',
  'pyproject.toml', 'Cargo.toml', 'go.mod',
]);

const SKIP_DIRS = new Set([
  '.git', 'node_modules', 'build', 'dist', 'out', 'target', 'vendor',
  '.gradle', '.idea', '.vscode', 'coverage', '__pycache__', '.venv', 'venv',
  'bin', 'obj', '.next', '.nuxt', 'site-packages',
]);

/* ------------------------------------------------------------------ *
 * Hosts we care about
 * ------------------------------------------------------------------ */

/*
 * Specific patterns drive specific rules; the broad ones (`wikiAny`, `jagex`)
 * exist so that a host held in a constant is still recognised. Real code writes
 * `const BASE = 'https://secure.runescape.com'` and appends the path later, so
 * a pattern that insists on the path never matches the line that names the host.
 */
const HOST = {
  prices: /prices\.runescape\.wiki/i,
  wikiApi: /(?:oldschool\.)?runescape\.wiki\/api\.php|\/w\/api\.php|api\.php\?[^'"\s]*action=/i,
  wikiPage: /(?:oldschool\.)?runescape\.wiki\/w\//i,
  wikiAny: /(?:oldschool\.|classic\.)?runescape\.wiki/i,
  hiscores: /secure\.runescape\.com\/m=hiscore/i,
  jagex: /secure\.runescape\.com|services\.runescape\.com|oldschool\.runescape\.com/i,
  runelite: /api\.runelite\.net/i,
  weirdgloop: /api\.weirdgloop\.org|chisel\.weirdgloop\.org/i,
};

const ANY_TRACKED_HOST = new RegExp(
  Object.values(HOST).map((r) => r.source).join('|'),
  'i',
);

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

const LOOP = /\b(for|while|forEach|\.map\(|\.flatMap\(|Promise\.all|repeat|each)\b|\bfor\s*\(/;

/** Does a loop open within `back` lines above line `i`? */
function inLoop(lines, i, back = 14) {
  for (let j = Math.max(0, i - back); j <= i; j++) {
    if (LOOP.test(lines[j])) return true;
  }
  return false;
}

/** Strip the obvious comment forms so a documented URL is not a finding. */
function isComment(line) {
  const t = line.trim();
  return t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')
    || t.startsWith('#') || t.startsWith('<!--');
}

/*
 * Escape hatches, because a checker you cannot silence gets deleted rather than
 * argued with:
 *
 *   osrs-lint-disable-file                  skip this file entirely
 *   osrs-lint-ignore                        skip this line
 *   osrs-lint-ignore <rule-id> [rule-id...] skip those rules on this line
 *
 * A marker on the line above counts, so it can sit in a comment.
 */
const DISABLE_FILE = /osrs-lint-disable-file/;
const IGNORE = /osrs-lint-ignore(?:\s+([a-z0-9,\s-]+))?/i;

function ignoredHere(lines, i, ruleId) {
  const candidates = [lines[i]];
  // Walk up through a contiguous comment block, so a marker can head a few
  // lines of justification rather than having to sit on one cramped line.
  // A reason nobody has room to write is a reason nobody writes.
  for (let j = i - 1; j >= 0 && j >= i - 6; j--) {
    if (!isComment(lines[j])) break;
    candidates.push(lines[j]);
  }
  for (const candidate of candidates) {
    const m = candidate ? IGNORE.exec(candidate) : null;
    if (!m) continue;
    if (!m[1]) return true; // bare marker silences everything on the line
    if (m[1].split(/[,\s]+/).filter(Boolean).includes(ruleId)) return true;
  }
  return false;
}

const ms = (n, unit) => {
  const u = (unit || '').toLowerCase();
  if (u.startsWith('nano')) return n / 1e6;
  if (u.startsWith('micro')) return n / 1e3;
  if (u.startsWith('milli')) return n;
  if (u.startsWith('second')) return n * 1000;
  if (u.startsWith('minute')) return n * 60_000;
  if (u.startsWith('hour')) return n * 3_600_000;
  if (u.startsWith('day')) return n * 86_400_000;
  return n; // bare number in JS timers is already ms
};

const isBrowserish = (text) =>
  /\bdocument\.|\bwindow\.|localStorage|chrome\.runtime|browser\.runtime/.test(text);

/*
 * Most of the noise a checker like this produces comes from asking "does the
 * repo talk to the wiki somewhere?" when the question is "does *this* call?".
 * A debounce timer and a price poller are both setTimeout; a fetch of
 * /api/profile and a fetch of the wiki are both fetch. So findings that depend
 * on talking to a tracked service have to prove it locally.
 *
 * Two things make that work on real code: constants (`const BASE =
 * 'https://secure.runescape.com'` used as `${BASE}/...`), and callbacks passed
 * by name (`setInterval(refreshPrices, 30_000)`), where the request is in a
 * function defined elsewhere.
 */

/** Names bound to a string literal containing a tracked host. */
function hostVarsOf(text) {
  const names = [];
  const re = /(?:const|let|var|static|final)?\s*(?:String\s+)?(\w+)\s*=\s*[`'"]([^`'"]+)[`'"]/g;
  for (const m of text.matchAll(re)) {
    if (ANY_TRACKED_HOST.test(m[2])) names.push(m[1]);
  }
  return names;
}

/*
 * Request verbs, deliberately not including bare `http` or `url` — every URL
 * string contains "http", so a link href would read as a request and anchor
 * findings on a line that never calls anything.
 */
const REQUESTISH = /\bfetch\s*\(|\baxios\b|\brequests?\s*[.(]|\.openConnection\s*\(|\bnewCall\s*\(|\burlopen\s*\(|\bHttpGet\b|\bHttpClients?\b|\bJsoup\b|\bnew\s+URL\s*\(|\bWebClient\b|XMLHttpRequest|\.(?:get|post|put|send|execute|enqueue)\s*\(/i;

/**
 * 1-based line where this file first makes a request to a tracked service.
 *
 * A host string on its own is not a request — it is just as likely to be the
 * base of a link the page renders. So prefer a line that is request-shaped, and
 * only fall back to a bare mention when the file has nothing better. Getting
 * this wrong puts repo-level findings on an innocent line, which is how a
 * reviewer learns to distrust the whole report.
 */
function firstCallSite(text, hostVars) {
  const lines = text.split('\n');
  const hv = hostVars.length ? new RegExp(`\\b(?:${hostVars.join('|')})\\b`) : null;
  let fallback = null;

  for (let i = 0; i < lines.length; i++) {
    if (isComment(lines[i])) continue;
    const mentionsHost = ANY_TRACKED_HOST.test(lines[i]);
    const usesHostVar = hv ? hv.test(lines[i]) : false;
    if (!mentionsHost && !usesHostVar) continue;

    // The call may wrap, so accept a request verb within a couple of lines.
    const near = lines.slice(Math.max(0, i - 2), i + 3).join('\n');
    if (REQUESTISH.test(near)) return { line: i + 1, confident: true };
    if (mentionsHost && fallback === null) fallback = i + 1;
  }
  return fallback === null ? null : { line: fallback, confident: false };
}

/**
 * Files that talk to a tracked service, best evidence first. Repo-level
 * findings anchor on the first of these, so a file that merely holds a wiki
 * link must never outrank one that actually makes a request.
 */
function callersOf(files) {
  const confident = files.filter((f) => f.callSite?.confident);
  return confident.length ? confident : files.filter((f) => f.callSite);
}

/** Does the body of the function called `name` reach a tracked service? */
function namedCallbackTouchesHost(file, name) {
  if (!name || name.length < 2) return false;
  const lines = file.text.split('\n');
  const def = new RegExp(
    `(?:function\\s+${name}\\b|\\b${name}\\s*=\\s*(?:async\\s*)?(?:function|\\()|\\b(?:void|private|public|protected)[\\w\\s<>,\\[\\]]*\\b${name}\\s*\\()`,
  );
  for (let i = 0; i < lines.length; i++) {
    if (!def.test(lines[i])) continue;
    const body = lines.slice(i, i + 30).join('\n');
    if (ANY_TRACKED_HOST.test(body)) return true;
    for (const v of file.hostVars) {
      if (new RegExp(`\\b${v}\\b`).test(body)) return true;
    }
  }
  return false;
}

/* ------------------------------------------------------------------ *
 * Rule catalogue
 *
 * kind 'line' — regex against one line, optionally gated by `when`.
 * kind 'file' — function over a whole file.
 * kind 'repo' — function over every file at once.
 * ------------------------------------------------------------------ */

const RULES = [
  /* ---------- cost to the services being read ---------- */
  {
    id: 'per-item-price-request',
    kind: 'line',
    severity: 'error',
    title: 'One price request per item id',
    pattern: /prices\.runescape\.wiki[^'"`\s]*\/(?:latest|5m|1h)\?[^'"`\s]*id=|\/(?:latest|5m|1h)\?id=\$?\{?[a-z_]/i,
    when: (ctx) => ctx.inLoop || /\$\{|\+\s*(?:id|itemId|item_id)\b|%[sd]|format\(/i.test(ctx.line),
    why: 'The wiki asks explicitly that you not loop over `id`. A full pull with no `id` '
      + 'parameter costs them roughly 100x less than fetching items one at a time, and '
      + '"don\'t hit us with 3700 API requests" is their own wording.',
    fix: 'Call /latest once with no `id`, keep the map in memory, and look ids up locally. '
      + 'Refresh on a timer, not per lookup.',
  },
  {
    id: 'prices-api-v1',
    kind: 'line',
    severity: 'warn',
    title: 'Deprecated v1 prices API',
    pattern: /prices\.runescape\.wiki\/api\/v1\//i,
    why: 'v1 is still served but documented as removable, and v2 is the supported version.',
    fix: 'Move to /api/v2/osrs. Note v2 averages can carry two decimal places, and prices '
      + 'can exceed a signed 32-bit int — widen the types you parse into.',
  },
  {
    id: 'timeseries-in-loop',
    kind: 'line',
    severity: 'error',
    title: '/timeseries called per item',
    pattern: /\/timeseries\?/i,
    when: (ctx) => ctx.inLoop,
    why: '/timeseries is per-item by design and is the most expensive price endpoint. '
      + 'Fanning it out over a list multiplies that cost directly.',
    fix: 'Fetch /timeseries only for the one item a user is actually looking at, and cache '
      + 'the result. For breadth use /5m or /1h, which are already aggregated.',
  },
  {
    id: 'timestep-assumed',
    kind: 'line',
    severity: 'info',
    title: 'Timeseries timestep treated as fixed',
    pattern: /timestep\s*[*/]|\/\s*300\b.*timeseries|timeseries.*\b300\b/i,
    why: 'The wiki states the timestep is NOT guaranteed and may change without notice.',
    fix: 'Read `timestep` out of the response and derive from that rather than hardcoding 300.',
  },
  {
    id: 'blocked-default-user-agent',
    kind: 'line',
    severity: 'error',
    title: 'Client whose default User-Agent is pre-emptively blocked',
    pattern: /\bnew\s+HttpURLConnection|\(HttpURLConnection\)\s*\w*\.openConnection|\bHttpClients?\.(?:createDefault|newHttpClient)\(|\brequests\.(?:get|post|Session)\(|\burllib\.request\.urlopen\(|\bnew\s+RestClient\(|\bRestSharp\b/,
    when: (ctx) => ctx.repo.touchesTrackedHost,
    why: 'The wiki blocks a list of default agents outright: python-requests, Python-urllib, '
      + 'Apache-HttpClient, RestSharp, Java/{version} and curl/{version}. A bare '
      + 'HttpURLConnection sends Java/{version}, so it is blocked before your code runs. '
      + 'The libraries themselves are fine — the default header is not.',
    fix: 'Set a descriptive User-Agent naming the tool and a contact (email or Discord). '
      + 'In a RuneLite plugin, inject RuneLite\'s OkHttpClient instead and you inherit '
      + '"RuneLite/<version>" for free.',
  },
  {
    id: 'no-user-agent',
    kind: 'repo',
    severity: 'error',
    title: 'No User-Agent set anywhere, but external APIs are called',
    run(files) {
      const callers = callersOf(files);
      if (!callers.length) return [];
      const setsUa = files.some((f) =>
        /User-?Agent|Api-User-Agent|setRequestProperty\s*\(\s*["']User-Agent/i.test(f.text)
        || /@Inject[\s\S]{0,200}OkHttpClient/.test(f.text));
      if (setsUa) return [];
      const first = callers[0];
      const browser = isBrowserish(first.text);
      return [{
        file: first.rel,
        line: first.callSite.line,
        severity: browser ? 'warn' : 'error',
        why: 'A descriptive User-Agent is the one hard requirement the wiki states, and it is '
          + 'how they tell your traffic from abuse when they decide what to throttle. '
          + (browser
            ? 'Browser JavaScript cannot set User-Agent, so the wiki asks for Api-User-Agent instead.'
            : 'Without one you are indistinguishable from a scraper.'),
        fix: browser
          ? 'Send an `Api-User-Agent` header: "<tool>/<version> (<contact>)".'
          : 'Send `User-Agent: <tool>/<version> (<what it does>; <contact>)`. Do not copy a '
            + 'browser\'s User-Agent string.',
      }];
    },
  },
  {
    id: 'no-cache-layer',
    kind: 'repo',
    severity: 'error',
    title: 'External API is called with nothing that looks like a cache',
    run(files) {
      const callers = callersOf(files);
      if (!callers.length) return [];
      const CACHEY = /CacheBuilder|expireAfter|Caffeine|LoadingCache|Cache-Control|If-None-Match|ETag|etag|localStorage|sessionStorage|indexedDB|redis|memcach|node-cache|lru-?cache|stale-while-revalidate|\bmaxAge\b|\bttl\b|lastFetch|cachedAt|fetchedAt|new\s+Cache\(|@Cacheable|functools\.lru_cache|writeFile|readFile/i;
      if (files.some((f) => CACHEY.test(f.text))) return [];
      const first = callers[0];
      return [{
        file: first.rel,
        line: first.callSite.line,
        why: 'The wiki caches at several levels on their side and asks that you cache on yours. '
          + 'Nothing in this repo stores a response, so every render, tick or page load '
          + 'becomes a request.',
        fix: 'Hold responses in memory keyed by endpoint with a timestamp, and refresh only '
          + 'when older than the data\'s own granularity: minutes for /latest, 5 minutes '
          + 'for /5m, an hour for /1h, and effectively forever for /mapping.',
      }];
    },
  },
  {
    id: 'polling-faster-than-data',
    kind: 'line',
    severity: 'error',
    title: 'Polling faster than the data changes',
    // Repeating timers only. A one-shot setTimeout is a debounce or an abort
    // deadline far more often than it is a poller, and flagging those buries
    // the real finding.
    pattern: /setInterval\s*\([^;]*?,\s*(\d[\d_]*)\s*\)|schedule(?:AtFixedRate|WithFixedDelay)\s*\([^,]*,[^,]*,\s*(\d[\d_]*)\s*,\s*TimeUnit\.(\w+)|\btime\.sleep\(\s*([\d.]+)\s*\)/,
    when: (ctx) => {
      const m = ctx.match;
      const n = Number((m[1] ?? m[2] ?? m[4] ?? '').replace(/_/g, ''));
      if (!Number.isFinite(n) || n === 0) return false;
      const unit = m[3] ? m[3] : (m[4] !== undefined ? 'seconds' : 'millis');
      ctx.periodMs = ms(n, unit);
      if (ctx.periodMs >= 60_000) return false;
      if (m[4] !== undefined && !ctx.inLoop) return false; // a lone sleep is not a poll
      return ctx.nearHost(12, 24);
    },
    why: 'Prices move on the order of minutes and /5m and /1h are pre-aggregated, so a sub-minute '
      + 'timer spends requests on data that has not changed. Sustained multiple-large-queries-'
      + 'per-second is the wiki\'s own description of what gets access restricted.',
    fix: 'Poll no faster than the endpoint\'s granularity. RuneLite\'s own ItemManager refreshes '
      + 'prices every 30 minutes, which is a reasonable floor to copy.',
    note: (ctx) => `timer fires every ${Math.round(ctx.periodMs)}ms`,
  },
  {
    id: 'expensive-wiki-query',
    kind: 'line',
    severity: 'error',
    title: 'Expensive wiki query where a cheap bulk source exists',
    pattern: /action=(?:parse|ask|cargoquery|expandtemplates|visualeditor)|Special:CargoExport|action=query[^'"`\s]*list=search|rvprop=content/i,
    why: 'Parser, Semantic-MediaWiki and Cargo queries run work per request and are the '
      + 'endpoints that hurt a wiki under load — unlike the price API, which is cached hard. '
      + 'Most tools reaching for these want data that is already published in bulk.',
    fix: 'Prefer, in order: the prices API (/latest, /mapping), `action=raw` on a data module, '
      + 'the Weird Gloop bulk dumps, or a build-time snapshot committed to your repo. '
      + 'Keep live parser queries for genuinely interactive one-offs.',
  },
  {
    id: 'mediawiki-no-maxlag',
    kind: 'file',
    severity: 'warn',
    title: 'MediaWiki API used without maxlag',
    run(f) {
      if (!HOST.wikiApi.test(f.text)) return [];
      if (/maxlag/i.test(f.text)) return [];
      const lines = f.text.split('\n');
      const i = lines.findIndex((l) => HOST.wikiApi.test(l) && !isComment(l));
      if (i < 0) return [];
      return [{
        line: i + 1,
        why: 'maxlag makes the API refuse your request instead of adding to the load when the '
          + 'servers are already struggling. MediaWiki asks every non-interactive client to set it.',
        fix: 'Add `maxlag=5` to api.php requests and treat the `maxlag` error as a signal to back '
          + 'off and retry later, not as a failure.',
      }];
    },
  },
  {
    id: 'mediawiki-unbatched',
    kind: 'line',
    severity: 'warn',
    title: 'One MediaWiki request per title',
    pattern: /[?&](?:titles|pageids|ids)=/i,
    when: (ctx) => ctx.inLoop && !/\|/.test(ctx.line),
    why: 'MediaWiki takes up to 50 titles in one request, pipe-separated, and asks that you '
      + 'batch rather than loop. A generator is cheaper still than a second round of lookups.',
    fix: 'Join ids with `|` up to 50 per request, or use a generator so one request feeds the next.',
  },
  {
    id: 'revid-not-oldid',
    kind: 'line',
    severity: 'info',
    title: 'revid used where oldid is cheaper',
    pattern: /[?&]revid=/i,
    why: 'MediaWiki documents `revid` as an expensive operation.',
    fix: 'Use `oldid` to fetch a specific revision.',
  },
  {
    id: 'parallel-wiki-requests',
    kind: 'line',
    severity: 'warn',
    title: 'Wiki requests fired in parallel',
    pattern: /Promise\.all|Promise\.allSettled|asyncio\.gather|parallelStream|Task\.WhenAll/,
    // The fanned-out calls sit in the lines below, so look mostly forward.
    when: (ctx) => ctx.nearHost(2, 16),
    why: 'MediaWiki asks for requests in series rather than in parallel; a fan-out is what turns '
      + 'a polite client into a burst.',
    fix: 'Await sequentially, or cap concurrency at 1 for api.php. Batch instead of fanning out.',
  },
  {
    id: 'no-gzip',
    kind: 'file',
    severity: 'info',
    title: 'Wiki API called without requesting gzip',
    run(f) {
      if (!HOST.wikiApi.test(f.text)) return [];
      if (/Accept-Encoding|gzip|\bcompress\b/i.test(f.text)) return [];
      if (isBrowserish(f.text)) return []; // the browser already does this
      const lines = f.text.split('\n');
      const i = lines.findIndex((l) => HOST.wikiApi.test(l) && !isComment(l));
      return i < 0 ? [] : [{
        line: i + 1,
        why: 'MediaWiki asks clients to send Accept-Encoding: gzip to cut bandwidth.',
        fix: 'Send `Accept-Encoding: gzip` and decompress the response.',
      }];
    },
  },
  {
    id: 'scrapes-wiki-html',
    kind: 'line',
    severity: 'warn',
    title: 'Wiki article HTML fetched and parsed',
    pattern: /(?:fetch|get|urlopen|request|Jsoup\.connect|HttpGet)\s*\(\s*[`'"][^`'"]*(?:oldschool\.)?runescape\.wiki\/w\//i,
    why: 'An article URL serves a full rendered page — the most expensive thing the wiki can '
      + 'hand you — and its HTML is not a stable interface, so this breaks on any layout change.',
    fix: 'Use the prices API, `action=raw` on the underlying data module, or a bulk dump. If you '
      + 'genuinely need article text, `action=query&prop=extracts` is far cheaper than the page.',
  },
  {
    id: 'wiki-image-by-name',
    kind: 'file',
    severity: 'warn',
    title: 'Wiki image fetched by name where an id-keyed source exists',
    run(f) {
      if (!/runescape\.wiki\/images/i.test(f.text)) return [];
      const lines = f.text.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (isComment(lines[i]) || !REQUESTISH.test(lines[i])) continue;
        // A literal filename is a deliberate one-off — a picture of a spell or
        // a quest, which genuinely exists nowhere else. A URL built from a
        // variable is a name-keyed lookup over many items, which is the thing
        // worth saying something about.
        if (!/\$\{|%s|\.format\(|\+\s*\w|encodeURIComponent|\{\}/.test(lines[i])) continue;
        const near = lines.slice(Math.max(0, i - 6), i + 4).join('\n');
        const aboutImages = /runescape\.wiki\/images/i.test(near)
          || f.hostVars.some((v) => new RegExp(`\\b${v}\\b`).test(lines[i]));
        if (!aboutImages) continue;
        const ladder = /['"`]_[15]['"`]|_5|_1/.test(near);
        return [{
          line: i + 1,
          snippet: lines[i].trim().slice(0, 160),
          note: ladder ? 'with a stack-size fallback ladder' : undefined,
          why: 'Wiki image files are keyed by name, and the wiki files stackable items only '
            + 'at a stack size — there is no Guam_seed.png, only Guam_seed_5.png — so a '
            + 'name-keyed lookup ends up trying Name, then Name_5, then Name_1, and a name '
            + 'that resolves to nothing costs three requests rather than one. The files are '
            + 'also article illustrations rather than icons: two measured from a real planner '
            + 'were 124KB and 75KB, both drawn at 20px.',
          fix: 'Resolve the name to an item id once, then fetch '
            + 'static.runelite.net/cache/item/icon/<id>.png — the game\'s own sprite, as a PNG, '
            + 'from a static CDN — with Jagex\'s obj_sprite.gif?id= as a fallback. Keep the '
            + 'wiki for the few pictures whose subject is not an item at all, as a short '
            + 'explicit allowlist of literal filenames.',
        }];
      }
      return [];
    },
  },
  {
    id: 'no-negative-cache',
    kind: 'file',
    severity: 'warn',
    title: 'Per-key lookups cache hits but not misses',
    run(f) {
      if (!f.callSite) return [];
      // Any vocabulary for recording an absence counts as handling it; this is
      // looking for the total absence of the idea, not grading the design.
      if (/unresolved|not_?found|negative|tombstone|known_?missing|\bmisses\b|absent|\bnotFound\b/i.test(f.text)) return [];
      // Only meaningful where something is cached in the first place, and where
      // the lookup can come back empty.
      if (!/writeFile|\.set\(|\.put\(|setItem|\bcache\[/i.test(f.text)) return [];
      if (!/return null|return undefined|return None|return nothing|=> null/.test(f.text)) return [];

      const lines = f.text.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (isComment(lines[i]) || !REQUESTISH.test(lines[i])) continue;
        // A bulk fetch cannot miss per key, so only a URL built from a key
        // raises the question at all.
        if (!/\$\{|%s|\.format\(|\+\s*\w|encodeURIComponent|\{\}/.test(lines[i])) continue;
        const near = lines.slice(Math.max(0, i - 8), i + 6).join('\n');
        const hostHere = ANY_TRACKED_HOST.test(near)
          || f.hostVars.some((v) => new RegExp(`\\b${v}\\b`).test(lines[i]));
        if (!hostHere) continue;
        return [{
          line: i + 1,
          snippet: lines[i].trim().slice(0, 160),
          why: 'This looks up one key at a time and writes successes to a cache, but nothing '
            + 'records a key that came back with nothing. A miss therefore re-pays its full '
            + 'cost on every later request for the same key — including every step of any '
            + 'fallback ladder — for the life of the tool. The keys that never resolve are '
            + 'asked for most often, precisely because nothing remembers that the answer is no.',
          fix: 'Record misses too, on a shorter TTL than hits, and check that record before '
            + 'making any request. Only store a definite absence — a 404 — and never a '
            + 'timeout or a 429, or a transient failure will hide something that exists. '
            + 'Give yourself a way to force a recheck after a game update.',
        }];
      }
      return [];
    },
  },
  {
    id: 'no-retry-backoff',
    kind: 'repo',
    severity: 'warn',
    title: 'No handling for rate limiting or transient failure',
    run(files) {
      const callers = callersOf(files);
      if (!callers.length) return [];
      // Deliberately narrow: a `LISTEN_RETRIES = 40` for port binding is not
      // rate-limit handling, and counting it as such hides the real gap.
      const HANDLES = /\b429\b|Retry-After|retryAfter|backoff|exponential\s*(?:backoff|delay)|ratelimited|TooManyRequests|maxRetries|retryCount|\.retry\(/i;
      if (files.some((f) => HANDLES.test(f.text))) return [];
      const first = callers[0];
      return [{
        file: first.rel,
        line: first.callSite.line,
        why: 'MediaWiki answers with a `ratelimited` error and asks you to widen the gap between '
          + 'requests; the price API may restrict access outright. A client that retries '
          + 'immediately, or treats a block as a crash, makes both worse.',
        fix: 'On 429 or a `ratelimited` error, honour Retry-After and otherwise back off '
          + 'exponentially. Serve stale cached data rather than retrying in a tight loop.',
      }];
    },
  },
  {
    id: 'no-request-timeout',
    kind: 'line',
    severity: 'warn',
    title: 'Request with no timeout',
    pattern: /\bfetch\s*\(|\brequests\.(?:get|post)\s*\(|openConnection\s*\(/,
    when: (ctx) => {
      // Only calls that actually leave for a tracked service. A fetch of the
      // app's own /api/... is someone else's problem.
      if (!ctx.nearHost(5, 3)) return false;
      const w = ctx.window(8, 4);
      return !/AbortController|AbortSignal|signal|timeout|setConnectTimeout|setReadTimeout|connectTimeout|readTimeout/i.test(w);
    },
    why: 'A request with no timeout can hang for as long as the far end lets it, which in a '
      + 'RuneLite plugin means a wedged thread and in a server means a leaked socket.',
    fix: 'Set connect and read timeouts (or an AbortController) on every outbound call.',
  },

  /* ---------- RuneLite-specific practice ---------- */
  {
    id: 'own-okhttp-client',
    kind: 'line',
    severity: 'error',
    title: 'Plugin builds its own OkHttpClient',
    pattern: /new\s+OkHttpClient(?:\.Builder)?\s*\(/,
    why: 'RuneLite hands plugins a configured client through Guice: it carries a '
      + '"RuneLite/<version>" User-Agent interceptor, a 20 MB shared disk cache under '
      + '~/.runelite/cache/okhttp, and a shared connection pool. A fresh client throws all '
      + 'three away, and its requests go out with OkHttp\'s own agent.',
    fix: 'Take `@Inject private OkHttpClient httpClient;` and use `newBuilder()` on it if you '
      + 'need per-call changes.',
  },
  {
    id: 'reimplements-item-prices',
    kind: 'repo',
    severity: 'warn',
    title: 'Plugin fetches prices itself instead of using ItemManager',
    run(files) {
      const java = files.filter((f) => f.ext === '.java');
      if (!java.length) return [];
      const fetcher = java.find((f) => f.callSite
        && (HOST.prices.test(f.text) || HOST.runelite.test(f.text)));
      if (!fetcher) return [];
      if (java.some((f) => /\bItemManager\b/.test(f.text))) return [];
      return [{
        file: fetcher.rel,
        line: fetcher.callSite.line,
        why: 'RuneLite already holds every item price in memory and refreshes them every 30 '
          + 'minutes through ItemManager, so a plugin fetching them again duplicates traffic '
          + 'the client has already spent. ItemManager also normalises noted, worn and bundled '
          + 'ids to the thing that actually has a price.',
        fix: 'Inject ItemManager and call getItemPrice(id), or getItemPriceWithSource(id, '
          + 'useWikiPrice) when you need to pin the source. Only fetch yourself for data '
          + 'RuneLite genuinely does not expose.',
      }];
    },
  },
  {
    id: 'network-on-game-thread',
    kind: 'line',
    severity: 'error',
    title: 'Network call on the game or client thread',
    pattern: /\b(?:execute|newCall|openConnection|fetch|get|post)\s*\(/,
    when: (ctx) => {
      const w = ctx.window(26, 0); // look back only
      const inHandler = /@Subscribe[\s\S]{0,400}(?:onGameTick|onClientTick|onMenuOptionClicked|onBeforeRender|onChatMessage|onItemContainerChanged)|clientThread\.invoke/.test(w);
      return inHandler && /newCall|openConnection|HttpGet|\.execute\(/.test(ctx.line);
    },
    why: 'The client thread draws the game. A blocking request there stutters or freezes the '
      + 'client for as long as the far end takes, and tick handlers run up to 50 times a minute.',
    fix: 'Hand the work to the injected ScheduledExecutorService, or use OkHttp\'s enqueue(), '
      + 'and push the result back with clientThread.invokeLater() only to touch client state.',
  },
  {
    id: 'getresource-not-stream',
    kind: 'line',
    severity: 'error',
    title: 'getResource used instead of getResourceAsStream',
    pattern: /\.getResource\s*\(/,
    when: (ctx) => ctx.file.ext === '.java' || ctx.file.ext === '.kt',
    why: 'Plugin Hub distributes plugins as a JAR and states you may not assume it is unpacked '
      + 'on disk, so a URL or File built from getResource fails in the shipped build while '
      + 'working in your IDE.',
    fix: 'Use getResourceAsStream, and ImageUtil.loadImageResource for images.',
  },
  {
    id: 'unbounded-cache',
    kind: 'file',
    severity: 'info',
    title: 'Cache with no bound',
    run(f) {
      // A TTL checked on read is not eviction: the entry still sits there, so
      // the map grows by one per distinct key ever seen. That is the shape this
      // looks for — a cache that expires logically but never shrinks.
      const BOUNDED = /maximumSize|expireAfter|Caffeine|\.delete\(|\.remove\(|\.clear\(|\.evict|evict\(|LRU|lru|removeEldest|maxSize/;
      if (BOUNDED.test(f.text)) return [];
      /*
       * Three things have to hold before this is worth saying, and each one
       * removes a whole class of false positive:
       *
       *   - the name says cache. A `seen` set is almost always a dedup inside
       *     one function, and flagging those is pure noise.
       *   - the constructor is empty. `new Set(await readdir(...))` is a
       *     snapshot of something else, not a cache that accumulates.
       *   - it outlives a call. Module scope in JS (column 0) or a class field
       *     in Java. A local is bounded by its own return.
       */
      const decl = /^(?:(?:const|let|var)\s+|\s*(?:private|protected|public|static|final)[\w\s<>,.[\]]*?\b)(\w*[Cc]ache\w*)\s*=\s*new\s+(?:HashMap|ConcurrentHashMap|HashSet|LinkedHashMap|Map|Set|WeakMap)\s*(?:<[^>]*>)?\s*\(\s*\)/;
      const lines = f.text.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (isComment(lines[i])) continue;
        const m = decl.exec(lines[i]);
        if (!m) continue;
        return [{
          line: i + 1,
          snippet: lines[i].trim().slice(0, 160),
          note: `${m[1]} is never evicted from`,
          why: `\`${m[1]}\` is used as a cache but nothing ever removes from it, so it grows by `
            + 'one entry per distinct key for the life of the process. A time check on read '
            + 'bounds staleness, not size. Keyed by item id that is harmless; keyed by player '
            + 'name, or anything a caller controls, it is a slow leak.',
          fix: 'Cap it and expire it: CacheBuilder with maximumSize and expireAfterAccess in '
            + 'Java — RuneLite\'s own caches use 128 entries and an hour — or delete on read '
            + 'when the entry is stale and sweep periodically in JavaScript.',
        }];
      }
      return [];
    },
  },

  /* ---------- monetization, licensing, data handling ---------- */
  {
    id: 'paywalled-feature',
    kind: 'line',
    severity: 'error',
    title: 'Feature gated behind payment or a licence check',
    pattern: /\b(?:isPremium|hasPremium|isPro\b|isSubscribed|hasSubscription|subscriptionTier|licen[cs]eKey|activationKey|unlockCode|entitlement|isPaidUser|premiumOnly|paywall)\b|\b(?:patreon|gumroad|ko-?fi|boosty|stripe\.com|checkout\.stripe|paddle\.com|lemonsqueezy)\b/i,
    why: 'Two problems stack here. The Plugin Hub will not merge a plugin it cannot verify '
      + 'against the rules, and a paid tier that unlocks behaviour at runtime is exactly that. '
      + 'Separately, wiki content is licensed CC BY-NC-SA 3.0 — a non-commercial licence — so '
      + 'selling access to a tool whose value is wiki data conflicts with the terms the data '
      + 'came under, whoever hosts it.',
    fix: 'Ship one tier with every feature on. Fund it with an unconditional donation link in '
      + 'the README if you want, not with a gate in the code. If you need a commercial '
      + 'licence for the data, ask the wiki rather than assuming.',
  },
  {
    id: 'remote-feature-gate',
    kind: 'line',
    severity: 'error',
    title: 'Behaviour decided by a remote author-controlled endpoint',
    pattern: /\b(?:featureFlags?|killSwitch|remoteConfig|entitlements?|checkLicen[cs]e|validateKey|verifySubscription)\b/i,
    when: (ctx) => /fetch|http|newCall|request|axios|get\(/i.test(ctx.window(5)),
    why: 'A plugin whose behaviour a server can change after review cannot be reviewed — the '
      + 'Hub says plugins it cannot verify against the rules will not be merged. It is also '
      + 'the mechanism a paywall needs, so it reads as one.',
    fix: 'Decide behaviour in the shipped code. If a value must be configurable, put it in '
      + 'plugin config the user can see.',
  },
  {
    id: 'player-data-exfiltration',
    kind: 'line',
    severity: 'error',
    title: 'Player data posted to a third-party host',
    pattern: /\b(?:getLocalPlayer\(\)\.getName|getAccountHash|getUsername|getRsn|accountHash|getWorldLocation|getInventory|getBank)\b/,
    when: (ctx) => {
      const w = ctx.window(16);
      return /\b(?:post|put|send|upload|newCall|fetch|axios)\b/i.test(w)
        && /https?:\/\//.test(w)
        && !HOST.runelite.test(w);
    },
    why: 'Sending identity or account contents to a host you control is the thing Hub review '
      + 'looks hardest at, and undisclosed collection is what gets a plugin pulled rather than '
      + 'asked to change.',
    fix: 'Collect nothing you do not need. Say plainly in the README what leaves the client, '
      + 'where it goes and why, make it opt-in, and never key it to an identifier the player '
      + 'did not choose to share.',
  },
  {
    id: 'hardcoded-credential',
    kind: 'line',
    severity: 'error',
    title: 'Credential committed to source',
    pattern: /\b(?:api_?key|secret|token|password|bearer|authorization)\s*[:=]\s*[`'"][A-Za-z0-9_\-./+]{16,}[`'"]/i,
    why: 'A key in a public repo is a published key — and Plugin Hub requires the repository be '
      + 'public, so there is no version of this that stays private.',
    fix: 'Read it from the environment or user config at runtime, rotate what was committed, '
      + 'and purge it from history.',
  },
  {
    id: 'missing-attribution',
    kind: 'repo',
    severity: 'warn',
    title: 'Wiki-derived data with no attribution',
    run(files) {
      const usesWiki = files.some((f) => /runescape\.wiki/i.test(f.text));
      if (!usesWiki) return [];
      const credits = files.some((f) =>
        /CC[\s-]?BY[\s-]?NC[\s-]?SA|creativecommons\.org|oldschool\.runescape\.wiki.*(?:licen|attribut|credit)|attribut/i.test(f.text)
        && /\.md$|LICENSE|NOTICE/i.test(f.rel));
      if (credits) return [];
      return [{
        file: files.find((f) => /readme/i.test(f.rel))?.rel ?? '.',
        line: 1,
        why: 'Wiki content is licensed CC BY-NC-SA 3.0, which requires attribution and carries '
          + 'a non-commercial condition. Using the data without saying where it came from '
          + 'leaves both unmet.',
        fix: 'Credit the OSRS Wiki in the README and in any UI that shows its data, link the '
          + 'CC BY-NC-SA 3.0 licence, and keep the per-value source links you already have '
          + 'in the source.',
      }];
    },
  },
  {
    id: 'missing-license-file',
    kind: 'repo',
    severity: 'warn',
    title: 'No LICENSE file',
    run(files) {
      if (files.some((f) => /^LICENSE(\.|$)|^COPYING/i.test(path.basename(f.rel)))) return [];
      if (!files.some((f) => f.ext === '.java')) return [];
      return [{
        file: '.',
        line: 1,
        why: 'The Plugin Hub setup steps have you add a BSD 2-Clause LICENSE, and an unlicensed '
          + 'public repo is all-rights-reserved by default — which is not what a submission wants.',
        fix: 'Add a BSD 2-Clause "Simplified" LICENSE file.',
      }];
    },
  },
  {
    id: 'new-dependency',
    kind: 'repo',
    severity: 'info',
    title: 'Third-party dependencies in a Plugin Hub submission',
    run(files) {
      const gradle = files.find((f) => /build\.gradle(\.kts)?$/.test(f.rel));
      if (!gradle) return [];
      const deps = (gradle.text.match(/^\s*(?:implementation|api|compileOnly|runtimeOnly)\s+['"]([^'"]+)/gm) || [])
        .map((l) => l.replace(/.*['"]/, ''))
        .filter((d) => !/^net\.runelite|^org\.projectlombok|^com\.google\.inject|^javax\.inject|^org\.slf4j|^junit|^org\.mockito|^com\.google\.guava/.test(d));
      if (!deps.length) return [];
      return [{
        file: gradle.rel,
        line: 1,
        why: 'Plugin Hub verifies dependency hashes through Gradle dependency verification and a '
          + 'maintainer checks each new one by hand, so every addition lengthens review. Their '
          + 'guidance is to avoid new dependencies unless absolutely necessary.',
        fix: `Drop what the JDK or RuneLite already covers. Currently non-standard: ${deps.slice(0, 6).join(', ')}`,
      }];
    },
  },
];

/* ------------------------------------------------------------------ *
 * Walk + run
 * ------------------------------------------------------------------ */

function collect(root) {
  const out = [];
  const walk = (dir) => {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name) && !e.name.startsWith('.claude')) walk(full);
        continue;
      }
      const ext = path.extname(e.name).toLowerCase();
      const isCode = CODE_EXT.has(ext);
      const isMeta = META_FILES.has(e.name) || /^LICENSE|^COPYING|^NOTICE|readme\.md$/i.test(e.name);
      if (!isCode && !isMeta) continue;
      let text;
      try {
        if (statSync(full).size > 2_000_000) continue;
        text = readFileSync(full, 'utf8');
      } catch { continue; }
      const hostVars = isCode ? hostVarsOf(text) : [];
      out.push({
        rel: path.relative(root, full).split(path.sep).join('/'),
        abs: full,
        ext,
        text,
        code: isCode,
        disabled: DISABLE_FILE.test(text),
        tracked: ANY_TRACKED_HOST.test(text),
        hostVars,
        // Where this file actually talks to a tracked service, as opposed to
        // merely citing one in a doc comment — which is what a calculator
        // sourcing its numbers from a wiki page does, and is not a request.
        callSite: isCode ? firstCallSite(text, hostVars) : null,
      });
    }
  };
  walk(root);
  return out;
}

function run(root) {
  const all = collect(root);
  const files = all.filter((f) => !f.disabled);
  const repo = {
    touchesTrackedHost: files.some((f) => f.tracked),
    touchesWiki: files.some((f) => HOST.wikiApi.test(f.text) || HOST.wikiPage.test(f.text)),
    touchesPrices: files.some((f) => HOST.prices.test(f.text)),
  };
  const findings = [];
  const push = (rule, f) => findings.push({
    id: rule.id,
    title: rule.title,
    severity: f.severity ?? rule.severity,
    file: f.file ?? '.',
    line: f.line ?? 1,
    why: f.why ?? rule.why,
    fix: f.fix ?? rule.fix,
    note: f.note,
    snippet: f.snippet,
  });

  for (const rule of RULES) {
    if (rule.kind === 'repo') {
      for (const f of rule.run(files, repo)) {
        // A repo finding still lands on a line in a file, so it is silenceable
        // there like any other. Findings anchored at '.' have no line to mark
        // and can only be resolved, not suppressed.
        const target = files.find((x) => x.rel === f.file);
        if (target && f.line && ignoredHere(target.text.split('\n'), f.line - 1, rule.id)) continue;
        push(rule, f);
      }
      continue;
    }
    for (const file of files) {
      if (rule.kind === 'file') {
        if (!file.code) continue;
        const lines = file.text.split('\n');
        for (const f of rule.run(file, repo)) {
          // A file rule reports a line in a file we have, so the same ignore
          // markers have to work here. Missing this made the documented
          // escape hatch silently a no-op for every non-line rule.
          if (f.line && ignoredHere(lines, f.line - 1, rule.id)) continue;
          push(rule, { ...f, file: f.file ?? file.rel });
        }
        continue;
      }
      if (!file.code) continue;
      const lines = file.text.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (isComment(line)) continue;
        rule.pattern.lastIndex = 0;
        const match = rule.pattern.exec(line);
        if (!match) continue;
        if (ignoredHere(lines, i, rule.id)) continue;
        const window = (back, fwd = 3) =>
          lines.slice(Math.max(0, i - back), i + 1 + fwd).join('\n');
        const ctx = {
          line, match, file, repo, lines, index: i, window,
          inLoop: inLoop(lines, i),
          /** Does this call site itself reach a tracked service? */
          nearHost(back = 8, fwd = 8) {
            const w = window(back, fwd);
            if (ANY_TRACKED_HOST.test(w)) return true;
            for (const v of file.hostVars) {
              if (new RegExp(`\\b${v}\\b`).test(w)) return true;
            }
            // setInterval(refreshPrices, ...) — follow the callback by name.
            const cb = /(?:setInterval|setTimeout|scheduleAtFixedRate|scheduleWithFixedDelay)\s*\(\s*(?:this\.)?(\w+)\s*,/.exec(line);
            return cb ? namedCallbackTouchesHost(file, cb[1]) : false;
          },
        };
        if (rule.when && !rule.when(ctx)) continue;
        push(rule, {
          file: file.rel,
          line: i + 1,
          snippet: line.trim().slice(0, 160),
          note: typeof rule.note === 'function' ? rule.note(ctx) : rule.note,
        });
      }
    }
  }

  // Deduplicate: one finding per rule per file per line.
  const seen = new Set();
  const unique = findings.filter((f) => {
    const k = `${f.id}:${f.file}:${f.line}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  const rank = { error: 0, warn: 1, info: 2 };
  unique.sort((a, b) =>
    rank[a.severity] - rank[b.severity]
    || a.file.localeCompare(b.file)
    || a.line - b.line);

  return { files, findings: unique, repo, skipped: all.length - files.length };
}

/* ------------------------------------------------------------------ *
 * Reporting
 * ------------------------------------------------------------------ */

const COLOR = process.stdout.isTTY && !process.env.NO_COLOR;
const c = (code, s) => (COLOR ? `\u001b[${code}m${s}\u001b[0m` : s);
const LABEL = {
  error: () => c('1;31', 'error'),
  warn: () => c('1;33', ' warn'),
  info: () => c('1;36', ' info'),
};

function wrap(text, width, indent) {
  const words = String(text).split(/\s+/);
  const out = [];
  let line = '';
  for (const w of words) {
    if (line && line.length + w.length + 1 > width) { out.push(line); line = w; }
    else line = line ? `${line} ${w}` : w;
  }
  if (line) out.push(line);
  return out.map((l, i) => (i === 0 ? l : indent + l)).join('\n');
}

function report(result, { min, quiet }) {
  const rank = { error: 0, warn: 1, info: 2 };
  const shown = result.findings.filter((f) => rank[f.severity] <= rank[min]);
  const counts = { error: 0, warn: 0, info: 0 };
  for (const f of result.findings) counts[f.severity]++;

  const pad = '        ';
  if (!shown.length) {
    console.log(c('1;32', '\n  No findings at or above ') + c('1;32', min) + c('1;32', '.'));
  } else {
    console.log('');
    for (const f of shown) {
      const loc = c('4', `${f.file}:${f.line}`);
      console.log(`  ${LABEL[f.severity]()}  ${c('1', f.title)}  ${c('2', `[${f.id}]`)}`);
      console.log(`${pad}${loc}${f.note ? c('2', `  — ${f.note}`) : ''}`);
      if (f.snippet) console.log(`${pad}${c('2', f.snippet)}`);
      if (!quiet) {
        console.log(`${pad}${c('2', 'why ')} ${wrap(f.why, 88, pad + '     ')}`);
        console.log(`${pad}${c('2', 'fix ')} ${wrap(f.fix, 88, pad + '     ')}`);
      }
      console.log('');
    }
  }

  const bits = [
    `${result.files.length} files scanned`,
    ...(result.skipped ? [`${result.skipped} skipped`] : []),
    `${counts.error} error`,
    `${counts.warn} warn`,
    `${counts.info} info`,
  ];
  console.log(c('2', `  ${bits.join('  ·  ')}\n`));
  return counts;
}

function github(result) {
  for (const f of result.findings) {
    const lvl = f.severity === 'error' ? 'error' : f.severity === 'warn' ? 'warning' : 'notice';
    const msg = `${f.title} [${f.id}] — ${f.why} Fix: ${f.fix}`.replace(/\r?\n/g, ' ');
    console.log(`::${lvl} file=${f.file},line=${f.line},title=osrs-lint::${msg}`);
  }
}

/* ------------------------------------------------------------------ *
 * CLI
 * ------------------------------------------------------------------ */

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const valueOf = (f, d) => {
  const i = argv.indexOf(f);
  return i === -1 ? d : argv[i + 1];
};

if (has('--help') || has('-h')) {
  console.log(`osrs-lint — static review for OSRS plugins, apps and extensions

  node osrs-lint.mjs [path]        scan a directory (default: .)
    --json                         machine-readable findings
    --github                       GitHub Actions annotations
    --min error|warn|info          lowest severity to print (default warn)
    --gate error|warn|info|none    severity that fails the run (default error)
    --quiet                        omit the why/fix prose
    --rules                        list every rule and exit
`);
  process.exit(0);
}

if (has('--rules')) {
  for (const r of RULES) {
    console.log(`${r.severity.padEnd(5)}  ${r.id.padEnd(28)}  ${r.title}`);
  }
  process.exit(0);
}

const target = path.resolve(argv.find((a) => !a.startsWith('--')
  && argv[argv.indexOf(a) - 1] !== '--min'
  && argv[argv.indexOf(a) - 1] !== '--gate') ?? '.');

if (!existsSync(target)) {
  console.error(`osrs-lint: no such path: ${target}`);
  process.exit(2);
}

const result = run(target);

if (has('--json')) {
  console.log(JSON.stringify({ target, ...result, files: result.files.map((f) => f.rel) }, null, 2));
} else if (has('--github')) {
  github(result);
} else {
  report(result, { min: valueOf('--min', 'warn'), quiet: has('--quiet') });
}

const gate = valueOf('--gate', 'error');
if (gate !== 'none') {
  const rank = { error: 0, warn: 1, info: 2 };
  const tripped = result.findings.some((f) => rank[f.severity] <= rank[gate]);
  process.exit(tripped ? 1 : 0);
}
process.exit(0);
