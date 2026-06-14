/**
 * Deterministic replay + verification for arcade runs.
 *
 * `replay` constructs a fresh env, resets it with the given seed, applies each
 * action name in order (stopping early if the env reports `done`), and returns
 * the final score / unlocked set / step count. `verifyRun` compares a claimed
 * record against a fresh replay, which is how SteamBench checks that a submitted
 * run is legitimate.
 */

import { make } from "./registry";
import type { Action } from "./types";

export interface ReplayResult {
  score: number;
  unlocked: string[];
  steps: number;
}

/**
 * Replay a recorded `(seed, actions)` trace on a fresh env.
 *
 * Returns the final `score`, the sorted list of `unlocked` achievement ids, and
 * the number of `steps` actually taken (which may be fewer than `actions.length`
 * if the env finished early).
 */
export function replay(
  envId: string,
  seed: number,
  actions: Action[],
): ReplayResult {
  const env = make(envId);
  env.reset(seed);
  for (const action of actions) {
    if (env.done) {
      break;
    }
    env.step(action);
  }
  return {
    score: env.score,
    unlocked: [...env.unlocked].sort(),
    steps: env.steps,
  };
}

/** A submitted run record to be verified. */
export interface RunRecord {
  env_id: string;
  seed: number;
  actions: Action[];
  /** The score the client claims it achieved. */
  score?: number;
  /** The achievement ids the client claims it unlocked. */
  unlocked?: string[];
}

export interface VerifyResult {
  ok: boolean;
  replayScore: number;
  replayUnlocked: string[];
  reason: string;
}

function setsEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sa = new Set(a);
  for (const x of b) {
    if (!sa.has(x)) return false;
  }
  return true;
}

/**
 * Verify a claimed run by replaying it. The score must match within 1e-6 and
 * the unlocked sets must be equal. If the record omits a claim, that field is
 * not checked (the replayed value is still returned).
 */
export function verifyRun(record: RunRecord): VerifyResult {
  const { score: replayScore, unlocked: replayUnlocked } = replay(
    record.env_id,
    record.seed,
    record.actions,
  );

  if (record.score !== undefined) {
    if (Math.abs(record.score - replayScore) > 1e-6) {
      return {
        ok: false,
        replayScore,
        replayUnlocked,
        reason: `score mismatch: claimed ${record.score}, replayed ${replayScore}`,
      };
    }
  }

  if (record.unlocked !== undefined) {
    const claimed = [...record.unlocked].sort();
    if (!setsEqual(claimed, replayUnlocked)) {
      return {
        ok: false,
        replayScore,
        replayUnlocked,
        reason:
          `unlocked mismatch: claimed [${claimed.join(", ")}], ` +
          `replayed [${replayUnlocked.join(", ")}]`,
      };
    }
  }

  return { ok: true, replayScore, replayUnlocked, reason: "ok" };
}
