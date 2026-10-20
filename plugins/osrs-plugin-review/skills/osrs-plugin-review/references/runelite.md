# What RuneLite already gives a plugin

Most "am I hammering the wiki" problems in a RuneLite plugin are really "I
rebuilt something the client already does". Read from the RuneLite source at
`runelite-client/src/main/java/net/runelite/client/`.

## The HTTP client

RuneLite builds one `OkHttpClient` at startup and passes it into the Guice
module. What a plugin gets with `@Inject` is a `newBuilder()` copy of it
(`RuneLiteModule.provideHttpClient`), so it shares everything below plus one
extra guard. It carries four things a fresh
client does not:

**A User-Agent interceptor.**

```java
public static String USER_AGENT = "RuneLite/" + RuneLiteProperties.getVersion()
    + "-" + RuneLiteProperties.getCommit() + (RuneLiteProperties.isDirty() ? "+" : "");
```

Applied per request: no User-Agent gets RuneLite's; a foreign one gets
RuneLite's prepended with a space; one already starting with `RuneLite` is left
alone. So you can add your own and still be identifiable as RuneLite traffic.

**A shared disk cache**, 20 MB under `~/.runelite/cache/okhttp`. A network
interceptor marks failed GETs (status >= 400) `Cache-Control: no-store` so
errors are not cached.

**A shared connection pool**, plus `pingInterval(30, SECONDS)`.

**A client-thread guard.** The injected copy adds an interceptor that throws
`IOException("Blocking network calls are not allowed on the client thread")`
for a synchronous call on the client thread, and the same on the Swing EDT.
So a blocking `execute()` there does not stutter the game — it fails, every
time, and the feature silently never works.

Note what it does *not* set: RuneLite configures no timeouts, so OkHttp's
defaults apply — 10 seconds each for connect, read and write, and no overall
call timeout. If your call needs a different deadline, set it with
`httpClient.newBuilder()`.

```java
@Inject
private OkHttpClient httpClient;   // yes

private final OkHttpClient http = new OkHttpClient();   // no
```

## Item prices — `ItemManager`

`ItemManager` already holds every price and keeps them fresh:

```java
scheduledExecutorService.scheduleWithFixedDelay(this::refreshPrices, 0, 30, TimeUnit.MINUTES);
```

- Prices live in an `ImmutableMap<Integer, ItemPrice>`, replaced wholesale on
  each successful load. There is no per-entry expiry.
- A refresh only fetches on first run or when the game state is `LOGGING_IN` or
  later, and logging in triggers a reload if the last attempt was over 30
  minutes ago.
- On `IOException` it logs and **keeps the previous map** — a failed refresh
  serves stale data rather than throwing. Worth copying.

Methods to call:

| Method | Use |
| --- | --- |
| `getItemPrice(int id)` | The usual one. Honours the user's `useWikiItemPrices()` setting. |
| `getItemPriceWithSource(int id, boolean useWikiPrice)` | When you need to pin the source. |
| `getWikiPrice(ItemPrice)` | Applies the price-manipulation checks to a price you already hold. |

The two that take an id normalise it first: notes map to the unnoted form, worn
items to the inventory form, and untradeable variants (ornamented, degraded,
kit-combined) are priced as their tradeable components. `getWikiPrice` takes a
price you already hold and does no normalisation. A plugin that fetches prices
itself loses all of that and will misprice noted stacks.

Its other caches are worth copying as a shape:

```java
itemImages = CacheBuilder.newBuilder()
    .maximumSize(128L)
    .expireAfterAccess(1, TimeUnit.HOURS)
```

`itemStats` is loaded once in the constructor and never reloaded.
`getItemComposition` adds no cache of its own — it is a straight call to
`client.getItemDefinition(id)`.

## Item icons

RuneLite publishes the game's own item sprites as PNGs with transparency,
keyed by item id:

```
https://static.runelite.net/cache/item/icon/<id>.png
```

**This is the right default for item icons**, and it is the one most tools get
wrong, because the wiki is the more obvious place to look. It is a static CDN
built to be fetched, the key is exact so there is no filename guessing, and a
missing id answers 404 cleanly and fast. Jagex's
`secure.runescape.com/m=itemdb_oldschool/obj_sprite.gif?id=<id>` serves the same
item as a GIF and makes a reasonable fallback.

Coverage is effectively total. Sampling a real planner's item set found **no id
that resolved but had no sprite** — every miss was a name that was not an item.

### A RuneLite install is not a source

Worth stating plainly, because it is the first idea everyone has and it does not
work. A RuneLite install keeps **no item images on disk**:

- `~/.runelite/cache/` holds an OkHttp binary journal and the xtea keys.
- `~/.runelite/jagexcache/oldschool` is empty on a current install; the Jagex
  launcher manages the real game cache elsewhere.
- The client renders item sprites at runtime out of the packed game cache,
  through `ItemManager` and `ImageUtil`.

Reading them locally would mean implementing a cache reader and holding the
decryption keys, to arrive at exactly the pixels the URL above hands over.
Asking the user where RuneLite is installed buys nothing.

### Resolving a name to an id

Both good sources are keyed by **id**, so a tool that stores item *names* needs
a table. Two traps:

- **The prices API's `/mapping` covers GE-tradeable items only** — roughly
  4,600. Skill capes are bought from a skill master rather than traded, so
  `Construction cape` and `Ranged cape` are simply absent, as is anything else
  untradeable. A name-to-id index built from `/mapping` alone will have holes
  exactly where a skilling tool needs them.
- **Names are not unique across ids.** A noted item wears the same name as the
  thing it notes, and the note is almost always the higher id, so taking the
  **lowest id wins** for the usual case. It is a heuristic, not a rule: coins,
  clue scrolls and caskets each span dozens of ids.

When neither source knows a name, draw a placeholder. **Guessing an id is the
one thing not to do** — a wrong but valid id resolves to a real sprite and
draws the wrong item silently, which is worse than drawing nothing.

## Threads

- The **client thread** draws the game. With the injected `OkHttpClient`, a
  blocking `execute()` there throws (see the client-thread guard above), so
  the feature fails rather than lagging. With any other HTTP client it stalls
  the game for as long as the far end takes.
- Tick handlers (`onGameTick`, `onClientTick`) run constantly. Nothing that can
  block belongs in one.
- Use the injected `ScheduledExecutorService` for work, or OkHttp's `enqueue()`.
- Come back to client state with `clientThread.invokeLater()`, and keep that
  callback trivial.

## Resources

Plugins ship as a JAR and the Hub states "you can not assume" it is unpacked on
disk, so `getResource` hands back a `jar:` URL rather than a `file:` one. The
Hub asks you to prefer `getResourceAsStream`:

```java
getClass().getResourceAsStream("/icon.png")                    // yes
ImageUtil.loadImageResource(getClass(), "/icon.png")           // yes, for images
new ImageIcon(getClass().getResource("/icon.png"))             // works, but prefer the above
new File(getClass().getResource("/data.json").toURI())         // works in your IDE, breaks when shipped
```

## Approved clients

Jagex restricts third-party clients to an Approved Client List — RuneLite and
HDOS. Using anything else is a terms breach, with a two-week ban for a first
offence and permanent bans for repeats. Relevant to a reviewer only in that a
plugin must not help a player onto an unapproved client.
