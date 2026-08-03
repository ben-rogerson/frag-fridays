#!/usr/bin/env python3
"""Aggregate HL kill logs (stdin) into the season standings JSON the web
page renders at /assets/standings.json.

Usage:
    ssh cs16 'cat /opt/cs16/logs/*/L*.log' | python3 scripts/standings.py

Log timestamps are UTC; sessions are grouped by Sydney date. By default
only Fridays inside the session window (14:00-16:30 Sydney) count, so
midweek testing doesn't pollute the table. --all-days lifts the Friday
filter, --from/--to widen the window.

Season table is humans only - bots never rank (auth field <BOT>).
"""
import argparse
import json
import re
import sys
from collections import defaultdict
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

SYD = ZoneInfo("Australia/Sydney")

TS = r"(\d{2}/\d{2}/\d{4} - \d{2}:\d{2}:\d{2})"
PLAYER = r'"(.+?)<\d+><(.*?)><(.*?)>"'
KILL_RE = re.compile(rf"{TS}: {PLAYER} killed {PLAYER} with \"(.+?)\"")
SUICIDE_RE = re.compile(rf"{TS}: {PLAYER} committed suicide")

FRIDAY = 4  # datetime.weekday()


def parse_ts(s):
    return datetime.strptime(s, "%m/%d/%Y - %H:%M:%S").replace(tzinfo=timezone.utc)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--from", dest="start", default="14:00", help="window start HH:MM Sydney")
    ap.add_argument("--to", dest="end", default="16:30", help="window end HH:MM Sydney")
    ap.add_argument("--all-days", action="store_true", help="count every day, not just Fridays")
    args = ap.parse_args()

    lo = datetime.strptime(args.start, "%H:%M").time()
    hi = datetime.strptime(args.end, "%H:%M").time()

    # per Sydney date -> per player -> {kills, deaths, bot}
    days = defaultdict(lambda: defaultdict(lambda: {"kills": 0, "deaths": 0, "bot": False}))
    lines = kills = 0

    def bump(day, name, auth, field):
        p = days[day][name]
        p[field] += 1
        p["bot"] = p["bot"] or auth == "BOT"

    for line in sys.stdin:
        lines += 1
        m = KILL_RE.search(line)
        if m:
            ts_s, killer, kauth, _, victim, vauth, _, _weapon = m.groups()
            syd = parse_ts(ts_s).astimezone(SYD)
            if not args.all_days and syd.weekday() != FRIDAY:
                continue
            if not (lo <= syd.time() <= hi):
                continue
            day = syd.date().isoformat()
            if (killer, kauth) == (victim, vauth):  # self-kill logged as kill line
                bump(day, victim, vauth, "deaths")
            else:
                bump(day, killer, kauth, "kills")
                bump(day, victim, vauth, "deaths")
            kills += 1
            continue
        m = SUICIDE_RE.search(line)
        if m:
            ts_s, name, auth, _ = m.groups()
            syd = parse_ts(ts_s).astimezone(SYD)
            if not args.all_days and syd.weekday() != FRIDAY:
                continue
            if not (lo <= syd.time() <= hi):
                continue
            bump(syd.date().isoformat(), name, auth, "deaths")

    season = defaultdict(lambda: {"sessions": 0, "kills": 0, "deaths": 0})
    weeks = []
    for day in sorted(days):
        humans = {n: p for n, p in days[day].items() if not p["bot"]}
        if not any(p["kills"] for p in humans.values()):
            continue  # bots-only day (nobody showed) doesn't count as a session
        for name, p in humans.items():
            s = season[name]
            s["sessions"] += 1
            s["kills"] += p["kills"]
            s["deaths"] += p["deaths"]
        mvp = max(humans, key=lambda n: humans[n]["kills"])
        weeks.append({"date": day, "mvp": mvp, "kills": humans[mvp]["kills"]})

    table = [
        {
            "name": name,
            "sessions": s["sessions"],
            "kills": s["kills"],
            "deaths": s["deaths"],
            "kd": round(s["kills"] / s["deaths"], 2) if s["deaths"] else float(s["kills"]),
        }
        for name, s in season.items()
    ]
    table.sort(key=lambda r: (-r["kills"], -r["kd"]))

    json.dump(
        {
            "generated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "season": table,
            "weeks": weeks,
        },
        sys.stdout,
        indent=1,
    )
    print()
    print(
        f"standings: {lines} log lines, {kills} counted kills, "
        f"{len(weeks)} sessions, {len(table)} ranked players",
        file=sys.stderr,
    )


if __name__ == "__main__":
    main()
