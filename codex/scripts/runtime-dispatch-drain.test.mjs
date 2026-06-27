import { createServer } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { drainRuntimeDispatches } from "./runtime-dispatch-drain.mjs";

let server;

function readBody(request) {
  return new Promise((resolve) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => resolve(body ? JSON.parse(body) : {}));
  });
}

async function startMockApi() {
  const calls = [];
  const dispatch = {
    id: "dispatch_local_a",
    runId: "run_a",
    taskId: "620:ACH_A",
    agentId: "agent_a",
    provider: "local",
    status: "planned",
    workerId: "worker_a",
    command: "node -e \"process.stdout.write('worker-ok')\"",
    manifestUrl: "/api/runs/run_a/execution-manifest?agentId=agent_a",
    runtimePackageUrl: "/api/runs/run_a/runtime-package?agentId=agent_a"
  };
  server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const body = request.method === "POST" ? await readBody(request) : {};
    calls.push({ method: request.method, path: url.pathname, body });
    response.setHeader("content-type", "application/json");

    if (request.method === "GET" && url.pathname === "/api/dispatches") {
      response.end(JSON.stringify({
        dispatches: [
          {
            dispatch,
            run: { id: "run_a", status: "queued" },
            task: { id: "620:ACH_A", title: "Achievement A" },
            agent: { id: "agent_a", handle: "agent-a" }
          },
          {
            dispatch: {
              ...dispatch,
              id: "dispatch_modal_b",
              provider: "modal",
              status: "planned"
            }
          }
        ]
      }));
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/dispatches/dispatch_local_a/status") {
      response.end(JSON.stringify({
        dispatch: {
          ...dispatch,
          status: body.status,
          summary: body.summary
        }
      }));
      return;
    }

    response.statusCode = 404;
    response.end(JSON.stringify({ error: "not_found", path: url.pathname }));
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

describe("runtime dispatch drain CLI runner", () => {
  it("lists local dispatches without side effects in dry-run mode", async () => {
    const { baseUrl, calls } = await startMockApi();
    const summary = await drainRuntimeDispatches({
      baseUrl,
      provider: "local",
      status: "planned",
      limit: 2,
      dryRun: true,
      dispatchId: ""
    });

    expect(summary).toMatchObject({
      schemaVersion: "steambench.runtime-dispatch-drain.v1",
      dryRun: true,
      totals: {
        availableDispatches: 2,
        selected: 1,
        dryRun: 1
      },
      results: [
        {
          dispatchId: "dispatch_local_a",
          status: "dry-run",
          runId: "run_a",
          agentId: "agent_a"
        }
      ]
    });
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      "GET /api/dispatches"
    ]);
  });

  it("launches a local dispatch command and marks it completed", async () => {
    const { baseUrl, calls } = await startMockApi();
    const summary = await drainRuntimeDispatches({
      baseUrl,
      provider: "local",
      status: "planned",
      limit: 1,
      dryRun: false,
      dispatchId: ""
    });

    expect(summary).toMatchObject({
      dryRun: false,
      totals: {
        selected: 1,
        completed: 1,
        failed: 0
      },
      results: [
        {
          dispatchId: "dispatch_local_a",
          terminalStatus: "completed",
          exitCode: 0,
          stdout: "worker-ok"
        }
      ]
    });
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      "GET /api/dispatches",
      "POST /api/dispatches/dispatch_local_a/status",
      "POST /api/dispatches/dispatch_local_a/status"
    ]);
    expect(calls[1].body.status).toBe("launched");
    expect(calls[2].body.status).toBe("completed");
  });
});
