// Shared types for the SteamBench web app. These mirror the Python engine's
// JSON output (engine/steambench/*.py -> data/seed/*.json).

export type Tier =
  | "tutorial"
  | "easy"
  | "medium"
  | "hard"
  | "elite"
  | "legendary";

export const TIERS: Tier[] = [
  "tutorial",
  "easy",
  "medium",
  "hard",
  "elite",
  "legendary",
];

export const TIER_LABEL: Record<Tier, string> = {
  tutorial: "Tutorial",
  easy: "Easy",
  medium: "Medium",
  hard: "Hard",
  elite: "Elite",
  legendary: "Legendary",
};

export type TaskKind = "achievement" | "leaderboard" | "stat";

export interface Task {
  task_id: string;
  game_appid: number;
  kind: TaskKind;
  name: string;
  description: string;
  points: number;
  bits: number;
  tier: Tier;
  tier_rank: number;
  rarity: number;
  source_ref: string;
  icon: string;
}

export interface AchievementDifficulty {
  rarity: number;
  percent: number;
  bits: number;
  tier: Tier;
  tier_rank: number;
  points: number;
}

export interface HardestAchievement extends AchievementDifficulty {
  apiname: string;
  name: string;
  display_name: string;
  description: string;
}

export interface Game {
  appid: number;
  name: string;
  genres: string[];
  owners_estimate: number | null;
  review_count: number | null;
  header_image: string;
  short_description: string;
  num_achievements: number;
  total_bits: number;
  total_points: number;
  popularity_weight: number;
  tier_histogram: Record<Tier, number>;
  hardest?: HardestAchievement;
  tasks?: Task[];
  // arcade-only
  env_id?: string;
  playable?: boolean;
  verify_mode?: string;
}

export interface GameScore {
  appid: number;
  earned_points: number;
  earned_bits: number;
  total_bits: number;
  completed_tasks: number;
  total_tasks: number;
  mastery: number;
  completion: number;
}

export type PlayerKind = "human" | "agent";

export interface PlayerStanding {
  player_id: string;
  kind: PlayerKind;
  total_points: number;
  weighted_score: number;
  games_played: number;
  tasks_completed: number;
  legendary_count: number;
  elo: number;
  per_game: Record<string, GameScore>;
  // optional presentation fields
  display_name?: string;
  rank?: number;
}

export interface RunRow {
  env_id: string;
  appid: number;
  game: string;
  agent_id: string;
  agent_kind: PlayerKind;
  seed: number;
  score: number;
  steps: number;
  unlocked: string[];
  earned_points: number;
  earned_bits: number;
  mastery: number;
  verified: boolean;
  created_at?: number;
}

export interface HumanVsAI {
  human_elo: number;
  ai_elo: number;
  human_wins: number;
  ai_wins: number;
  draws: number;
  games_contested: number;
  leader: "human" | "ai" | "tie";
  gap: number;
}

export interface Summary {
  num_games: number;
  total_tasks: number;
  by_tier: Record<Tier, number>;
  hardest_overall: {
    game: string;
    appid: number;
    name: string;
    percent: number;
    points: number;
    tier: Tier;
  }[];
}

// A run record submitted by an agent/human for verification + scoring.
export interface SubmittedRun {
  env_id: string;
  appid: number;
  agent_id: string;
  agent_kind: PlayerKind;
  seed: number;
  actions: string[];
  num_steps: number;
  final_score: number;
  unlocked: string[];
  verify_mode: string;
  reasoning?: string[];
  meta?: Record<string, unknown>;
}
