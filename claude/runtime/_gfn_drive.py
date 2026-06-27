"""Local driver: press gamepad buttons on the real GFN game via the daemon's
public HTTP API, then grab a frame. Pure stdlib (urllib), runs on my machine.

    DAEMON=https://8765-<id>.e2b.app python3 _gfn_drive.py DPAD_DOWN A wait:1.5 B
"""
import json
import os
import sys
import time
import urllib.request

BASE = os.environ["DAEMON"].rstrip("/")
IDX = {"A":0,"B":1,"X":2,"Y":3,"LB":4,"RB":5,"BACK":8,"START":9,
       "LS":10,"RS":11,"DPAD_UP":12,"DPAD_DOWN":13,"DPAD_LEFT":14,"DPAD_RIGHT":15,"GUIDE":16}


def post_pad(axes, buttons):
    data = json.dumps({"axes": axes, "buttons": buttons}).encode()
    req = urllib.request.Request(BASE + "/pad", data=data, headers={"Content-Type": "application/json"})
    urllib.request.urlopen(req, timeout=20).read()


def set_state(buttons=(), lx=0.0, ly=0.0, lt=0.0, rt=0.0):
    bs = [0.0] * 17
    for n in buttons:
        bs[IDX[n]] = 1.0
    bs[6] = lt; bs[7] = rt
    post_pad([lx, -ly, 0, 0], bs)


def press(btn, hold=0.30):
    set_state([btn]); time.sleep(hold); set_state([])


def grab(path="/tmp/drive.png"):
    with urllib.request.urlopen(BASE + "/frame", timeout=25) as r:
        open(path, "wb").write(r.read())


# tokens: BTN | wait:SEC | hold:BTN:SEC | lx:VAL:SEC (tilt stick) | grab
for tok in sys.argv[1:]:
    if tok.startswith("wait:"):
        time.sleep(float(tok[5:]))
    elif tok.startswith("hold:"):
        _, b, s = tok.split(":"); press(b, float(s))
    elif tok.startswith("lx:"):
        _, v, s = tok.split(":"); set_state(lx=float(v)); time.sleep(float(s)); set_state()
    elif tok == "grab":
        pass
    else:
        press(tok); time.sleep(0.7)
grab()
print("done; frame -> /tmp/drive.png")
