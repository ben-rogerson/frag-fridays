#!/usr/bin/env python3
"""Aggregate HL kill logs (stdin) into the season standings JSON the web
page renders at /assets/standings.json.

Usage (normally via scripts/standings.sh, which refreshes the mirror first):
    cat data/logs/*/L*.log | python3 scripts/standings.py

Log timestamps are UTC; sessions are grouped by Sydney date. By default
only Fridays inside the session window count, so midweek testing doesn't
pollute the table. The window comes from data/sessions.json (via
scripts/sessions.py) - one entry per Friday, because the slot moves week to
week and regeneration replays the whole log history. --all-days lifts the
Friday filter, --from/--to override the window for every week.

Every Friday from the first session onwards gets a row in "weeks" with its
own player table, so the page can show a week-by-week breakdown. A Friday
with no kills in its window is still listed - "no stats recorded" - and a
week whose logs are known to be incomplete carries a note (WEEK_NOTES).
Neither counts as a session for the season totals unless it has kills.

Kills outside the session window feed a separate practice table: warm-up
frags since the most recent session (the table resets at each kickoff).
The web page shows it during the practice period.

Time played comes from enter/disconnect intervals in the same logs, split
across the window boundary the same way. A "Log file closed/started" pair
(map change, restart) closes any open interval, so crashes never inflate
anyone's hours.

Plants count bombs that detonated: the round's planter ("Planted_The_Bomb")
is credited when the Team "Target_Bombed" line follows. Defusals, round
starts and log edges clear the pending planter.

Both tables are humans only - bots never rank (auth field <BOT>).
"""
import argparse
import json
import re
import sys
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone

import sessions
from sessions import FRIDAY, SYD

TS = r"(\d{2}/\d{2}/\d{4} - \d{2}:\d{2}:\d{2})"
PLAYER = r'"(.+?)<(\d+)><(.*?)><(.*?)>"'
KILL_RE = re.compile(rf"{TS}: {PLAYER} killed {PLAYER} with \"(.+?)\"")
SUICIDE_RE = re.compile(rf"{TS}: {PLAYER} committed suicide")
ENTER_RE = re.compile(rf"{TS}: {PLAYER} entered the game")
LEAVE_RE = re.compile(rf"{TS}: {PLAYER} disconnected")
RENAME_RE = re.compile(rf'{TS}: {PLAYER} changed name to "(.+?)"')
LOGEDGE_RE = re.compile(rf"{TS}: Log file (?:started|closed)")
PLANT_RE = re.compile(rf'{TS}: {PLAYER} triggered "Planted_The_Bomb"')
BOMBED_RE = re.compile(rf'{TS}: Team "TERRORIST" triggered "Target_Bombed"')
# a defuse logs as Team "CT", a new round as World
PLANT_OVER_RE = re.compile(rf'{TS}: (?:World|Team "CT") triggered "(?:Round_Start|Bomb_Defused)"')

# bots log auth BOT on enter/kill lines but ID_BOT on disconnect
BOT_AUTHS = {"BOT", "ID_BOT"}

# never rank: the default webxash alias (player didn't set a name)
UNRANKED_RE = re.compile(r"^Player$")

# "(1)"-style dupe suffixes the engine appends on name collisions fold
# into the base name so both connections count as one player
DUPE_RE = re.compile(r"\s*\(\d+\)$")


def canon(name):
    return DUPE_RE.sub("", name)

# Weeks whose logs don't tell the whole story. Stated flat on the page.
WEEK_NOTES = {
    "2026-08-14": (
        "partial - kill logging was off for the classic half (1:30-2pm); "
        "only the deathmatch stretch from 2pm to the server crash at 2:11 is counted"
    ),
}

NO_STATS = "no stats recorded"


def parse_ts(s):
    return datetime.strptime(s, "%m/%d/%Y - %H:%M:%S").replace(tzinfo=timezone.utc)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--from", dest="start", default=None, help="window start HH:MM Sydney")
    ap.add_argument("--to", dest="end", default=None, help="window end HH:MM Sydney")
    ap.add_argument("--all-days", action="store_true", help="count every day, not just Fridays")
    args = ap.parse_args()

    # read once: session_window is called per log line, not per week
    schedule = sessions.load()

    def session_window(d):
        lo, hi = sessions.window(d, schedule)
        if args.start:
            lo = datetime.strptime(args.start, "%H:%M").time()
        if args.end:
            hi = datetime.strptime(args.end, "%H:%M").time()
        return lo, hi

    # per Sydney date -> per player -> {kills, deaths, secs, bot}; session
    # play in days, everything else (midweek testing, warm-up) in practice
    fresh = lambda: defaultdict(
        lambda: defaultdict(
            lambda: {"kills": 0, "deaths": 0, "plants": 0, "secs": 0, "bot": False}
        )
    )
    days, practice_days = fresh(), fresh()
    lines = kills = 0

    def bucket(syd):
        lo, hi = session_window(syd.date())
        in_window = (args.all_days or syd.weekday() == FRIDAY) and lo <= syd.time() <= hi
        return days if in_window else practice_days

    def bump(table, day, name, auth, field):
        p = table[day][canon(name)]
        p[field] += 1
        p["bot"] = p["bot"] or auth == "BOT"

    def credit_time(name, bot, start, end):
        """Split a presence interval into session vs practice buckets,
        day by day so nothing straddles midnight or the window edges."""
        name = canon(name)
        cur = start
        while cur < end:
            midnight = (cur + timedelta(days=1)).replace(
                hour=0, minute=0, second=0, microsecond=0
            )
            piece_end = min(end, midnight)
            day = cur.date().isoformat()

            def add(table, span):
                secs = int(span.total_seconds())
                if secs > 0:
                    p = table[day][name]
                    p["secs"] += secs
                    p["bot"] = p["bot"] or bot

            if args.all_days or cur.weekday() == FRIDAY:
                lo, hi = session_window(cur.date())
                w0 = cur.replace(hour=lo.hour, minute=lo.minute, second=0, microsecond=0)
                w1 = cur.replace(hour=hi.hour, minute=hi.minute, second=0, microsecond=0)
                add(days, min(piece_end, w1) - max(cur, w0))
                add(practice_days, min(piece_end, w0) - cur)
                add(practice_days, piece_end - max(cur, w1))
            else:
                add(practice_days, piece_end - cur)
            cur = midnight

    # Presence is keyed by userid, not name: webxash clients join as
    # "Player" and set their alias after entering, which the engine never
    # logs as a rename. Kill-line sightings keep the uid's current name
    # fresh, and a uid first seen mid-game (missed enter) opens a synthetic
    # interval from that sighting.
    on_server = {}  # userid -> {"start": syd time, "name": str, "bot": bool}
    last_seen = None  # syd time of the last parsed line
    planter = None  # (name, auth, syd time of the plant) until the round resolves

    def seen(uid, name, auth, syd):
        p = on_server.get(uid)
        if p:
            p["name"] = name
        else:
            on_server[uid] = {"start": syd, "name": name, "bot": auth in BOT_AUTHS}

    def leave(uid, end):
        p = on_server.pop(uid)
        if end > p["start"]:
            credit_time(p["name"], p["bot"], p["start"], end)

    for line in sys.stdin:
        lines += 1
        m = KILL_RE.search(line)
        if m:
            ts_s, killer, kuid, kauth, _, victim, vuid, vauth, _, _weapon = m.groups()
            syd = last_seen = parse_ts(ts_s).astimezone(SYD)
            seen(kuid, killer, kauth, syd)
            seen(vuid, victim, vauth, syd)
            table = bucket(syd)
            day = syd.date().isoformat()
            if kuid == vuid:  # self-kill logged as kill line
                bump(table, day, victim, vauth, "deaths")
            else:
                bump(table, day, killer, kauth, "kills")
                bump(table, day, victim, vauth, "deaths")
            kills += 1
            continue
        m = SUICIDE_RE.search(line)
        if m:
            ts_s, name, uid, auth, _ = m.groups()
            syd = last_seen = parse_ts(ts_s).astimezone(SYD)
            seen(uid, name, auth, syd)
            bump(bucket(syd), syd.date().isoformat(), name, auth, "deaths")
            continue
        m = ENTER_RE.search(line)
        if m:
            ts_s, name, uid, auth, _ = m.groups()
            syd = last_seen = parse_ts(ts_s).astimezone(SYD)
            seen(uid, name, auth, syd)
            continue
        m = LEAVE_RE.search(line)
        if m:
            ts_s, name, uid, auth, _ = m.groups()
            syd = last_seen = parse_ts(ts_s).astimezone(SYD)
            if uid in on_server:
                on_server[uid]["name"] = name  # disconnect line has the final name
                leave(uid, syd)
            continue
        m = RENAME_RE.search(line)
        if m:
            ts_s, _, uid, _, _, new = m.groups()
            last_seen = parse_ts(ts_s).astimezone(SYD)
            if uid in on_server:
                on_server[uid]["name"] = new
            continue
        m = PLANT_RE.search(line)
        if m:
            ts_s, name, uid, auth, _ = m.groups()
            syd = last_seen = parse_ts(ts_s).astimezone(SYD)
            seen(uid, name, auth, syd)
            planter = (name, auth, syd)
            continue
        m = BOMBED_RE.search(line)
        if m:
            if planter:
                name, auth, syd = planter
                bump(bucket(syd), syd.date().isoformat(), name, auth, "plants")
                planter = None
            continue
        if PLANT_OVER_RE.search(line):
            planter = None  # defused, or a new round: that plant never blew
            continue
        m = LOGEDGE_RE.search(line)
        if m:
            planter = None
            # map change or restart: everyone re-enters in the next file, so
            # close open intervals here. Close at the last activity we saw -
            # the cat'ed files aren't strictly chronological across mods, and
            # a crash can leave hours between segments.
            if last_seen is not None:
                for uid in list(on_server):
                    leave(uid, last_seen)
            on_server.clear()
            last_seen = parse_ts(m.group(1)).astimezone(SYD)

    # whoever is still on when the logs end played up to the last line seen
    if last_seen is not None:
        for uid in list(on_server):
            leave(uid, last_seen)

    def row(name, p):
        return {
            "name": name,
            "kills": p["kills"],
            "deaths": p["deaths"],
            "kd": round(p["kills"] / p["deaths"], 2) if p["deaths"] else float(p["kills"]),
            "plants": p["plants"],
            "time": p["secs"],
        }

    season = defaultdict(
        lambda: {"sessions": 0, "kills": 0, "deaths": 0, "plants": 0, "secs": 0}
    )
    played = {}  # date -> week entry, only days with human kills in the window
    for day in sorted(days):
        humans = {
            n: p
            for n, p in days[day].items()
            if not p["bot"] and not UNRANKED_RE.search(n)
            # kills or deaths required: never fragged, never fell is a
            # spectator, not a player
            and (p["kills"] or p["deaths"])
        }
        if not any(p["kills"] for p in humans.values()):
            continue  # bots-only day (nobody showed) doesn't count as a session
        for name, p in humans.items():
            s = season[name]
            s["sessions"] += 1
            s["kills"] += p["kills"]
            s["deaths"] += p["deaths"]
            s["plants"] += p["plants"]
            s["secs"] += p["secs"]
        players = sorted(
            (row(n, p) for n, p in humans.items()), key=lambda r: (-r["kills"], -r["kd"])
        )
        entry = {
            "date": day,
            "mvp": players[0]["name"],
            "kills": players[0]["kills"],
            "players": players,
        }
        if day in WEEK_NOTES:
            entry["note"] = WEEK_NOTES[day]
        played[day] = entry

    # One row per Friday from the first session to the most recent Friday
    # whose window has passed, so a week with nothing in the logs shows up
    # as exactly that instead of silently vanishing from the season.
    weeks = []
    if played and not args.all_days:
        now = datetime.now(SYD)
        last_friday = now.date() - timedelta(days=(now.weekday() - FRIDAY) % 7)
        if last_friday == now.date() and now.time() < session_window(last_friday)[1]:
            last_friday -= timedelta(days=7)
        d = date.fromisoformat(min(played))
        while d <= max(last_friday, date.fromisoformat(max(played))):
            weeks.append(
                played.get(d.isoformat())
                or {"date": d.isoformat(), "mvp": None, "kills": 0, "players": [], "note": NO_STATS}
            )
            d += timedelta(days=7)
    else:
        weeks = [played[d] for d in sorted(played)]

    table = [
        {
            "name": name,
            "sessions": s["sessions"],
            "kills": s["kills"],
            "deaths": s["deaths"],
            "kd": round(s["kills"] / s["deaths"], 2) if s["deaths"] else float(s["kills"]),
            "plants": s["plants"],
            "time": s["secs"],
        }
        for name, s in season.items()
    ]
    table.sort(key=lambda r: (-r["kills"], -r["kd"]))

    # practice: warm-up frags since the last session; kickoff resets the table
    last_session = max(played) if played else None
    warmup = defaultdict(lambda: {"kills": 0, "deaths": 0, "plants": 0, "secs": 0})
    for day, players in practice_days.items():
        if last_session is not None and day <= last_session:
            continue
        for name, p in players.items():
            if p["bot"] or UNRANKED_RE.search(name):
                continue
            warmup[name]["kills"] += p["kills"]
            warmup[name]["deaths"] += p["deaths"]
            warmup[name]["plants"] += p["plants"]
            warmup[name]["secs"] += p["secs"]
    practice = [
        row(name, s)
        for name, s in warmup.items()
        # kills or deaths required: headless probes and spectators clock
        # hours without ever touching the game, and they never rank
        if s["kills"] or s["deaths"]
    ]
    practice.sort(key=lambda r: (-r["kills"], -r["kd"]))

    json.dump(
        {
            "generated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "season": table,
            "weeks": weeks,
            "practice": practice,
            "practiceSince": last_session,
        },
        sys.stdout,
        indent=1,
    )
    print()
    print(
        f"standings: {lines} log lines, {kills} counted kills, "
        f"{len(played)} sessions over {len(weeks)} weeks, {len(table)} ranked players, "
        f"{len(practice)} in practice",
        file=sys.stderr,
    )


if __name__ == "__main__":
    main()
