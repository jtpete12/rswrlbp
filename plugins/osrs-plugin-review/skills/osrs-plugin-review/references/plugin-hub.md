# Plugin Hub submission, licensing, and the monetization question

Source: <https://github.com/runelite/plugin-hub> (README), plus the Jagex
third-party client rules it links to.

## What review actually checks

The Hub reviews for malice and for compliance with Jagex's rules and the
Rejected/Rolled-Back Features list. The load-bearing sentence is:

> If it is difficult for us to ensure the plugin isn't against the rules we will
> not merge it

That is the sentence that decides most borderline cases. It is not "we found a
violation" — it is "we could not tell", which is the author's problem to fix.
Anything that makes behaviour unverifiable from the source counts: obfuscation,
a remote feature flag, a licence check, a payload whose contents depend on a
server response.

## Mechanics

- **The repository must be public.** There is no private submission, so there is
  no version of a committed secret that stays private.
- **Submission** is a PR to `plugin-hub` adding a manifest with `repository=`
  and a 40-character `commit=`. CI runs a build check plus "RuneLite Plugin Hub
  Checks".
- **Dependencies** are verified by cryptographic hash through Gradle dependency
  verification, and a maintainer verifies each new one **by hand**. The README's
  guidance is to avoid new dependencies "unless absolutely necessary" — each one
  lengthens review.
- **Resources** must be loaded with `getResourceAsStream`, not `getResource`:
  "The plugin is not unpacked on disk, and you can not assume that it is."
- **`icon.png`** is optional and must be no larger than 48x72 px.
- **Licence**: add a BSD 2-Clause "Simplified" `LICENSE` file.
- **Build type**: `standard` replaces your `build.gradle` and `settings.gradle`
  at submission; use `gradle` mode only if you genuinely need custom deps or
  build steps.
- Plugins are distributed "as is", with no guarantees from the maintainers.
- The README asks you to **contribute to an existing plugin** where its authors
  accept contributions, rather than fragmenting the ecosystem with a near-
  duplicate.

## Monetization

The Hub README does not publish a monetization clause. The case against a paid
tier does not depend on one, and rests on two things that are documented:

**1. A gate makes the plugin unverifiable.** A premium tier needs something at
runtime that decides whether a feature is on — a licence check, an entitlement
fetch, a remote flag. That is behaviour a server can change after review, which
runs straight into "if it is difficult for us to ensure the plugin isn't against
the rules we will not merge it".

**2. The data is non-commercially licensed.** Wiki content is CC BY-NC-SA 3.0,
and the wiki's own position is that "our main license for content is a
non-commercial one". A tool whose value *is* wiki data, sold or gated, is in
tension with the terms the data came under — and that holds whoever hosts it, so
moving the paywall to a website does not resolve it.

### What is fine

- An unconditional donation link in the README. Nothing unlocks.
- Being paid to develop it, by anyone, as long as the shipped plugin is whole.
- Hosting your own backend, if what it does is visible from the source and it is
  not the thing deciding whether features work.

### What is not

- A premium or pro tier.
- A licence key, activation code or entitlement check.
- A remote feature flag or kill switch.
- Ads, or data collection funding the tool.

### If you want a commercial licence

Ask the wiki. They answer on Discord, and they are the only ones who can grant
an exception to a licence they hold. Assuming is how this becomes a public
argument instead of an email.

## Data collection

Undisclosed collection is what gets a plugin pulled rather than asked to change.
The bar to clear before submitting:

- Collect nothing the feature does not need.
- Say in the README, in plain words, what leaves the client, where it goes, and
  why.
- Make it opt-in.
- Do not key it to an identifier the player did not choose to share —
  `getAccountHash` and RSN are both identity.
