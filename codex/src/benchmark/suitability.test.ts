import { describe, expect, it } from "vitest";
import { gameCatalog } from "./catalog";
import { evaluateAchievementSuitability, evaluateBenchmarkSuitability } from "./suitability";

describe("benchmark suitability model", () => {
  it("recommends bounded low-risk achievement tasks", () => {
    const portal = gameCatalog.find((game) => game.appid === 620);
    expect(portal).toBeDefined();

    const result = evaluateAchievementSuitability(
      portal!,
      { percent: 13.7 },
      { estimatedRuntimeMinutes: 35 }
    );

    expect(result.score).toBeGreaterThanOrEqual(75);
    expect(result.rating).toBe("recommended");
    expect(result.reviewRequired).toBe(false);
    expect(result.activeRisks).toEqual([]);
    expect(result.fairness.verdict).toBe("good");
    expect(result.recommendations.join(" ")).toContain("ranked benchmark candidate");
  });

  it("pushes grind-heavy long-horizon tasks into review with fairness controls", () => {
    const result = evaluateBenchmarkSuitability({
      track: "achievement",
      benchmarkFit: 96,
      harnessRisk: "medium",
      achievementPercent: 9.4,
      estimatedRuntimeMinutes: 360,
      flags: {
        grind: true
      }
    });

    expect(result.rating).toBe("usable-with-review");
    expect(result.reviewRequired).toBe(true);
    expect(result.activeRisks.map((risk) => risk.flag)).toEqual(["grind", "longHorizon"]);
    expect(result.fairness.verdict).toBe("controlled");
    expect(result.fairness.controls.join(" ")).toContain("partial-credit");
    expect(result.recommendations.join(" ")).toContain("checkpointed save");
  });

  it("rejects anti-cheat protected multiplayer seasonal tasks for ranked agent automation", () => {
    const result = evaluateBenchmarkSuitability({
      track: "leaderboard",
      benchmarkFit: 88,
      harnessRisk: "high",
      estimatedRuntimeMinutes: 50,
      flags: {
        antiCheat: true,
        multiplayer: true,
        seasonal: true
      }
    });

    expect(result.score).toBeLessThan(35);
    expect(result.rating).toBe("reject");
    expect(result.fairness.verdict).toBe("exclude");
    expect(result.activeRisks.map((risk) => risk.flag)).toEqual(["multiplayer", "seasonal", "antiCheat"]);
    expect(result.recommendations.join(" ")).toContain("Do not run agent automation");
  });

  it("keeps DLC-only stat tasks usable when entitlement controls are explicit", () => {
    const result = evaluateBenchmarkSuitability({
      track: "stat",
      benchmarkFit: 76,
      harnessRisk: "low",
      estimatedRuntimeMinutes: 70,
      flags: {
        dlc: true
      }
    });

    expect(result.rating).toBe("usable-with-review");
    expect(result.fairness.verdict).toBe("controlled");
    expect(result.activeRisks).toHaveLength(1);
    expect(result.fairness.controls.join(" ")).toContain("matching DLC ownership");
  });
});
