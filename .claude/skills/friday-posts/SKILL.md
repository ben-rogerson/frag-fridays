---
name: friday-posts
description: Generate the three Friday-session Slack posts (morning announcement, preload nudge, final call) ready to paste into Slack - checks the live server for the running mod first. Use when asked for Slack posts, the Friday announcement, session messages, or "what do I post".
---

# Friday Slack posts

Generate all three session-day Slack posts in one run, ready to copy-paste.
Session default: **Friday 2:30pm Sydney time** (a 30-minute lunch-break
session). An argument overrides the time, e.g. `/friday-posts 1pm`.

## Step 1: check what's actually running (no SSH needed)

```bash
curl -s https://cs.benrogerson.dev/info.json
curl -s https://cs.benrogerson.dev/status.json
```

`info.json` is served by the live container, so its `mode` IS the running
mod (GunGame / Deathmatch / Classic) - use its tagline as raw material, not
verbatim. `status.json` gives current map, humans/bots and proves the
server is up.

Fallbacks, in order:

1. curl fails -> `pnpm run status` (docker ps over SSH; container name
   `<mod>-xash3d-1` on 27016 names the mod).
2. Box unreachable -> still generate the posts from `docs/game-guide.md`,
   but open the output with a loud warning that the mode is UNVERIFIED and
   must be confirmed before posting (the port-theft incident: never
   announce a mode without verification).

## Step 2: write the three posts

Output each post in its own fenced block for easy copy-paste, with a plain
line above saying when to post it. Slack markdown inside: `*bold*` (single
asterisks), plain dashes for bullets, no headers, no tables. Link as a bare
URL so Slack unfurls/links it.

**Post 1 - morning announcement (~9am).** Sets turnout. Mode name + a
one-line pitch rewritten with banter (not the info.json tagline verbatim),
day + time ("today 2:30pm"), the URL, and *laptop only - mobile browsers
don't work*. Short.

**Post 2 - preload nudge (~1 hour before).** The load-bearing one: the
browser build has no lazy loading, the whole ~300MB game loads into browser
RAM on first visit. Ask people to open https://cs.benrogerson.dev NOW, let
it finish loading, then close the tab - so 2:30 is playing time, not
download time. One fun line of why, then the ask.

**Post 3 - final call (~15 min before).** Full join steps so nobody scrolls
back. Must include, in join order:

1. Open https://cs.benrogerson.dev and hit PLAY
2. *Mic prompt appears - click Allow or Deny, either works. Ignoring it =
   stuck on "Starting engine..." forever*
3. Stuck at the splash screen anyway? Just refresh - fixes every known stall
4. First time on this URL: enter your name again (fresh settings per domain)
5. F1 = Terrorists, F2 = Counter-Terrorists (the numbered team menu also
   works)
6. Mode-specific line - dm: say `/guns` in chat for the gun list, then e.g.
   `/awp` (applies next spawn); gg: every kill levels your weapon, knife
   kills steal a level, first to gold knife wins
7. Bots fill the server and leave as humans join - early birds aren't alone

## Fact guardrails (repo data that is wrong or stale - do not propagate)

- URL is **https://cs.benrogerson.dev**. Player-facing docs still say the
  old IP URL - never put the IP URL in a post.
- Gun chat commands are **`/guns`**, `/ak`, `/awp` etc - dm's info.json
  says `!guns`, which is wrong.
- Bot count: trust the live `status.json` / `yb_quota` (7 as of 2026-08-03);
  game-guide.md's "quota 9" is stale. Or just say "bots fill the server".
- The team menu DOES render in-browser (runbook says otherwise - stale);
  F1/F2 are the easy path, not the only path.

## Tone

Hype with banter and CS 1.6 nostalgia; tasteful emoji (it's Slack, not the
repo docs). Vary the jokes and angle every run so posts never read
templated - riff on the current map, last week's session, the mode's
flavour. The instructions themselves stay unmissable and exact: never
sacrifice a fact or a step for a joke.
