/**
 * Env registry: map a stable `env_id` to its env class.
 *
 * Mirrors `harness/steambench_harness/registry.py`. The verifier instantiates
 * an env by id so a submitted run can be replayed without trusting the client
 * about which env it ran on.
 */

import type { Env } from "./base";
import type { EnvSpec } from "./types";
import { Catcher } from "./catcher";
import { Connect4 } from "./connect4";
import { Dodger } from "./dodger";
import { Forager } from "./forager";
import { Flappy } from "./flappy";
import { Game2048 } from "./game2048";
import { Minesweeper } from "./minesweeper";
import { Phantom } from "./phantom";
import { Rally } from "./rally";
import { Snake } from "./snake";
import { Sokoban } from "./sokoban";
import { Storm } from "./storm";
import { Tetris } from "./tetris";
import { Turret } from "./turret";
import { Volley } from "./volley";

type EnvCtor = new () => Env;

const REGISTRY: Record<string, EnvCtor> = {
  [Catcher.env_id]: Catcher,
  [Connect4.env_id]: Connect4,
  [Dodger.env_id]: Dodger,
  [Forager.env_id]: Forager,
  [Flappy.env_id]: Flappy,
  [Game2048.env_id]: Game2048,
  [Minesweeper.env_id]: Minesweeper,
  [Phantom.env_id]: Phantom,
  [Rally.env_id]: Rally,
  [Snake.env_id]: Snake,
  [Sokoban.env_id]: Sokoban,
  [Storm.env_id]: Storm,
  [Tetris.env_id]: Tetris,
  [Turret.env_id]: Turret,
  [Volley.env_id]: Volley,
};

/** Instantiate an env by id. */
export function make(envId: string): Env {
  const ctor = REGISTRY[envId];
  if (!ctor) {
    const known = Object.keys(REGISTRY).sort().join(", ");
    throw new Error(`unknown env_id ${JSON.stringify(envId)}; registered: ${known}`);
  }
  return new ctor();
}

/** Sorted list of registered env ids (mirrors `all_env_ids`). */
export const ENV_IDS: string[] = Object.keys(REGISTRY).sort();

/** Spec dicts for every registered env (drives the catalog + docs). */
export function allSpecs(): EnvSpec[] {
  return ENV_IDS.map((id) => make(id).spec());
}
