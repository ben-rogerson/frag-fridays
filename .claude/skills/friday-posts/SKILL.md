---
name: friday-posts
description: Generate the two Friday-session Slack posts (morning announcement, final call) ready to paste into Slack - checks the live server for the running mod first. Use when asked for Slack posts, the Friday announcement, session messages, or "what do I post".
---

# Friday Slack posts

Generate both session-day Slack posts in one run, ready to copy-paste.
The slot moves week to week, so never assume it - read it:

```bash
python3 scripts/sessions.py       # -> "2026-09-04 14:30-15:00 Sydney"
```

That's `data/sessions.json`, the one place the session time lives (the
leaderboards, the recap and the site countdown all read it). If the week
you're posting for isn't listed it falls back to the default - add an entry
before writing the posts if the slot has moved. An argument still overrides
for a one-off, e.g. `/friday-posts 1pm`.

**Use the START time only.** sessions.py prints a window because the
leaderboards need one; the posts never do. No end time, no "half an hour",
no "30 min", no "quick one" - nothing that puts a length on it. Say "today
2.30pm" and stop. It's the end-of-week wind-down once work wraps, so pitch
it as finishing the week fragging, never as "sneak off and be back at your
desk".

## Step 1: check what's actually running (no SSH needed)

```bash
curl -s https://ff.benrogerson.dev/info.json
curl -s https://ff.benrogerson.dev/status.json
```

`info.json` is served by the live container, so its `mode` IS the running
mod - use its tagline as raw material, not verbatim. `status.json` gives
current map, humans/bots and proves the server is up.

Fallbacks, in order:

1. curl fails -> `pnpm run status` (docker ps over SSH; container name
   `<mod>-xash3d-1` on 27016 names the mod).
2. Box unreachable -> still generate the posts from `docs/game-guide.md`,
   but open the output with a loud warning that the mode is UNVERIFIED and
   must be confirmed before posting (the port-theft incident: never
   announce a mode without verification).

## Step 2: write the two posts

Output each post in its own fenced block for easy copy-paste, with a plain
line above saying when to post it, and a `---------------` line separating
the posts. **Plain text only inside the block** - no `*bold*`, no `_italics_`,
no backticks, no headers, no tables. Slack's paste doesn't render the markup,
it just shows the asterisks, so anything that isn't a word is litter. Plain
dashes or numbers for lists, emoji are fine, and links go in as a bare URL so
Slack unfurls them.

Chat commands still get typed literally (`/guns` becomes: say /guns in chat) -
that's the command, not formatting.

**Post 1 - morning announcement (~9am).** Sets turnout. Mode name + a
one-line pitch rewritten with banter (not the info.json tagline verbatim),
day + start time ("today 2.30pm"), the URL, and *Chrome on desktop for best
performance*. Short.

No preload post - loading is fast now, don't ask people to prep.

**Post 2 - final call (~15 min before).** Everything needed to join, so
nobody scrolls back:

1. Open https://ff.benrogerson.dev, hit PLAY, and enter your name if it's
   your first time on this URL (settings are fresh per domain) - one step,
   not two
2. The mode line for whatever is running (table below)
3. The bot line for whatever is running (same table)
4. Jump in the huddle in #gaming - callouts are half the fun

No refresh-if-stuck step: it made the join look fragile for a stall most
people never hit, and anyone staring at a dead splash screen refreshes
without being told.

End on a closer with some edge, or end on the huddle line. Don't reach for
a rhyme or a desk-vs-game contrast ("guns down at your desk, guns up in
dust") - it lands limp every time.

No controls, no key list, no team-select walkthrough: the in-game match
menu (Esc) lists every control off the player's own binds, and Tab shows
the scoreboard with the session clock. Don't teach 1.6 in a Slack post.

### Mode lines (keyed on `info.json` `mode`)

Rewrite these in your own words each run - they're the facts to hit, not
copy. One mode line and one bot line per post.

| `mode` | Mode line | Bot line |
|---|---|---|
| `GunGame` | every kill levels your weapon through 23 of them, knife kills steal a level, first to the gold knife takes the round | bots fill the server and leave as humans join - early birds aren't alone |
| `Deathmatch` | say `/guns` in chat for the gun list, then e.g. `/awp` (applies next spawn); instant respawn, top score when the map ends wins | bots fill the server and leave as humans join - early birds aren't alone |
| `Source Maps` | deathmatch rules on CS:S and CS:GO maps rebuilt for 1.6 - cache, mirage, dust2, bank; `/guns` works the same | bots fill the server and leave as humans join - early birds aren't alone |
| `Fight Yard` | fy_ maps only - tiny open yards, 1 minute rounds, `/guns` works but some maps hand out their own floor guns | bots fill the server and leave as humans join - early birds aren't alone |
| `Sniper` | AWP and knife, nothing else - no `/guns`, no buying, grenades still work; one shot decides it | bots fill the server and leave as humans join - early birds aren't alone |
| `ClassicAl` | classic rounds with the match rules off - $16000 every round so you buy whatever you want, and when you die you get to watch the round finish instead of a black screen | bots fill the server and leave as humans join - early birds aren't alone |
| `CPL Tournament` | the era's match rules - $800 start, buy at round start, no respawns, and dead means a black screen until the round ends, so don't rush the AWP alone | NO bots - it's humans or nobody, so turning up on time is the whole plan |
| `Aim Prac` | rarely posted (Ben's call) - if it's somehow live, check with him before writing the post | 16 knife bots, all on T, and they stay - humans hold CT |

`Source Maps`, `Fight Yard` and `Sniper` ship on the
`add-source-fightyard-sniper-modes` branch. If `info.json` reports one of
them, that branch is what's deployed - fine to post, just don't deploy over
it from main mid-week.

## Fact guardrails (repo data that is wrong or stale - do not propagate)

- URL is **https://ff.benrogerson.dev**. Player-facing docs still say the
  old IP URL - never put the IP URL in a post.
- Gun chat commands are **`/guns`**, `/ak`, `/awp` etc - dm's info.json
  says `!guns`, which is wrong. Sniper has no gun menu at all.
- Bots: every mod except CPL Tournament runs `yb_quota 10`,
  `yb_quota_mode fill` - ten players in the server, one bot leaving per human
  who joins. CPL Tournament ships `yb_quota 0`: it HAS YaPB, it just starts
  with none, and a restart always puts it back to zero. game-guide.md's
  "quota 9" is stale, and so is any older "7". Or just say "bots fill the
  server" (never for CPL Tournament - ClassicAl is the one with bots).
- Never name the current map in posts - maps rotate and there's voting, so
  whatever status.json shows now won't be what's on at session time.
- The bots aren't pushovers - never pitch them as free frags or easy kills.
- No session length, ever (see the schedule note above).

## Tone

Hype with banter and CS 1.6 nostalgia; tasteful emoji (it's Slack, not the
repo docs). Vary the jokes and angle every run so posts never read
templated - riff on last week's session or the mode's flavour (not the
current map - see guardrails). The instructions themselves stay unmissable
and exact: never sacrifice a fact or a step for a joke.
