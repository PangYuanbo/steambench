"use client";

import { useEffect, useRef, useState } from "react";

// CUA input test harness — live readouts for mouse / keyboard / gamepad. This is
// the same surface our E2B daemon drives (POST /mouse /key /pad) to verify the
// computer-use I/O pipeline end-to-end. It also exposes window.__state() so the
// harness can read the registered state back programmatically, exactly like the
// in-sandbox test page (runtime/e2b_browser_daemon.py TEST_PAGE_HTML).

type State = {
  mouse: { clientX: number; clientY: number; lastButton: number | null; clicks: number; targetHits: number };
  keyboard: { last: string | null; count: number; log: string[] };
  gamepad: { connected: boolean; id: string | null; pressed: number[]; axes: number[] };
};

export default function CuaTestPage() {
  const S = useRef<State>({
    mouse: { clientX: 0, clientY: 0, lastButton: null, clicks: 0, targetHits: 0 },
    keyboard: { last: null, count: 0, log: [] },
    gamepad: { connected: false, id: null, pressed: [], axes: [] },
  });
  const targetRef = useRef<HTMLDivElement>(null);
  const [, force] = useState(0);
  const render = () => force((n) => n + 1);

  useEffect(() => {
    const s = S.current;
    (window as Window & { __state?: () => State; __cuaReset?: () => void }).__state = () => s;
    (window as Window & { __cuaReset?: () => void }).__cuaReset = () => {
      s.mouse.clicks = 0; s.mouse.targetHits = 0;
      s.keyboard.count = 0; s.keyboard.log = []; s.keyboard.last = null;
      render();
    };

    const onMove = (e: MouseEvent) => { s.mouse.clientX = e.clientX; s.mouse.clientY = e.clientY; render(); };
    const onDown = (e: MouseEvent) => {
      s.mouse.lastButton = e.button; s.mouse.clientX = e.clientX; s.mouse.clientY = e.clientY; s.mouse.clicks++;
      const t = targetRef.current?.getBoundingClientRect();
      if (t && e.clientX >= t.left && e.clientX <= t.right && e.clientY >= t.top && e.clientY <= t.bottom) s.mouse.targetHits++;
      render();
    };
    const onKey = (e: KeyboardEvent) => {
      s.keyboard.last = e.key; s.keyboard.count++; s.keyboard.log.push(e.key);
      if (s.keyboard.log.length > 12) s.keyboard.log.shift();
      if ([" ", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Tab"].includes(e.key)) e.preventDefault();
      render();
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);

    const iv = window.setInterval(() => {
      const g = navigator.getGamepads?.()[0];
      if (g) {
        s.gamepad.connected = true; s.gamepad.id = g.id;
        s.gamepad.pressed = g.buttons.map((b, i) => (b.pressed ? i : -1)).filter((i) => i >= 0);
        s.gamepad.axes = g.axes.map((a) => +a.toFixed(2));
      } else {
        s.gamepad.connected = false;
      }
      render();
    }, 80);

    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
      window.clearInterval(iv);
    };
  }, []);

  const s = S.current;
  const big = "text-3xl font-bold text-brand tabular";
  return (
    <div className="mx-auto max-w-5xl px-6 py-12 font-mono">
      <h1 className="text-2xl font-semibold tracking-tight">CUA input test harness</h1>
      <p className="mt-2 max-w-2xl text-sm text-muted">
        Live mouse / keyboard / gamepad readouts. The benchmark&apos;s E2B daemon drives this
        surface (<code>POST /mouse /key /pad</code>) and reads <code>window.__state()</code> back to
        verify the computer-use I/O pipeline end-to-end — the same primitives a CUA framework
        (screenshot + click + type + keypress) relies on, plus a virtual gamepad.
      </p>

      <div className="mt-8 space-y-px overflow-hidden rounded-xl border border-border">
        <Panel label="MOUSE">
          move <span className={big}>{s.mouse.clientX},{s.mouse.clientY}</span>{"  "}
          lastclick <span className={big}>{s.mouse.lastButton ?? "-"}@{s.mouse.clientX},{s.mouse.clientY}</span>{"  "}
          clicks <span className={big}>{s.mouse.clicks}</span>{"  "}
          target hits <span className={big}>{s.mouse.targetHits}</span>
        </Panel>
        <Panel label="KEYBOARD">
          last <span className={big}>{s.keyboard.last ?? "-"}</span>{"  "}
          count <span className={big}>{s.keyboard.count}</span>{"  "}
          <span className="text-base text-amber-400">{s.keyboard.log.join(" ")}</span>
        </Panel>
        <Panel label="GAMEPAD">
          <span className={`${big} ${s.gamepad.connected ? "text-good" : "text-faint"}`}>
            {s.gamepad.connected ? "CONNECTED" : "disconnected"}
          </span>{"  "}
          btns <span className="text-amber-400">{JSON.stringify(s.gamepad.pressed)}</span>{"  "}
          axes <span className="text-amber-400">{JSON.stringify(s.gamepad.axes)}</span>
        </Panel>
      </div>

      <div
        ref={targetRef}
        className="mt-10 flex h-24 w-24 items-center justify-center rounded-full border-4 border-amber-400 text-xs text-amber-400"
      >
        TARGET
      </div>
      <p className="mt-3 text-xs text-faint">Click the TARGET to register a hit. Connect a gamepad (or have the daemon inject one) to see buttons/axes.</p>
    </div>
  );
}

function Panel({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="bg-bg-soft px-5 py-4">
      <div className="text-xs uppercase tracking-[0.14em] text-faint">{label}</div>
      <div className="mt-1 leading-relaxed">{children}</div>
    </div>
  );
}
