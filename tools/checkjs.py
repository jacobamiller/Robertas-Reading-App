#!/usr/bin/env python3
"""
Catch the mistakes a syntax check will not.

    python3 tools/checkjs.py

A top-level `const top = ...` in a classic script is a SyntaxError, because
window.top already exists and is not configurable — the whole file then fails
to evaluate and nothing runs, with no console error in some browsers. Neither
`node --check` nor wrapping the source in `new Function()` or `eval()` will
show it, because both give lexical declarations a scope of their own. Only a
real <script> tag does. This checks for it directly.
"""
import glob, os, re, sys

RESTRICTED = {"top", "self", "name", "length", "status", "origin", "parent",
              "closed", "frames", "location", "history", "navigator",
              "document", "window", "event", "external", "scrollX", "scrollY"}
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

bad = []
for path in sorted(glob.glob(os.path.join(ROOT, "*.js"))):
    src = open(path).read()
    for m in re.finditer(r"^\s*(?:const|let|class)\s+([A-Za-z_$][\w$]*)", src, re.M):
        if m.group(1) in RESTRICTED:
            line = src[:m.start()].count("\n") + 1
            bad.append(f"{os.path.basename(path)}:{line}  top-level '{m.group(1)}' "
                       f"collides with the built-in window.{m.group(1)}")

for b in bad:
    print("  " + b)
print(f"\n{len(bad)} problem(s)" + ("" if bad else " — all clear"))
sys.exit(1 if bad else 0)
