#!/usr/bin/env python3
"""
Take a snapshot of everyone's reading and keep it in the repo.

    python3 tools/snapshot.py <your-topic>
    python3 tools/snapshot.py <your-topic> --push

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
        "topLookedUp", "devices", "lastSeen"]


def top(d, n):
    d = d or {}
    return " ".join(f"{k}:{d[k]}" for k in sorted(d, key=lambda k: -d[k])[:n])


def fetch(topic):
    url = f"https://ntfy.sh/{topic}/json?poll=1"
    try:
        raw = urllib.request.urlopen(url, timeout=30).read().decode()
    except Exception as e:
        sys.exit(f"could not reach ntfy: {e}")
    per_device = {}
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
        key = (t["student"], t.get("device", "unknown"))
        if key not in per_device or msg.get("time", 0) > per_device[key]["_at"]:
            t["_at"] = msg.get("time", 0)
            per_device[key] = t
    return add_up(per_device.values())


NUM = ["minutes", "visits", "pages", "sentences", "rereads", "wordTaps",
       "glossary", "quizzes", "quizRight", "quizTotal", "practiceGot", "practiceAll"]
DICT = ["books", "tapped", "lookedUp", "modes", "speeds"]


def add_up(per_device):
    """One row per child, their devices added together. A child may read on a
    laptop and a phone, and each device only knows its own totals."""
    by = {}
    for d in per_device:
        t = by.setdefault(d["student"], {
            "student": d["student"], "name": d.get("name", ""), "devices": [],
            "dates": set(), "lastSeen": 0,
            **{k: 0 for k in NUM}, **{k: {} for k in DICT}})
        t["name"] = d.get("name") or t["name"]
        dev = d.get("device", "unknown")
        if dev not in t["devices"]:
            t["devices"].append(dev)
        for k in NUM:
            t[k] += d.get(k, 0) or 0
        for k in DICT:
            for w, n in (d.get(k) or {}).items():
                t[k][w] = t[k].get(w, 0) + n
        t["dates"].update(d.get("dates") or [])
        t["lastSeen"] = max(t["lastSeen"], d.get("lastSeen", 0) or 0)
    out = []
    for t in by.values():
        t["minutes"] = round(t["minutes"], 1)
        t["days"] = len(t["dates"])
        t["dates"] = sorted(t["dates"])
        out.append(t)
    return out


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
        "devices": " ".join(t.get("devices", [])),
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

    # a run that adds a column would otherwise append wider rows under the old
    # header, so rewrite the file when the shape has changed
    existing, header = [], None
    if os.path.exists(CSV):
        with open(CSV, newline="") as f:
            rd = csv.DictReader(f)
            header = rd.fieldnames
            existing = list(rd)
    if header is not None and header != COLS:
        for r in existing:
            for c in COLS:
                r.setdefault(c, "")
        with open(CSV, "w", newline="") as f:
            w = csv.DictWriter(f, fieldnames=COLS, extrasaction="ignore")
            w.writeheader()
            for r in existing:
                w.writerow({c: r.get(c, "") for c in COLS})
        print(f"  (history.csv grew a column — rewrote {len(existing)} earlier row(s))")
        header = COLS

    with open(CSV, "a", newline="") as f:
        w = csv.DictWriter(f, fieldnames=COLS, extrasaction="ignore")
        if header is None:
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
