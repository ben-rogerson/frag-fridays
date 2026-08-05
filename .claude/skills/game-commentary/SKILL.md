---
name: game-commentary
description: Generate a Slack post with per-game esports-commentator-style summaries for a Friday session - one hype block per map, bots downplayed, self-deprecating Aussie tone. Use when asked for a game summary, commentary, play-by-play, "the caster post", or per-map hype (as opposed to /friday-recap, which is one session-wide leaderboard).
---

# Per-game commentary post

One Slack post per session, but structured as a **separate block per map**
- a play-by-play write-up from an imaginary caster who has committed the
crime of taking Friday afternoon CS 1.6 in 2026 way too seriously. That's
the joke: pro-tour voice, amateur-hour subject, and no one's pretending
otherwise.

This is a different deliverable from `/friday-recap`. Recap = one
leaderboard for the whole session. Commentary = one hype block per game.
Both can be posted; they're not redundant.

## Step 1: parse the logs

Same source and parser as `/friday-recap` - the output is already
segmented per map, which is exactly one game each:

```bash
ssh cs16 'cat /opt/cs16/logs/*/L*.log' | \
  python3 .claude/skills/friday-recap/parse_logs.py --date <YYYY-MM-DD>
```

Defaults to 2:25pm-3:15pm Sydney. Override `--from/--to` if the session
ran off-window. `bot: true` flags the bots; use it to filter and to fuel
the jokes, never to rank.

If a map segment has zero human kills, skip it silently - no commentary
for a game nobody was actually in.

## Step 2: write the post

Slack markdown: `*bold*`, plain dashes, no headers, no tables. Output the
whole post in one fenced block for copy-paste. Structure:

- **One-line opener** for the session as a whole. Undersell it. "Right,
  the tape's in" energy, not "WELCOME BACK LADIES AND GENTLEMEN".
- **One block per map**, in play order. Each block:
  - Map name in bold on its own line (`*de_dust2*`).
  - 2-4 lines of commentary. Call the game like a highlight package: who
    popped off, what weapon did the damage (`top_weapon`), where the
    momentum turned. Numbers stay exact.
  - Close with the top human line - name, kills, K/D - phrased as a
    caster's stat drop, not a podium ceremony. Example: `Ben closed on
    14-5 with the AWP doing most of the talking.`
- **One-line sign-off.** Toss to next week, keep it dry.

Keep the whole post scan-able - a mate scrolling Slack on the tram
shouldn't have to zoom in.

## Voice

Aussie, self-deprecating, allergic to tall poppies. The commentator
schtick is played straight enough to be funny - like calling a suburban
touch-footy game as if it were the World Cup - but never mean to the
humans on the scoreboard.

- **Rib the winner, don't crown them.** A big stat line gets a shrug or a
  qualifier, not a coronation. "Ben top-scored, which on this lineup is
  less of a flex than he thinks." Bold their name once; don't do it
  twice.
- **Lift the middle and the bottom with dry sympathy, not pity.** "Dave
  finished on 3-11 but by god he was committed to the rush." Never name
  a bottom-scorer just to dunk on them.
- **Self-deprecation is the whole vibe.** We are grown adults playing a
  25-year-old shooter on a Friday afternoon. Lean in. Own it. Anyone
  writing this like it's the IEM Grand Final without a wink is missing
  the point.
- **Specific > generic.** "The AWP did the talking" > "great game".
  Weapons, K/D swings, moments the data actually shows. If the data
  doesn't show it, don't invent it.

## Bots

The bots are on `yb_difficulty 0` - literally the lowest setting, which
is verifiable in `server/*/addons/yapb/conf/yapb.cfg` and worth knowing.
Treat them accordingly:

- **They don't get commentary time.** No bot names in the top-scorer
  line, no bot plays in the highlight beats. They're the crowd, not the
  players.
- **One shared gag per post, maximum**, and only if it lands. Something
  like: "the bots, set to zero difficulty by design, held up their end
  as target practice". Any more than that and the joke goes flat.
- **If a bot out-fragged the top human, that's the joke of the post.**
  Say it once, plainly, and move on. "Rough day at the office - a bot on
  skill zero out-fragged the room." No further commentary needed.
- **Don't call a bot 'good' or 'clutch'.** They're on 0. If they killed
  you, that's on you, and the post can note that without naming names.

## Guardrails

- Names and numbers from parser output are load-bearing - never fudge.
- Bots never rank, never get called out by name for a play.
- If the whole session had zero human kills, don't post - say so, check
  the window with `--from/--to` first.
- Deaths include suicides / self-kills; a deathless player's K/D is just
  their kill count. Don't invent a divide-by-zero moment.
- Never invent plays, clutches, or quotes the data can't support.
- Slack markdown only. No headers, no tables, no code blocks inside the
  post itself (the wrapping fence is just for copy-paste).
- This skill's take on bots (target practice) intentionally differs from
  `/friday-recap`'s ("aren't pushovers"). Recap is hype-the-humans;
  commentary is caster-voice with the bots as scenery. Don't
  cross-contaminate.
