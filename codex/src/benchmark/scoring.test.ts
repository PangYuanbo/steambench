import { describe, expect, it } from "vitest";
import { buildFixtureTasks } from "./task-generator";
import { scoreRunAttempt, simulatedMetricValue } from "./scoring";

describe("benchmark scoring", () => {
  it("uses Steam proof base score for achievement tasks", () => {
    const task = buildFixtureTasks().find((entry) => entry.track === "achievement");
    expect(task).toBeDefined();

    const result = scoreRunAttempt(task!, [
      {
        type: "steam-achievement",
        status: "verified"
      }
    ]);

    expect(result.score).toBe(task!.score);
    expect(result.metadata.scoringMode).toBe("achievement");
  });

  it("rewards lower completion time on capture tasks", () => {
    const task = buildFixtureTasks().find((entry) => entry.id === "620:CAP.CHAMBER_01_90S");
    expect(task).toBeDefined();

    const result = scoreRunAttempt(task!, [
      {
        type: "manual-review",
        status: "verified",
        metadata: {
          metricValue: 72
        }
      }
    ]);

    expect(result.score).toBeGreaterThan(task!.score);
    expect(result.metadata.direction).toBe("lower-is-better");
    expect(result.metadata.thresholdMet).toBe(true);
  });

  it("does not treat leaderboard time caps as score targets", () => {
    const task = buildFixtureTasks().find((entry) => entry.id === "646570:LDRB.SEED_A20_SCORE");
    expect(task).toBeDefined();

    const result = scoreRunAttempt(task!, [
      {
        type: "manual-review",
        status: "verified",
        metadata: {
          metricValue: 1550
        }
      }
    ]);

    expect(result.metadata.targetNumber).toBeUndefined();
    expect(result.metadata.direction).toBe("higher-is-better");
    expect(result.score).toBeGreaterThan(task!.score);
  });

  it("generates simulated metric values for seeded non-achievement tasks", () => {
    const capture = buildFixtureTasks().find((entry) => entry.track === "capture");
    const stat = buildFixtureTasks().find((entry) => entry.id === "413150:STAT.DAY1_GOLD_2000");
    expect(simulatedMetricValue(capture!)).toBeLessThan(90);
    expect(simulatedMetricValue(stat!)).toBeGreaterThan(2000);
  });
});
