#!/usr/bin/env python3
"""Parse HL kill logs (stdin) into per-map player stats for the Friday recap.

Usage:
    ssh cs16 'cat /opt/cs16/logs/*/L*.log' | \
        python3 parse_logs.py --date 2026-08-07 --from 14:25 --to 15:15

Times are Sydney local (Australia/Sydney); log timestamps are UTC - the
script converts. Emits JSON: one entry per map segment played in the
window, players sorted by kills with K/D and top weapon, bots flagged.
"""
import argparse
import json
import re
import sys
from collections import defaultdict
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

SYD = ZoneInfo("Australia/Sydney")
UTC = ZoneInfo("UTC")

TS = r"(\d{2}/\d{2}/\d{4} - \d{2}:\d{2}:\d{2})"
PLAYER = r'"(.+?)<\d+><(.*?)><(.*?)>"'
KILL_RE = re.compile(rf"{TS}: {PLAYER} killed {PLAYER} with \"(.+?)\"")
SUICIDE_RE = re.compile(rf"{TS}: {PLAYER} committed suicide")
MAP_RE = re.compile(rf'{TS}: Started map "(.+?)"')


def parse_ts(s):
    return datetime.strptime(s, "%m/%d/%Y - %H:%M:%S").replace(tzinfo=UTC)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--date", required=True, help="session date, YYYY-MM-DD (Sydney)")
    ap.add_argument("--from", dest="start", default="14:25", help="window start HH:MM Sydney")
    ap.add_argument("--to", dest="end", default="15:15", help="window end HH:MM Sydney")
    args = ap.parse_args()

    day = datetime.strptime(args.date, "%Y-%m-%d")
    lo = datetime.combine(day, datetime.strptime(args.start, "%H:%M").time(), SYD).astimezone(UTC)
    hi = datetime.combine(day, datetime.strptime(args.end, "%H:%M").time(), SYD).astimezone(UTC)

    # events across all files, sorted by time so map segments come out right
    # even though gg/dm files interleave on stdin
    events = []
    for line in sys.stdin:
        m = MAP_RE.search(line)
        if m:
            events.append((parse_ts(m.group(1)), "map", m.group(2)))
            continue
        m = KILL_RE.search(line)
        if m:
            ts, killer, kauth, _, victim, vauth, _, weapon = m.groups()
            events.append((parse_ts(ts), "kill", (killer, kauth, victim, vauth, weapon)))
            continue
        m = SUICIDE_RE.search(line)
        if m:
            ts, name, auth, _ = m.groups()
            events.append((parse_ts(ts), "suicide", (name, auth)))
    events.sort(key=lambda e: e[0])

    maps = []  # ordered segments: {"map": str, "players": {name: stats}}
    current = None

    def seg(map_name):
        nonlocal current
        current = {"map": map_name, "players": defaultdict(lambda: {
            "kills": 0, "deaths": 0, "bot": False, "weapons": defaultdict(int)})}
        maps.append(current)

    for ts, kind, data in events:
        if kind == "map":
            # segment boundary matters even outside the window, so the first
            # in-window kill lands on the right map
            seg(data)
            continue
        if not (lo <= ts <= hi):
            continue
        if current is None:
            seg("(unknown map)")
        players = current["players"]
        if kind == "kill":
            killer, kauth, victim, vauth, weapon = data
            if (killer, kauth) == (victim, vauth):  # self-kill logged as kill line
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
                         "kd": kd, "top_weapon": top_weapon, "bot": p["bot"]})
        rows.sort(key=lambda r: (-r["kills"], -r["kd"]))
        out.append({"map": s["map"], "players": rows})

    json.dump({"window_utc": [lo.isoformat(), hi.isoformat()], "maps": out},
              sys.stdout, indent=1)
    print()


if __name__ == "__main__":
    main()
