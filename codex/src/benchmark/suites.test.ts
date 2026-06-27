import { describe, expect, it } from "vitest";
import { gameCatalog } from "./catalog";
import { buildBenchmarkSuites } from "./suites";
import { buildTaskReviews } from "./task-review";
import { buildFixtureTasks } from "./task-generator";

describe("benchmark suites", () => {
  it("groups game tasks into runnable benchmark tiers with review status", () => {
    const tasks = buildFixtureTasks();
    const reviews = buildTaskReviews(tasks);
    const suites = buildBenchmarkSuites({ games: gameCatalog, tasks, reviews });

    const portalRanked = suites.find((suite) => suite.id === "620:ranked");
    expect(portalRanked).toMatchObject({
      appid: 620,
      gameName: "Portal 2",
      tier: "ranked",
      status: "ranked-ready",
      levelRange: {
        min: 4,
        max: 6
      }
    });
    expect(portalRanked?.taskIds).toContain("620:CAP.CHAMBER_01_90S");
    expect(portalRanked?.tracks).toContain("capture");
    expect(portalRanked?.readinessScore).toBeGreaterThan(75);

    const slayExpert = suites.find((suite) => suite.id === "646570:expert");
    expect(slayExpert?.status).toBe("controlled");
    expect(slayExpert?.controlledTasks).toBeGreaterThan(0);
    expect(slayExpert?.requiredControls.join(" ")).toContain("Snapshot leaderboard rules");

    expect(suites.every((suite) => suite.taskCount > 0)).toBe(true);
    expect(suites[0].readinessScore).toBeGreaterThanOrEqual(suites.at(-1)?.readinessScore ?? 0);
  });
});
