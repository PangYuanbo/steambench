import { createServer } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { runTaskReviewOps } from "./task-review-ops.mjs";

let server;

async function startMockApi() {
  const calls = [];
  server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    calls.push({ method: request.method, path: url.pathname, search: url.searchParams.toString() });
    response.setHeader("content-type", "application/json");

    if (request.method === "GET" && url.pathname === "/api/tasks/review-catalog") {
      const decision = url.searchParams.get("decision");
      response.end(JSON.stringify({
        catalog: {
          generatedAt: "2026-06-14T00:00:00.000Z",
          totals: {
            tasks: 3,
            active: 1,
            candidates: 2,
            rejected: 0,
            rankedReady: decision === "review-required" ? 0 : 1,
            reviewRequired: 2,
            blocked: 0
          },
          decisions: {
            "ranked-ready": decision === "review-required" ? 0 : 1,
            "review-required": 2,
            reject: 0
          },
          ratings: {
            recommended: 1,
            "usable-with-review": 2,
            "poor-fit": 0,
            reject: 0
          },
          fairness: {
            good: 1,
            controlled: 2,
            "not-comparable": 0,
            exclude: 0
          },
          risks: [
            { flag: "longHorizon", count: 2 },
            { flag: "grind", count: 1 }
          ],
          reviewQueue: [
            {
              task: { id: "620:challenge_mode", title: "Challenge Mode" },
              review: {
                decision: "review-required",
                fairnessVerdict: "controlled",
                risks: [{ flag: "longHorizon" }]
              },
              registryStatus: "candidate"
            }
          ],
          entries: []
        }
      }));
      return;
    }

    response.statusCode = 404;
    response.end(JSON.stringify({ error: "not_found" }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return { baseUrl: `http://127.0.0.1:${address.port}`, calls };
}

afterEach(async () => {
  if (!server) return;
  await new Promise((resolve) => server.close(resolve));
  server = undefined;
});

describe("task review ops CLI runner", () => {
  it("summarizes the task review catalog", async () => {
    const { baseUrl, calls } = await startMockApi();

    const result = await runTaskReviewOps({
      baseUrl,
      decision: "review-required",
      fairnessVerdict: "controlled",
      riskFlag: "longHorizon",
      registryStatus: "candidate",
      limit: 10
    });

    expect(result).toMatchObject({
      schemaVersion: "steambench.task-review-ops-cli.v1",
      filters: {
        decision: "review-required",
        fairnessVerdict: "controlled",
        riskFlag: "longHorizon",
        registryStatus: "candidate",
        limit: 10
      },
      summary: {
        tasks: 3,
        candidates: 2,
        rankedReady: 0,
        reviewRequired: 2,
        blocked: 0,
        controlled: 2,
        exclude: 0,
        topRisk: "longHorizon",
        queue: [{
          taskId: "620:challenge_mode",
          decision: "review-required",
          registryStatus: "candidate",
          fairnessVerdict: "controlled",
          riskFlags: ["longHorizon"]
        }]
      }
    });
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      "GET /api/tasks/review-catalog"
    ]);
    expect(calls[0].search).toContain("decision=review-required");
    expect(calls[0].search).toContain("fairnessVerdict=controlled");
    expect(calls[0].search).toContain("riskFlag=longHorizon");
    expect(calls[0].search).toContain("registryStatus=candidate");
    expect(calls[0].search).toContain("limit=10");
  });
});
