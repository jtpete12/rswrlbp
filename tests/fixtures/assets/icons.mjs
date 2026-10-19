/**
 * Fixture: an icon fetcher that does almost everything right and still has the
 * two problems this pair of rules exists to catch.
 *
 * It sets a descriptive User-Agent, sets a deadline, honours a 429, and writes
 * what it gets to disk. What it does wrong is fetch wiki images keyed by item
 * *name* when an id-keyed source exists, and remember only its successes — so
 * a name that resolves to nothing re-pays all three requests of the fallback
 * ladder on every single call, forever.
 *
 * Everything else is deliberately correct, so the two findings under test are
 * not buried in unrelated ones.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const BASE = 'https://oldschool.runescape.wiki/images';
const DIR = 'cache/icons';
const USER_AGENT = 'fixture-icons/1.0 (osrs-lint test fixture; @nobody on Discord)';

/** The wiki files stackables only at a stack size, hence the ladder. */
const SUFFIXES = ['', '_5', '_1'];

async function download(file) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(`${BASE}/${encodeURIComponent(file)}.png`, {
      signal: controller.signal,
      headers: { 'User-Agent': USER_AGENT },
    });
    if (res.status === 429) {
      const after = Number(res.headers.get('retry-after'));
      if (Number.isFinite(after)) await new Promise((r) => setTimeout(r, after * 1000));
      return null;
    }
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  } finally {
    clearTimeout(timer);
  }
}

export async function getIcon(name) {
  const path = join(DIR, `${name}.png`);
  try {
    return await readFile(path);
  } catch {
    /* not cached yet */
  }

  for (const suffix of SUFFIXES) {
    const buf = await download(`${name}${suffix}`);
    if (!buf) continue;
    await writeFile(path, buf);
    return buf;
  }

  // Nothing is written here, which is the whole point of the fixture.
  return null;
}
