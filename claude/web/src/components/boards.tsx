"use client";

// Shared board renderers for the Play and Live views. Driven purely by the
// `state` dict an Observation carries (keys mirror the Python envs).

const TILE_COLORS: Record<number, string> = {
  2: "#1f2937", 4: "#27364a", 8: "#3b5168", 16: "#4a6c86",
  32: "#5c87a0", 64: "#66c0f4", 128: "#7aa2f7", 256: "#8b7cf6",
  512: "#a78bfa", 1024: "#c084fc", 2048: "#facc15", 4096: "#fb923c", 8192: "#f87171",
};

export function Board2048({ state, size = 76 }: { state: Record<string, unknown>; size?: number }) {
  const board = (state.board as number[][]) ?? [];
  return (
    <div className="grid gap-2 rounded-xl bg-bg-soft p-2" style={{ gridTemplateColumns: `repeat(4, ${size}px)` }}>
      {board.flat().map((v, i) => (
        <div
          key={i}
          className="tabular flex items-center justify-center rounded-lg font-semibold transition-colors"
          style={{
            width: size, height: size, fontSize: size * 0.27,
            background: v ? TILE_COLORS[v] ?? "#facc15" : "rgba(255,255,255,0.03)",
            color: v >= 2048 ? "#04121f" : v ? "#e6edf6" : "transparent",
          }}
        >
          {v || ""}
        </div>
      ))}
    </div>
  );
}

export function SnakeBoard({ state, cell = 26 }: { state: Record<string, unknown>; cell?: number }) {
  const snake = (state.snake as number[][]) ?? [];
  const head = state.head as number[] | null;
  const food = (state.food as number[]) ?? [0, 0];
  const width = (state.width as number) ?? 12;
  const height = (state.height as number) ?? 12;
  const bodyKey = new Set(snake.map(([x, y]) => `${x},${y}`));
  const headKey = head ? `${head[0]},${head[1]}` : "";
  const foodKey = `${food[0]},${food[1]}`;
  const cells: React.ReactNode[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const k = `${x},${y}`;
      const isHead = k === headKey;
      const isBody = bodyKey.has(k) && !isHead;
      const isFood = k === foodKey;
      cells.push(
        <div
          key={k}
          style={{
            width: cell, height: cell,
            background: isHead
              ? "var(--color-ai)"
              : isBody
                ? "color-mix(in srgb, var(--color-ai) 55%, #0b1018)"
                : isFood
                  ? "var(--color-human)"
                  : "rgba(255,255,255,0.025)",
            borderRadius: isFood ? "50%" : 5,
          }}
        />
      );
    }
  }
  return (
    <div className="grid gap-[3px] rounded-xl bg-bg-soft p-3" style={{ gridTemplateColumns: `repeat(${width}, ${cell}px)` }}>
      {cells}
    </div>
  );
}

export function SokobanBoard({ state, cell = 34 }: { state: Record<string, unknown>; cell?: number }) {
  const width = (state.width as number) ?? 7;
  const height = (state.height as number) ?? 7;
  const player = state.player as number[] | undefined;
  const k = (p: number[]) => `${p[0]},${p[1]}`;
  const walls = new Set(((state.walls as number[][]) ?? []).map(k));
  const goals = new Set(((state.goals as number[][]) ?? []).map(k));
  const boxes = new Set(((state.boxes as number[][]) ?? []).map(k));
  const playerKey = player ? k(player) : "";
  const cells: React.ReactNode[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const key = `${x},${y}`;
      const isWall = walls.has(key);
      const isGoal = goals.has(key);
      const isBox = boxes.has(key);
      const isPlayer = key === playerKey;
      let bg = "transparent";
      let inner: React.ReactNode = null;
      if (isWall) bg = "#1a2434";
      else if (isBox)
        inner = (
          <div style={{ width: "72%", height: "72%", borderRadius: 4, background: isGoal ? "var(--color-good)" : "var(--color-human)", boxShadow: "inset 0 0 0 2px rgba(0,0,0,0.25)" }} />
        );
      else if (isPlayer)
        inner = <div style={{ width: "62%", height: "62%", borderRadius: "50%", background: "var(--color-brand)" }} />;
      else if (isGoal)
        inner = <div style={{ width: "30%", height: "30%", borderRadius: "50%", border: "2px solid var(--color-accent)" }} />;
      cells.push(
        <div key={key} style={{ width: cell, height: cell, display: "flex", alignItems: "center", justifyContent: "center", background: bg, borderRadius: isWall ? 4 : 0 }}>
          {inner}
        </div>
      );
    }
  }
  return (
    <div className="rounded-xl bg-bg-soft p-3">
      <div className="grid" style={{ gridTemplateColumns: `repeat(${width}, ${cell}px)` }}>
        {cells}
      </div>
    </div>
  );
}

// piece_id 1..7 => I,O,T,S,Z,J,L (classic colors)
const TETRIS_COLORS = ["transparent", "#22d3ee", "#facc15", "#a78bfa", "#4ade80", "#f87171", "#3b82f6", "#fb923c"];

export function TetrisBoard({ state, cell = 22 }: { state: Record<string, unknown>; cell?: number }) {
  const grid = ((state.grid as number[][]) ?? (state.board as number[][])) ?? [];
  const width = (state.width as number) ?? 10;
  return (
    <div className="rounded-xl bg-bg-soft p-2">
      <div className="grid gap-px" style={{ gridTemplateColumns: `repeat(${width}, ${cell}px)` }}>
        {grid.flat().map((v, i) => (
          <div
            key={i}
            style={{
              width: cell,
              height: cell,
              borderRadius: 3,
              background: v ? TETRIS_COLORS[v] ?? "#e6edf6" : "rgba(255,255,255,0.03)",
              boxShadow: v ? "inset 0 0 0 1px rgba(0,0,0,0.25)" : undefined,
            }}
          />
        ))}
      </div>
    </div>
  );
}

// classic minesweeper number colors (index = adjacent-mine count)
const MS_NUM = ["", "#3b82f6", "#4ade80", "#f87171", "#a78bfa", "#fb923c", "#22d3ee", "#e6edf6", "#8aa0bd"];

export function MinesweeperBoard({
  state,
  onCell,
  cell = 30,
}: {
  state: Record<string, unknown>;
  onCell?: (r: number, c: number) => void;
  cell?: number;
}) {
  const view = (state.view as number[][]) ?? [];
  const cols = (state.cols as number) ?? 9;
  return (
    <div className="rounded-xl bg-bg-soft p-2">
      <div className="grid gap-px" style={{ gridTemplateColumns: `repeat(${cols}, ${cell}px)` }}>
        {view.flatMap((row, r) =>
          row.map((v, c) => {
            const hidden = v === -1;
            const boom = v === -2;
            const clickable = hidden && !!onCell;
            return (
              <button
                key={`${r},${c}`}
                disabled={!clickable}
                onClick={() => clickable && onCell!(r, c)}
                style={{
                  width: cell, height: cell, fontSize: cell * 0.5, fontWeight: 800, borderRadius: 3,
                  background: boom ? "#f87171" : hidden ? "var(--color-surface-2)" : "rgba(255,255,255,0.04)",
                  color: v > 0 ? MS_NUM[v] : "transparent",
                  cursor: clickable ? "pointer" : "default",
                  border: hidden ? "1px solid var(--color-border)" : "1px solid transparent",
                }}
              >
                {boom ? "💣" : v > 0 ? v : ""}
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

export function FlappyBoard({ state, scale = 4 }: { state: Record<string, unknown>; scale?: number }) {
  const W = (state.width as number) ?? 120;
  const H = (state.height as number) ?? 80;
  const bx = (state.bird_x as number) ?? 34;
  const by = (state.bird_y as number) ?? 40;
  const gh = (state.gap_half as number) ?? 12;
  const pw = (state.pipe_w as number) ?? 8;
  const pipes = (state.pipes as { x: number; gap: number }[]) ?? [];
  const alive = (state.alive as boolean) ?? true;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={W * scale} height={H * scale} style={{ background: "#0b1018", borderRadius: 12 }}>
      {pipes.map((p, i) => (
        <g key={i} fill="var(--color-good)" opacity={0.85}>
          <rect x={p.x - pw} y={0} width={pw * 2} height={Math.max(0, p.gap - gh)} />
          <rect x={p.x - pw} y={p.gap + gh} width={pw * 2} height={Math.max(0, H - (p.gap + gh))} />
        </g>
      ))}
      <circle cx={bx} cy={by} r={2.8} fill={alive ? "var(--color-human)" : "var(--color-bad)"} />
    </svg>
  );
}

export function DodgerBoard({ state, scale = 3 }: { state: Record<string, unknown>; scale?: number }) {
  const W = (state.width as number) ?? 168;
  const H = (state.height as number) ?? 120;
  const px = (state.paddle_x as number) ?? 74;
  const py = (state.paddle_y as number) ?? 109;
  const pw = (state.paddle_w as number) ?? 20;
  const ph = (state.paddle_h as number) ?? 8;
  const hw = (state.hazard_w as number) ?? 14;
  const hh = (state.hazard_h as number) ?? 14;
  const hazards = (state.hazards as { x: number; y: number }[]) ?? [];
  const alive = (state.alive as boolean) ?? true;
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width={W * scale}
      height={H * scale}
      style={{ background: "#0b0e16", borderRadius: 12, maxWidth: "100%" }}
    >
      {hazards.map((h, i) => (
        <rect key={i} x={h.x} y={h.y} width={hw} height={hh} rx={2} fill="#f87171" opacity={0.92} />
      ))}
      <rect x={px} y={py} width={pw} height={ph} rx={2.5} fill={alive ? "#4ade80" : "#f87171"} />
    </svg>
  );
}

export function CatcherBoard({ state, scale = 3 }: { state: Record<string, unknown>; scale?: number }) {
  const W = (state.width as number) ?? 168;
  const H = (state.height as number) ?? 120;
  const px = (state.paddle_x as number) ?? 72;
  const py = (state.paddle_y as number) ?? 109;
  const pw = (state.paddle_w as number) ?? 24;
  const ph = (state.paddle_h as number) ?? 8;
  const iw = (state.item_w as number) ?? 12;
  const ih = (state.item_h as number) ?? 12;
  const items = (state.items as { x: number; y: number; kind: number }[]) ?? [];
  const alive = (state.alive as boolean) ?? true;
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width={W * scale}
      height={H * scale}
      style={{ background: "#0b0e16", borderRadius: 12, maxWidth: "100%" }}
    >
      {items.map((it, i) => (
        <rect key={i} x={it.x} y={it.y} width={iw} height={ih} rx={2} fill={it.kind === 1 ? "#f87171" : "#4ade80"} opacity={0.95} />
      ))}
      <rect x={px} y={py} width={pw} height={ph} rx={2.5} fill={alive ? "#38bdf8" : "#f87171"} />
    </svg>
  );
}

export function VolleyBoard({ state, scale = 3 }: { state: Record<string, unknown>; scale?: number }) {
  const W = (state.width as number) ?? 168;
  const H = (state.height as number) ?? 120;
  const bx = (state.ball_x as number) ?? 80;
  const by = (state.ball_y as number) ?? 12;
  const bs = (state.ball_size as number) ?? 8;
  const px = (state.paddle_x as number) ?? 71;
  const py = (state.paddle_y as number) ?? 111;
  const pw = (state.paddle_w as number) ?? 26;
  const ph = (state.paddle_h as number) ?? 6;
  const alive = (state.alive as boolean) ?? true;
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width={W * scale}
      height={H * scale}
      style={{ background: "#0b0e16", borderRadius: 12, maxWidth: "100%" }}
    >
      <rect x={bx} y={by} width={bs} height={bs} rx={2} fill="#eeeef0" />
      <rect x={px} y={py} width={pw} height={ph} rx={2.5} fill={alive ? "#38bdf8" : "#f87171"} />
    </svg>
  );
}

export function StormBoard({ state, scale = 3 }: { state: Record<string, unknown>; scale?: number }) {
  const W = (state.width as number) ?? 168;
  const H = (state.height as number) ?? 120;
  const px = (state.paddle_x as number) ?? 73;
  const py = (state.paddle_y as number) ?? 109;
  const pw = (state.paddle_w as number) ?? 22;
  const ph = (state.paddle_h as number) ?? 8;
  const bw = (state.block_w as number) ?? 12;
  const bh = (state.block_h as number) ?? 12;
  const blocks = (state.blocks as { x: number; y: number; vy: number }[]) ?? [];
  const alive = (state.alive as boolean) ?? true;
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width={W * scale}
      height={H * scale}
      style={{ background: "#0b0e16", borderRadius: 12, maxWidth: "100%" }}
    >
      {blocks.map((b, i) => (
        <rect key={i} x={b.x} y={b.y} width={bw} height={bh} rx={2} fill="#f87171" opacity={0.92} />
      ))}
      <rect x={px} y={py} width={pw} height={ph} rx={2.5} fill={alive ? "#4ade80" : "#f87171"} />
    </svg>
  );
}

export function TurretBoard({ state, scale = 3 }: { state: Record<string, unknown>; scale?: number }) {
  const W = (state.width as number) ?? 168;
  const H = (state.height as number) ?? 120;
  const cx = (state.cannon_x as number) ?? 75;
  const cy = (state.cannon_y as number) ?? 109;
  const cw = (state.cannon_w as number) ?? 18;
  const ch = (state.cannon_h as number) ?? 8;
  const tw = (state.target_w as number) ?? 14;
  const th = (state.target_h as number) ?? 12;
  const bw = (state.bullet_w as number) ?? 4;
  const bh = (state.bullet_h as number) ?? 8;
  const targets = (state.targets as { x: number; y: number }[]) ?? [];
  const bullet = state.bullet as { x: number; y: number } | null;
  const alive = (state.alive as boolean) ?? true;
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width={W * scale}
      height={H * scale}
      style={{ background: "#0b0e16", borderRadius: 12, maxWidth: "100%" }}
    >
      {targets.map((t, i) => (
        <rect key={i} x={t.x} y={t.y} width={tw} height={th} rx={2} fill="#f87171" opacity={0.92} />
      ))}
      {bullet && <rect x={bullet.x} y={bullet.y} width={bw} height={bh} rx={1} fill="#facc15" />}
      <rect x={cx} y={cy} width={cw} height={ch} rx={2.5} fill={alive ? "#4ade80" : "#f87171"} />
    </svg>
  );
}

export function ForagerBoard({ state, scale = 3 }: { state: Record<string, unknown>; scale?: number }) {
  const W = (state.width as number) ?? 168;
  const H = (state.height as number) ?? 120;
  const px = (state.player_x as number) ?? 79;
  const py = (state.player_y as number) ?? 55;
  const ps = (state.player_size as number) ?? 10;
  const gs = (state.good_size as number) ?? 8;
  const hs = (state.hazard_size as number) ?? 12;
  const goods = (state.goods as { x: number; y: number }[]) ?? [];
  const hazards = (state.hazards as { x: number; y: number }[]) ?? [];
  const alive = (state.alive as boolean) ?? true;
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width={W * scale}
      height={H * scale}
      style={{ background: "#0b0e16", borderRadius: 12, maxWidth: "100%" }}
    >
      {goods.map((g, i) => (
        <rect key={`g${i}`} x={g.x} y={g.y} width={gs} height={gs} rx={2} fill="#4ade80" />
      ))}
      {hazards.map((h, i) => (
        <rect key={`h${i}`} x={h.x} y={h.y} width={hs} height={hs} rx={2} fill="#f87171" opacity={0.92} />
      ))}
      <rect x={px} y={py} width={ps} height={ps} rx={2} fill={alive ? "#38bdf8" : "#f87171"} />
    </svg>
  );
}

export function PhantomBoard({ state, scale = 3 }: { state: Record<string, unknown>; scale?: number }) {
  const W = (state.width as number) ?? 168;
  const H = (state.height as number) ?? 120;
  const px = (state.paddle_x as number) ?? 74;
  const py = (state.paddle_y as number) ?? 109;
  const pw = (state.paddle_w as number) ?? 20;
  const ph = (state.paddle_h as number) ?? 8;
  const bw = (state.block_w as number) ?? 14;
  const bh = (state.block_h as number) ?? 14;
  const blocks = (state.blocks as { x: number; y: number }[]) ?? [];
  const alive = (state.alive as boolean) ?? true;
  const visible = (state.visible as boolean) ?? true;
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width={W * scale}
      height={H * scale}
      style={{ background: visible ? "#0b0e16" : "#140c28", borderRadius: 12, maxWidth: "100%", transition: "background 0.1s" }}
    >
      {blocks.map((b, i) => (
        <rect key={i} x={b.x} y={b.y} width={bw} height={bh} rx={2} fill="#f87171" opacity={0.92} />
      ))}
      <rect x={px} y={py} width={pw} height={ph} rx={2.5} fill={alive ? "#4ade80" : "#f87171"} />
      {!visible && (
        <text x={W / 2} y={9} fill="#7a6fb0" fontSize="7" textAnchor="middle" fontWeight="bold">BLACKOUT</text>
      )}
    </svg>
  );
}

export function RallyBoard({ state, scale = 3 }: { state: Record<string, unknown>; scale?: number }) {
  const W = (state.width as number) ?? 168;
  const H = (state.height as number) ?? 120;
  const ax = (state.agent_x as number) ?? 4;
  const ay = (state.agent_y as number) ?? 47;
  const ox = (state.opp_x as number) ?? 160;
  const oy = (state.opp_y as number) ?? 47;
  const pw = (state.paddle_w as number) ?? 4;
  const ph = (state.paddle_h as number) ?? 26;
  const bx = (state.ball_x as number) ?? 80;
  const by = (state.ball_y as number) ?? 57;
  const bs = (state.ball_size as number) ?? 6;
  const alive = (state.alive as boolean) ?? true;
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width={W * scale}
      height={H * scale}
      style={{ background: "#0b0e16", borderRadius: 12, maxWidth: "100%" }}
    >
      <line x1={W / 2} y1={0} x2={W / 2} y2={H} stroke="#1c2433" strokeWidth={1} strokeDasharray="3 4" />
      <rect x={ax} y={ay} width={pw} height={ph} rx={1.5} fill={alive ? "#4ade80" : "#f87171"} />
      <rect x={ox} y={oy} width={pw} height={ph} rx={1.5} fill="#fb923c" />
      <rect x={bx} y={by} width={bs} height={bs} rx={1.5} fill="#eeeef0" />
    </svg>
  );
}

export function Connect4Board({
  state,
  onCol,
  cell = 42,
}: {
  state: Record<string, unknown>;
  onCol?: (c: number) => void;
  cell?: number;
}) {
  const board = (state.board as number[][]) ?? [];
  const cols = (state.cols as number) ?? 7;
  const disc = ["transparent", "var(--color-human)", "var(--color-ai)"];
  return (
    <div className="rounded-xl bg-bg-soft p-3">
      {onCol && (
        <div className="mb-2 grid gap-1.5" style={{ gridTemplateColumns: `repeat(${cols}, ${cell}px)` }}>
          {Array.from({ length: cols }, (_, c) => {
            const full = board[0]?.[c] !== 0;
            return (
              <button
                key={c}
                disabled={full}
                onClick={() => onCol(c)}
                className="rounded-md border border-border-soft bg-surface-2 text-brand transition hover:border-brand disabled:opacity-30"
                style={{ height: cell * 0.55, cursor: full ? "default" : "pointer" }}
              >
                ↓
              </button>
            );
          })}
        </div>
      )}
      <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${cols}, ${cell}px)` }}>
        {board.flat().map((v, i) => (
          <div
            key={i}
            style={{
              width: cell, height: cell, borderRadius: "50%",
              background: v ? disc[v] : "rgba(255,255,255,0.05)",
              boxShadow: v ? "inset 0 0 0 2px rgba(0,0,0,0.25)" : "inset 0 0 0 1px var(--color-border-soft)",
            }}
          />
        ))}
      </div>
    </div>
  );
}

export function AnyBoard({
  envId,
  state,
  onCell,
  onCol,
}: {
  envId: string;
  state: Record<string, unknown>;
  onCell?: (r: number, c: number) => void;
  onCol?: (c: number) => void;
}) {
  if (envId.includes("snake")) return <SnakeBoard state={state} />;
  if (envId.includes("sokoban")) return <SokobanBoard state={state} />;
  if (envId.includes("tetris")) return <TetrisBoard state={state} />;
  if (envId.includes("minesweeper")) return <MinesweeperBoard state={state} onCell={onCell} />;
  if (envId.includes("flappy")) return <FlappyBoard state={state} />;
  if (envId.includes("dodger")) return <DodgerBoard state={state} />;
  if (envId.includes("catcher")) return <CatcherBoard state={state} />;
  if (envId.includes("volley")) return <VolleyBoard state={state} />;
  if (envId.includes("storm")) return <StormBoard state={state} />;
  if (envId.includes("turret")) return <TurretBoard state={state} />;
  if (envId.includes("forager")) return <ForagerBoard state={state} />;
  if (envId.includes("phantom")) return <PhantomBoard state={state} />;
  if (envId.includes("rally")) return <RallyBoard state={state} />;
  if (envId.includes("connect4")) return <Connect4Board state={state} onCol={onCol} />;
  return <Board2048 state={state} />;
}
