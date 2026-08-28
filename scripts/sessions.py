#!/usr/bin/env python3
"""The session schedule: when Frag Fridays runs, Sydney time.

data/sessions.json is the single source of truth - one entry per Friday,
because the slot moves week to week. Everything that needs to know when a
session was (or will be) goes through here rather than hardcoding a time:

    scripts/standings.py                       log window per Friday
    .claude/skills/friday-recap/parse_logs.py  recap window
    scripts/session.py                         the site's countdown

A Friday with no entry falls back to "default", so an ordinary week needs
no edit at all, and an unlisted week can't inherit the week before's odd
slot the way the old per-era table did.

Run directly to print the window for a date:  python3 scripts/sessions.py 2026-08-28
"""
import json
from datetime import date, datetime, time, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

SYD = ZoneInfo("Australia/Sydney")
FRIDAY = 4  # datetime.weekday()
SCHEDULE = Path(__file__).resolve().parent.parent / "data" / "sessions.json"


def load(path=SCHEDULE):
    return json.loads(Path(path).read_text())


def _hhmm(s):
    return datetime.strptime(s, "%H:%M").time()


def slot(d, schedule=None):
    """The raw {start, end, note?} entry for date d - the week's, or the default."""
    s = schedule if schedule is not None else load()
    return s.get("weeks", {}).get(d.isoformat()) or s["default"]


def window(d, schedule=None):
    """(start, end) as Sydney times for the session on date d."""
    w = slot(d, schedule)
    return _hhmm(w["start"]), _hhmm(w["end"])


def next_friday(now=None, schedule=None):
    """The Friday the countdown is pointing at: today while today's slot is
    still to come or still running, otherwise the Friday after."""
    now = now or datetime.now(SYD)
    d = now.date() + timedelta(days=(FRIDAY - now.weekday()) % 7)
    if d == now.date() and now.time() >= window(d, schedule)[1]:
        d += timedelta(days=7)
    return d


if __name__ == "__main__":
    import sys

    d = date.fromisoformat(sys.argv[1]) if len(sys.argv) > 1 else next_friday()
    lo, hi = window(d)
    print(f"{d} {lo:%H:%M}-{hi:%H:%M} Sydney")
