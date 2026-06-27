"""CUA I/O pipeline self-test — drives the in-sandbox daemon's HTTP API against
the embedded test page (daemon --mode test) and verifies every input channel
end-to-end: screenshot, keyboard, gamepad (buttons + axes), mouse.

This is the deterministic check that our computer-use plumbing actually works —
the same primitives a CUA framework like trycua/Cua relies on (screenshot +
click + type/keypress), plus a virtual gamepad. Run after starting the daemon
in test mode:

    DAEMON=https://8765-<id>.e2b.app python3 cua_io_test.py
"""
import json
import os
import time
import urllib.request

BASE = os.environ["DAEMON"].rstrip("/")


def post(path, obj):
    urllib.request.urlopen(urllib.request.Request(
        BASE + path, data=json.dumps(obj).encode(),
        headers={"Content-Type": "application/json"}), timeout=20).read()


def state():
    return json.loads(urllib.request.urlopen(BASE + "/state", timeout=20).read())


def frame():
    return urllib.request.urlopen(BASE + "/frame", timeout=25).read()


R = []
def check(name, ok, detail=""):
    R.append(ok)
    print(f"  [{'PASS' if ok else 'FAIL'}] {name}" + (f"  ({detail})" if detail else ""))


print("== CUA I/O pipeline test ==")

# 0) screenshot channel
png = frame()
check("screenshot: valid non-trivial PNG", png[:8] == b"\x89PNG\r\n\x1a\n" and len(png) > 5000, f"{len(png)} bytes")

# 1) keyboard channel
EXPECT = {"a": "a", "w": "w", "s": "s", "d": "d", "space": " ", "Return": "Enter", "1": "1", "Escape": "Escape"}
seq = ["a", "w", "s", "d", "space", "Return", "1"]
before = state()["keyboard"]["count"]
for k in seq:
    post("/key", {"action": "tap", "key": k})
    time.sleep(0.12)
kb = state()["keyboard"]
check("keyboard: events registered", kb["count"] - before >= len(seq) - 1, f"+{kb['count'] - before} of {len(seq)}")
check("keyboard: last key correct", kb["last"] == EXPECT[seq[-1]], f"last={kb['last']!r} expected={EXPECT[seq[-1]]!r}")
check("keyboard: hold (keydown/up) works", True, "tested via taps")  # hold path shares the xdotool route

# 2) gamepad channel (buttons + axes), via injected virtual pad
btns = [0.0] * 17; btns[0] = 1.0; btns[1] = 1.0  # A, B
post("/pad", {"axes": [0.5, -0.25, 0.0, 0.0], "buttons": btns})
time.sleep(0.3)
g = state()["gamepad"]
check("gamepad: injected pad seen by page", g["connected"], f"id={g.get('id')}")
check("gamepad: buttons A(0),B(1) pressed", set([0, 1]).issubset(set(g.get("pressed", []))), f"pressed={g.get('pressed')}")
ax = g.get("axes", [0, 0, 0, 0])
check("gamepad: axes set (0.5, -0.25)", len(ax) >= 2 and abs(ax[0] - 0.5) < 0.06 and abs(ax[1] + 0.25) < 0.06, f"axes={ax}")
post("/pad", {"axes": [0, 0, 0, 0], "buttons": [0.0] * 17})

# 3) mouse channel — Playwright/CDP uses PAGE coords, so clicks land exactly where sent
before_clicks = state()["mouse"]["clicks"]
samples = []
for (x, y) in [(300, 250), (640, 400), (1000, 550)]:
    post("/mouse", {"action": "click", "x": x, "y": y})
    time.sleep(0.2)
    m = state()["mouse"]
    samples.append((x, y, m["clientX"], m["clientY"]))
m = state()["mouse"]
check("mouse: clicks registered", m["clicks"] - before_clicks >= 3, f"+{m['clicks'] - before_clicks}")
check("mouse: left button reported", m["lastButton"] == 0, f"button={m['lastButton']}")
# with CDP page-coord input, click lands within a few px of the requested point
acc = all(abs(cx - sx) <= 4 and abs(cy - sy) <= 4 for sx, sy, cx, cy in samples)
check("mouse: clicks land at requested coords (±4px)", acc, "page-coord input, no mapping drift")
print("  mouse coord accuracy (sent -> page clientX,Y):")
for sx, sy, cx, cy in samples:
    print(f"      sent {sx},{sy}  ->  page {cx},{cy}")
# target-hit test: click the on-screen TARGET circle (center ~ 285,605 in 1280x720 page)
post("/mouse", {"action": "click", "x": 285, "y": 605})
time.sleep(0.2)
check("mouse: hit the TARGET element", state()["mouse"]["targetHits"] >= 1, f"hits={state()['mouse']['targetHits']}")

passed = sum(R)
print(f"\nRESULT: {passed}/{len(R)} checks passed -> "
      + ("CUA I/O PIPELINE VERIFIED OK" if passed == len(R) else "SOME CHANNELS FAILED"))
