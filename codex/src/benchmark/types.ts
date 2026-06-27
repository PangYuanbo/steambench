export type CompetitorType = "human" | "agent";

export type BenchmarkTrack = "achievement" | "leaderboard" | "stat" | "capture";

export type GameCatalogEntry = {
  appid: number;
  name: string;
  capsuleUrl: string;
  headerUrl: string;
  tracks: BenchmarkTrack[];
  genres: string[];
  harnessRisk: "low" | "medium" | "high";
  benchmarkFit: number;
  notes: string;
};

export type SteamAchievement = {
  apiName: string;
  displayName: string;
  description?: string;
  percent: number;
};

export type SteamStatDefinition = {
  apiName: string;
  displayName?: string;
  defaultValue?: number;
};

export type SteamLeaderboardDefinition = {
  id: string;
  name: string;
  displayName?: string;
  sortMethod?: "Ascending" | "Descending" | string;
  displayType?: "Numeric" | "TimeSeconds" | "TimeMilliSeconds" | string;
  entryCount?: number;
  onlyTrustedWrites?: boolean;
  onlyFriendsReads?: boolean;
};

export type BenchmarkSignalSource = "steam-achievement" | "steam-stat" | "steam-leaderboard" | "run-capture";

export type BenchmarkTask = {
  id: string;
  appid: number;
  gameName: string;
  title: string;
  track: BenchmarkTrack;
  level: number;
  score: number;
  objective: string;
  proof: string[];
  estimatedRuntimeMinutes: number;
  suitability: "baseline" | "ranked" | "expert" | "needs-review";
  suitabilityScore: number;
  reviewRequired: boolean;
  fairnessVerdict: "good" | "controlled" | "not-comparable" | "exclude";
  riskFlags: string[];
  source: "fixture" | "steam-live" | "manual";
  achievementPercent?: number;
  signalSource?: BenchmarkSignalSource;
  metricName?: string;
  targetValue?: string;
  scoringRule?: string;
};

export type BenchmarkTaskSeed = {
  appid: number;
  key: string;
  title: string;
  track: BenchmarkTrack;
  level: number;
  targetValue: string;
  metricName: string;
  objective: string;
  proof: string[];
  estimatedRuntimeMinutes: number;
  scoringRule: string;
  signalSource: BenchmarkSignalSource;
  riskFlags?: string[];
};

export type ScoreboardRow = {
  rank: number;
  runId?: string;
  taskId?: string;
  appid?: number;
  competitor: string;
  type: CompetitorType;
  game: string;
  task: string;
  track?: BenchmarkTrack;
  level: number;
  score: number;
  evidence: string;
  completedAt: string;
  metricName?: string;
  metricValue?: number;
  scoreMetadata?: Record<string, string | number | boolean | undefined>;
};
