# Friday run-book

The repeatable procedure for running a session. Player URL:
`http://149.28.172.74:27016` (constant across all mods).

## 1. Bring up the chosen mod

Only one mod runs at a time - they all bind port 27016. Swap by taking the
old one down and bringing the new one up:

```bash
cd /opt/cs16/gg && docker compose down     # whatever is currently running
cd /opt/cs16/dm && docker compose up -d    # the mod for this session
docker ps --format '{{.Names}}'
```

**The `docker ps` check is MANDATORY, not optional.** Containers look
identical in-browser - vanilla and GunGame serve the same page and the same
map. This has bitten before: a `restart: always` vanilla container silently
reclaimed port 27016 after a reboot and "GunGame" was actually vanilla for
the whole session. Never announce until `docker ps` shows the right container
name and nothing else on 27016.

If the client config changed, run `pnpm run clientcfg` from the laptop: it
syncs configs, then runs `update-clientcfg.sh` on the box, which rebuilds
`valve.zip` from the game files tree, installs it to every mount point and
restarts the running mod. Players must hard-refresh the browser tab to fetch
the new zip. (`pnpm run deploy` alone only installs the config into the game
files tree - players won't see it.)

## 2. The three Slack messages

Generate the text with the `/friday-posts` skill - it checks the live
server for the running mod and emits all three, paste-ready.

Three messages on the day, each doing a specific job:

1. **Morning announcement** - what's on, what mode, what time. Sets turnout.
2. **Midday "open it now to pre-load" reminder.** This one does real work:
   the browser build has **no lazy loading** - the entire game filesystem
   loads into browser RAM on first join, which takes a while. If people open
   the URL at midday, the assets are cached and the session start time isn't
   eaten by everyone's first-load delay. Ask them to open the URL now, wait
   for it to load, then close it.
3. **30-minutes-before final call** - includes the full connect steps (URL +
   join instructions below) so nobody has to scroll back.

## 3. Join instructions (include in the final call)

The browser build does not render the team select menu, so players must:

- **Press F1 to join Terrorists, F2 for Counter-Terrorists.** These binds
  ship to every player via the `userconfig.cfg` inside `valve.zip`.
- **Console fallback** if the binds fail: open console (backtick key), type
  `jointeam 1` then `joinclass 1`.
- **DM sessions only:** gun choice is by chat - say `/guns` for the list,
  then e.g. `/awp` or `/ak` (applies from the next spawn; default is your
  team's rifle + deagle).
- **Bots:** YaPB fills the server (9 by default) and bots leave as humans
  join - the server is never empty, so early joiners have someone to shoot.

Mobile browsers do not work (text input isn't real HTML input) - laptop only.
Say so in the announcement.

## 4. Post-session teardown

- No need to stop the container between sessions - the box is cheap and stays
  up. But if switching what's "resident", do it now while the session is
  fresh, and verify with `docker ps`.
- Note anything that broke or was decided during the session in
  [decisions.md](decisions.md) - it is the raw material for the blog and much
  easier to capture now than to reconstruct.
- Add any new work items to [backlog.md](backlog.md).
