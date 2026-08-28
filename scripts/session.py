#!/usr/bin/env python3
"""Print the web countdown's /assets/session.json for the coming Friday.

The page's clock needs one thing - the next kickoff - but the schedule that
knows it lives in data/sessions.json alongside every other week. This turns
the coming week's entry into the small shape App.tsx reads:

    {"date": "2026-09-04", "hour": 14, "minute": 30, "end": "15:00"}

Generated, not hand-edited: change data/sessions.json and re-run
scripts/session.sh. App.tsx only honours the file while its date matches the
Friday it is counting to, so a stale one can never show last week's time.
"""
import json
import sys
from datetime import date

import sessions


def main():
    d = date.fromisoformat(sys.argv[1]) if len(sys.argv) > 1 else sessions.next_friday()
    lo, hi = sessions.window(d)
    json.dump(
        {"date": d.isoformat(), "hour": lo.hour, "minute": lo.minute, "end": f"{hi:%H:%M}"},
        sys.stdout,
    )
    print()
    print(f"session: {d} kickoff {lo:%H:%M}, slot ends {hi:%H:%M} (Sydney)", file=sys.stderr)


if __name__ == "__main__":
    main()
