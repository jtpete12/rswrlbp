---
name: osrs-plugin-review
description: Review Old School RuneScape plugin, app or extension code before it goes to the RuneLite Plugin Hub or ships to users. Use when reviewing or writing anything that reads the OSRS Wiki, the real-time prices API, the hiscores, or api.runelite.net — or when a RuneScape tool gates features behind payment, polls an API, caches game data, or sends player data anywhere. Triggers on "review my plugin", "plugin hub ready", "am I hammering the wiki", "OSRS API etiquette", "RuneLite plugin review".
---

# Reviewing an OSRS plugin, app or extension

Third-party OSRS tools get blocked or pulled for two reasons, and almost never
for the reasons their authors were worrying about:

1. **They are expensive to the services they read.** The OSRS Wiki publishes
   price data for free and barely rate-limits it, which means the only thing
   standing between a popular tool and a restricted IP is whether its author
   read the docs. The classic failure is a loop over item ids, a default
   User-Agent that is blocked before the request arrives, and no cache.
2. **They charge for something built on data given away on non-commercial
   terms.** Wiki content is CC BY-NC-SA 3.0. A premium tier whose value is wiki
   data is in tension with the licence the data came under, and a runtime
   licence check is also something Plugin Hub review cannot verify.

Both are cheap to fix before submission and expensive to fix after a public
argument. This review exists to catch them while they are still cheap.

## How to run the review

**Step 1 — run the checker.** It is deterministic, so do this before forming
any opinion:

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/osrs-lint.mjs <path> --min info
```

`--rules` lists every rule. `--json` is for tooling, `--github` emits Actions
annotations, and `--gate error|warn|info|none` sets what fails the run. Findings
can be silenced with `osrs-lint-ignore <rule-id>` on the line or the line above,
or `osrs-lint-disable-file` anywhere in a file.

Report its findings as-is. Do not re-derive them, and do not soften them —
each one already carries a `why` and a `fix`.

**Step 2 — do the judgment pass.** The checker matches patterns. It cannot tell
whether the design is sound. Work through the sections below, reading the code
rather than grepping it, and only raise what you can point at a line for.

**Step 3 — report.** Lead with anything that would get the tool blocked or
rejected. Then correctness, then everything else. Say plainly what you did not
check.

## The judgment pass

### Does it need this data at all?

The cheapest request is the one not made. For each outbound call, ask what it
is for and whether a cheaper source answers the same question:

- **Item prices** — RuneLite already holds every price in memory and refreshes
  them every 30 minutes through `ItemManager`. A plugin fetching prices itself
  is spending traffic the client has already spent, and losing the id
  normalisation (noted, worn and bundled items) that `ItemManager` does.
- **Static game data** — item names, ids, examine text, buy limits, alch values
  all come from `/mapping` in one request and change only when the game does.
  Fetch it once per release and commit the snapshot, or cache it for days. A
  tool refetching `/mapping` hourly is refetching a constant.
- **Anything derived from article text** — if the numbers come from a wiki page,
  the honest answer is usually to transcribe them into source with a citation,
  not to parse the page at runtime. Article HTML is both the most expensive
  thing the wiki can serve and the least stable interface it has.

### Is the caching real?

The checker only asks whether anything cache-shaped exists. Read it and ask:

- Is the TTL tied to the data's own granularity? `/latest` moves in minutes,
  `/5m` and `/1h` are already aggregated, `/mapping` is effectively static.
  A 30-second TTL on `/1h` does nothing but add load.
- **Does a miss cost the same as a hit, every time?** This is the one most
  often missed. A lookup that fails and caches nothing re-pays the full cost on
  every later request for the same key — and if the code falls back through
  several candidates before giving up, it re-pays all of them. Items that will
  never resolve are exactly the ones asked for most often, because nothing ever
  records that the answer is "no". Negative results need caching too, on a
  shorter TTL than positive ones.
- Does a cache miss stampede? Ten widgets rendering at once should produce one
  request, not ten. Look for a single in-flight promise or a lock.
- Does a failed refresh serve stale data or throw? Serving stale is almost
  always right; RuneLite's own `ItemManager` keeps the previous map on failure.
- Is the cache bounded? An unbounded map keyed by item id is fine; one keyed by
  player name is a leak.

### Is the polling tied to anything real?

A timer is the easiest way to turn a polite tool into an abusive one, because
the cost scales with install count and nobody notices locally. Prefer events to
timers: refresh on login, on a container change, on the user opening the panel.
If a timer is genuinely needed, it should be no faster than the data changes,
and it should stop when nothing is watching.

### Does anything leave the client that should not?

List everything the tool sends outward and where it goes. Then ask, for each:
does the feature work without it? Identity (`getAccountHash`, RSN), location
and inventory contents are the sensitive ones. Collection should be opt-in,
disclosed in the README in plain words, and never keyed to an identifier the
player did not choose to share.

### Is anything gated?

Look for a premium tier, a licence key, a remote feature flag, a "pro" build,
or a donation that unlocks behaviour. Any of these is a problem:

- Plugin Hub states that a plugin it cannot verify against the rules will not be
  merged. Behaviour a server can change after review is unverifiable by
  construction.
- Wiki data is CC BY-NC-SA 3.0 — non-commercial. If the tool's value is wiki
  data, selling access to it conflicts with the terms the data came under,
  whoever hosts the tool.

An unconditional donation link in the README is fine. A gate in the code is not.
If a commercial licence is genuinely needed, the answer is to ask the wiki, not
to assume.

### RuneLite-specific correctness

- **Use the injected `OkHttpClient`.** RuneLite's carries a
  `RuneLite/<version>` User-Agent interceptor, a shared 20 MB disk cache under
  `~/.runelite/cache/okhttp`, and a shared connection pool. `new OkHttpClient()`
  throws all three away.
- **Never block the client thread.** It draws the game. Network calls belong on
  the injected `ScheduledExecutorService` or in `enqueue()`; come back with
  `clientThread.invokeLater()` only to touch client state.
- **`getResourceAsStream`, not `getResource`.** Plugins ship as a JAR and the
  Hub states you may not assume it is unpacked, so a `File` from `getResource`
  works in your IDE and fails in the shipped build.
- **Keep dependencies out.** The Hub verifies dependency hashes and a
  maintainer checks each new one by hand, so every addition lengthens review.

## Reporting

Group by what it costs the author:

1. **Would block or reject** — abusive request patterns, blocked User-Agent,
   payment gates, undisclosed data collection.
2. **Would break** — client-thread blocking, `getResource`, unhandled rate
   limiting, missing timeouts.
3. **Worth fixing** — cache design, polling cadence, attribution, dependencies.

For each: the file and line, what happens, and the fix. One or two sentences.
If the tool looks fine, say so — and say what you looked at, so the author knows
what the review did and did not cover.

## References

Load these only when you need the detail:

- `references/wiki-apis.md` — the prices API and MediaWiki etiquette: endpoints,
  the blocked User-Agent list, what counts as expensive, and the cheap
  alternative for each expensive thing.
- `references/runelite.md` — what RuneLite already gives a plugin, so the review
  can say "use this" rather than "fetch less".
- `references/plugin-hub.md` — Hub submission rules, licensing, and the
  monetization question.
- `references/rules.md` — the checker's rule catalogue, with the source behind
  each rule.
- `references/practices.md` — the thirty numbered practices, each labelled
  documented or inferred and naming the case that produced it, with a table of
  which ones the checker enforces. Load this for a full pre-review; the
  `/rswrlbp` command walks all thirty.
