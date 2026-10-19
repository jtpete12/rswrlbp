---
name: osrs-review
description: Review an OSRS plugin, app or extension for API etiquette and Plugin Hub readiness.
argument-hint: "[path] [--strict]"
---

Review the OSRS plugin, app or extension at `$1` (default: the repository root)
for API etiquette and Plugin Hub readiness.

Follow the `osrs-plugin-review` skill. In short:

1. **Run the checker first**, so the deterministic findings are on the table
   before you form an opinion:

   ```bash
   node ${CLAUDE_PLUGIN_ROOT}/scripts/osrs-lint.mjs "${1:-.}" --min info
   ```

   Report what it finds as-is — each finding already carries a `why` and a
   `fix`. Do not re-derive or soften them.

2. **Then do the judgment pass** from the skill, reading the code rather than
   grepping it. The checker matches patterns; it cannot tell whether the design
   is sound. Cover, in this order:
   - whether the tool needs the data it fetches at all, or whether RuneLite's
     `ItemManager` / a `/mapping` snapshot / a committed table already answers it
   - whether the caching is real: TTL tied to the data's granularity, no
     stampede on a miss, stale served on failure, bounded keys
   - whether polling is tied to anything real, or is just a timer
   - what leaves the client, and whether it needs to
   - whether anything is gated behind payment, a licence key or a remote flag

3. **Report** grouped by what it costs the author: *would block or reject*,
   *would break*, then *worth fixing*. File and line, what happens, the fix —
   one or two sentences each.

If `--strict` was passed, treat `warn` findings as blocking and say so in the
report.

Say what you did not check. A quiet checker run is not a certificate, and the
author should know where the review's edges were.
