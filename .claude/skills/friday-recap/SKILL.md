---
name: friday-recap
description: Generate the post-session Slack recap - top 3 players per map with kills and K/D, parsed from the server's kill logs. Use when asked for the recap, session summary, results post, or "who won".
---

# Friday session recap

One Slack post summarising the session just played: top 3 per map, kills,
K/D, and a champion-of-the-day callout. The goal is competitive FOMO -
everyone reading it should want top spot next week.

## Step 1: parse the logs

Logs are HL kill logs on the box at `/opt/cs16/logs/<mod>/L*.log` (UTC
timestamps; only exist since 2026-08-03 when logging was enabled). The
parser handles timezone conversion and map segmentation:

```bash
ssh cs16 'cat /opt/cs16/logs/*/L*.log' | \
  python3 .claude/skills/friday-recap/parse_logs.py --date <YYYY-MM-DD>
```

Defaults to a 2:25pm-3:15pm Sydney window (session + spillover). Override
with `--from HH:MM --to HH:MM` (Sydney time) if the session ran at a
different time. Date defaults to nothing - always pass the session date;
usually today.

Output: JSON, one entry per map segment, players sorted by kills, bots
flagged (`"bot": true`). Weekly log hygiene: if the logs dir grows past a
few hundred files, old ones can be deleted - the recap only ever needs the
session day.

## Step 2: write the post

One post, in a fenced block for copy-paste. Slack markdown: `*bold*`
(single asterisks), plain dashes, no headers, no tables.

Structure:

- Punchy opening line about the session.
- Per map played: map name + medal-emoji top 3 with kills and K/D, e.g.
  `🥇 Ben - 14 kills (2.8 K/D)`. Humans only in the top 3 - bots are
  filtered out of rankings. If a bot out-fragged the human winner, that's
  a banter line ("[BOT] Fat Matt topped the real scoreboard - awkward"),
  not a podium spot.
- Champion of the day: most total kills across all maps (humans). Crown
  them properly - name in bold, a title, the works.
- Closing challenge for next week: the crown is up for grabs, come take it.

Use `top_weapon` for colour ("did most of his damage with the AWP").
Recaps CAN name maps (unlike the pre-session posts) - they were actually
played.

## Guardrails

- Bots never rank. Auth field `<BOT>` / `"bot": true` in parser output.
- If the window has zero human kills (nobody showed / wrong window), say
  so instead of posting a bot leaderboard - check `--from/--to` first.
- Deaths include suicides and self-kills; K/D of a deathless player is
  just their kill count.
- Don't shame the bottom of the board - hype the top, ignore the rest.
  Exception: friendly banter if someone finished below a bot.
- The bots aren't pushovers, so beating them is genuinely braggable -
  frame it that way.

## Tone

Same voice as /friday-posts: hype, CS 1.6 nostalgia, tasteful emoji.
Sports-desk energy - call the podium like a highlights reel. Facts
(numbers, names) stay exact; the jokes go around them, never through them.
