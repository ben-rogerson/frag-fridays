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

**Deploy runs from a clean `main` only.** The syncs use `--delete`, so
deploying any other tree doesn't merely skip what that tree lacks - it
removes it from the box (this is how the war room went dead). Both the
branch and the dirty-tree check refuse before anything is touched; merge to
`main` first. `CS16_DEPLOY_FORCE=1 pnpm run deploy` skips them, for an
emergency where a fix cannot wait on a merge. `pnpm run swap` and
`pnpm run clientcfg` both call deploy.sh, so they are gated by it too -
worth knowing on a Friday, when a mod swap from a half-finished tree now
refuses instead of shipping it.

## 2. The three Slack messages

Generate the text with the `/friday-posts` skill - it checks the live
server for the running mod and emits all three, paste-ready.

The slot moves week to week, so the time isn't a constant anywhere: it lives
in `data/sessions.json`, one entry per Friday. If this week has moved, put it
in there **before** posting - the announcement, the leaderboards, the recap
and the site's countdown all read it. `python3 scripts/sessions.py` prints
what the coming Friday resolves to.

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

- **Press F1 to join Terrorists, F2 for Counter-Terrorists.** These binds
  ship to every player via the `userconfig.cfg` inside `valve.zip`. The team
  menu does render (numbered text menu), so this is the fast path, not the
  only one.
- **Radio is Z / X / C**, picked with the number keys. Worth a mention -
  they were dead until 2026-08-30, so regulars have learned to ignore them.
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
- `pnpm run standings` - replays the box's kill logs into the leaderboards and
  pushes them live. It counts the slot in `data/sessions.json`, so if play ran
  outside it, fix that week's entry and re-run rather than passing `--from`.
- `pnpm run session` - rolls the site's countdown to the next Friday from the
  same file. Do it after adding next week's entry if the slot has moved.
- `/friday-recap` for the Slack results post.

## 5. The sim watchdog runs itself

`/opt/cs16/sim-watchdog.sh` runs on cron every 5 min (source:
`server/sim-watchdog.sh`, rsynced by deploy.sh). It restarts the game
container in two cases: the sim killed itself (the MAX_MODELS precache leak
- players hang on the splash and nothing else looks wrong), or the sim has
been up more than 8h with nobody connected. Neither can fire on a server
with humans on it mid-session, so it needs no attention on session day -
but if you find the container younger than you expected, check
`/opt/cs16/logs/sim-watchdog.log` before assuming someone else restarted it.
Full rationale in [troubleshooting.md](troubleshooting.md).

## 6. Remote control from the phone (MCP)

The box runs a small MCP server (`server/mcp/`, container `mcp-mcp-1`, port
27017) wired into claude.ai as a custom connector, so the server can be
driven without the laptop: status, console commands (changelevel, csay,
votes, cvars), log tails, container restart (the join-wedge fix) and mod
swaps. The endpoint is `https://ff.benrogerson.dev/mcp/<secret>`.

**Connector setup (once per Claude account):** claude.ai → Settings →
Connectors → Add custom connector → URL `https://ff.benrogerson.dev/mcp/<secret>`,
no auth. The secret is line 1 of `/opt/cs16/mcp.env` (password manager copy).

**Rotate the secret** (it rides the URL, so it lands in Cloudflare logs):

```bash
# mcp.env holds TWO secrets (MCP_SECRET and ADMIN_TOKEN) - rewrite the one line,
# never the file, or the war room's token goes with it
ssh cs16 'umask 177 && sed -i "s|^MCP_SECRET=.*|MCP_SECRET=$(openssl rand -hex 32)|" /opt/cs16/mcp.env'
ssh cs16 'cd /opt/cs16/mcp && docker compose up -d'   # picks up the new env
# then update the connector URL in claude.ai
```

**Container ops:** the mcp container is its own compose project and is NOT
part of the mod swap - `pnpm run deploy` re-syncs and rebuilds it
(`docker compose up -d --build` in `/opt/cs16/mcp`), and it must never
appear on 27016 in the `docker ps` check. Logs:
`ssh cs16 'docker logs --tail 100 mcp-mcp-1'` - every tool call is logged
with its arguments, which is the audit trail for remote commands.

## 7. The war room (browser admin panel)

The same control plane also answers `/admin-api/*`, which is the back end for
a hidden route in the web client: **https://ff.benrogerson.dev/#/warroom**.
It is the phone-friendly way to run a session without claude.ai or SSH -
kick someone, change map, dial the bots up or down, put a message on
everyone's screen, swap the mode.

**Getting in:** paste the admin token (line 2 of `/opt/cs16/mcp.env`,
password manager copy). It is kept in that browser's localStorage until you
hit LOCK, so on your own phone it is a one-time thing. Ten wrong tokens from
one IP locks that IP out for 15 minutes.

**What each panel does:**

| Panel | Action | Costs players? |
|---|---|---|
| On the server | Kick a human by name (engine `kick`) | that player only |
| Session | Start the session on the site early (moves the kickoff to now) | no, touches no container |
| Bots | `yb_quota` - the TOTAL headcount YaPB fills to, plus a clear-all | no |
| Announce | `amx_csay green` centre-screen message | no |
| Map | `changelevel` to any map in the live rotation | no, stays connected |
| Mode | Full mod swap - `docker compose` down/build/up | DROPS EVERYONE, 1-2 min |
| Console | Any console command through the pipe, round restart, container restart | round restart no; container restart DROPS EVERYONE |

**Starting early:** if everyone is on and it is not kickoff yet, Session ->
START NOW rewrites `/opt/cs16/web/assets/session.json` with the kickoff at
this minute, keeping the slot's scheduled end. The front page stops counting
down and reads LIVE NOW - the server browser row says LIVE, the join button
says "join live" - and pages already open follow within 30 seconds without a
reload. BACK TO <time> puts the scheduled kickoff back. It only offers this
on Fridays: the site's clock has no other day to point at. The next
`pnpm run session` overwrites the file, which is the intent - the schedule in
`data/sessions.json` stays the source of truth and this is one night's
override. Nothing here reaches the game server: it is a statement about the
page, and the leaderboards still cut on the slot in `data/sessions.json` - so
if play really did start half an hour early, widen that week's entry before
`pnpm run standings`, or the early frags land in the practice table.

Everything except mode and restart runs through the cmdpipe. Every mod hears
it except **zp**, whose plugin mount is the abandoned template - on that one
the panel says so and disables those controls. Mode swap and restart drive
docker directly and always work.

The two destructive buttons arm on the first tap and fire on the second, and
both hand off to a background job (a swap outlives Cloudflare's ~100s request
limit) - the banner at the top reports it when it lands. Bots cannot be
kicked individually: YaPB's quota refills the slot within half a second, so
the quota is the only control that sticks.

**Deploying a change to it:** the panel is part of the web client
(`apps/web/src/Admin.tsx`) and the API is part of the MCP container
(`server/mcp/src/admin.js`), so `pnpm run deploy <mod>` ships both - it
rebuilds the client into `server/web/` and re-`up`s the mcp compose project.
The Worker route (`/admin-api/*` → 27017) is separate: `npx wrangler deploy`
from `apps/web/proxy/` after changing it.

**If `/admin-api` 404s:** `ADMIN_TOKEN` is missing from `/opt/cs16/mcp.env` -
the routes are only mounted when it is set (`docker logs mcp-mcp-1` says so
at boot). Add the line and `docker compose up -d` in `/opt/cs16/mcp`.
