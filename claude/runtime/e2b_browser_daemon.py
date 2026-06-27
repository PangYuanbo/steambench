#!/usr/bin/env python3
"""In-sandbox browser control daemon — the bridge a remote (Modal) agent talks to.

Chrome's CDP /json endpoint rejects non-localhost Host headers, so a remote agent
can't drive it directly. This daemon runs *inside* the E2B sandbox, attaches to
the local Chrome over CDP (localhost:9222), injects a W3C-standard virtual
gamepad, and exposes a clean HTTP API that anything on the internet can call:

    GET  /health  -> {"ok":true,"mode":...,"url":...}
    GET  /frame   -> image/png   (the canvas, or the <video>/page)
    GET  /state   -> game state json (demo game exposes window.__state)
    POST /pad     -> {"axes":[lx,ly,rx,ry], "buttons":[17 floats]}  applies gamepad

Single-threaded on purpose: Playwright's sync API must be used from its creating
thread, so all page.evaluate calls happen in the one serve_forever thread.

    # demo: load a loginless gamepad mini-game and serve it
    python3 e2b_browser_daemon.py --cdp http://localhost:9222 --mode demo --port 8765
    # gfn: attach to the already-open GeForce NOW page (no navigation)
    python3 e2b_browser_daemon.py --cdp http://localhost:9222 --mode gfn --port 8765
"""
from __future__ import annotations

import argparse
import json
import urllib.parse
from http.server import BaseHTTPRequestHandler, HTTPServer

GAMEPAD_INIT_JS = r"""
(() => {
  const mkButtons = () => Array.from({length: 17}, () => ({pressed: false, touched: false, value: 0}));
  const pad = {id: 'Xbox 360 Controller (XInput STANDARD GAMEPAD)', index: 0, connected: true,
    mapping: 'standard', timestamp: performance.now(), axes: [0,0,0,0], buttons: mkButtons(), vibrationActuator: null};
  const bump = () => { pad.timestamp = performance.now(); };
  window.__gpPad = pad;
  window.__gpSetState = (axes, buttons) => {
    if (axes) for (let i=0;i<axes.length;i++) pad.axes[i]=axes[i];
    if (buttons) for (let i=0;i<buttons.length;i++){ const v=(typeof buttons[i]==='number')?buttons[i]:(buttons[i]?1:0);
      pad.buttons[i].value=v; pad.buttons[i].pressed=v>=0.5; pad.buttons[i].touched=v>0; }
    bump();
  };
  window.__gpFireConnected = () => { const e=new Event('gamepadconnected'); e.gamepad=pad; window.dispatchEvent(e); };
  const gg = function getGamepads(){ return [pad,null,null,null]; };
  try { Object.defineProperty(Navigator.prototype,'getGamepads',{value:gg,writable:true,configurable:true}); }
  catch(e1){ try{ Object.defineProperty(navigator,'getGamepads',{value:gg,writable:true,configurable:true}); }
    catch(e2){ try{ navigator.getGamepads=gg; }catch(e3){} } }
  try { navigator.webkitGetGamepads = gg; } catch(e){}
})();
"""

# A loginless mini-game that reads navigator.getGamepads() exactly as GFN does:
# a cyan paddle (steered by left stick / d-pad) catches falling yellow targets.
# Distinct flat colors so a simple vision agent can locate paddle + target.
DEMO_GAME = r"""<!doctype html><meta charset=utf8><body style="margin:0;background:#0b1018">
<canvas id=c width=640 height=360></canvas><script>
let px=320, score=0, misses=0, tick=0, targets=[];
const ctx=document.getElementById('c').getContext('2d');
window.__state=()=>({score,misses,paddleX:Math.round(px),
  targets:targets.map(t=>({x:Math.round(t.x),y:Math.round(t.y)}))});
setInterval(()=>{
  tick++;
  const g=navigator.getGamepads&&navigator.getGamepads()[0];
  let dx=0;
  if(g){ dx=g.axes[0]||0;
    if(g.buttons[14]&&g.buttons[14].pressed)dx=-1;
    if(g.buttons[15]&&g.buttons[15].pressed)dx=1; }
  px+=dx*7; px=Math.max(44,Math.min(596,px));
  if(tick%48===0) targets.push({x:44+Math.random()*552,y:-10,v:2.4});
  for(const t of targets) t.y+=t.v;
  for(let i=targets.length-1;i>=0;i--){ const t=targets[i];
    if(t.y>=332){ if(Math.abs(t.x-px)<48) score++; else misses++; targets.splice(i,1); } }
  ctx.fillStyle='#0b1018'; ctx.fillRect(0,0,640,360);
  ctx.fillStyle='#facc15'; for(const t of targets){ ctx.beginPath(); ctx.arc(t.x,t.y,11,0,7); ctx.fill(); }
  ctx.fillStyle='#22d3ee'; ctx.fillRect(px-46,340,92,14);
  ctx.fillStyle='#e5e7eb'; ctx.font='18px monospace';
  ctx.fillText('score '+score+'   miss '+misses,14,26);
},33);
</script></body>"""

# CUA I/O self-test page: live readouts for mouse / keyboard / gamepad, plus a
# machine-readable window.__state() (so the harness can verify each input channel
# end-to-end). Big high-contrast text so the readouts survive a stream screenshot.
TEST_PAGE_HTML = r"""<!doctype html><html><head><meta charset=utf8><title>CUA IO Test</title>
<style>
 body{margin:0;font-family:monospace;background:#0b1020;color:#e5e7eb;font-size:24px}
 .panel{padding:18px 22px;border-bottom:2px solid #1f2a44}
 .lbl{color:#8aa;font-size:18px}
 .big{font-size:40px;color:#22d3ee;font-weight:bold}
 .ok{color:#4ade80}
 #target{position:fixed;left:240px;top:560px;width:90px;height:90px;border:4px solid #facc15;border-radius:50%;
   display:flex;align-items:center;justify-content:center;color:#facc15;font-size:16px}
</style></head><body tabindex=0>
<div class=panel><div class=lbl>MOUSE</div>
  move <span class=big id=mxy>-</span>&nbsp; lastclick <span class=big id=mc>-</span>&nbsp; clicks <span class=big id=mn>0</span></div>
<div class=panel><div class=lbl>KEYBOARD</div>
  last <span class=big id=klast>-</span>&nbsp; count <span class=big id=kn>0</span>&nbsp; <span id=klog style="font-size:22px;color:#fde68a"></span></div>
<div class=panel><div class=lbl>GAMEPAD</div>
  <span class=big id=gc>disconnected</span>&nbsp; btns <span id=gb style=color:#fde68a>-</span>&nbsp; axes <span id=ga style=color:#fde68a>-</span></div>
<div id=target>TARGET</div>
<script>
const S={mouse:{clientX:0,clientY:0,screenX:0,screenY:0,lastButton:null,clicks:0,targetHits:0},
  keyboard:{last:null,count:0,log:[]},
  gamepad:{connected:false,id:null,pressed:[],axes:[]}};
window.__state=()=>S;
window.__cuaReset=()=>{S.mouse.clicks=0;S.mouse.targetHits=0;S.keyboard.count=0;S.keyboard.log=[];S.keyboard.last=null;};
const $=id=>document.getElementById(id);
addEventListener('mousemove',e=>{S.mouse.clientX=e.clientX;S.mouse.clientY=e.clientY;S.mouse.screenX=e.screenX;S.mouse.screenY=e.screenY;
  $('mxy').textContent=e.clientX+','+e.clientY;});
addEventListener('mousedown',e=>{S.mouse.lastButton=e.button;S.mouse.clientX=e.clientX;S.mouse.clientY=e.clientY;S.mouse.clicks++;
  const t=$('target').getBoundingClientRect();
  if(e.clientX>=t.left&&e.clientX<=t.right&&e.clientY>=t.top&&e.clientY<=t.bottom)S.mouse.targetHits++;
  $('mc').textContent=e.button+'@'+e.clientX+','+e.clientY;$('mn').textContent=S.mouse.clicks;});
addEventListener('keydown',e=>{S.keyboard.last=e.key;S.keyboard.count++;S.keyboard.log.push(e.key);if(S.keyboard.log.length>12)S.keyboard.log.shift();
  $('klast').textContent=e.key;$('kn').textContent=S.keyboard.count;$('klog').textContent=S.keyboard.log.join(' ');e.preventDefault();});
setInterval(()=>{const g=navigator.getGamepads&&navigator.getGamepads()[0];
  if(g){S.gamepad.connected=true;S.gamepad.id=g.id;
    S.gamepad.pressed=g.buttons.map((b,i)=>b.pressed?i:-1).filter(i=>i>=0);
    S.gamepad.axes=g.axes.map(a=>+a.toFixed(2));
    $('gc').textContent='CONNECTED';$('gc').className='big ok';
    $('gb').textContent=JSON.stringify(S.gamepad.pressed);$('ga').textContent=JSON.stringify(S.gamepad.axes);}
  else{S.gamepad.connected=false;$('gc').textContent='disconnected';$('gc').className='big';}
},50);
window.focus();document.body.focus();
</script></body></html>"""


class Daemon:
    def __init__(self, cdp: str, mode: str):
        from playwright.sync_api import sync_playwright

        self.mode = mode
        self._pw = sync_playwright().start()
        self.browser = self._pw.chromium.connect_over_cdp(cdp)
        pages = [pg for c in self.browser.contexts for pg in c.pages]
        if mode == "gfn":
            # prefer the page that actually holds a playing <video> (the live
            # game stream); fall back to any geforcenow page, then the first page.
            def has_video(pg):
                try:
                    v = pg.evaluate("(()=>{const v=document.querySelector('video');"
                                    "return !!(v && v.videoWidth>0 && !v.paused)})()")
                    return bool(v)
                except Exception:
                    return False
            self.page = (next((p for p in pages if has_video(p)), None)
                         or next((p for p in pages if "geforcenow" in (p.url or "")), None)
                         or (pages[0] if pages else None))
            if self.page is None:
                self.page = self.browser.contexts[0].new_page()
            if "geforcenow" not in (self.page.url or ""):
                try:
                    self.page.goto("https://play.geforcenow.com/", wait_until="domcontentloaded")
                except Exception:
                    pass
        elif mode == "test":  # CUA I/O self-test page
            self.page = pages[0] if pages else self.browser.contexts[0].new_page()
            self.page.goto("data:text/html;charset=utf-8," + urllib.parse.quote(TEST_PAGE_HTML))
            self.page.wait_for_timeout(150)
        else:  # demo: load the mini-game into the first page
            self.page = pages[0] if pages else self.browser.contexts[0].new_page()
            self.page.goto("data:text/html;charset=utf-8," + urllib.parse.quote(DEMO_GAME))
            self.page.wait_for_timeout(150)
        # Pre-grant clipboard permission so GFN's clipboard-sync never pops the
        # "wants to see clipboard" prompt (which can't be reliably dismissed
        # through the stream and re-appears every time the page reads clipboard).
        try:
            self.browser.contexts[0].grant_permissions(
                ["clipboard-read", "clipboard-write"],
                origin="https://play.geforcenow.com",
            )
        except Exception:
            pass

        self.page.evaluate(GAMEPAD_INIT_JS)
        self.page.evaluate("window.__gpFireConnected && window.__gpFireConnected()")

    def set_pad(self, axes, buttons):
        self.page.evaluate("([a,b]) => window.__gpSetState && window.__gpSetState(a,b)", [axes, buttons])

    # Playwright key names for common aliases (so callers can use simple names).
    _PWKEY = {"space": "Space", "return": "Enter", "enter": "Enter", "escape": "Escape",
              "esc": "Escape", "up": "ArrowUp", "down": "ArrowDown", "left": "ArrowLeft",
              "right": "ArrowRight", "tab": "Tab", "shift_r": "ShiftRight",
              "shift_l": "ShiftLeft", "ctrl": "Control", "backspace": "Backspace"}

    def key(self, action: str, key: str, hold: float = 0.0):
        """Keyboard via Playwright/CDP — dispatches synthetic key events straight
        to the page's renderer, so it works WITHOUT OS window focus (xdotool
        needs the X window focused, which the headless Xvfb desktop doesn't
        reliably grant). action: 'tap','hold','down','up'."""
        import time as _t
        k = self._PWKEY.get(key.lower(), key)
        kb = self.page.keyboard
        if action == "hold":
            kb.down(k); _t.sleep(hold); kb.up(k)
        elif action == "down":
            kb.down(k)
        elif action == "up":
            kb.up(k)
        else:
            kb.press(k)

    def mouse(self, action: str, x=None, y=None, button: int = 1, hold: float = 0.0):
        """Mouse via Playwright/CDP — coordinates are PAGE/viewport pixels (no
        desktop->page mapping needed, unlike xdotool). action: 'move','click',
        'doubleclick','down','up'. button 1=left 2=middle 3=right."""
        btn = {1: "left", 2: "middle", 3: "right"}.get(int(button), "left")
        ms = self.page.mouse
        if x is not None and y is not None:
            ms.move(float(x), float(y))
        if action == "click":
            ms.click(float(x), float(y), button=btn)
        elif action == "doubleclick":
            ms.dblclick(float(x), float(y), button=btn)
        elif action == "down":
            ms.down(button=btn)
        elif action == "up":
            ms.up(button=btn)

    def _desktop_capture(self) -> bytes:
        """Capture the whole X display — the only way to get a NON-black frame of
        the GFN WebRTC <video> on a no-GPU/swiftshader desktop (page.screenshot
        reads the GPU overlay and comes back black)."""
        import os
        import subprocess

        out = "/home/user/_cap.png"
        env = {**os.environ, "DISPLAY": ":0"}
        for cmd in (["scrot", "-z", "-o", out],
                    ["import", "-window", "root", out],
                    ["ffmpeg", "-y", "-f", "x11grab", "-i", ":0", "-frames:v", "1", out]):
            try:
                subprocess.run(cmd, env=env, timeout=10, check=True,
                               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                with open(out, "rb") as f:
                    return f.read()
            except Exception:
                continue
        return b""

    def frame(self) -> bytes:
        if self.mode == "gfn":
            png = self._desktop_capture()
            if png:
                return png
            # fall through to in-page screenshot if desktop capture is unavailable
        try:
            box = self.page.evaluate(
                "(()=>{const c=document.querySelector('canvas')||document.querySelector('video');"
                "if(!c)return null;const r=c.getBoundingClientRect();"
                "return{x:r.x,y:r.y,width:r.width,height:r.height}})()"
            )
        except Exception:
            box = None
        if box and box["width"] > 4 and box["height"] > 4:
            return self.page.screenshot(clip=box)
        return self.page.screenshot()

    def state(self):
        try:
            return self.page.evaluate("window.__state ? window.__state() : null")
        except Exception:
            return None

    def url(self):
        try:
            return self.page.url
        except Exception:
            return None


def make_handler(d: Daemon):
    class H(BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def _send(self, code, body, ctype="application/json"):
            self.send_response(code)
            self.send_header("Content-Type", ctype)
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            if self.path.startswith("/health"):
                self._send(200, json.dumps({"ok": True, "mode": d.mode, "url": d.url()}).encode())
            elif self.path.startswith("/frame"):
                self._send(200, d.frame(), "image/png")
            elif self.path.startswith("/state"):
                self._send(200, json.dumps(d.state()).encode())
            else:
                self._send(404, b'{"error":"not found"}')

        def do_POST(self):
            n = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(n) or b"{}"
            if self.path.startswith("/pad"):
                try:
                    req = json.loads(body)
                    d.set_pad(req.get("axes", [0, 0, 0, 0]), req.get("buttons", [0] * 17))
                    self._send(200, b'{"ok":true}')
                except Exception as e:
                    self._send(500, json.dumps({"error": str(e)[:120]}).encode())
            elif self.path.startswith("/key"):
                try:
                    req = json.loads(body)
                    d.key(req.get("action", "tap"), req["key"], float(req.get("hold", 0.0)))
                    self._send(200, b'{"ok":true}')
                except Exception as e:
                    self._send(500, json.dumps({"error": str(e)[:120]}).encode())
            elif self.path.startswith("/mouse"):
                try:
                    req = json.loads(body)
                    d.mouse(req.get("action", "click"), req.get("x"), req.get("y"),
                            int(req.get("button", 1)), float(req.get("hold", 0.0)))
                    self._send(200, b'{"ok":true}')
                except Exception as e:
                    self._send(500, json.dumps({"error": str(e)[:120]}).encode())
            else:
                self._send(404, b'{"error":"not found"}')

    return H


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cdp", default="http://localhost:9222")
    ap.add_argument("--mode", default="demo", choices=["demo", "gfn", "test"])
    ap.add_argument("--port", type=int, default=8765)
    args = ap.parse_args()

    d = Daemon(args.cdp, args.mode)
    srv = HTTPServer(("0.0.0.0", args.port), make_handler(d))
    print(f"daemon up: mode={args.mode} port={args.port} page={d.url()}", flush=True)
    srv.serve_forever()


if __name__ == "__main__":
    main()
