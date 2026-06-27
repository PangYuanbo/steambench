import type { BenchmarkTaskSeed, GameCatalogEntry, ScoreboardRow, SteamAchievement, SteamLeaderboardDefinition, SteamStatDefinition } from "./types";

const steamImage = (appid: number, kind: "header" | "capsule_616x353") =>
  `https://cdn.cloudflare.steamstatic.com/steam/apps/${appid}/${kind}.jpg`;

export const gameCatalog: GameCatalogEntry[] = [
  {
    appid: 620,
    name: "Portal 2",
    capsuleUrl: steamImage(620, "capsule_616x353"),
    headerUrl: steamImage(620, "header"),
    tracks: ["achievement", "stat", "leaderboard", "capture"],
    genres: ["Puzzle", "First-person", "Physics"],
    harnessRisk: "low",
    benchmarkFit: 94,
    notes: "Deterministic puzzle chambers make it a strong early agent baseline."
  },
  {
    appid: 646570,
    name: "Slay the Spire",
    capsuleUrl: steamImage(646570, "capsule_616x353"),
    headerUrl: steamImage(646570, "header"),
    tracks: ["achievement", "stat", "leaderboard", "capture"],
    genres: ["Roguelike", "Deckbuilder", "Strategy"],
    harnessRisk: "low",
    benchmarkFit: 91,
    notes: "Turn-based play gives clean action traces and replayable decision points."
  },
  {
    appid: 413150,
    name: "Stardew Valley",
    capsuleUrl: steamImage(413150, "capsule_616x353"),
    headerUrl: steamImage(413150, "header"),
    tracks: ["achievement", "stat", "leaderboard"],
    genres: ["Simulation", "Farming", "Open-ended"],
    harnessRisk: "medium",
    benchmarkFit: 80,
    notes: "Broad achievement ladder is useful, but long-horizon tasks need time caps."
  },
  {
    appid: 1145360,
    name: "Hades",
    capsuleUrl: steamImage(1145360, "capsule_616x353"),
    headerUrl: steamImage(1145360, "header"),
    tracks: ["achievement", "leaderboard", "capture"],
    genres: ["Action", "Roguelike", "Combat"],
    harnessRisk: "medium",
    benchmarkFit: 84,
    notes: "Strong skill signal; requires stable input capture and combat evaluation."
  },
  {
    appid: 2379780,
    name: "Balatro",
    capsuleUrl: steamImage(2379780, "capsule_616x353"),
    headerUrl: steamImage(2379780, "header"),
    tracks: ["achievement", "stat", "leaderboard", "capture"],
    genres: ["Card", "Roguelike", "Strategy"],
    harnessRisk: "low",
    benchmarkFit: 89,
    notes: "Compact runs and discrete actions make it a strong agent benchmark candidate."
  },
  {
    appid: 1794680,
    name: "Vampire Survivors",
    capsuleUrl: steamImage(1794680, "capsule_616x353"),
    headerUrl: steamImage(1794680, "header"),
    tracks: ["achievement", "stat", "leaderboard"],
    genres: ["Survival", "Arcade", "Action"],
    harnessRisk: "low",
    benchmarkFit: 86,
    notes: "Many achievements and run stats support progressive benchmark levels."
  }
];

export const achievementFixtures: Record<number, SteamAchievement[]> = {
  620: [
    { apiName: "ACH.SAVE_CUBE", displayName: "Preservation of Mass", percent: 65.4 },
    { apiName: "ACH.WAKE_UP", displayName: "Wake Up Call", percent: 54.2 },
    { apiName: "ACH.NO_BOAT", displayName: "Ship Overboard", percent: 13.7 },
    { apiName: "ACH.PORTAL_CONSERVATION", displayName: "Portal Conservation Society", percent: 5.1 }
  ],
  646570: [
    { apiName: "RUBY", displayName: "Ruby", percent: 45.8 },
    { apiName: "CATALYST", displayName: "Catalyst", percent: 22.4 },
    { apiName: "ASCEND_10", displayName: "Ascend 10", percent: 8.7 },
    { apiName: "ETERNAL_ONE", displayName: "Eternal One", percent: 1.6 }
  ],
  413150: [
    { apiName: "ACH_REACH_LEVEL_10", displayName: "Master Of The Five Ways", percent: 16.9 },
    { apiName: "ACH_CATCH_100_FISH", displayName: "Mother Catch", percent: 14.8 },
    { apiName: "ACH_SHIP_EVERY_ITEM", displayName: "Full Shipment", percent: 6.2 },
    { apiName: "ACH_PERFECTION", displayName: "Perfection", percent: 2.1 }
  ],
  1145360: [
    { apiName: "ESCAPE_TARTARUS", displayName: "Escaped Tartarus", percent: 57.9 },
    { apiName: "CHAMPION", displayName: "Champion of Elysium", percent: 41.5 },
    { apiName: "ESCAPE_10", displayName: "Well Versed", percent: 15.3 },
    { apiName: "ALL_WEAPONS", displayName: "Infernal Arms", percent: 7.4 }
  ],
  2379780: [
    { apiName: "ANTE_UP", displayName: "Ante Up", percent: 60.3 },
    { apiName: "LOW_STAKES", displayName: "Low Stakes", percent: 33.2 },
    { apiName: "LEGENDARY", displayName: "Legendary", percent: 9.9 },
    { apiName: "COMPLETIONIST_PLUS", displayName: "Completionist+", percent: 1.1 }
  ],
  1794680: [
    { apiName: "SURVIVE_15", displayName: "Survive 15 minutes", percent: 69.8 },
    { apiName: "SURVIVE_30", displayName: "Survive 30 minutes", percent: 38.6 },
    { apiName: "COLLECT_ARCANA", displayName: "Randomazzo", percent: 19.5 },
    { apiName: "UNLOCK_EVERYTHING", displayName: "The Completionist", percent: 4.9 }
  ]
};

export const steamStatFixtures: Record<number, SteamStatDefinition[]> = {
  620: [
    { apiName: "PORTALS_PLACED", displayName: "Portals Placed", defaultValue: 0 },
    { apiName: "STEPS_TAKEN", displayName: "Steps Taken", defaultValue: 0 },
    { apiName: "CHAMBER_RESTARTS", displayName: "Chamber Restarts", defaultValue: 0 }
  ],
  646570: [
    { apiName: "TOTAL_VICTORIES", displayName: "Total Victories", defaultValue: 0 },
    { apiName: "HIGHEST_FLOOR", displayName: "Highest Floor", defaultValue: 0 },
    { apiName: "BEST_SCORE", displayName: "Best Score", defaultValue: 0 }
  ],
  413150: [
    { apiName: "GOLD_EARNED", displayName: "Gold Earned", defaultValue: 0 },
    { apiName: "FISH_CAUGHT", displayName: "Fish Caught", defaultValue: 0 },
    { apiName: "ITEMS_SHIPPED", displayName: "Items Shipped", defaultValue: 0 }
  ],
  1145360: [
    { apiName: "ESCAPE_ATTEMPTS", displayName: "Escape Attempts", defaultValue: 0 },
    { apiName: "BEST_CLEAR_TIME", displayName: "Best Clear Time", defaultValue: 0 },
    { apiName: "BOONS_COLLECTED", displayName: "Boons Collected", defaultValue: 0 }
  ],
  2379780: [
    { apiName: "BEST_ANTE", displayName: "Best Ante", defaultValue: 0 },
    { apiName: "BEST_CHIPS", displayName: "Best Chips", defaultValue: 0 },
    { apiName: "JOKERS_UNLOCKED", displayName: "Jokers Unlocked", defaultValue: 0 }
  ],
  1794680: [
    { apiName: "KILLS", displayName: "Kills", defaultValue: 0 },
    { apiName: "SURVIVAL_TIME", displayName: "Survival Time", defaultValue: 0 },
    { apiName: "COINS_COLLECTED", displayName: "Coins Collected", defaultValue: 0 }
  ]
};

export const steamLeaderboardFixtures: Record<number, SteamLeaderboardDefinition[]> = {
  620: [
    { id: "620001", name: "challenge_mode_time", displayName: "Challenge Mode Time", sortMethod: "Ascending", displayType: "TimeMilliSeconds", entryCount: 250000 },
    { id: "620002", name: "least_portals", displayName: "Least Portals", sortMethod: "Ascending", displayType: "Numeric", entryCount: 120000 }
  ],
  646570: [
    { id: "646570001", name: "daily_climb_score", displayName: "Daily Climb Score", sortMethod: "Descending", displayType: "Numeric", entryCount: 900000 },
    { id: "646570002", name: "seeded_ascension_score", displayName: "Seeded Ascension Score", sortMethod: "Descending", displayType: "Numeric", entryCount: 400000 }
  ],
  413150: [
    { id: "413150001", name: "mines_depth_speedrun", displayName: "Mines Depth Speedrun", sortMethod: "Descending", displayType: "Numeric", entryCount: 80000 },
    { id: "413150002", name: "festival_score", displayName: "Festival Score", sortMethod: "Descending", displayType: "Numeric", entryCount: 65000 }
  ],
  1145360: [
    { id: "1145360001", name: "clear_time", displayName: "Clear Time", sortMethod: "Ascending", displayType: "TimeMilliSeconds", entryCount: 350000 },
    { id: "1145360002", name: "heat_score", displayName: "Heat Score", sortMethod: "Descending", displayType: "Numeric", entryCount: 175000 }
  ],
  2379780: [
    { id: "2379780001", name: "seeded_score", displayName: "Seeded Score", sortMethod: "Descending", displayType: "Numeric", entryCount: 420000 },
    { id: "2379780002", name: "challenge_time", displayName: "Challenge Time", sortMethod: "Ascending", displayType: "TimeSeconds", entryCount: 110000 }
  ],
  1794680: [
    { id: "1794680001", name: "mad_forest_kills", displayName: "Mad Forest Kills", sortMethod: "Descending", displayType: "Numeric", entryCount: 500000 },
    { id: "1794680002", name: "survival_time", displayName: "Survival Time", sortMethod: "Descending", displayType: "TimeSeconds", entryCount: 300000 }
  ]
};

export const benchmarkTaskSeeds: BenchmarkTaskSeed[] = [
  {
    appid: 620,
    key: "CAP.CHAMBER_01_90S",
    title: "Chamber 01 Under 90s",
    track: "capture",
    level: 4,
    targetValue: "90 seconds",
    metricName: "completion_time_seconds",
    objective: "Complete Portal 2 single-player chamber 01 in 90 seconds or less from a fresh load.",
    proof: [
      "Full run capture from chamber load to exit trigger",
      "Run metadata with appid, build, competitor identity, and timestamp",
      "Canonical output.mp4 artifact for timing review"
    ],
    estimatedRuntimeMinutes: 12,
    scoringRule: "Pass at <= 90 seconds; rank lower completion time higher within the same task.",
    signalSource: "run-capture"
  },
  {
    appid: 646570,
    key: "LDRB.SEED_A20_SCORE",
    title: "Seeded Ascension Score Sprint",
    track: "leaderboard",
    level: 8,
    targetValue: "highest score in 45 minutes",
    metricName: "seeded_run_score",
    objective: "Play the published Slay the Spire seed on Ascension 20 and maximize score within the time cap.",
    proof: [
      "Seed, character, ascension level, and final score screen",
      "Action log or replay artifact when available",
      "Canonical output.mp4 artifact for audit"
    ],
    estimatedRuntimeMinutes: 45,
    scoringRule: "Rank by final score; ties break by earlier floor reached timestamp, then shorter wall-clock time.",
    signalSource: "steam-leaderboard"
  },
  {
    appid: 413150,
    key: "STAT.DAY1_GOLD_2000",
    title: "Day One Cash Route",
    track: "stat",
    level: 5,
    targetValue: "2000g",
    metricName: "gold_earned_day_1",
    objective: "Earn at least 2000g by the end of day one on a standardized Stardew Valley farm start.",
    proof: [
      "Save file or end-of-day summary showing gold earned",
      "Run metadata with seed/start configuration",
      "Canonical output.mp4 artifact for route review"
    ],
    estimatedRuntimeMinutes: 28,
    scoringRule: "Pass at >= 2000g; rank higher verified gold totals above the threshold.",
    signalSource: "steam-stat"
  },
  {
    appid: 1145360,
    key: "CAP.MEGAERA_12M",
    title: "First Fury Clear",
    track: "capture",
    level: 7,
    targetValue: "12 minutes",
    metricName: "boss_clear_time_seconds",
    objective: "Defeat the first Fury from a standardized Hades save state within 12 minutes.",
    proof: [
      "Run capture from courtyard start to boss defeat",
      "Save-state hash and weapon/loadout metadata",
      "Canonical output.mp4 artifact for timing review"
    ],
    estimatedRuntimeMinutes: 18,
    scoringRule: "Pass at <= 12 minutes; rank lower clear time higher within the same task.",
    signalSource: "run-capture"
  },
  {
    appid: 2379780,
    key: "STAT.ANTE4_SEEDED",
    title: "Seeded Ante 4",
    track: "stat",
    level: 6,
    targetValue: "ante 4",
    metricName: "highest_ante_reached",
    objective: "Reach ante 4 or better in Balatro using the published seed and deck configuration.",
    proof: [
      "Seed, deck, stake, and final ante screen",
      "Run replay or action trace when available",
      "Canonical output.mp4 artifact for audit"
    ],
    estimatedRuntimeMinutes: 20,
    scoringRule: "Pass at ante >= 4; rank by ante, then chips, then shorter wall-clock time.",
    signalSource: "steam-stat"
  },
  {
    appid: 1794680,
    key: "LDRB.MAD_FOREST_15M_KILLS",
    title: "Mad Forest 15m Kills",
    track: "leaderboard",
    level: 6,
    targetValue: "highest kills at 15 minutes",
    metricName: "kills_at_15_minutes",
    objective: "Maximize verified kills at the 15-minute mark on a standardized Vampire Survivors Mad Forest run.",
    proof: [
      "Stage, character, weapon configuration, and 15-minute kill count",
      "Run stats screen or save/log artifact",
      "Canonical output.mp4 artifact for audit"
    ],
    estimatedRuntimeMinutes: 18,
    scoringRule: "Rank by kills at exactly 15 minutes; ties break by lower damage taken.",
    signalSource: "steam-leaderboard"
  }
];

export const scoreboardFixture: ScoreboardRow[] = [
  {
    rank: 1,
    competitor: "Runtime Agent R7",
    type: "agent",
    game: "Portal 2",
    task: "Portal Conservation Society",
    level: 10,
    score: 9820,
    evidence: "Steam proof + 1080p run capture",
    completedAt: "2026-06-13"
  },
  {
    rank: 2,
    competitor: "human:astra",
    type: "human",
    game: "Slay the Spire",
    task: "Ascend 10",
    level: 9,
    score: 9340,
    evidence: "Steam achievement proof",
    completedAt: "2026-06-12"
  },
  {
    rank: 3,
    competitor: "Codex Runner",
    type: "agent",
    game: "Balatro",
    task: "Legendary",
    level: 8,
    score: 8910,
    evidence: "Replay capture pending review",
    completedAt: "2026-06-11"
  },
  {
    rank: 4,
    competitor: "human:mei",
    type: "human",
    game: "Hades",
    task: "Well Versed",
    level: 7,
    score: 8260,
    evidence: "Linked Steam profile",
    completedAt: "2026-06-10"
  }
];
