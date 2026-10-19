---
name: rswrlbp
description: RuneScape Wiki / RuneLite Best Practices — a full pre-review of this repo against all 30 practices, before Plugin Hub submission.
argument-hint: "[path] [--write] [--strict]"
---

**RSWRLBP** — RuneScape Wiki / RuneLite Best Practices.

A full pre-review of the OSRS plugin, app or extension at `$1` (default: the
repository root) against every practice, intended to be run *before* a Plugin
Hub submission so that review is short.

This is the thorough one. `/osrs-review` is fast triage on a path; this walks
all thirty practices and produces a fixed-format report. Use the format
exactly — these reports get compared between repos and quoted back in
corrections, so a freely-worded one is much less useful.

## Step 1 — Establish what you are reviewing

```bash
cd "${1:-.}" && git rev-parse --short HEAD 2>/dev/null; ls
```

Work out which kind of project this is, because whole sections do not apply:

| Kind | Tell | Skip |
| --- | --- | --- |
| RuneLite plugin | `runelite-plugin.properties`, `net.runelite` imports | nothing |
| Web app / site | a server, HTML pages | Shipping a plugin (P23–P25) |
| Browser extension | `manifest.json` with `content_scripts` | Shipping a plugin (P23–P25) |
| Library / script | no entry point | Shipping a plugin, most of Icons |

## Step 2 — Run the checker

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/osrs-lint.mjs "${1:-.}" --min info
```

Report its findings as-is. Each already carries a `why` and a `fix`; do not
re-derive or soften them. If a finding is a false positive, say so plainly and
say why — that is a bug report on the checker, and worth more than a silent
dismissal.

## Step 3 — Audit every practice

Read `${CLAUDE_PLUGIN_ROOT}/skills/osrs-plugin-review/references/practices.md`
and work through **P1 to P25**, in order.

**P26–P30 are out of scope.** They are about how a checker is built, not about
the project being reviewed, so they are N/A for every subject and listing them
is five rows of noise in every report. Audit them only if the thing you are
reviewing is itself review tooling.

For each practice, assign exactly one:

- **PASS** — you found the thing it asks for, and can point at a file and line.
- **FAIL** — you found it violated, with a file and line.
- **N/A** — the practice cannot apply here (no prices fetched, not a plugin).
- **UNVERIFIED** — applies, but you could not establish it from the source.
  Use this honestly and often; it is far better than a guessed PASS.

A PASS needs evidence, not absence of evidence. "No paywall found" is a PASS
for P18; "caching looks fine" without having read the cache is UNVERIFIED.

The checker covers sixteen of the thirty — see the enforcement table at the
foot of the practices. For those, the checker's result decides the verdict. The
other fourteen need you to read code, and are where this command earns its
keep. Pay particular attention to:

- **P4, P11** — is fetching driven by a timer or an action, or does rendering
  trigger it? Trace back from each request to what causes it.
- **P9, P10** — are misses cached, and is a transient failure kept out of that
  record? Read the failure path, not the happy path.
- **P14–P17** — where do assets come from, and what happens when one is absent?
- **P21, P22** — if anything is sent anywhere, can the user change where, and
  can they see where?

## Step 4 — Report

Emit exactly this structure:

```markdown
# RSWRLBP pre-review — <repo name> @ <short sha>

**Verdict:** Ready | Ready with caveats | Not ready — for <the thing it is for>
**Project kind:** <from step 1>
**Checker:** <N> error · <N> warn · <N> info

## Blocking
Things that would get this rejected or pulled. Empty is a good answer.
- **P<n> <name>** — `file:line` — what happens, then the fix. Two sentences.

## Should fix
- **P<n> <name>** — `file:line` — same shape.

## Practice audit
| # | Practice | Verdict | Evidence |
| --- | --- | --- | --- |
| P1 | User-Agent | PASS | `src/http.js:14` sets a descriptive agent |
| … | … | … | … |

(All thirty rows. N/A rows carry the reason, not a blank.)

## Not checked
What this review could not establish, and why. Always non-empty — say if you
could not run the code, could not see a backend, or did not read the tests.

## Corrections
Practices you think are wrong for this project, with your reasoning. These go
back to the practices doc as issues.
```

**Verdict rules.** *Not ready* if anything is Blocking. *Ready with caveats* if
Should-fix is non-empty or more than three practices are UNVERIFIED. *Ready*
otherwise. With `--strict`, treat Should-fix as Blocking.

**Say what the verdict is about.** Only a RuneLite plugin is heading for Plugin
Hub submission; for a web app, a site or an extension, write what it is
actually ready for — "for release", "for sharing" — rather than naming a
process that does not apply to it. A verdict against the wrong bar reads as
though the review did not notice what it was reviewing.

With `--write`, also save the report to `rswrlbp-report.md` in the reviewed
directory so it can be attached to a submission or sent back with corrections.

## Tone

The author is the reader. Be specific and unhedged about what is wrong, give
the fix rather than the rule, and do not pad a clean review to look thorough —
"nothing blocking, three unverified" is a complete and useful result. The
Corrections section is not a formality: this practice set is one developer's
conclusions and is explicitly open to being wrong, so if a practice does not
fit the project, say so rather than contorting the project to fit it.
