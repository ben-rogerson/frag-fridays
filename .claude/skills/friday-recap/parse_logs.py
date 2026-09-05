#!/usr/bin/env python3
"""Parse HL kill logs (stdin) into per-map player stats for the Friday recap.

Usage (scripts/mirror-logs.sh refreshes data/logs/ from the box first):
    grep -H "" data/logs/*/L*.log | \
        python3 parse_logs.py --date 2026-08-07

The window defaults to that Friday's slot from data/sessions.json, padded
either side (see PAD_*) so a map that started early or ran over still gets
called. --from/--to override it.

grep -H prefixes each line with its file path; the logs/<mod>/ dir names
the game mode, so each map segment comes out tagged (gungame, deathmatch,
classic, ...) - PATH_RE matches that dir anywhere in the path, so the local
archive and the box's own paths both work. Plain `cat` input still works -
mode is just null.

Times are Sydney local (Australia/Sydney); log timestamps are UTC - the
script converts. Emits JSON: one entry per map segment played in the
window, players sorted by kills with K/D, top weapon and distinct weapon
count (gungame ladder progress), bots flagged.
"""
import argparse
import json
import re
import sys
from collections import defaultdict
from datetime import date, datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

# the session schedule lives with the other tooling, not in the skill
sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "scripts"))
import sessions  # noqa: E402

SYD = ZoneInfo("Australia/Sydney")
UTC = ZoneInfo("UTC")

TS = r"(\d{2}/\d{2}/\d{4} - \d{2}:\d{2}:\d{2})"
PLAYER = r'"(.+?)<(\d+)><(.*?)><(.*?)>"'
KILL_RE = re.compile(rf"{TS}: {PLAYER} killed {PLAYER} with \"(.+?)\"")
SUICIDE_RE = re.compile(rf"{TS}: {PLAYER} committed suicide")
MAP_RE = re.compile(rf'{TS}: Started map "(.+?)"')
PATH_RE = re.compile(r"^(?:.*?/)?logs/([^/]+)/[^:]*\.log:")

# A player whose tab crashes keeps their slot and their name for sv_timeout
# (600s), so the engine hands them "Name (1)" when they come back and the
# session sees two people with half the frags each. server/*/addons/.../
# ff_rejoin.sma fixes it at the source from the moment it ships; this folds the
# suffix back so the archive - and the ~1s window before the plugin renames
# them - still reads as one player. Same rule as scripts/standings.py.
# The cost: someone whose alias genuinely ends in " (2)" merges with the same
# name without it. Nobody in data/logs/ has ever used one, and every "(N)" in
# the archive is a known player's crash-rejoin, so the trade is one-sided.
DUPE_RE = re.compile(r"\s*\(\d+\)$")


def canon(name):
    return DUPE_RE.sub("", name)

# logs/<dir> -> the mode label the recap tells the story in. "vanilla" stays
# because the archive under data/logs/vanilla/ predates the 2026-09-05 rename
# to "cpl" and still has to parse.
MODES = {"gg": "gungame", "dm": "deathmatch", "cpl": "classic",
         "vanilla": "classic", "classical": "classical", "aim": "aim",
         "css": "deathmatch", "fy": "deathmatch", "awp": "deathmatch",
         "zp": "zombie"}

# The leaderboards count the slot exactly; a recap is a story, so it opens a
# little early and stays on air for whatever ran over the end.
PAD_BEFORE = timedelta(minutes=5)
PAD_AFTER = timedelta(minutes=15)


def parse_ts(s):
    return datetime.strptime(s, "%m/%d/%Y - %H:%M:%S").replace(tzinfo=UTC)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--date", required=True, help="session date, YYYY-MM-DD (Sydney)")
    ap.add_argument("--from", dest="start", default=None,
                    help="window start HH:MM Sydney (default: the week's slot, padded)")
    ap.add_argument("--to", dest="end", default=None,
                    help="window end HH:MM Sydney (default: the week's slot, padded)")
    args = ap.parse_args()

    day = datetime.strptime(args.date, "%Y-%m-%d")
    slot_lo, slot_hi = sessions.window(date.fromisoformat(args.date))

    def edge(override, slot_time, pad):
        at = datetime.combine(day, slot_time, SYD)
        if override:
            at = datetime.combine(day, datetime.strptime(override, "%H:%M").time(), SYD)
            pad = timedelta(0)
        return (at + pad).astimezone(UTC)

    lo = edge(args.start, slot_lo, -PAD_BEFORE)
    hi = edge(args.end, slot_hi, PAD_AFTER)

    # events across all files, sorted by time so map segments come out right
    # even though gg/dm files interleave on stdin
    events = []
    for line in sys.stdin:
        pm = PATH_RE.match(line)
        mode = MODES.get(pm.group(1), pm.group(1)) if pm else None
        m = MAP_RE.search(line)
        if m:
            events.append((parse_ts(m.group(1)), "map", (m.group(2), mode)))
            continue
        m = KILL_RE.search(line)
        if m:
            ts, killer, kuid, kauth, _, victim, vuid, vauth, _, weapon = m.groups()
            events.append((parse_ts(ts), "kill",
                           (canon(killer), kuid, kauth, canon(victim), vuid, vauth, weapon)))
            continue
        m = SUICIDE_RE.search(line)
        if m:
            ts, name, _uid, auth, _ = m.groups()
            events.append((parse_ts(ts), "suicide", (canon(name), auth)))
    events.sort(key=lambda e: e[0])

    maps = []  # ordered segments: {"map": str, "mode": str, "players": {name: stats}}
    current = None

    def seg(map_name, mode=None):
        nonlocal current
        current = {"map": map_name, "mode": mode, "players": defaultdict(lambda: {
            "kills": 0, "deaths": 0, "bot": False, "weapons": defaultdict(int)})}
        maps.append(current)

    for ts, kind, data in events:
        if kind == "map":
            # segment boundary matters even outside the window, so the first
            # in-window kill lands on the right map
            seg(*data)
            continue
        if not (lo <= ts <= hi):
            continue
        if current is None:
            seg("(unknown map)")
        players = current["players"]
        if kind == "kill":
            killer, kuid, kauth, victim, vuid, vauth, weapon = data
            # compare userids, not names: folding "(1)" away would otherwise
            # make a player fragging their own ghost look like a suicide
            if kuid == vuid:  # self-kill logged as kill line
                players[victim]["deaths"] += 1
                players[victim]["bot"] = vauth == "BOT"
            else:
                players[killer]["kills"] += 1
                players[killer]["weapons"][weapon] += 1
                players[killer]["bot"] = kauth == "BOT"
                players[victim]["deaths"] += 1
                players[victim]["bot"] = vauth == "BOT"
        elif kind == "suicide":
            name, auth = data
            players[name]["deaths"] += 1
            players[name]["bot"] = auth == "BOT"

    out = []
    for s in maps:
        if not s["players"]:
            continue  # map segment with no in-window action
        rows = []
        for name, p in s["players"].items():
            kd = round(p["kills"] / p["deaths"], 2) if p["deaths"] else float(p["kills"])
            top_weapon = max(p["weapons"], key=p["weapons"].get) if p["weapons"] else None
            rows.append({"name": name, "kills": p["kills"], "deaths": p["deaths"],
                         "kd": kd, "top_weapon": top_weapon,
                         "weapons_used": len(p["weapons"]), "bot": p["bot"]})
        rows.sort(key=lambda r: (-r["kills"], -r["kd"]))
        out.append({"map": s["map"], "mode": s["mode"], "players": rows})

    json.dump({"window_utc": [lo.isoformat(), hi.isoformat()], "maps": out},
              sys.stdout, indent=1)
    print()


if __name__ == "__main__":
    main()
