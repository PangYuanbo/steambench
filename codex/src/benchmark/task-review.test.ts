import { describe, expect, it } from "vitest";
import { buildFixtureTasks } from "./task-generator";
import { buildTaskReview } from "./task-review";
import { buildTaskReviewCatalog } from "./task-review-catalog";
import type { TaskRegistryEntry } from "../server/store";

describe("task review explanations", () => {
  it("marks low-risk benchmark tasks as ranked-ready", () => {
    const task = buildFixtureTasks().find((entry) => entry.id === "620:ACH.NO_BOAT");
    expect(task).toBeDefined();

    const review = buildTaskReview(task!);

    expect(review.decision).toBe("ranked-ready");
    expect(review.reviewRequired).toBe(false);
    expect(review.controls.join(" ")).toContain("same game build");
    expect(review.recommendations.join(" ")).toContain("ranked benchmark candidate");
  });

  it("keeps controlled leaderboard tasks in review with explicit controls", () => {
    const task = buildFixtureTasks().find((entry) => entry.id === "646570:LDRB.SEED_A20_SCORE");
    expect(task).toBeDefined();

    const review = buildTaskReview(task!);

    expect(review.decision).toBe("review-required");
    expect(review.fairnessVerdict).toBe("controlled");
    expect(review.controls.join(" ")).toContain("Snapshot leaderboard rules");
  });

  it("builds a filterable review catalog for active and candidate tasks", () => {
    const tasks = buildFixtureTasks();
    const controlledTask = tasks.find((entry) => entry.id === "646570:LDRB.SEED_A20_SCORE");
    expect(controlledTask).toBeDefined();
    const candidate: TaskRegistryEntry = {
      ...controlledTask!,
      id: "646570:LDRB.REVIEW_ONLY",
      status: "candidate",
      importedAt: "2026-06-14T00:00:00.000Z",
      updatedAt: "2026-06-14T00:00:00.000Z",
      reviewNotes: "Needs explicit benchmark approval."
    };

    const catalog = buildTaskReviewCatalog({
      tasks,
      taskRegistry: [candidate],
      generatedAt: "2026-06-14T00:00:00.000Z"
    });

    expect(catalog.totals.tasks).toBe(tasks.length + 1);
    expect(catalog.totals.candidates).toBe(1);
    expect(catalog.decisions["ranked-ready"]).toBeGreaterThan(0);
    expect(catalog.decisions["review-required"]).toBeGreaterThan(0);
    expect(catalog.fairness.controlled).toBeGreaterThan(0);
    expect(catalog.reviewQueue.some((entry) => entry.task.id === candidate.id && entry.registryStatus === "candidate")).toBe(true);

    const filtered = buildTaskReviewCatalog({
      tasks,
      taskRegistry: [candidate],
      filter: {
        decision: "review-required",
        registryStatus: "candidate"
      }
    });

    expect(filtered.entries.map((entry) => entry.task.id)).toEqual([candidate.id]);
  });
});
