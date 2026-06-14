/**
 * Parity tests for the TS scoring/difficulty mirror of the Python engine.
 * Run:  npx tsx src/lib/scoring.test.mjs   (from web/)
 *
 * These lock in the cross-language contract that two code reviews verified by
 * hand: difficulty.ts and scoring.ts must produce the SAME numbers as
 * engine/steambench/{difficulty,scoring}.py.
 */
import { rarityToBits, scoreAchievement, bitsToPoints } from "./difficulty.ts";
import { scoreRun, eloUpdate, expectedScore, matchOutcome, buildLeaderboard } from "./scoring.ts";

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}`); }
}
const close = (a, b, eps = 1e-3) => Math.abs(a - b) <= eps;

// --- difficulty: bits = -log2(rarity) (mirrors test_difficulty.py) ---
check("rarityToBits(0.5)=1", close(rarityToBits(0.5), 1));
check("rarityToBits(0.25)=2", close(rarityToBits(0.25), 2));
check("rarityToBits(0.01)=6.6439", close(rarityToBits(0.01), 6.6439));
check("rarityToBits(1)=0", close(rarityToBits(1), 0));
check("bits additive: 0.1+0.1 == 0.01", close(rarityToBits(0.1) + rarityToBits(0.1), rarityToBits(0.01)));
check("rarity clamped finite at 0", Number.isFinite(rarityToBits(0)) && rarityToBits(0) > 13);

// --- tiers + points (mirrors scoreAchievement) ---
check("50% -> easy, 100pts", scoreAchievement(50).tier === "easy" && scoreAchievement(50).points === 100);
check("80% -> tutorial", scoreAchievement(80).tier === "tutorial");
check("2.5% -> hard", scoreAchievement(2.5).tier === "hard");
check("0.4% -> elite", scoreAchievement(0.4).tier === "elite");
check("0.05% -> legendary", scoreAchievement(0.05).tier === "legendary");
check("points floor >= 5", scoreAchievement(99.9).points >= 5);
check("bitsToPoints(1)=100", bitsToPoints(1) === 100);

// --- Elo (mirrors test_scoring.py) ---
check("expectedScore(1200,1200)=0.5", close(expectedScore(1200, 1200), 0.5));
const [a, b] = eloUpdate(1200, 1200, 1.0);
check("elo winner up, loser down, symmetric", a > 1200 && b < 1200 && close(a - 1200, 1200 - b));
check("matchOutcome", matchOutcome(5, 3) === 1 && matchOutcome(3, 5) === 0 && matchOutcome(4, 4) === 0.5);

// --- scoreRun + buildLeaderboard ---
const tasks = [
  { task_id: "g:t1", source_ref: "t1", points: 100, bits: 1.0, tier: "easy" },
  { task_id: "g:t2", source_ref: "t2", points: 200, bits: 2.0, tier: "medium" },
  { task_id: "g:t3", source_ref: "t3", points: 700, bits: 7.0, tier: "elite" },
];
const s = scoreRun(["t1", "t3"], tasks);
check("scoreRun points", s.earned_points === 800);
check("scoreRun bits", close(s.earned_bits, 8.0));
check("scoreRun mastery = 8/10", close(s.mastery, 0.8));
check("scoreRun completed/total", s.completed === 2 && s.total === 3);

// One human run + one AI run on the same game -> a contested Elo match.
const tasksByApp = new Map([[1, tasks]]);
const runs = [
  { env_id: "g", appid: 1, game: "G", agent_id: "ai1", agent_kind: "agent", seed: 1, score: 0, steps: 0, unlocked: ["t1", "t2", "t3"], earned_points: 0, earned_bits: 0, mastery: 0, verified: true },
  { env_id: "g", appid: 1, game: "G", agent_id: "human1", agent_kind: "human", seed: 1, score: 0, steps: 0, unlocked: ["t1"], earned_points: 0, earned_bits: 0, mastery: 0, verified: true },
];
const { standings, humanVsAI } = buildLeaderboard(runs, tasksByApp);
check("leaderboard ranks AI above human (more bits)", standings[0].player_id === "ai1");
check("humanVsAI: AI wins the contest", humanVsAI.ai_wins === 1 && humanVsAI.ai_elo > humanVsAI.human_elo);
check("unverified runs excluded", buildLeaderboard([{ ...runs[0], verified: false }], tasksByApp).standings.length === 0);

console.log(`\n${pass} passed, ${fail} failed.`);
if (fail > 0) process.exit(1);
