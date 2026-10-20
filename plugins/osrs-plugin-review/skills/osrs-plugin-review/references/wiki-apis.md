# The wiki APIs, and what each one costs

Everything here is from the wiki's own documentation. Where a figure is the
wiki's wording rather than a measured number, it is quoted.

Sources:
- <https://oldschool.runescape.wiki/w/RuneScape:Real-time_Prices>
- <https://oldschool.runescape.wiki/w/Forum:API_and_terms_of_use>
- <https://www.mediawiki.org/wiki/API:Etiquette>

## Real-time prices

Base: `https://prices.runescape.wiki/api/v2/osrs`. **v1 is still served but
documented as removable** — new code should be on v2.

Deadman is the exception: `/api/v2/dmm/*` returns 404, and `/api/v1/dmm/latest`
still answers but is undocumented on the current Real-time Prices page and its
data was months stale when last checked (October 2026). A DMM tool has no v2 to
move to; say so rather than flagging its v1 use.

| Endpoint | Returns | How often it is worth fetching |
| --- | --- | --- |
| `/latest` | Latest high/low per item, with unix timestamps | Minutes. Omit `id` for everything. |
| `/mapping` | Name, id, examine, members, alch values, GE buy limit, icon | Once per game update. Effectively static. |
| `/5m` | 5-minute average high/low plus trade counts | Every 5 minutes at most. |
| `/1h` | Hourly average high/low plus trade counts | Hourly at most. |
| `/timeseries` | One item's history; needs `id` and `lookback` | Per user action only. Never in a loop. |

`lookback` accepts `6h`, `24h`, `7d`, `30d`, `6m`, `1y`. The response carries a
`timestep`, and the wiki warns it is **NOT guaranteed** and may change without
notice — read it from the response rather than hardcoding 300.

### The rule that matters most

> don't hit us with 3700 API requests

Omitting `id` and taking the whole map costs the wiki **roughly 100x less** than
fetching items one at a time. There is no case where looping over ids is the
right call; if you need many items, you need the bulk response.

### Parsing gotchas

- Prices can exceed the signed 32-bit integer limit. Parse into a 64-bit type.
- v2 averages can carry up to two decimal places.
- Items never traded are omitted entirely; a side is `null` when no instant-buy
  or instant-sell has ever been seen. Absent is not zero.
- Before 30 September 2026 the data came only from RuneLite. Newer data comes
  from Jagex and covers all clients, so older series are not comparable.

### User-Agent

A descriptive User-Agent is the **one hard requirement** the wiki states. It
should say what the tool does, and optionally carry contact info — an email or a
Discord handle.

These default agents are blocked pre-emptively, and the wiki says it may add
more:

```
python-requests      Python-urllib      Apache-HttpClient
RestSharp            Java/{version}     curl/{version}
```

The libraries are fine. The default header is not. Note that a bare
`HttpURLConnection` sends `Java/{version}`, so it is blocked before your code
runs — which looks exactly like an outage and gets debugged for hours.

### Rate limits

No endpoint is explicitly rate-limited, and the wiki says it does "our best to
cache the responses at multiple levels". It reserves the right to restrict
access when usage threatens stability, and describes the threshold for GE prices
as likely being:

> multiple large queries per second for a sustained period

If you are blocked, the wiki asks you to contact them on Discord for
alternatives. Anyone running a real-time pipeline is asked to join
`#api-discussion` to get notice of changes and maintenance.

## The MediaWiki API (`api.php`)

This is the expensive one, and the one most tools reach for by mistake.

- **Serial, not parallel.** MediaWiki asks for requests "in series rather than
  in parallel". A fan-out is what turns a polite client into a burst.
- **Batch.** Up to 50 titles or ids per request, pipe-separated:
  `titles=PageA|PageB|PageC`. Use a generator so one request feeds the next
  rather than issuing a second round of lookups.
- **`maxlag`.** For anything non-interactive, set `maxlag` so the API refuses
  your request instead of adding to the load when servers are already behind.
  Treat the `maxlag` error as back-off-and-retry, not as a failure. Higher
  values are more aggressive; lower are nicer.
- **`Accept-Encoding: gzip`.** Asked for explicitly, to cut bandwidth.
- **`oldid`, not `revid`.** `revid` is documented as an expensive operation.
- **Rate limiting** comes back as a `ratelimited` error. You may retry, but you
  should widen the gap — exponential backoff.
- **User-Agent format:** `clientname/version (contact information) framework/version`.
  Do not copy a browser's User-Agent. Browser JavaScript cannot set the header,
  so use `Api-User-Agent` instead.

### Expensive, and what to use instead

| Instead of | Use |
| --- | --- |
| `action=parse` | `action=raw` on the underlying data module, or transcribe the numbers into source with a citation |
| `action=ask` (Semantic MediaWiki) | A bulk dump, or a committed snapshot |
| `action=cargoquery`, `Special:CargoExport` | Export once at build time; commit the result |
| `action=query&list=search` | Your own index over a dump |
| `prop=revisions&rvprop=content` | `action=raw` |
| Fetching `/w/Article` HTML | `prop=extracts` if you need prose; otherwise the prices API |

Bulk sources worth knowing: Weird Gloop publishes dumps at
`chisel.weirdgloop.org`, and the RuneScape Wiki's Grand Exchange Market Watch
documents bulk price modules fetched with `action=raw` — with the caveat that
the bulk module is only worth it if you genuinely want every item.

## Images

`oldschool.runescape.wiki/images/<Filename>.png` serves an image file. For
anything that is an item this is the wrong source, on three counts — and the
third is the one that actually costs the wiki money.

**A filename is a poor key.** The wiki files stackable items only at a stack
size: there is no `Guam_seed.png`, only `Guam_seed_5.png`. So a tool keyed on
names ends up trying `Name`, then `Name_5`, then `Name_1` before giving up,
which means **a name that resolves to nothing costs three requests, not one**.

**The files are article illustrations, not icons.** They are sized for an
article. Two examples measured from a real planner: `One_Small_Favour.png` is
124KB and `Chaos_altar.png` is 75KB, both drawn at 20px. The id-keyed sources
serve the same subjects at 200–600B.

**Without negative caching it repeats forever.** Only hits get written to a
cache by default, so every unresolvable name re-pays its full cost — all three
requests — on every page load, for the life of the tool. The names that never
resolve are the ones asked for most often, precisely because nothing records
that the answer is no.

**Use instead:** `static.runelite.net/cache/item/icon/<id>.png`, with Jagex's
`obj_sprite.gif?id=` as a fallback. Both are keyed by id, both are cheap, and
both 404 cleanly. See `runelite.md`.

**Legitimately wiki-only:** pictures of things that are not items and so have
no item id — spells, quests, scenery, interfaces. A real planner's list came to
eight names out of 541, among them four Reanimation spells, `Magic Imbue` and
`Chaos altar`. Keep such a list short, explicit, and **checked** — an entry the
wiki 404s is a wasted request every time the cache is cleared — and cache every
hit permanently. Eight requests, once, is a fair use of a service doing you a
favour; a filename ladder on every page load is not.

## Licensing

Wiki content is licensed **CC BY-NC-SA 3.0** (the licence linked in every
article footer). A wiki staff member summarised the position in a 2018 reply on
[Forum:API and terms of use](https://oldschool.runescape.wiki/w/Forum:API_and_terms_of_use)
— a forum answer, not a policy page:

> Our main license for content is a non-commercial one.

Two consequences for a tool built on wiki data: attribution is required, and
commercial use is not granted by the licence. That is the licensing half of the
monetization question — see `plugin-hub.md`.

There are no API-specific terms of use. The site's general Terms of Use apply,
plus the copyright policy, and for anything without a documented hard limit the
wiki asks that you "try to be reasonable in how many requests you're making".

## Hiscores

`https://secure.runescape.com/m=hiscore_oldschool/index_lite.json?player=<rsn>`
is Jagex's, not the wiki's, and is per-player by nature — there is no bulk form.
That makes it the easiest thing in the ecosystem to abuse: a leaderboard
refreshing a hundred players on a timer is a hundred requests per tick. Cache
per player, refresh on user action rather than on a clock, and back off hard on
failure. The JSON endpoint is self-describing; the `.ws` CSV form is the older
fallback and is positional.
