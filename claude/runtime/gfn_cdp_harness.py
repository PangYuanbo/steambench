#!/usr/bin/env python3
"""Self-contained GeForce NOW harness that drives a real, already-running browser
over CDP.

This is the *hosted-runner* shape: the benchmark host has GeForce NOW open in a
cloud browser (here: an E2B no-GPU desktop sandbox; equally a Modal container).
Chrome runs with ``--remote-debugging-port=9222``; this harness attaches over CDP,
injects a W3C-standard **virtual gamepad** into the live GFN page, and runs an
agent loop: read the frame (is a game streaming?), decide an action, push it onto
the gamepad the page polls every frame — exactly as a physical controller would.

No steambench_harness import on purpose: it must run in a bare sandbox whose only
extra dependency is ``playwright`` (the package — it attaches to the existing
Chrome via ``connect_over_cdp``, so no browser download is needed).

    python3 gfn_cdp_harness.py --cdp http://localhost:9222 --steps 12 --frames /tmp/hf
"""
from __future__ import annotations

import argparse
import json
import sys
import time

# --- verified virtual-gamepad injection (Chrome 148; see runtime/gfn_browser.py) ---
GAMEPAD_INIT_JS = r"""
(() => {
  const mkButtons = () => Array.from({length: 17}, () => ({pressed: false, touched: false, value: 0}));
  const pad = {
    id: 'Xbox 360 Controller (XInput STANDARD GAMEPAD)',
    index: 0, connected: true, mapping: 'standard',
    timestamp: performance.now(), axes: [0, 0, 0, 0], buttons: mkButtons(), vibrationActuator: null,
  };
  const bump = () => { pad.timestamp = performance.now(); };
  window.__gpPad = pad;
  window.__gpSetState = (axes, buttons) => {
    if (axes) for (let i = 0; i < axes.length; i++) pad.axes[i] = axes[i];
    if (buttons) for (let i = 0; i < buttons.length; i++) {
      const v = (typeof buttons[i] === 'number') ? buttons[i] : (buttons[i] ? 1 : 0);
      pad.buttons[i].value = v; pad.buttons[i].pressed = v >= 0.5; pad.buttons[i].touched = v > 0;
    }
    bump();
  };
  window.__gpFireConnected = () => { const e = new Event('gamepadconnected'); e.gamepad = pad; window.dispatchEvent(e); };
  const getGamepads = function getGamepads() { return [pad, null, null, null]; };
  try { Object.defineProperty(Navigator.prototype, 'getGamepads', {value: getGamepads, writable: true, configurable: true}); }
  catch (e1) { try { Object.defineProperty(navigator, 'getGamepads', {value: getGamepads, writable: true, configurable: true}); }
    catch (e2) { try { navigator.getGamepads = getGamepads; } catch (e3) {} } }
  try { navigator.webkitGetGamepads = getGamepads; } catch (e) {}
})();
"""

BTN = {"A": 0, "B": 1, "X": 2, "Y": 3, "LB": 4, "RB": 5, "BACK": 8, "START": 9,
       "LS": 10, "RS": 11, "DPAD_UP": 12, "DPAD_DOWN": 13, "DPAD_LEFT": 14,
       "DPAD_RIGHT": 15, "GUIDE": 16}


def state(buttons=(), lx=0.0, ly=0.0, rx=0.0, ry=0.0, lt=0.0, rt=0.0):
    """Build W3C-standard (axes, buttons). ly/ry are +up here, negated to the
    Gamepad-API +down convention."""
    b = [0.0] * 17
    for n in buttons:
        b[BTN[n]] = 1.0
    b[6] = lt
    b[7] = rt
    return [lx, -ly, rx, -ry], b


def find_gfn_page(browser):
    pages = [pg for c in browser.contexts for pg in c.pages]
    for pg in pages:
        if "geforcenow" in (pg.url or ""):
            return pg, [p.url for p in pages]
    return (pages[0] if pages else None), [p.url for p in pages]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--cdp", default="http://localhost:9222")
    ap.add_argument("--steps", type=int, default=12)
    ap.add_argument("--frames", default="/tmp/hframes")
    args = ap.parse_args()

    import os
    os.makedirs(args.frames, exist_ok=True)
    from playwright.sync_api import sync_playwright

    report = {"cdp": args.cdp, "steps": []}
    with sync_playwright() as p:
        browser = p.chromium.connect_over_cdp(args.cdp)
        page, urls = find_gfn_page(browser)
        if page is None:
            print(json.dumps({"error": "no pages over CDP"}))
            return 1
        report["page_url"] = (page.url or "")[:80]
        report["all_urls"] = [u[:60] for u in urls]
        try:
            page.bring_to_front()
        except Exception:
            pass

        # inject the gamepad into the already-loaded page + announce it
        page.evaluate(GAMEPAD_INIT_JS)
        page.evaluate("window.__gpFireConnected && window.__gpFireConnected()")
        report["pad"] = page.evaluate(
            "(()=>{const g=navigator.getGamepads()[0];return g?{id:g.id,mapping:g.mapping,ts:g.timestamp}:null})()"
        )

        def video():
            return page.evaluate(
                "(()=>{const v=document.querySelector('video');"
                "return v?{w:v.videoWidth,h:v.videoHeight,ready:v.readyState,paused:v.paused}:null})()"
            )

        def focus():
            return page.evaluate(
                "(()=>{const a=document.activeElement;return a?"
                "(a.getAttribute('aria-label')||a.getAttribute('title')||a.className||a.tagName||'').slice(0,60):null})()"
            )

        def setpad(**kw):
            a, b = state(**kw)
            page.evaluate("([a,b])=>window.__gpSetState(a,b)", [a, b])

        report["video_at_start"] = video()
        streaming = bool(report["video_at_start"] and report["video_at_start"].get("w", 0) > 0)
        report["mode"] = "drive_stream" if streaming else "navigate_library"

        # the agent loop ------------------------------------------------------
        # library mode: walk focus around with the d-pad (proves GFN's UI reacts
        # to our virtual pad). stream mode: sweep the stick + tap A/B (proves the
        # game receives input). One frame saved per step.
        lib_seq = ["DPAD_RIGHT", "DPAD_RIGHT", "DPAD_DOWN", "DPAD_LEFT", "DPAD_DOWN",
                   "DPAD_RIGHT", "DPAD_UP", "DPAD_RIGHT", "A", "B", "DPAD_DOWN", "DPAD_RIGHT"]
        for t in range(args.steps):
            f0 = focus()
            if streaming:
                # sweep the left stick through the compass + tap a face button
                ang = (t % 4)
                lx = [1.0, 0.0, -1.0, 0.0][ang]
                ly = [0.0, 1.0, 0.0, -1.0][ang]
                btns = ["A"] if t % 3 == 0 else []
                setpad(buttons=btns, lx=lx, ly=ly)
                act = f"stick=({lx:+.0f},{ly:+.0f}) {btns}"
            else:
                btn = lib_seq[t % len(lib_seq)]
                setpad(buttons=[btn])
                act = btn
            time.sleep(0.14)
            setpad()  # release
            time.sleep(0.30)
            f1 = focus()
            try:
                shot = f"{args.frames}/step_{t:02d}.png"
                page.screenshot(path=shot)
                shot_ok = os.path.getsize(shot)
            except Exception as e:
                shot_ok = f"err:{str(e)[:40]}"
            step = {"t": t, "act": act, "focus_before": f0, "focus_after": f1,
                    "focus_changed": f0 != f1, "frame_bytes": shot_ok}
            report["steps"].append(step)
            print(f"  t{t:>2} act={act:<22} focus_changed={f0 != f1} frame={shot_ok}", file=sys.stderr)

        report["video_at_end"] = video()
        # don't close the browser — it's the host's shared Chrome
    print(json.dumps(report))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
