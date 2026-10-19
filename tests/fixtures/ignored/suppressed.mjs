/**
 * Fixture: a tool that behaves itself, except for two findings it silences on
 * purpose. It must come back completely clean.
 *
 * The point is the markers, so everything else here is deliberately correct —
 * a descriptive User-Agent, a cache with a TTL, and backoff on 429 — otherwise
 * the repo-level rules fire and drown out what is being tested.
 *
 * It covers both rule kinds, because the markers were once wired into line
 * rules only and did nothing at all for `file` and `repo` rules.
 */

const USER_AGENT = 'fixture-tool/1.0 (osrs-lint test fixture; @nobody on Discord)';

// A line rule, silenced by a marker on the line above.
// osrs-lint-ignore prices-api-v1
const LEGACY = 'https://prices.runescape.wiki/api/v1/osrs/latest';

// A line rule, silenced by a marker at the end of the line itself.
const ALSO_LEGACY = 'https://prices.runescape.wiki/api/v1/osrs/mapping'; // osrs-lint-ignore

// A file rule, with the marker heading several lines of justification — the
// shape a real reason takes, and the one that used to slip through because
// only the immediately preceding line was checked.
//
// osrs-lint-ignore unbounded-cache — keyed by region, of which there are two,
// so this holds a parsed table rather than an entry per item. Nothing in it
// grows with use.
const regionCache = new Map();

const CACHE_TTL_MS = 5 * 60 * 1000;
let lastFetch = 0;
let cached = null;

export async function latestPrices() {
  if (cached && Date.now() - lastFetch < CACHE_TTL_MS) return cached;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(LEGACY, {
      signal: controller.signal,
      headers: { 'User-Agent': USER_AGENT, 'Accept-Encoding': 'gzip' },
    });
    if (res.status === 429) {
      // Honour the wait rather than retrying straight away; serve what we have.
      const after = Number(res.headers.get('retry-after'));
      if (Number.isFinite(after)) await new Promise((r) => setTimeout(r, after * 1000));
      return cached;
    }
    cached = await res.json();
    lastFetch = Date.now();
    return cached;
  } finally {
    clearTimeout(timer);
  }
}

export { ALSO_LEGACY, regionCache };
