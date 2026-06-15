"""Probe: can GeForce NOW's web client run in a headless, **no-GPU** container?

The host side of GFN needs no rendering GPU (NVIDIA renders in the cloud) — only
a screen + input + video *decode*. This checks the make-or-break for hosting GFN
on cheap no-GPU compute: does play.geforcenow.com load in headless Chrome on a
Modal container, does our injected virtual gamepad survive, and can we capture a
(non-black) frame? (Pre-login — the in-game WebRTC stream still needs the user's
account, but this de-risks the container/headless/capture path itself.)

    modal run runtime/gfn_modal_probe.py
"""

import modal

app = modal.App("gfn-probe")

image = (
    modal.Image.debian_slim()
    .pip_install("playwright==1.60.0")
    .run_commands("playwright install-deps chromium", "playwright install chromium")
)

# Minimal virtual-gamepad injection (same technique as runtime/gfn_browser.py).
INIT = r"""
(() => {
  const mk = () => Array.from({length:17},()=>({pressed:false,touched:false,value:0}));
  const pad = {id:'Xbox 360 Controller (XInput STANDARD GAMEPAD)',index:0,connected:true,
    mapping:'standard',timestamp:performance.now(),axes:[0,0,0,0],buttons:mk(),vibrationActuator:null};
  window.__gpPad = pad;
  const gg = function getGamepads(){ return [pad,null,null,null]; };
  try { Object.defineProperty(Navigator.prototype,'getGamepads',{value:gg,writable:true,configurable:true}); }
  catch(e){ try{ navigator.getGamepads = gg; }catch(_){} }
})();
"""


@app.function(image=image, timeout=240, cpu=4, memory=4096)
def probe() -> dict:
    from playwright.sync_api import sync_playwright

    out: dict = {}
    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=True,
            args=["--no-sandbox", "--disable-blink-features=AutomationControlled",
                  "--use-gl=swiftshader", "--enable-unsafe-swiftshader"],
        )
        page = browser.new_page(viewport={"width": 1280, "height": 720})
        page.add_init_script(INIT)
        try:
            page.goto("https://play.geforcenow.com/", wait_until="domcontentloaded", timeout=90000)
        except Exception as e:
            return {"error": f"goto failed: {str(e)[:160]}"}
        page.wait_for_timeout(8000)
        try:
            out = page.evaluate(
                "(() => { const g = navigator.getGamepads && navigator.getGamepads()[0];"
                " return { url: location.href.slice(0,80), title: document.title.slice(0,60),"
                " padSurvived: !!(g && g.mapping==='standard'),"
                " hasVideo: !!document.querySelector('video'),"
                " bodyLen: document.body ? document.body.innerText.length : 0 }; })()"
            )
        except Exception as e:
            out = {"evaluate_error": str(e)[:160]}
        try:
            shot = page.screenshot()
            # crude non-black check via average byte (PNG header aside) isn't exact;
            # ship size + a decoded mean if PIL present.
            out["shot_bytes"] = len(shot)
            try:
                import io
                from PIL import Image

                im = Image.open(io.BytesIO(shot)).convert("L").resize((32, 32))
                px = list(im.getdata())
                out["shot_mean_luma"] = round(sum(px) / len(px), 1)  # >8 ≈ not black
            except Exception:
                pass
        except Exception as e:
            out["screenshot_error"] = str(e)[:160]
        browser.close()
    return out


@app.local_entrypoint()
def main():
    import json

    print(json.dumps(probe.remote(), indent=2, ensure_ascii=False))
