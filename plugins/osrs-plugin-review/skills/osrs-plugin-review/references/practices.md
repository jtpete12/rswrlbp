<!-- Generated from PRACTICES.md by scripts/sync-practices.mjs. Do not edit here. -->

# Practices for OSRS third-party tools

Opinionated working rules for plugins, apps and extensions that read OSRS data.
Each one came out of building something and getting it wrong first, and each
says which case produced it.

**This document wants to be corrected.** It is one developer's conclusions, not
a standard, and the people who run these services know things I don't. Every
practice is numbered so you can argue with a specific one — "P7 is wrong
because…" is the most useful thing you could send back. See
[Correcting this](#correcting-this).

Two labels appear throughout:

- **Documented** — the services say this themselves, and the source is linked.
- **Inferred** — my conclusion from building against them. Could be wrong.

---

## Reading someone else's service

### P1 — Send a User-Agent that names your tool and how to reach you
**Documented.** It is the one hard requirement the OSRS Wiki states. It is also
how they tell your traffic apart from abuse when they decide what to throttle,
so it protects you as much as them.

```
User-Agent: my-tool/1.2 (GE price overlay; @me on Discord)
```

Several defaults are blocked *pre-emptively*: `python-requests`,
`Python-urllib`, `Apache-HttpClient`, `RestSharp`, `Java/{version}`,
`curl/{version}`. A bare `HttpURLConnection` sends the Java one, so the request
is refused before your code runs — which looks exactly like an outage.
Browser JavaScript cannot set the header; use `Api-User-Agent`.

*Source: [Real-time Prices](https://oldschool.runescape.wiki/w/RuneScape:Real-time_Prices).*

### P2 — Never loop a per-item endpoint that has a bulk form
**Documented.** Omitting `id` on `/latest` costs the wiki roughly 100× less
than fetching items one at a time. Their own wording is "don't hit us with 3700
API requests". Take the whole map, hold it, and look up locally.

*Source: [Prices — latest price](https://oldschool.runescape.wiki/w/RuneScape:Real-time_Prices#Latest_price_%28all_items%29).*

### P3 — Match your poll interval to how fast the data actually changes
**Inferred, from documented granularity.** `/5m` and `/1h` are pre-aggregated,
so polling either faster than its own period returns the same block again.
RuneLite's `ItemManager` refreshes prices every 30 minutes, which is a
reasonable floor to copy. A sub-minute timer against a price endpoint is the
most common abusive pattern in OSRS tooling, and it scales with install count
while costing the author nothing — which is why nobody notices locally.

### P4 — Prefer events to timers
**Inferred.** Refresh on login, on a container change, on the user opening the
panel. A timer keeps costing while nobody is looking. If you must use one, stop
it when the panel closes.

### P5 — Treat a rate limit as a signal, not an error
**Documented.** MediaWiki answers with a `ratelimited` error and asks you to
widen the gap. Honour `Retry-After` when it is there, back off exponentially
when it is not, and **serve stale data rather than retrying hard**. RuneLite's
own `ItemManager` keeps the previous price map when a refresh throws, which is
the behaviour worth copying.

**Addendum — if you serve stale data, say how stale.** Serving the last good
value is right, but silently is not: a price that is quietly four hours old
looks exactly like a price that is current, and someone will trade on it. Put
the last successful sync time in the tooltip of anything showing a price, and
once a value is older than a threshold the feature chooses, mark it visibly —
a colour change, an icon, something that survives not reading the tooltip.
Pick the threshold from what the number is *for*: a flip margin goes stale in
minutes, a "can I afford this skilling plan" total is fine for an hour. The
point is that staleness is the user's information, not the plugin's secret.

*Sources: [Etiquette — rate limits](https://www.mediawiki.org/wiki/API:Etiquette#Rate_limits), [Prices — acceptable use](https://oldschool.runescape.wiki/w/RuneScape:Real-time_Prices#Acceptable_use_policy).*

### P6 — Go in series, and batch
**Documented.** MediaWiki asks for requests in series rather than in parallel,
and takes up to 50 pipe-separated titles per request. A fan-out is what turns a
polite client into a burst.

*Source: [Etiquette — request limit](https://www.mediawiki.org/wiki/API:Etiquette#Request_limit).*

### P7 — Reach for the cheapest source that answers the question
**Inferred.** Roughly, in order: a snapshot committed to your repo → a bulk
dump → `action=raw` on a data module → the prices API → `action=query` →
`action=parse` / Cargo / search. If the numbers are static, transcribe them
into source with a citation and fetch nothing at runtime. A rendered article
page is the most expensive thing the wiki can hand you *and* the least stable
interface it has.

---

## Caching

### P8 — Cache, and tie the TTL to the data
**Documented that you should; mine as to how.** The wiki caches at several
levels on their side and asks you to cache on yours. Prices move in minutes;
`/5m` and `/1h` are already aggregated; `/mapping` changes when the game does
and is effectively a constant. A 30-second TTL on `/1h` is pure waste.

**Addendum — Jagex publishes its own price API; use it when it fits.** The wiki
is a volunteer service and the obvious default, which means it absorbs load it
did not have to. Jagex serves the same subject itself:

| Endpoint | Gives you |
| --- | --- |
| `secure.runescape.com/m=itemdb_oldschool/api/catalogue/detail.json?item=<id>` | One item: current price, trend, and 30/90/180-day change |
| `secure.runescape.com/m=itemdb_oldschool/api/graph/<id>.json` | One item: a daily price series |

Reach for these when you are **developing or testing** — there is no reason to
spend someone else's goodwill on your debug loop — and when you want **daily
history for one item**, which is what `graph` is actually for.

Three things to know before you do, all verified rather than assumed:

- It is **per item, with no bulk form**, so [P2](#p2--never-loop-a-per-item-endpoint-that-has-a-bulk-form)
  still binds: never loop it across a list. For breadth the wiki's bulk
  endpoints remain the right answer.
- `detail.json` returns prices as **display strings** — `"788.6k"`, `"1.2m"` —
  not numbers, and serves them under a `text/html` content type. Parse
  accordingly.
- It is **daily-grained and lags**. For anything claiming to be current, the
  wiki's `/latest`, `/5m` and `/1h` are purpose-built, and since 30 September
  2026 that data comes from Jagex anyway and covers all clients.

**There is no Jagex "recent transactions" API.** `itemdb_oldschool/top100` is
an HTML page, not an endpoint. The nearest real thing is the trade volume in
the wiki's `/5m` and `/1h`, which is the aggregated form of exactly that.

*Sources: [Prices — acceptable use](https://oldschool.runescape.wiki/w/RuneScape:Real-time_Prices#Acceptable_use_policy), [Etiquette — caching](https://www.mediawiki.org/wiki/API:Etiquette#Caching).*

### P9 — Cache misses too
**Inferred, and the one I'd most like checked.** A lookup that fails and stores
nothing re-pays its full cost on every later request for the same key. The keys
that never resolve are asked for *most* often, because nothing ever records
that the answer is no. Give negative results a shorter TTL than positive ones
and a way to force a recheck after a game update.

*Learned from: a planner whose icon cache stored hits only, and fell through
three candidate filenames before giving up — so every unresolvable item name
cost three wiki requests on every page load, indefinitely.*

### P10 — Only cache a definite absence, never a transient failure
**Inferred.** A 404 is a fact worth remembering. A timeout, a 429 or a 503 is
weather. Recording the second kind hides something that exists and is hard to
debug later, because the tool stops asking and nothing in the UI says why.

### P11 — Collapse concurrent requests for the same key
**Inferred.** Ten widgets rendering at once should produce one request, not
ten. A single in-flight promise per key is usually the whole fix.

**Addendum — rendering must never be what drives a lookup.** Deduplicating
concurrent requests treats the symptom; the cause is a render path that fetches
at all. A widget that asks for data when it draws has tied network traffic to
scrolling, resizing, tab switching and every re-render the framework decides to
do — none of which means the data changed, and all of which the user triggers
without knowing. Fetching belongs on a timer, a user action, or a game event;
rendering reads whatever the cache currently holds and draws it, including
drawing nothing. That inversion is also what makes
[P5](#p5--treat-a-rate-limit-as-a-signal-not-an-error)'s staleness marker
possible: a renderer that cannot fetch has to show what it has, which means it
has to admit how old it is.

### P12 — Bound anything you call a cache
**Inferred.** A TTL checked on read bounds *staleness*, not *size* — the entry
still sits there, so the map grows by one per distinct key forever. Keyed by
item id that is harmless; keyed by player name, or anything a caller controls,
it is a slow leak. RuneLite's own caches cap at 128 entries and expire an hour
after last access.

---

## Icons and assets

### P13 — Get item images from a client that publishes them, keyed by id
**Inferred, strongly.** `static.runelite.net/cache/item/icon/<id>.png` is a
static CDN serving the game's own sprites as PNGs with transparency. Jagex's
`obj_sprite.gif?id=` is a fallback. Both are keyed by id, so there is no
filename guessing; both 404 cleanly; both are cheap.

The wiki is the obvious place to look and the wrong one. Its files are keyed by
*name*, and it files stackable items only at a stack size — so a seed needs
`Name`, `Name_5`, `Name_1` — and they are article illustrations, not icons: two
I measured were 124KB and 75KB, drawn at 20px.

*Learned from: moving a planner's 541 icons off the wiki. Sampling the real
item set found no id that resolved but had no sprite.*

### P14 — A RuneLite install is not an asset source
**Inferred, verified on a real install.** It keeps no item images on disk —
`~/.runelite/cache` holds an OkHttp journal and xtea keys, and the client
renders sprites at runtime from the packed game cache. Reading them locally
means writing a cache reader and holding decryption keys, to arrive at exactly
what the CDN hands over. Asking the user where RuneLite lives buys nothing.

### P15 — Never guess an id
**Inferred.** A wrong-but-valid id resolves to a real sprite and draws the
wrong item **silently**. That is worse than drawing nothing, because nothing is
visible and wrong is not. Verify every mapping against a real table, and where
no table knows the name, draw a placeholder.

### P16 — Make a missing asset visible, not invisible
**Inferred.** Hiding a failed image leaves a gap that reads as a layout bug and
tells nobody anything. A marked placeholder sized to the element it replaces,
with a tooltip naming the item, costs nothing and turns a silent data error
into something a maintainer can see and fix.

### P17 — Keep an explicit, checked allowlist for genuine exceptions
**Inferred.** Some pictures exist only on the wiki because their subject is not
an item at all — spells, quests, scenery. That is a fair use of the wiki:
fetched once, cached permanently. Keep the list short, name each entry
deliberately, and **verify each one actually answers** — an entry the wiki 404s
is a wasted request every time the cache is cleared.

---

## Money and licensing

### P18 — Don't gate features behind payment
**Documented premises, inferred conclusion.** Two things stack. Wiki content is
[CC BY-NC-SA 3.0](https://creativecommons.org/licenses/by-nc-sa/3.0/) — a
non-commercial licence — and the wiki's own position is that "our main license
for content is a non-commercial one", so selling access to a tool whose value
*is* wiki data conflicts with the terms the data came under. Separately, the
Plugin Hub states it will not merge a plugin where "it is difficult for us to
ensure the plugin isn't against the rules", and a runtime licence check makes
behaviour unverifiable by construction.

An unconditional donation link in the README is fine. A gate in the code is
not. If you want a commercial licence, **ask the wiki** — they are the only
ones who can grant it, and asking is cheaper than the argument.

### P19 — Attribute what you used
**Documented.** CC BY-NC-SA requires it. Credit the wiki in the README and in
any UI showing its data, and keep per-value source links in the code where the
numbers were transcribed from a guide.

*Source: [CC BY-NC-SA 3.0](https://creativecommons.org/licenses/by-nc-sa/3.0/).*

### P20 — Disclose everything that leaves the client
**Inferred.** Undisclosed collection is what gets a plugin pulled rather than
asked to change. Collect nothing the feature does not need, say in plain words
what goes where and why, make it opt-in, and never key it to an identifier the
player did not choose to share — `getAccountHash` and RSN are both identity.

---

### P21 — If you ship a service connection, ship a way to change it
**Inferred.** Any destination your plugin sends to — your backend, a Discord
webhook, a Google Sheet, an API that wants a key — must be changeable by the
user without recompiling. In practice that means three things: the destination
as a visible configuration field, credentials as a separate secret field, and
the whole configuration exportable and importable as JSON.

This is a freedom-to-use argument more than a privacy one. A hardcoded
destination makes every user's data, and every feature built on it, hostage to
one person's hosting bill and continued interest — and plugins reliably outlive
their authors' enthusiasm. When the host goes away, a hardcoded URL means the
plugin is simply dead; a configurable one means somebody stands up a
replacement in an afternoon, posts the address, and users paste it in. The
JSON export is what makes that a five-minute fix for a community rather than a
support thread repeated two thousand times.

It also draws a line that money alone does not.
[P18](#p18--dont-gate-features-behind-payment) covers paid gates, but a
destination you cannot change is lock-in whether or not anyone is charging for
it — it is the difference between a tool and a funnel.

### P22 — Make a non-default destination obvious, never covert
**Inferred, and this one argues against something tempting.** Once destinations
are configurable, someone can point your plugin at infrastructure you never
intended, and the instinct is to build a quiet tripwire: a hidden forwarder
that mirrors traffic to Jagex whenever a non-default destination is set.

**Don't.** It fails on its own terms before the ethics even come up. Plugin Hub
requires a public repository, so anyone actually running a botnet reads the
source, deletes the forwarder and ships their own build in an afternoon — the
only people who keep it are the honest self-hosters it was never aimed at, and
the only data it reliably collects is theirs. It is also exactly the
undisclosed collection that [P20](#p20--disclose-everything-that-leaves-the-client)
says gets a plugin pulled rather than asked to change, it is unmergeable under
the Hub's "if it is difficult for us to ensure the plugin isn't against the
rules" clause, and there is no Jagex ingest endpoint for it in any case. You
would be building hidden surveillance of your own users, against a threat it
cannot catch.

The worry underneath it is real, though, and has an answer that works:

- **Show the destination in the UI**, where the data is sent, not buried in a
  config screen nobody opens.
- **Warn plainly when it is not the default** — "Sending to `example.com`, not
  the default endpoint" — so redirection cannot be quiet.
- **Make any telemetry opt-in and named**, so the honest case is the
  documented one.
- **Report abuse through Jagex's and RuneLite's existing channels.** They can
  act on an account; your plugin cannot, and trying makes you the problem.

The general test: anything your plugin does with a user's data should be
something you would be happy printing in the README — because on the Hub, with
a public repository, it effectively is.

## Shipping a plugin

### P23 — Use the client's shared infrastructure
**Documented behaviour, inferred advice.** RuneLite injects a configured
`OkHttpClient` carrying a `RuneLite/<version>` User-Agent interceptor, a shared
20MB disk cache and a connection pool. `new OkHttpClient()` discards all three.
Likewise `ItemManager` already holds every price, refreshed every 30 minutes,
and normalises noted, worn and bundled ids — fetching prices yourself
duplicates traffic the client already spent and loses that normalisation.

*Sources: [RuneLite.java](https://github.com/runelite/runelite/blob/master/runelite-client/src/main/java/net/runelite/client/RuneLite.java), [ItemManager.java](https://github.com/runelite/runelite/blob/master/runelite-client/src/main/java/net/runelite/client/game/ItemManager.java).*

### P24 — Keep the game thread clear
**Inferred.** The client thread draws the game; tick handlers run constantly.
Network work belongs on the injected `ScheduledExecutorService` or in
`enqueue()`, coming back via `clientThread.invokeLater()` only to touch client
state.

### P25 — Make review easy
**Documented.** The Hub verifies dependency hashes and a maintainer checks each
new dependency by hand, so every addition lengthens review; their guidance is
to avoid them unless necessary. Load resources with `getResourceAsStream` — the
JAR is not unpacked on disk. Add a BSD 2-Clause `LICENSE`. Anything that makes
behaviour unverifiable from the source — obfuscation, remote flags, a payload
whose contents depend on a server response — reads as a reason not to merge.

---

## Building the checks themselves

These are about the tooling, not the game, but they are the ones that most
changed how I work.

*Source: [Plugin Hub README](https://github.com/runelite/plugin-hub).*

### P26 — Tune for precision, and treat noise as a bug
**Inferred, learned painfully.** The first version of this repo's checker asked
"does the repo mention the wiki anywhere?" and returned 22 findings against a
real project, 20 of them noise — flagging abort timers as pollers and
local-API fetches as external calls. A reviewer who sees noise stops reading,
and then the real finding goes out with the rest. Evidence has to be at the
call site.

### P27 — Prove a check fails before trusting that it passes
**Inferred.** A green run means nothing until you have seen the check go red.
Every drift check in this repo was deliberately broken to confirm it caught it.
This is also how I found that `osrs-lint-ignore` was wired into line rules only
and silently did nothing for every other rule kind — a suppression that quietly
no-ops is worse than none, because you believe it.

The failure mode is always the same: a check that cannot fire looks exactly
like a codebase with no problems. Adding the two rules behind P9 and P13, I
wrote `` `\b${v}\b` `` into a JavaScript template literal, where a single
backslash-b is the backspace character rather than a word boundary. Both rules
registered, both ran, and both matched nothing. The only reason I noticed was a
fixture built to trip them that came back clean.

### P28 — Rendering is not validating
**Inferred.** Swagger UI rendered this repo's OpenAPI spec without complaint
while a real validator found twelve errors in it. "It looks right in the
browser" is a check on the renderer's tolerance, not on your artefact.

### P29 — Measure before removing a fallback
**Inferred.** When I suspected the wiki fallback for icons was dead weight, the
answer was to clear the cache and re-run rather than to reason about it: it
turned out to resolve eight names that nothing else could serve. The same
measurement would have justified deleting it, had it resolved none.

### P30 — Make prose that can go stale fail loudly
**Inferred.** The same knowledge living in code, a reference doc and a spec
will drift, and documentation nobody trusts is worse than none. Cross-check
them in tests: this repo asserts every rule id cited in the spec exists in the
checker, and that the catalogue documents every rule.

---

## Which of these the checker enforces

A practice that is only written down relies on someone remembering it. These
are the ones `osrs-lint.mjs` can actually catch, which is also an honest map of
where the rest of this document is just advice.

| Practice | Rule |
| --- | --- |
| P1 User-Agent | `no-user-agent`, `blocked-default-user-agent` |
| P2 Never loop a bulk endpoint | `per-item-price-request`, `timeseries-in-loop` |
| P3 Poll no faster than the data | `polling-faster-than-data` |
| P5 Rate limit as a signal | `no-retry-backoff` |
| P6 Series, and batch | `parallel-wiki-requests`, `mediawiki-unbatched`, `mediawiki-no-maxlag` |
| P7 Cheapest source that answers | `expensive-wiki-query`, `scrapes-wiki-html`, `revid-not-oldid` |
| P8 Cache with a fitting TTL | `no-cache-layer` |
| P9 Cache misses too | `no-negative-cache` |
| P12 Bound your caches | `unbounded-cache` |
| P13 Item images by id | `wiki-image-by-name` |
| P18 No paid gates | `paywalled-feature`, `remote-feature-gate` |
| P19 Attribute what you used | `missing-attribution` |
| P20 Disclose what leaves | `player-data-exfiltration` |
| P22 No covert destinations | `player-data-exfiltration`, `remote-feature-gate` |
| P23 Use the client's infrastructure | `own-okhttp-client`, `reimplements-item-prices` |
| P24 Keep the game thread clear | `network-on-game-thread` |
| P25 Make review easy | `getresource-not-stream`, `new-dependency`, `missing-license-file` |

Unenforced, and likely to stay that way, because a pattern matcher cannot see
them: **P4** (events over timers), **P10** (only cache definite absences),
**P11** (collapse concurrent requests), **P14**–**P17** (asset judgement),
**P21** (configurable destinations), and all of **P26**–**P30**, which are
about how you build the checks rather than what they check.

## Correcting this

If you run one of these services, or you have shipped a plugin and know better:

- Open an issue naming the practice — "P9 is wrong because…".
- Corrections from the OSRS Wiki team, the RuneLite maintainers or Jagex
  override anything here, including things marked **Documented** if I have
  read the documentation wrong.
- If a practice is right but my *reason* is wrong, that is worth saying too —
  the reasons are what the checker encodes.

Practices labelled **Inferred** are the ones most likely to be wrong, and
**P9**, **P13** and **P17** are the ones I would most like a wiki admin to look
at, since they are about how much load is fair to place on a service given
freely.
