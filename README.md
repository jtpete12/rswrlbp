# RSWRLBP — RuneScape Wiki / RuneLite Best Practices

A pre-review for Old School RuneScape plugins, apps and extensions, meant to be
run *before* a Plugin Hub submission so that review is short. It checks the two
things that actually get third-party OSRS tools blocked or pulled:

1. **What the tool costs the services it reads.** Per-item request loops, a
   User-Agent that is blocked before the request arrives, no caching, polling
   faster than the data changes, and expensive parser queries where a bulk dump
   already exists.
2. **Whether anything is gated behind payment.** Wiki content is CC BY-NC-SA
   3.0 — a non-commercial licence — and Plugin Hub will not merge a plugin whose
   behaviour it cannot verify, which a runtime licence check prevents by
   construction.

Both are cheap to fix before submission and expensive to fix after a public
argument.

> **Reviewing someone's rules, not their code.** This is one developer's
> conclusions, written down so they can be argued with. If a rule is wrong,
> saying so is more valuable than anything the tool finds in any one plugin —
> see [Sending feedback](#sending-feedback).

## Run it on your plugin

Five minutes, nothing leaves your machine. Needs [Claude
Code](https://claude.com/claude-code) (CLI, VS Code extension or desktop app)
and Node 18+.

**1. Add this repository as a plugin marketplace:**

```
/plugin marketplace add jtpete12/rswrlbp
```

**2. Install the plugin:**

```
/plugin install osrs-plugin-review@rswrlbp
```

The marketplace is `rswrlbp`; the plugin inside it is `osrs-plugin-review`.

**3. Open your plugin's repository and run:**

```
/rswrlbp
```

Add `--write` to save the report as `rswrlbp-report.md`, or `--strict` to treat
should-fix items as blocking. `/rswrlbp some/path` reviews a subdirectory.

**What you get:** a report with a Ready / Not ready verdict, anything blocking,
anything worth fixing, and a row for each of the 25 applicable practices marked
PASS, FAIL, N/A or UNVERIFIED — plus an explicit list of what the review could
*not* establish. A PASS requires evidence, so an honest review deliberately
looks less impressive than a lazy one.

**Don't want to install anything?** The checker runs standalone, with no
dependencies and no Claude Code:

```bash
git clone https://github.com/jtpete12/rswrlbp && cd rswrlbp
node plugins/osrs-plugin-review/scripts/osrs-lint.mjs /path/to/your/plugin --min info
```

That gives you the 31 deterministic rules without the judgement pass.

## Sending feedback

The last section of every report is **Corrections** — practices the reviewer
thinks are wrong for their project. That is the part worth sending back.

Every practice in [`PRACTICES.md`](PRACTICES.md) is numbered so an issue can
name one: *"P9 is wrong because…"* is the most useful thing you could open.
Each is labelled **documented** (the services say this themselves, with a
link) or **inferred** (my conclusion from building against them, and more
likely to be wrong).

Corrections from the OSRS Wiki team, the RuneLite maintainers or Jagex
override anything here — including the **documented** ones, if I have read the
documentation wrong. The three I would most like a wiki admin to look at are
**P9**, **P13** and **P17**, since those are about how much load is fair to
place on a service provided for free.

## How it works

It ships as two halves that do different jobs:

- **`osrs-lint.mjs`** — a zero-dependency static checker, 31 rules, each
  carrying a `why` and a `fix`. Deterministic, runs in CI, exits non-zero on
  anything at or above a gate you choose.
- **A Claude Code skill and `/osrs-review` command** — the judgment pass the
  checker cannot do: whether the tool needs the data at all, whether the caching
  is coherent, whether polling is tied to anything real.

## The checker on its own

No install, no dependencies, Node >= 18:

```bash
node plugins/osrs-plugin-review/scripts/osrs-lint.mjs /path/to/plugin
```

```
  error  Plugin builds its own OkHttpClient  [own-okhttp-client]
        src/main/java/com/example/OffenderPlugin.java:14
        private final OkHttpClient http = new OkHttpClient();
        why  RuneLite hands plugins a configured client through Guice: it carries a
             "RuneLite/<version>" User-Agent interceptor, a 20 MB shared disk cache under
             ~/.runelite/cache/okhttp, and a shared connection pool. A fresh client throws
             all three away, and its requests go out with OkHttp's own agent.
        fix  Take `@Inject private OkHttpClient httpClient;` and use `newBuilder()` on it
             if you need per-call changes.
```

| Flag | Does |
| --- | --- |
| `--rules` | List every rule and exit |
| `--min error\|warn\|info` | Lowest severity to print (default `warn`) |
| `--gate error\|warn\|info\|none` | Severity that fails the run (default `error`) |
| `--json` | Machine-readable findings |
| `--github` | GitHub Actions inline annotations |
| `--quiet` | Findings without the why/fix prose |

Silence a finding with `osrs-lint-ignore <rule-id>` on the line or the line
above, or `osrs-lint-disable-file` anywhere in a file. Prefer the narrow form
with a reason.

## The two commands

| Command | For |
| --- | --- |
| `/rswrlbp [path]` | **The pre-review.** Walks the applicable practices and emits a fixed-format report with a Ready / Not ready verdict. `--write` saves `rswrlbp-report.md`; `--strict` treats should-fix as blocking. |
| `/osrs-review [path]` | Fast triage. The checker plus a judgement pass, no formal report. |

The report format is fixed on purpose: these get compared between projects and
quoted back when someone disagrees with a practice, and a freely-worded review
is much harder to argue with.

You can also just ask — the skill triggers on reviewing anything that reads the
wiki, the prices API, the hiscores or `api.runelite.net`.


## In CI

The workflow is callable, so a plugin repo can gate its own pull requests:

```yaml
jobs:
  review:
    uses: jtpete12/rswrlbp/.github/workflows/review.yml@main
    with:
      path: .
      gate: error
```

Findings land as inline annotations on the diff. The gate step fails the run on
anything at or above `gate`.

## The endpoint reference

`docs/` holds an OpenAPI 3.1 spec for every endpoint an OSRS tool is likely to
read — the prices API, the MediaWiki API, the hiscores, and the two sources of
item sprites — annotated with the thing the official docs bury: **what each
request costs the people serving it, and how long you may cache the answer.**

```bash
npm run docs    # then open http://localhost:8080
```

Each operation's cost (`cheap`, `moderate`, `expensive`, `avoid`) shows as a
badge on the collapsed row, so the expensive calls are visible before you open
anything. "Try it out" is deliberately disabled — a live request button on an
endpoint documented as expensive is an invitation to do the exact thing the
page exists to discourage.

`docs/openapi.yaml` stands on its own if you would rather read it as a file, or
point your own tooling at it. It is validated in CI:

```bash
npm run docs:lint
```

Two different checks guard it, because they catch different things. `npm test`
cross-references the spec against the checker — every operation's cost token is
one of the four documented ones, every rule id in an `x-osrs-lint-rules`
extension exists, and `references/rules.md` documents every rule the checker
has — so the prose cannot quietly stop matching the code. `npm run docs:lint`
runs a real OpenAPI validator over the structure, which is a genuinely separate
concern: Swagger UI rendered this spec happily while it still had twelve
validation errors, so "it looks right in the browser" proves very little.

## Practices

[`PRACTICES.md`](PRACTICES.md) is the opinionated layer: 30 numbered working
rules for OSRS tools, each saying which real case produced it and whether it is
**documented** by the services themselves or **inferred** from building against
them.

It is deliberately separate from the reference docs below, which state what the
services say. Practices are arguable, and the document is written to be argued
with — each one is numbered so a correction can name it, and it says outright
which three it would most like a wiki admin to check.

## What it knows, and where that came from

Every rule cites a source. The rule catalogue is in
[`references/rules.md`](plugins/osrs-plugin-review/skills/osrs-plugin-review/references/rules.md),
and the detail sits in three reference docs next to it:

- [`wiki-apis.md`](plugins/osrs-plugin-review/skills/osrs-plugin-review/references/wiki-apis.md)
  — the prices API and MediaWiki etiquette: endpoints and how often each is
  worth fetching, the pre-emptively blocked User-Agent list, what counts as
  expensive, and the cheap alternative for each expensive thing.
- [`runelite.md`](plugins/osrs-plugin-review/skills/osrs-plugin-review/references/runelite.md)
  — what RuneLite already gives a plugin, so a review can say "use this" rather
  than "fetch less": the injected `OkHttpClient` and what it carries,
  `ItemManager`'s 30-minute price refresh and id normalisation, thread rules.
- [`plugin-hub.md`](plugins/osrs-plugin-review/skills/osrs-plugin-review/references/plugin-hub.md)
  — submission mechanics, licensing, and the monetization question.

Primary sources:
[Real-time Prices](https://oldschool.runescape.wiki/w/RuneScape:Real-time_Prices),
[API and terms of use](https://oldschool.runescape.wiki/w/Forum:API_and_terms_of_use),
[MediaWiki API:Etiquette](https://www.mediawiki.org/wiki/API:Etiquette),
[runelite/plugin-hub](https://github.com/runelite/plugin-hub),
and the RuneLite client source.

## Tests

```bash
npm test
```

Three fixtures, and the second matters most. `tests/fixtures/offender` is a
deliberately bad plugin that must trip all 18 rules it is built to trip, at the
lines it is built to trip them. `tests/fixtures/polite` is the same job done
properly and must come back **completely clean at every severity** — because a
reviewer who sees noise stops reading, and then the real finding goes out with
the rest. `tests/fixtures/ignored` silences a line rule and a file rule with
markers and must also come back clean; it exists because the markers were once
honoured by line rules only and did nothing at all for the rest, which is the
kind of bug that makes a checker quietly useless.

The rules are tuned for precision over recall. Anything that depends on reaching
a tracked service needs evidence at the call site — a host literal, a constant
bound to one, or a callback whose body reaches one — not "this repo mentions the
wiki somewhere". So it misses indirection through several layers. **A quiet run
is not a certificate**; it means the patterns did not match, which is why the
judgment pass exists.

## Scope

This reviews how a tool treats the services it reads and whether it is shippable
to the Plugin Hub. It is not a security scanner, not a Jagex-rules compliance
check (the Rejected Features list is the authority there, and it moves), and not
a substitute for Hub review — it is the pass that makes Hub review short.

## Licence

BSD 2-Clause. Data and documentation quoted from the OSRS Wiki is used under
[CC BY-NC-SA 3.0](https://creativecommons.org/licenses/by-nc-sa/3.0/), with
thanks to the wiki and its contributors — who publish all of this for free and
then get to deal with the traffic.
