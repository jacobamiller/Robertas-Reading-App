#!/usr/bin/env python3
"""
Build students.json — the roster the app shows on its "Who is reading?" screen.

    python3 tools/students.py add Roberta 1234 --avatar 🦊
    python3 tools/students.py list
    python3 tools/students.py pin ynty 4321
    python3 tools/students.py remove ynty

Each child gets a short code, which is also their link:

    .../index.html?s=<code>

Hand that link out and the child only has to tap their PIN. The PIN is stored
as a salted SHA-256 rather than the digits, so the roster is not readable at a
glance — but four digits checked on the device is a speed bump, not a lock.
It keeps siblings out of each other's reading. Nothing more.
"""
import argparse, hashlib, json, os, random, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PATH = os.path.join(ROOT, "students.json")


def load():
    if not os.path.exists(PATH):
        return {"students": []}
    return json.load(open(PATH))


def save(d):
    json.dump(d, open(PATH, "w"), ensure_ascii=False, indent=1)


def pin_hash(code, pin):
    return hashlib.sha256(f"{code}:{pin}".encode()).hexdigest()


def new_code(taken):
    while True:
        c = "".join(random.choice("abcdefghjkmnpqrstuvwxyz23456789") for _ in range(4))
        if c not in taken:
            return c


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    a = sub.add_parser("add");    a.add_argument("name"); a.add_argument("pin")
    a.add_argument("--avatar", default="🙂"); a.add_argument("--code")
    sub.add_parser("list")
    c = sub.add_parser("pin", help="change a PIN, keeping the code and the link")
    c.add_argument("code"); c.add_argument("pin")
    r = sub.add_parser("remove"); r.add_argument("code")
    args = ap.parse_args()

    d = load()
    if args.cmd == "list":
        if not d["students"]:
            sys.exit("no students yet — try: python3 tools/students.py add Roberta 1234")
        print(f"{'code':6} {'name':16} link")
        for s in d["students"]:
            print(f"{s['code']:6} {s['avatar']} {s['name']:14} ?s={s['code']}")
        return

    if args.cmd == "pin":
        if not re.fullmatch(r"\d{4}", args.pin):
            sys.exit("the PIN must be four digits")
        for st in d["students"]:
            if st["code"] == args.code:
                st["pin"] = pin_hash(st["code"], args.pin)
                save(d)
                print(f"{st['name']}'s PIN changed — code and link are unchanged")
                print(f"their link:  index.html?s={st['code']}")
                return
        sys.exit(f"no student with code {args.code}")

    if args.cmd == "remove":
        n = len(d["students"])
        d["students"] = [s for s in d["students"] if s["code"] != args.code]
        if len(d["students"]) == n:
            sys.exit(f"no student with code {args.code}")
        save(d); print(f"removed {args.code}")
        return

    if not re.fullmatch(r"\d{4}", args.pin):
        sys.exit("the PIN must be four digits")
    taken = {s["code"] for s in d["students"]}
    code = args.code or new_code(taken)
    if code in taken:
        sys.exit(f"code {code} is already used")
    d["students"].append({"code": code, "name": args.name,
                          "avatar": args.avatar, "pin": pin_hash(code, args.pin)})
    save(d)
    print(f"added {args.name}  code={code}")
    print(f"their link:  index.html?s={code}")


if __name__ == "__main__":
    main()
