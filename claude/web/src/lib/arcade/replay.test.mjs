// Acceptance test for the arcade TS port. Run with:
//   npx --yes tsx src/lib/arcade/replay.test.mjs
// from the `web/` directory. Verifies the PRNG vectors and that every fixture
// in data/fixtures/replay_fixtures.json replays to the expected score, unlocked
// set, and step count.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { Mulberry32 } from "./rng.ts";
import { replay } from "./replay.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
// web/src/lib/arcade -> repo root -> data/fixtures/replay_fixtures.json
const fixturesPath = resolve(
  __dirname,
  "../../../../data/fixtures/replay_fixtures.json",
);

let failures = 0;
function check(label, fn) {
  try {
    fn();
    console.log(`  PASS  ${label}`);
  } catch (err) {
    failures += 1;
    console.log(`  FAIL  ${label}`);
    console.log(`        ${err.message.replace(/\n/g, "\n        ")}`);
  }
}

// 1. PRNG vector check (seed=42, first 8 random() values).
check("mulberry32(42) first 8 random() values", () => {
  const r = new Mulberry32(42);
  const got = [];
  for (let i = 0; i < 8; i++) got.push(r.random());
  const expected = [
    0.6011037519201636, 0.44829055899754167, 0.8524657934904099,
    0.6697340414393693, 0.17481389874592423, 0.5265925421845168,
    0.2732279943302274, 0.6247446539346129,
  ];
  assert.deepEqual(got, expected);
});

// 2. Fixture replays.
const fixtures = JSON.parse(readFileSync(fixturesPath, "utf8")).fixtures;
console.log(`Loaded ${fixtures.length} fixtures from ${fixturesPath}`);

for (const fx of fixtures) {
  const label = `${fx.env_id} seed=${fx.seed} (steps=${fx.expected_steps}, score=${fx.expected_score})`;
  check(label, () => {
    const result = replay(fx.env_id, fx.seed, fx.actions);
    const expectedUnlocked = [...fx.expected_unlocked].sort();
    assert.equal(
      result.score,
      fx.expected_score,
      `score: got ${result.score}, expected ${fx.expected_score}`,
    );
    assert.deepEqual(
      result.unlocked,
      expectedUnlocked,
      `unlocked: got [${result.unlocked.join(", ")}], expected [${expectedUnlocked.join(", ")}]`,
    );
    assert.equal(
      result.steps,
      fx.expected_steps,
      `steps: got ${result.steps}, expected ${fx.expected_steps}`,
    );
  });
}

if (failures > 0) {
  console.log(`\n${failures} check(s) FAILED`);
  process.exit(1);
}
console.log(`\nAll ${fixtures.length + 1} checks passed.`);
