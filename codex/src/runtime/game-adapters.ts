import type { BenchmarkTask, GameCatalogEntry } from "../benchmark/types";

export type RuntimeGameAdapter = {
  appid: number;
  gameName: string;
  launchUri: string;
  installHint: string;
  inputMode: "keyboard-mouse" | "controller" | "turn-based-actions";
  captureMode: "screen-recording" | "replay-or-screen" | "stats-screen";
  saveStrategy: "fresh-profile" | "seeded-save" | "published-seed" | "account-progress";
  readinessChecks: string[];
  agentLoopHints: string[];
  evidenceHints: string[];
};

const fallbackAdapter = (task: Pick<BenchmarkTask, "appid" | "gameName" | "track">): RuntimeGameAdapter => ({
  appid: task.appid,
  gameName: task.gameName,
  launchUri: `steam://run/${task.appid}`,
  installHint: `Install Steam app ${task.appid} before dispatch.`,
  inputMode: task.track === "stat" || task.track === "leaderboard" ? "turn-based-actions" : "keyboard-mouse",
  captureMode: task.track === "stat" ? "stats-screen" : "screen-recording",
  saveStrategy: task.track === "achievement" ? "account-progress" : "fresh-profile",
  readinessChecks: [
    "Steam client is online or in a prepared offline mode.",
    "The game window is focused and visible to the capture process.",
    "The output directory exists without deleting existing artifacts."
  ],
  agentLoopHints: [
    "Observe the current screen state before each action batch.",
    "Emit checkpoint events when the objective state changes.",
    "Stop when the proof condition or time cap is reached."
  ],
  evidenceHints: [
    "Record the full attempt to output/output.mp4.",
    "Capture final score or proof screen before shutting down."
  ]
});

const adapters: Record<number, RuntimeGameAdapter> = {
  620: {
    appid: 620,
    gameName: "Portal 2",
    launchUri: "steam://run/620",
    installHint: "Install Portal 2 and preload the single-player campaign test profile.",
    inputMode: "keyboard-mouse",
    captureMode: "screen-recording",
    saveStrategy: "seeded-save",
    readinessChecks: [
      "Portal 2 launches to the requested chamber or save slot.",
      "Mouse capture is active and the crosshair is visible.",
      "Timer overlay or event timestamps are available for capture tasks."
    ],
    agentLoopHints: [
      "Use short mouse-look and movement bursts; re-observe after every portal placement.",
      "Prefer deterministic route scripts for early chambers, then fall back to visual planning.",
      "Emit checkpoints at chamber load, key object interaction, and exit trigger."
    ],
    evidenceHints: [
      "Record from chamber load through exit trigger.",
      "Keep audio/video continuous so timing review is possible."
    ]
  },
  646570: {
    appid: 646570,
    gameName: "Slay the Spire",
    launchUri: "steam://run/646570",
    installHint: "Install Slay the Spire with a clean profile and seeded-run support.",
    inputMode: "turn-based-actions",
    captureMode: "replay-or-screen",
    saveStrategy: "published-seed",
    readinessChecks: [
      "Seed, character, and ascension are set before the first decision.",
      "Game speed is fixed and combat logs are available where possible.",
      "The run starts from a fresh seed with no mid-run reload."
    ],
    agentLoopHints: [
      "Represent each decision as a discrete action with card/relic context.",
      "Emit checkpoints at act transitions, boss fights, and final score screen.",
      "Prefer action logs over pixel-only reasoning when available."
    ],
    evidenceHints: [
      "Capture seed and ascension settings.",
      "Attach score screen, action log, and output/output.mp4."
    ]
  },
  413150: {
    appid: 413150,
    gameName: "Stardew Valley",
    launchUri: "steam://run/413150",
    installHint: "Install Stardew Valley with a standardized farm save template.",
    inputMode: "keyboard-mouse",
    captureMode: "stats-screen",
    saveStrategy: "seeded-save",
    readinessChecks: [
      "Farm seed and save template hash match the task contract.",
      "Clock, inventory, and gold counter are readable in capture.",
      "No mods or DLC-only state are enabled unless the task contract allows them."
    ],
    agentLoopHints: [
      "Plan route segments around in-game time, stamina, inventory, and sale cutoffs.",
      "Emit checkpoints at tool pickup, first sale, and day-end summary.",
      "Use conservative pathing when stamina or inventory is near a hard constraint."
    ],
    evidenceHints: [
      "Capture the day-end summary and save metadata.",
      "Attach save hash plus output/output.mp4."
    ]
  },
  1145360: {
    appid: 1145360,
    gameName: "Hades",
    launchUri: "steam://run/1145360",
    installHint: "Install Hades with the standardized save state and graphics settings.",
    inputMode: "controller",
    captureMode: "screen-recording",
    saveStrategy: "seeded-save",
    readinessChecks: [
      "Weapon, mirror state, and boon seed match the task contract.",
      "Controller or keyboard bindings are reset to the benchmark preset.",
      "Combat HUD and timer are visible in capture."
    ],
    agentLoopHints: [
      "Run a tight observe-act loop for enemy telegraphs and dash cooldowns.",
      "Emit checkpoints at chamber exits, boss entry, and boss defeat.",
      "Avoid automation-sensitive online features; keep the run offline."
    ],
    evidenceHints: [
      "Record from courtyard start through target boss clear.",
      "Capture save-state hash and final chamber timer."
    ]
  },
  2379780: {
    appid: 2379780,
    gameName: "Balatro",
    launchUri: "steam://run/2379780",
    installHint: "Install Balatro and configure the published seed/deck/stake preset.",
    inputMode: "turn-based-actions",
    captureMode: "replay-or-screen",
    saveStrategy: "published-seed",
    readinessChecks: [
      "Deck, stake, and seed are visible before the run starts.",
      "Run history or action trace is enabled when available.",
      "No challenge modifiers are active unless specified by the task."
    ],
    agentLoopHints: [
      "Evaluate each shop and hand as a discrete state transition.",
      "Emit checkpoints at ante transitions and final defeat/victory screen.",
      "Record chosen cards, discards, purchases, and joker order in event metadata."
    ],
    evidenceHints: [
      "Capture seed/deck/stake and final ante screen.",
      "Attach action trace plus output/output.mp4."
    ]
  },
  1794680: {
    appid: 1794680,
    gameName: "Vampire Survivors",
    launchUri: "steam://run/1794680",
    installHint: "Install Vampire Survivors with the standardized character/stage unlock profile.",
    inputMode: "controller",
    captureMode: "stats-screen",
    saveStrategy: "seeded-save",
    readinessChecks: [
      "Stage, character, and modifiers match the task contract.",
      "Timer and kill counter are visible in capture.",
      "The run starts from the benchmark profile without extra unlock advantages."
    ],
    agentLoopHints: [
      "Use continuous movement policies with periodic weapon/upgrade decisions.",
      "Emit checkpoints at 5-minute intervals and the target measurement time.",
      "Avoid farming beyond the scoring window when a fixed-time metric is used."
    ],
    evidenceHints: [
      "Capture the target timestamp and final stats screen.",
      "Attach stats screenshot plus output/output.mp4."
    ]
  }
};

export function adapterForGame(task: Pick<BenchmarkTask, "appid" | "gameName" | "track">): RuntimeGameAdapter {
  return adapters[task.appid] ?? fallbackAdapter(task);
}

export function adaptersForCatalog(games: Pick<GameCatalogEntry, "appid" | "name" | "tracks">[]): RuntimeGameAdapter[] {
  return games.map((game) => adapterForGame({ appid: game.appid, gameName: game.name, track: game.tracks[0] ?? "achievement" }));
}
