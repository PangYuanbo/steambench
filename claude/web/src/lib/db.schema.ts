/**
 * Durable-storage schema (Drizzle + Postgres) — the upgrade path from the
 * in-memory demo store in `store.ts`.
 *
 * The app currently runs keyless/DB-less so it deploys with zero provisioning;
 * the seed catalog + reference runs are baked in. To make submitted runs durable
 * and shared across instances, provision a Postgres (e.g. Neon via the Vercel
 * Marketplace), set `DATABASE_URL`, run a migration from this schema, and swap
 * `store.ts` to read/write these tables (the async interface there already
 * matches). Nothing else in the app needs to change.
 *
 *   npm i drizzle-orm pg && npm i -D drizzle-kit
 *   npx drizzle-kit generate && npx drizzle-kit migrate
 */

import {
  pgTable,
  serial,
  text,
  integer,
  doublePrecision,
  boolean,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/** Human players (bound via Steam OpenID). */
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  steamid: text("steamid").notNull().unique(),
  name: text("name").notNull(),
  avatar: text("avatar").default(""),
  createdAt: timestamp("created_at").defaultNow(),
});

/** AI agents (authenticate run submissions with an API key). */
export const agents = pgTable(
  "agents",
  {
    id: text("id").primaryKey(), // slug
    name: text("name").notNull(),
    apiKeyHash: text("api_key_hash").notNull(), // store a hash, not the key
    owner: text("owner").default(""),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (t) => ({ keyIdx: uniqueIndex("agents_key_idx").on(t.apiKeyHash) })
);

/** Games (Steam apps + synthetic arcade appids >= 9_000_000). */
export const games = pgTable("games", {
  appid: integer("appid").primaryKey(),
  name: text("name").notNull(),
  kind: text("kind").notNull().default("steam"), // steam | arcade
  envId: text("env_id"), // arcade only
  ownersEstimate: integer("owners_estimate"),
  totalBits: doublePrecision("total_bits").default(0),
  numAchievements: integer("num_achievements").default(0),
  headerImage: text("header_image").default(""),
  meta: jsonb("meta"),
});

/** Tasks (one per achievement / leaderboard objective). */
export const tasks = pgTable(
  "tasks",
  {
    taskId: text("task_id").primaryKey(),
    appid: integer("appid").notNull(),
    kind: text("kind").notNull(),
    sourceRef: text("source_ref").notNull(), // apiname / leaderboard id
    name: text("name").notNull(),
    description: text("description").default(""),
    rarity: doublePrecision("rarity").notNull(),
    bits: doublePrecision("bits").notNull(),
    points: integer("points").notNull(),
    tier: text("tier").notNull(),
  },
  (t) => ({ appIdx: index("tasks_app_idx").on(t.appid) })
);

/** Every submitted run, after server-side verification. */
export const runs = pgTable(
  "runs",
  {
    id: serial("id").primaryKey(),
    envId: text("env_id").notNull(),
    appid: integer("appid").notNull(),
    playerId: text("player_id").notNull(), // agent id or steam:<name>
    playerKind: text("player_kind").notNull(), // human | agent
    seed: integer("seed").notNull(),
    actions: jsonb("actions"), // recorded trace (for re-verification/audit)
    numSteps: integer("num_steps").default(0),
    score: doublePrecision("score").notNull(),
    unlocked: jsonb("unlocked").notNull(), // string[]
    earnedPoints: integer("earned_points").notNull(),
    earnedBits: doublePrecision("earned_bits").notNull(),
    mastery: doublePrecision("mastery").notNull(),
    verified: boolean("verified").notNull().default(false),
    verifyMode: text("verify_mode").notNull().default("replay"),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (t) => ({
    playerIdx: index("runs_player_idx").on(t.playerId),
    appIdx: index("runs_app_idx").on(t.appid),
    bestIdx: index("runs_best_idx").on(t.appid, t.playerId, t.earnedBits),
  })
);

export type UserRow = typeof users.$inferSelect;
export type AgentRow = typeof agents.$inferSelect;
export type GameRow = typeof games.$inferSelect;
export type TaskRow = typeof tasks.$inferSelect;
export type RunDbRow = typeof runs.$inferSelect;
