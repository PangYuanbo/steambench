/**
 * Shared types for the arcade envs. These mirror the dataclasses in
 * `harness/steambench_harness/protocol.py`. JSON-facing fields use the same
 * snake_case keys as the Python side so recorded observations match.
 */

/** How a run on an env is verified to be legitimate (mirrors `VerifyMode`). */
export type VerifyMode = "replay" | "steam_api" | "trusted";

/** One unlockable objective on an env (mirrors `AchievementSpec`). */
export interface AchievementSpec {
  id: string;
  name: string;
  description: string;
  /** 0..1 designed unlock fraction. */
  rarity_hint: number;
}

/** Achievement entry as serialized in `spec()` (mirrors Python `spec()`). */
export interface AchievementSpecOut {
  id: string;
  name: string;
  description: string;
  percent_hint: number;
}

/** Machine-readable description of an env (mirrors Python `Env.spec()`). */
export interface EnvSpec {
  env_id: string;
  appid: number;
  name: string;
  description: string;
  verify_mode: VerifyMode;
  action_space: string[];
  achievements: AchievementSpecOut[];
}

/** A discrete action: either its index or its name. */
export type Action = number | string;

/**
 * What an agent sees each step. Three coordinated views of one state.
 * Mirrors the Python `Observation.as_dict()` shape, including snake_case keys.
 */
export interface Observation {
  step: number;
  /** Structured, machine-friendly state (keys mirror the Python `state` dict). */
  state: Record<string, unknown>;
  /** ASCII render for LLM agents. */
  text: string;
  /** Optional base64 PNG for vision agents / stream. */
  frame: string | null;
  legal_actions: string[];
  score: number;
  done: boolean;
  reward: number;
  info: Record<string, unknown>;
}
