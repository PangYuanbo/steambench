#!/usr/bin/env python3
"""Readiness check for the GeForce NOW bridge — run this BEFORE going live.

It exercises the three backends a real run needs (virtual gamepad · screen
capture · Steam achievement read) and prints a ✓/✗ report plus the exact next
step for anything missing. Nothing here touches a real game; it's safe to run
any time.

    python runtime/geforce_now_check.py --appid 1245620 \
        --region 0 0 1920 1080 --steamid 7656119… --frame-size 512 288

Without a real game streaming you'll typically see: capture ✓ (it grabs your
desktop), gamepad ✗ until you `pip install vgamepad` on Windows, steam ✓ once a
key+steamid are set. That's expected — it tells you what to wire next.
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
for p in (ROOT, ROOT / "harness"):
    if str(p) not in sys.path:
        sys.path.insert(0, str(p))

from geforce_now import GeForceNowSession  # noqa: E402  (same dir)

GREEN, RED, DIM, BOLD, OFF = "\033[32m", "\033[31m", "\033[2m", "\033[1m", "\033[0m"


def main() -> None:
    ap = argparse.ArgumentParser(description="GeForce NOW bridge readiness check")
    ap.add_argument("--appid", type=int, default=0)
    ap.add_argument("--region", type=int, nargs=4, metavar=("LEFT", "TOP", "W", "H"))
    ap.add_argument("--steamid", default=os.environ.get("STEAMID", ""))
    ap.add_argument("--steam-key", default=os.environ.get("STEAM_API_KEY", ""))
    ap.add_argument("--frame-size", type=int, nargs=2, metavar=("W", "H"))
    ap.add_argument("--no-capture", action="store_true", help="skip the screen grab")
    args = ap.parse_args()

    session = GeForceNowSession(
        appid=args.appid,
        region=tuple(args.region) if args.region else None,
        steamid=args.steamid or None,
        steam_key=args.steam_key or None,
        frame_size=tuple(args.frame_size) if args.frame_size else None,
    )
    report = session.selftest(capture=not args.no_capture)

    print(f"\n{BOLD}GeForce NOW bridge — readiness{OFF}")
    print(f"{DIM}region: {report['region']}{OFF}\n")
    for k in ("gamepad", "capture", "steam"):
        r = report[k]
        mark = f"{GREEN}✓{OFF}" if r["ok"] else (f"{DIM}–{OFF}" if r.get("skipped") else f"{RED}✗{OFF}")
        print(f"  {mark} {BOLD}{k:<9}{OFF} {r['detail']}")

    ready = report["ready"]
    print(f"\n  {'='*46}")
    if ready:
        print(f"  {GREEN}{BOLD}READY{OFF} — capture + gamepad live. Swap MockGameSession →")
        print(f"  GeForceNowSession in your run and you're playing a real game.")
    else:
        print(f"  {RED}{BOLD}NOT READY{OFF} — wire the ✗ items above. Capture + gamepad")
        print(f"  are required to drive a game; Steam can be verified at submit.")
    print()
    sys.exit(0 if ready else 1)


if __name__ == "__main__":
    main()
