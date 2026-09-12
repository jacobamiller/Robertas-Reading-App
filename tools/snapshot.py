#!/usr/bin/env python3
"""
Take a snapshot of everyone's reading and keep it in the repo.

    python3 tools/snapshot.py rra-zjou8m56j6rmyn
    python3 tools/snapshot.py rra-zjou8m56j6rmyn --push

ntfy forgets a message after about half a day, so it only ever holds "where
each child is now". Running this regularly turns that into a history: one row
per child per run in data/history.csv, which is what you want for charting
minutes or accuracy over the term.

Nothing secret lives here. The app never writes to GitHub — the children's
phones only post to ntfy — and this runs on your machine with the git
credentials you already have.
"""
import argparse, csv, json, os, subprocess, sys, urllib.request
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")
CSV = os.path.join(DATA, "history.csv")
COLS = ["taken", "student", "name", "minutes", "days", "visits", "pages",
        "sentences", "rereads", "wordTaps", "glossary", "quizRight", "quizTotal",
        "practiceGot", "practiceAll", "accuracy", "books", "topTapped",
        "topLookedUp", "lastSeen"]


def top(d, n):
    d = d or {}
    return " ".join(f"{k}:{d[k]}" for k in sorted(d, key=lambda k: -d[k])[:n])


def fetch(topic):
    url = f"https://ntfy.sh/{topic}/json?poll=1"
    try:
        raw = urllib.request.urlopen(url, timeout=30).read().decode()
    except Exception as e:
        sys.exit(f"could not reach ntfy: {e}")
    latest = {}
    for line in raw.strip().splitlines():
        if not line.strip():
            continue
        try:
            msg = json.loads(line)
        except ValueError:
            continue
        body = msg.get("message", "")
        jline = next((l for l in body.splitlines() if l.startswith("json ")), None)
        if not jline:
            continue
        try:
            t = json.loads(jline[5:])
        except ValueError:
            continue
        if t["student"] not in latest or msg.get("time", 0) > latest[t["student"]]["_at"]:
            t["_at"] = msg.get("time", 0)
            latest[t["student"]] = t
    return list(latest.values())


def row(t, taken):
    return {
        "taken": taken, "student": t.get("student", ""), "name": t.get("name", ""),
        "minutes": t.get("minutes", 0), "days": t.get("days", 0),
        "visits": t.get("visits", 0), "pages": t.get("pages", 0),
        "sentences": t.get("sentences", 0), "rereads": t.get("rereads", 0),
        "wordTaps": t.get("wordTaps", 0), "glossary": t.get("glossary", 0),
        "quizRight": t.get("quizRight", 0), "quizTotal": t.get("quizTotal", 0),
        "practiceGot": t.get("practiceGot", 0), "practiceAll": t.get("practiceAll", 0),
        "accuracy": (round(t["practiceGot"] / t["practiceAll"] * 100)
                     if t.get("practiceAll") else ""),
        "books": top(t.get("books"), 8), "topTapped": top(t.get("tapped"), 12),
        "topLookedUp": top(t.get("lookedUp"), 12),
        "lastSeen": (datetime.fromtimestamp(t["lastSeen"] / 1000, timezone.utc)
                     .isoformat(timespec="seconds") if t.get("lastSeen") else ""),
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("topic")
    ap.add_argument("--commit", action="store_true", help="git commit the snapshot")
    ap.add_argument("--push", action="store_true", help="commit and push to GitHub")
    a = ap.parse_args()

    readers = fetch(a.topic)
    if not readers:
        sys.exit("nothing on that topic — either nobody has read since the messages "
                 "expired, or the topic is wrong")

    os.makedirs(DATA, exist_ok=True)
    taken = datetime.now(timezone.utc).isoformat(timespec="seconds")
    rows = [row(t, taken) for t in sorted(readers, key=lambda t: t.get("name", ""))]

    # a run where nobody has moved adds nothing worth keeping
    prev = {}
    if os.path.exists(CSV):
        for r in csv.DictReader(open(CSV)):
            prev[r["student"]] = r
    fresh = [r for r in rows
             if prev.get(r["student"], {}).get("lastSeen") != r["lastSeen"]]
    if not fresh:
        print(f"{len(rows)} reader(s), none with anything new since the last snapshot")
        return

    new_file = not os.path.exists(CSV)
    with open(CSV, "a", newline="") as f:
        w = csv.DictWriter(f, fieldnames=COLS)
        if new_file:
            w.writeheader()
        for r in fresh:
            w.writerow(r)

    json.dump({"taken": taken, "readers": readers},
              open(os.path.join(DATA, "latest.json"), "w"), indent=1)

    for r in fresh:
        print(f"  {r['name']:12} {r['minutes']:>6} min  {r['pages']:>4} pages  "
              f"quiz {r['quizRight']}/{r['quizTotal']}")
    print(f"\n{len(fresh)} row(s) added to data/history.csv")

    if a.commit or a.push:
        subprocess.run(["git", "add", "data"], cwd=ROOT, check=True)
        subprocess.run(["git", "commit", "-q", "-m",
                        f"Reading snapshot {taken[:16].replace('T', ' ')}"],
                       cwd=ROOT, check=True)
        if a.push:
            subprocess.run(["git", "push", "-q", "origin", "main"], cwd=ROOT, check=True)
            print("committed and pushed")
        else:
            print("committed — not pushed, so it is not on GitHub yet")


if __name__ == "__main__":
    main()
