import { createServer } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { runRuntimeActionSpaces } from "./runtime-action-spaces.mjs";

let server;

function catalogPayload(created = false) {
  return {
    catalog: {
      schemaVersion: "steambench.runtime-action-space-catalog.v1",
      totals: {
        tasks: 1,
        controllerTasks: 1,
        keyboardMouseTasks: 0,
        turnBasedTasks: 0,
        virtualControllerTasks: 1,
        bridgeableTasks: 1,
        readyForSelectedAgent: 1,
        blockedForSelectedAgent: 0
      },
      entries: [
        {
          task: {
            id: "1145360:ESCAPE_TARTARUS",
            appid: 1145360,
            gameName: "Hades"
          },
          actionSpace: {
            schemaVersion: "steambench.runtime-action-space.v1",
            inputMode: "controller",
            transport: "virtual-controller"
          },
          bridge: {
            bridgeable: true
          }
        }
      ],
      recommendedActions: created
        ? [
            {
              id: "inspect-control-bridge-docs",
              method: "GET",
              endpoint: "/api/control-sessions/ops-report?transport=virtual-controller"
            }
          ]
        : [
            {
              id: "create-control-run-session",
              method: "POST",
              endpoint: "/api/agents/agent_controller/run-session",
              body: {
                taskId: "1145360:ESCAPE_TARTARUS",
                createControlSession: true,
                ttlSeconds: 900
              }
            },
            {
              id: "create-agent-run",
              method: "POST",
              endpoint: "/api/agents/agent_controller/runs",
              body: {
                taskId: "1145360:ESCAPE_TARTARUS"
              }
            },
            {
              id: "inspect-control-bridge-docs",
              method: "GET",
              endpoint: "/api/control-sessions/ops-report?transport=virtual-controller"
            }
          ]
    }
  };
}

async function readBody(request) {
  let body = "";
  request.setEncoding("utf8");
  for await (const chunk of request) body += chunk;
  return body ? JSON.parse(body) : {};
}

async function startMockApi() {
  const calls = [];
  let created = false;
  server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const body = request.method === "POST" ? await readBody(request) : {};
    calls.push({ method: request.method, path: url.pathname, search: url.searchParams.toString(), body });
    response.setHeader("content-type", "application/json");

    if (request.method === "GET" && url.pathname === "/api/runtime/action-spaces") {
      response.end(JSON.stringify(catalogPayload(created)));
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/agents/agent_controller/runs") {
      created = true;
      response.statusCode = 201;
      response.end(JSON.stringify({
        run: {
          id: "run_controller",
          taskId: body.taskId
        }
      }));
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/agents/agent_controller/run-session") {
      created = true;
      response.statusCode = 201;
      response.end(JSON.stringify({
        schemaVersion: "steambench.agent-run-session.v1",
        run: {
          id: "run_controller_session",
          taskId: body.taskId
        },
        controlSession: {
          session: {
            id: "session_controller",
            runId: "run_controller_session",
            status: "active"
          }
        },
        accessPacket: {
          audit: {
            readyForActions: true,
            readyForBridge: true
          },
          bridge: {
            executor: {
              command: "npm run executor:geforce-now",
              requestSchemaVersion: "steambench.controller-executor-request.v1",
              reportSchemaVersion: "steambench.controller-executor-report.v1"
            }
          },
          endpoints: {
            actionBatch: "/api/runs/run_controller_session/action-batches",
            bridgeManifest: "/api/control-sessions/session_controller/bridge-manifest",
            executorReport: "/api/runs/run_controller_session/controller-executor-reports"
          }
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

describe("runtime action-spaces CLI runner", () => {
  it("summarizes runtime action spaces without side effects", async () => {
    const { baseUrl, calls } = await startMockApi();

    const summary = await runRuntimeActionSpaces({
      baseUrl,
      agentId: "agent_controller",
      appid: 1145360,
      inputMode: "controller",
      transport: "virtual-controller",
      limit: 5,
      execute: ""
    });

    expect(summary).toMatchObject({
      schemaVersion: "steambench.runtime-action-spaces-cli.v1",
      summary: {
        tasks: 1,
        controllerTasks: 1,
        virtualControllerTasks: 1,
        bridgeableTasks: 1,
        readyForSelectedAgent: 1,
        actions: ["create-control-run-session", "create-agent-run", "inspect-control-bridge-docs"]
      }
    });
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      "GET /api/runtime/action-spaces"
    ]);
    expect(calls[0].search).toContain("agentId=agent_controller");
    expect(calls[0].search).toContain("appid=1145360");
    expect(calls[0].search).toContain("inputMode=controller");
    expect(calls[0].search).toContain("transport=virtual-controller");
  });

  it("creates a control run session only when explicitly requested", async () => {
    const { baseUrl, calls } = await startMockApi();

    const summary = await runRuntimeActionSpaces({
      baseUrl,
      agentId: "agent_controller",
      appid: 1145360,
      inputMode: "controller",
      transport: "virtual-controller",
      limit: 5,
      execute: "create-control-run-session"
    });

    expect(summary).toMatchObject({
      schemaVersion: "steambench.runtime-action-spaces-cli.v1",
      executedAction: {
        action: {
          id: "create-control-run-session",
          endpoint: "/api/agents/agent_controller/run-session"
        },
        result: {
          schemaVersion: "steambench.agent-run-session.v1",
          run: {
            id: "run_controller_session",
            taskId: "1145360:ESCAPE_TARTARUS"
          },
          controlSession: {
            session: {
              id: "session_controller",
              status: "active"
            }
          }
        }
      },
      summary: {
        executedActionId: "create-control-run-session",
        executedActionIds: ["create-control-run-session"],
        executedActionCount: 1,
        createdRunId: "run_controller_session",
        createdTaskId: "1145360:ESCAPE_TARTARUS",
        controlSessionId: "session_controller",
        accessPacketReady: true,
        bridgeReady: true,
        bridgeExecutorCommand: "npm run executor:geforce-now",
        bridgeExecutorRequest: "steambench.controller-executor-request.v1",
        bridgeExecutorReport: "steambench.controller-executor-report.v1",
        actionBatchEndpoint: "/api/runs/run_controller_session/action-batches",
        bridgeManifestEndpoint: "/api/control-sessions/session_controller/bridge-manifest",
        executorReportEndpoint: "/api/runs/run_controller_session/controller-executor-reports"
      }
    });
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      "GET /api/runtime/action-spaces",
      "POST /api/agents/agent_controller/run-session",
      "GET /api/runtime/action-spaces"
    ]);
    expect(calls[1].body).toEqual({
      taskId: "1145360:ESCAPE_TARTARUS",
      createControlSession: true,
      ttlSeconds: 900
    });
  });

  it("creates an agent run only when explicitly requested", async () => {
    const { baseUrl, calls } = await startMockApi();

    const summary = await runRuntimeActionSpaces({
      baseUrl,
      agentId: "agent_controller",
      appid: 1145360,
      inputMode: "controller",
      transport: "virtual-controller",
      limit: 5,
      execute: "create-agent-run"
    });

    expect(summary).toMatchObject({
      schemaVersion: "steambench.runtime-action-spaces-cli.v1",
      executedAction: {
        action: {
          id: "create-agent-run",
          endpoint: "/api/agents/agent_controller/runs"
        },
        result: {
          run: {
            id: "run_controller",
            taskId: "1145360:ESCAPE_TARTARUS"
          }
        }
      },
      summary: {
        executedActionId: "create-agent-run",
        executedActionIds: ["create-agent-run"],
        executedActionCount: 1,
        createdRunId: "run_controller",
        createdTaskId: "1145360:ESCAPE_TARTARUS"
      }
    });
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      "GET /api/runtime/action-spaces",
      "POST /api/agents/agent_controller/runs",
      "GET /api/runtime/action-spaces"
    ]);
    expect(calls[1].body).toEqual({
      taskId: "1145360:ESCAPE_TARTARUS"
    });
  });

  it("advances the bridgeable action-space run handoff and stops before inspection", async () => {
    const { baseUrl, calls } = await startMockApi();

    const summary = await runRuntimeActionSpaces({
      baseUrl,
      agentId: "agent_controller",
      appid: 1145360,
      inputMode: "controller",
      transport: "virtual-controller",
      limit: 5,
      execute: "advance-action-space-actions",
      maxSteps: 2
    });

    expect(summary).toMatchObject({
      schemaVersion: "steambench.runtime-action-spaces-cli.v1",
      summary: {
        executedActionId: "create-control-run-session",
        executedActionIds: ["create-control-run-session"],
        executedActionCount: 1,
        createdRunId: "run_controller_session",
        createdTaskId: "1145360:ESCAPE_TARTARUS",
        controlSessionId: "session_controller",
        accessPacketReady: true,
        bridgeReady: true,
        bridgeExecutorCommand: "npm run executor:geforce-now",
        bridgeExecutorRequest: "steambench.controller-executor-request.v1",
        bridgeExecutorReport: "steambench.controller-executor-report.v1",
        actionBatchEndpoint: "/api/runs/run_controller_session/action-batches",
        bridgeManifestEndpoint: "/api/control-sessions/session_controller/bridge-manifest",
        executorReportEndpoint: "/api/runs/run_controller_session/controller-executor-reports",
        actions: ["inspect-control-bridge-docs"]
      }
    });
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      "GET /api/runtime/action-spaces",
      "POST /api/agents/agent_controller/run-session",
      "GET /api/runtime/action-spaces"
    ]);
    expect(calls[1].body).toEqual({
      taskId: "1145360:ESCAPE_TARTARUS",
      createControlSession: true,
      ttlSeconds: 900
    });
  });
});
