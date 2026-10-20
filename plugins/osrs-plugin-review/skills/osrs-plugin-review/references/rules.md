# Rule catalogue

Every rule `osrs-lint.mjs` applies, with the source behind it. `node
osrs-lint.mjs --rules` prints the same list. Severities: **error** fails the
default gate, **warn** is reported, **info** is advisory.

Where a service says the thing itself, the Source column links to the exact
section. Rules marked **Inferred** are our own conclusions rather than anything
a service documents — they cite the practice they come from, and are the ones
most worth arguing with.

## Cost to the services being read

| Rule | Sev | Source |
| --- | --- | --- |
| `per-item-price-request` | error | [Prices — latest][latest]: omitting `id` costs ~100x less; "don't hit us with 3700 API requests" |
| `prices-api-v1` | warn | [Prices — migrating v1 to v2][v2]: v1 is documented as removable. Not raised for `/v1/dmm`, which has no v2 |
| `timeseries-in-loop` | error | [Prices — time-series][timeseries]: per-item by design |
| `timestep-assumed` | info | [Prices — time-series][timeseries]: the timestep is "NOT guaranteed" |
| `blocked-default-user-agent` | error | [Prices — User-Agent][ua]: blocks python-requests, Python-urllib, Apache-HttpClient, RestSharp, `Java/{version}`, `curl/{version}` |
| `no-user-agent` | error | [Prices — User-Agent][ua]: the one stated requirement |
| `no-cache-layer` | error | [Prices — acceptable use][aup] and [Etiquette — caching][etiq-cache] |
| `polling-faster-than-data` | error | [Prices — acceptable use][aup]: "multiple large queries per second for a sustained period". Drops to **info** when the timer's callback returns early unless the data is stale — the gate, not the tick, sets the rate |
| `expensive-wiki-query` | error | [Etiquette — request limit][reqlimit]: parser, SMW and Cargo queries do work per request |
| `mediawiki-no-maxlag` | warn | [Etiquette — the maxlag parameter][maxlag] |
| `mediawiki-unbatched` | warn | [Etiquette — request limit][reqlimit]: batch pipe-separated, up to 50 |
| `revid-not-oldid` | info | [Etiquette — parsing of revisions][revisions]: `revid` is expensive |
| `parallel-wiki-requests` | warn | [Etiquette — request limit][reqlimit]: in series, not in parallel |
| `no-gzip` | info | [Etiquette — data formats][formats]: send `Accept-Encoding: gzip` |
| `no-retry-backoff` | warn | [Etiquette — rate limits][ratelimits]: `ratelimited` means widen the gap |
| `no-request-timeout` | warn | [RuneLite.java][runelite-src]: the shared client sets no connect or read timeout |
| `scrapes-wiki-html` | warn | **Inferred** (practice P7): article HTML is the most expensive response and an unstable interface |
| `wiki-image-by-name` | warn | **Inferred** (practice P13): wiki images are keyed by name and filed only at a stack size, so a miss costs three requests |
| `no-negative-cache` | warn | **Inferred** (practice P9): an unrecorded miss re-pays its full cost forever, and the keys that never resolve are asked for most |

## RuneLite practice

| Rule | Sev | Source |
| --- | --- | --- |
| `own-okhttp-client` | error | [RuneLite.java][runelite-src]: the injected client carries the User-Agent interceptor, a 20 MB disk cache, a shared pool, and (via `RuneLiteModule`) a guard that refuses blocking calls on the client thread |
| `reimplements-item-prices` | warn | [ItemManager.java][itemmanager]: holds every price, refreshed every 30 minutes, with id normalisation |
| `getresource-not-stream` | error / warn | [Plugin Hub README][hub]: "the plugin is not unpacked on disk", so prefer the stream. **error** when the URL is turned into a `File` or `Path`, which breaks in a JAR; **warn** otherwise, since reading through the URL still works |
| `unbounded-cache` | info | [ItemManager.java][itemmanager]: RuneLite's own caches cap at 128 and expire an hour after last access |
| `network-on-game-thread` | error | [RuneLiteModule.java][runelite-src]: the injected client throws on a blocking call on the client thread; with any other client it stalls the game |

## Monetization, licensing, data

| Rule | Sev | Source |
| --- | --- | --- |
| `paywalled-feature` | error | [Plugin Hub README][hub] (unverifiable plugins are not merged) and [CC BY-NC-SA 3.0][cc] (non-commercial). Matches gates and licence-verification APIs, not payment platforms by name — a donate button that unlocks nothing is fine |
| `remote-feature-gate` | error | [Plugin Hub README][hub]: "if it is difficult for us to ensure the plugin isn't against the rules we will not merge it" |
| `hardcoded-credential` | error | [Plugin Hub README][hub]: the repository must be public |
| `missing-attribution` | warn | [CC BY-NC-SA 3.0][cc] requires attribution; see also [the wiki's terms thread][terms] |
| `missing-license-file` | warn | [Plugin Hub README][hub]: setup adds a BSD 2-Clause LICENSE |
| `new-dependency` | info | [Plugin Hub README][hub]: dependencies are hash-verified and checked by hand |
| `player-data-exfiltration` | error | **Inferred** (practice P20): undisclosed collection is what gets plugins pulled rather than asked to change |

<!--
Reference-style links, so the tables stay readable and the anchors stay in one
place. Every anchor below was checked against the rendered page rather than
derived from the heading text — `#Latest_price_(all_items)` and
`#Please_set_a_descriptive_User-Agent!` are exactly as the wiki emits them,
punctuation included.
-->

[aup]: https://oldschool.runescape.wiki/w/RuneScape:Real-time_Prices#Acceptable_use_policy
[ua]: https://oldschool.runescape.wiki/w/RuneScape:Real-time_Prices#Please_set_a_descriptive_User-Agent!
[latest]: https://oldschool.runescape.wiki/w/RuneScape:Real-time_Prices#Latest_price_(all_items)
[timeseries]: https://oldschool.runescape.wiki/w/RuneScape:Real-time_Prices#Time-series
[v2]: https://oldschool.runescape.wiki/w/RuneScape:Real-time_Prices#Migrating_from_v1_to_v2
[reqlimit]: https://www.mediawiki.org/wiki/API:Etiquette#Request_limit
[maxlag]: https://www.mediawiki.org/wiki/API:Etiquette#The_maxlag_parameter
[revisions]: https://www.mediawiki.org/wiki/API:Etiquette#Parsing_of_revisions
[formats]: https://www.mediawiki.org/wiki/API:Etiquette#Data_formats
[etiq-cache]: https://www.mediawiki.org/wiki/API:Etiquette#Caching
[ratelimits]: https://www.mediawiki.org/wiki/API:Etiquette#Rate_limits
[hub]: https://github.com/runelite/plugin-hub
[runelite-src]: https://github.com/runelite/runelite/blob/master/runelite-client/src/main/java/net/runelite/client/RuneLite.java
[itemmanager]: https://github.com/runelite/runelite/blob/master/runelite-client/src/main/java/net/runelite/client/game/ItemManager.java
[cc]: https://creativecommons.org/licenses/by-nc-sa/3.0/
[terms]: https://oldschool.runescape.wiki/w/Forum:API_and_terms_of_use

## What the checker deliberately does not do

It matches patterns, so it cannot tell whether a cache TTL suits the data,
whether a cache miss stampedes, whether the tool needs the data at all, or
whether a disclosed collection is proportionate. Those are the judgment pass in
`SKILL.md`.

It is also tuned for **precision over recall**. Rules that depend on reaching a
tracked service require evidence at the call site — a host literal, a constant
bound to one, or a callback whose body reaches one — rather than "this repo
mentions the wiki somewhere". A wiki URL handed to the browser is a link, not
a request, and does not count. That means it misses indirection through several
layers. A quiet run is not a certificate.

It skips test sources — `test/`, `tests/`, `__tests__/`, `androidTest/`, and
`*.test.*` / `*.spec.*` files — because they never ship. A test asserting the
donate link is present is not the plugin doing anything.

## Silencing a finding

```java
// osrs-lint-ignore per-item-price-request — single item, user-initiated
```

`osrs-lint-ignore` alone silences everything on the line; followed by rule ids
it silences only those. `osrs-lint-disable-file` anywhere in a file skips the
file. Prefer the narrow form with a reason, so the next reader knows whether it
still applies.

A marker is honoured on the finding's own line, or anywhere in the contiguous
comment block directly above it — so a reason can run to a few lines rather
than being crammed onto one:

```js
// osrs-lint-ignore unbounded-cache — keyed by region, of which there are two,
// so this holds a parsed table rather than an entry per item. Nothing in it
// grows with use.
const regionCache = new Map();
```

This works for every rule kind. A repo-level finding anchored at `.` rather
than at a line — `missing-license-file`, and `missing-attribution` when there
is no README — has nowhere to put a marker and has to be resolved instead.
