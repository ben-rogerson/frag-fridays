---
name: friday-recap
description: Generate the post-session Slack recap - one exciting caster-style block per map, mode-aware (gungame/deathmatch/classic), each ending with the 🥇🥈🥉 podium. Use when asked for the recap, session summary, results post, commentary, the caster post, or "who won".
---

# Friday session recap

One Slack post summarising the session just played: a separate hype block
per map, written like an esports caster calling a highlights package, each
block closing with the top-three podium. The goal is competitive FOMO -
everyone reading it should want top spot next week.

## Step 1: parse the logs

Logs are HL kill logs on the box at `/opt/cs16/logs/<mod>/L*.log` (UTC
timestamps; only exist since 2026-08-03 when logging was enabled). Use
`grep -H` so each line carries its file path - the parser reads the mod
dir from it and tags every map segment with its game mode:

```bash
ssh cs16 'grep -H "" /opt/cs16/logs/*/L*.log' | \
  python3 .claude/skills/friday-recap/parse_logs.py --date <YYYY-MM-DD>
```

Defaults to a 2:25pm-3:15pm Sydney window (session + spillover). Override
with `--from HH:MM --to HH:MM` (Sydney time) if the session ran at a
different time. Always pass the session date; usually today.

Output: JSON, one entry per map segment in play order, each with a `mode`
field, players sorted by kills with K/D, `top_weapon`, `weapons_used`
(distinct weapons - gungame ladder progress), bots flagged (`"bot": true`).

Weekly log hygiene: if the logs dir grows past a few hundred files, old
ones can be deleted - the recap only ever needs the session day.

## Step 2: know the mode

Each map block must be written for the mode it was played in - the same
stat line means different things in different modes:

- **gungame** (`gg`): a race up the weapon ladder - every kill advances
  you to the next gun, finishing on the knife. Kills = level-ups, so call
  it as a race: who was climbing fastest, who stalled on a weapon, who
  closed it out. `weapons_used` is the ladder-progress proxy - someone
  with 12 distinct weapons went deep even if their K/D is ugly.
- **deathmatch** (`dm`): instant respawn, pure frag volume. Deaths are
  cheap, so raw kills and streaks are the story, not K/D. Frame it as a
  shooting gallery where the top fragger simply out-gunned the room.
- **classic** (`vanilla`): round-based, one life per round, buy economy.
  Deaths are expensive here - K/D actually means something, and a high
  ratio is worth calling out as discipline/clutch play.
- **aim** (`aim`): classic round rules on aim maps - no objectives, just
  rifle duels. Call the gunfights; `top_weapon` is the whole story.
- **zombie** (`zp`): humans vs the infection. Kills are survival stats -
  frame it as who held out, not who dominated.
- **kz** (`kz`): climb maps, no combat. A kz segment with kills is people
  mucking about - usually skip it.
- `mode` null (old un-prefixed input): write it neutral, or infer from
  the map name and weapon spread.

## Step 3: write the post

One post, in a fenced block for copy-paste. Slack markdown: `*bold*`
(single asterisks), plain dashes, no headers, no tables. Keep it scan-able
on a phone.

Structure:

- **Punchy opening line** for the session as a whole.
- **One block per map**, in play order. Each block:
  - Map name in bold with the mode, e.g. `*de_dust2* (gungame)`.
  - 2-4 lines of mode-aware commentary. Call it like a highlight package:
    who popped off, what weapon did the damage (`top_weapon`), where the
    momentum turned, how the mode shaped it. Numbers stay exact.
  - Close the block with the podium - medal emoji, kills and K/D:
    `🥇 Ben - 14 kills (2.8 K/D)` / `🥈 ...` / `🥉 ...`. Humans only.
    Fewer than three humans on the board? Award the medals you can.
- **Champion of the day**: most total kills across all maps (humans).
  Crown them properly - name in bold, a title, the works.
- **Closing challenge** for next week: the crown is up for grabs.

Skip any map segment with zero human kills - no block for a game nobody
was actually in. Recaps CAN name maps (unlike the pre-session posts) -
they were actually played.

## Bots

The bots run on the lowest difficulty (`yb_difficulty 0`, verifiable in
`server/*/addons/yapb/conf/yapb.cfg`). Treat them accordingly:

- **They never rank.** No bot names on a podium, no bot plays in the
  highlight beats. Auth field `<BOT>` / `"bot": true` in parser output.
- **One bot gag per post, maximum**, and only if it lands.
- **If a bot out-fragged the top human, that's the joke of the post.**
  Say it once, plainly ("[BOT] Fat Matt topped the real scoreboard -
  awkward"), and move on.
- **Don't call a bot 'good' or 'clutch'.** They're on zero.

## Guardrails

- Names and numbers from parser output are load-bearing - never fudge,
  never invent plays, clutches or quotes the data can't support.
- If the window has zero human kills (nobody showed / wrong window), say
  so instead of posting a bot leaderboard - check `--from/--to` first.
- Deaths include suicides and self-kills; a deathless player's K/D is
  just their kill count.
- Don't shame the bottom of the board - hype the top, lift the middle
  with dry sympathy, ignore the rest. Exception: friendly banter if
  someone finished below a bot.
- Slack markdown only inside the post - no headers, no tables, no code
  blocks (the wrapping fence is just for copy-paste).

## Tone

Same voice as /friday-posts: hype, CS 1.6 nostalgia, tasteful emoji.
Esports-caster energy played straight enough to be funny - we're grown
adults playing a 25-year-old shooter on a Friday arvo, and the post calls
it like it's the grand final anyway. Facts (numbers, names) stay exact;
the jokes go around them, never through them.
