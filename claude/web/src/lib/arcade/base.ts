/**
 * Base `Env` class and shared helpers, mirroring
 * `harness/steambench_harness/protocol.py`.
 *
 * Subclasses must be deterministic: identical `(seed, action sequence)` must
 * always yield identical `score` and `unlocked` sets. All randomness must come
 * from `this.rng` (seeded in `reset`).
 */

import { Mulberry32 } from "./rng";
import type {
  AchievementSpec,
  Action,
  EnvSpec,
  Observation,
  VerifyMode,
} from "./types";

/** A small discrete, named action space (mirrors Python `ActionSpace`). */
export class ActionSpace {
  constructor(public readonly names: string[]) {}

  get length(): number {
    return this.names.length;
  }

  index(action: Action): number {
    if (typeof action === "number") {
      if (!(action >= 0 && action < this.names.length)) {
        throw new Error(`action index ${action} out of range`);
      }
      return action;
    }
    const i = this.names.indexOf(action);
    if (i === -1) {
      throw new Error(
        `unknown action ${JSON.stringify(action)}; valid: ${JSON.stringify(this.names)}`,
      );
    }
    return i;
  }

  name(action: Action): string {
    return this.names[this.index(action)];
  }

  sample(rng: Mulberry32): string {
    return rng.choice(this.names);
  }
}

/** Round to a fixed number of decimal places (mirrors Python `round`). */
function roundTo(value: number, ndigits: number): number {
  const f = 10 ** ndigits;
  // Python's round() uses banker's rounding, but rarity_hint * 100 values here
  // are exact enough that ordinary rounding to 3 dp matches the Python output.
  return Math.round(value * f) / f;
}

/** Base class for all SteamBench environments. */
export abstract class Env {
  /** stable id, e.g. "arcade/2048". Mirrors a Steam appid for real games. */
  static env_id = "env/base";
  // NOTE: a class is a function, and `Function.name` is read-only, so we cannot
  // shadow it with a static `name` field. Mirror the Python `name` attribute via
  // `displayName` and expose it through the `name` getter below.
  static displayName = "Base Env";
  static description = "";
  static action_space: ActionSpace;
  static achievements: AchievementSpec[] = [];
  static verify_mode: VerifyMode = "replay";
  /** synthetic Steam appid so arcade games slot into the same catalog/DB. */
  static appid = 0;

  rng: Mulberry32;
  seed: number;
  score: number;
  steps: number;
  done: boolean;
  unlocked: Set<string>;

  constructor() {
    this.rng = new Mulberry32(0);
    this.seed = 0;
    this.score = 0.0;
    this.steps = 0;
    this.done = false;
    this.unlocked = new Set<string>();
  }

  // ---- static metadata accessors (instance-side convenience) ------------- //

  get envId(): string {
    return (this.constructor as typeof Env).env_id;
  }

  get appid(): number {
    return (this.constructor as typeof Env).appid;
  }

  get name(): string {
    return (this.constructor as typeof Env).displayName;
  }

  get description(): string {
    return (this.constructor as typeof Env).description;
  }

  get verifyMode(): VerifyMode {
    return (this.constructor as typeof Env).verify_mode;
  }

  get actionSpace(): ActionSpace {
    return (this.constructor as typeof Env).action_space;
  }

  get achievements(): AchievementSpec[] {
    return (this.constructor as typeof Env).achievements;
  }

  // ---- lifecycle --------------------------------------------------------- //

  /** Start a new episode. Must seed `this.rng` from `seed`. */
  abstract reset(seed?: number): Observation;

  /** Apply one action; advance the world by one tick. */
  abstract step(action: Action): Observation;

  // ---- helpers for subclasses -------------------------------------------- //

  /** Common reset bookkeeping. Subclasses call this first. */
  protected begin(seed: number): void {
    this.seed = Math.trunc(seed);
    this.rng = new Mulberry32(this.seed);
    this.score = 0.0;
    this.steps = 0;
    this.done = false;
    this.unlocked = new Set<string>();
  }

  /** Mark an achievement unlocked. Returns true if newly unlocked. */
  protected unlock(achId: string): boolean {
    if (this.unlocked.has(achId)) {
      return false;
    }
    const declared = this.achievements.some((a) => a.id === achId);
    if (!declared) {
      throw new Error(
        `${JSON.stringify(achId)} is not a declared achievement of ${this.envId}`,
      );
    }
    this.unlocked.add(achId);
    return true;
  }

  newlyUnlocked(before: Set<string>): string[] {
    return [...this.unlocked].filter((a) => !before.has(a));
  }

  // ---- introspection ----------------------------------------------------- //

  achievement(achId: string): AchievementSpec {
    for (const a of this.achievements) {
      if (a.id === achId) {
        return a;
      }
    }
    throw new Error(achId);
  }

  /** Machine-readable description of this env (for the catalog/docs). */
  spec(): EnvSpec {
    return {
      env_id: this.envId,
      appid: this.appid,
      name: this.name,
      description: this.description,
      verify_mode: this.verifyMode,
      action_space: this.actionSpace.names,
      achievements: this.achievements.map((a) => ({
        id: a.id,
        name: a.name,
        description: a.description,
        percent_hint: roundTo(a.rarity_hint * 100.0, 3),
      })),
    };
  }

  /** Convenience: the legal action names from the current state. */
  abstract legalActions(): string[];

  /** Default text render; subclasses usually override. */
  render(): string {
    return `${this.name} | step=${this.steps} score=${this.score}`;
  }
}
