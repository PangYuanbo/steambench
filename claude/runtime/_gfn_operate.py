"""One-off: find the GFN page that actually holds the streaming <video>, inject
the gamepad there, and drive the Worms W.M.D menu to prove input reaches the
streamed game. Captures the desktop (scrot) before/after each press."""
import json
import os
import subprocess
import time

from playwright.sync_api import sync_playwright

INIT = r"""
(() => {
  const mk = () => Array.from({length:17},()=>({pressed:false,touched:false,value:0}));
  const pad = {id:'Xbox 360 Controller (XInput STANDARD GAMEPAD)',index:0,connected:true,
    mapping:'standard',timestamp:performance.now(),axes:[0,0,0,0],buttons:mk(),vibrationActuator:null};
  const bump=()=>{pad.timestamp=performance.now();};
  window.__gpPad=pad;
  window.__gpSetState=(axes,buttons)=>{
    if(axes)for(let i=0;i<axes.length;i++)pad.axes[i]=axes[i];
    if(buttons)for(let i=0;i<buttons.length;i++){const v=(typeof buttons[i]==='number')?buttons[i]:(buttons[i]?1:0);
      pad.buttons[i].value=v;pad.buttons[i].pressed=v>=0.5;pad.buttons[i].touched=v>0;}
    bump();
  };
  window.__gpFireConnected=()=>{const e=new Event('gamepadconnected');e.gamepad=pad;window.dispatchEvent(e);};
  const gg=function getGamepads(){return [pad,null,null,null];};
  try{Object.defineProperty(Navigator.prototype,'getGamepads',{value:gg,writable:true,configurable:true});}
  catch(e){try{navigator.getGamepads=gg;}catch(_){}}
})();
"""
IDX = {"A":0,"B":1,"X":2,"Y":3,"LB":4,"RB":5,"BACK":8,"START":9,
       "DPAD_UP":12,"DPAD_DOWN":13,"DPAD_LEFT":14,"DPAD_RIGHT":15}


def cap(name):
    out = f"/home/user/{name}.png"
    subprocess.run(["scrot","-z","-o",out], env={**os.environ,"DISPLAY":":0"},
                   timeout=10, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    return out


def main():
    p = sync_playwright().start()
    b = p.chromium.connect_over_cdp("http://localhost:9222")
    pages = [pg for c in b.contexts for pg in c.pages]
    info, target = [], None
    for pg in pages:
        try:
            v = pg.evaluate("(()=>{const v=document.querySelector('video');"
                            "return v?{w:v.videoWidth,h:v.videoHeight,ready:v.readyState,paused:v.paused}:null})()")
        except Exception as e:
            v = {"err": str(e)[:40]}
        info.append({"url": (pg.url or "")[:55], "video": v})
        if isinstance(v, dict) and v.get("w", 0) > 0:
            target = pg
    print("PAGES:", json.dumps(info, ensure_ascii=False))
    if not target:
        print("NO_VIDEO_PAGE"); return
    print("TARGET:", (target.url or "")[:60])
    target.bring_to_front()
    target.evaluate(INIT)
    target.evaluate("window.__gpFireConnected && window.__gpFireConnected()")
    # confirm the page sees our pad
    pad = target.evaluate("(()=>{const g=navigator.getGamepads()[0];return g?{id:g.id,mapping:g.mapping}:null})()")
    print("PAD_ON_PAGE:", json.dumps(pad))

    def press(btn, hold=0.25):
        a = [0,0,0,0]; bs = [0.0]*17; bs[IDX[btn]] = 1.0
        target.evaluate("([a,b])=>window.__gpSetState(a,b)", [a, bs])
        time.sleep(hold)
        target.evaluate("([a,b])=>window.__gpSetState(a,b)", [[0,0,0,0], [0.0]*17])

    cap("op0")
    seq = ["DPAD_DOWN","DPAD_DOWN","DPAD_UP","A"]
    for i, btn in enumerate(seq):
        press(btn)
        time.sleep(1.0)   # let the input round-trip through the cloud + stream back
        cap(f"op{i+1}")
        print(f"pressed {btn} -> op{i+1}.png")


if __name__ == "__main__":
    main()
