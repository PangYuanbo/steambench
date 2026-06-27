import { createServer } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { runPublicAgent } from "./public-agent.mjs";

let server;

async function readBody(request) {
  let body = "";
  request.setEncoding("utf8");
  for await (const chunk of request) body += chunk;
  return body ? JSON.parse(body) : {};
}

function onboarding(baseUrl, { agent } = {}) {
  const selectedTask = {
    id: "1145360:ESCAPE_TARTARUS",
    appid: 1145360,
    gameName: "Hades",
    title: "Escaped Tartarus",
    track: "achievement",
    level: 7,
    taskStatus: "active",
    runnable: true
  };
  return {
    schemaVersion: "steambench.public-agent-onboarding.v1",
    generatedAt: "2026-06-15T00:00:00.000Z",
    status: agent ? "ready-to-run" : "ready-to-register",
    selectedTask,
    selectedAgent: agent
      ? {
          id: agent.id,
          handle: agent.handle,
          displayName: agent.displayName,
          provider: agent.provider,
          runtimeProvider: agent.runtimeProvider,
          status: "active",
          capabilities: agent.capabilities
        }
      : undefined,
    registration: {
      endpoint: `${baseUrl}/api/agents`,
      method: "POST",
      provider: "external",
      runtimeProvider: "local-sim",
      requiredCapabilities: ["output.mp4", "screen-capture", "controller", "seeded-save"],
      recommendedCapabilities: ["output.mp4", "screen-capture", "controller", "seeded-save", "virtual-controller", "geforce-now-bridge"],
      requestBodyTemplate: {
        handle: "external-agent",
        displayName: "External Runtime Agent",
        provider: "external",
        runtimeProvider: "local-sim",
        command: "external-runner consumes public action-space and submits action batches",
        capabilities: ["output.mp4", "screen-capture", "controller", "seeded-save"]
      }
    },
    readiness: {
      ready: Boolean(agent),
      agentId: agent?.id,
      taskId: selectedTask.id,
      appid: selectedTask.appid,
      requiredCapabilities: ["output.mp4", "screen-capture", "controller", "seeded-save"],
      providedCapabilities: agent?.capabilities ?? [],
      missingCapabilities: agent ? [] : ["output.mp4", "screen-capture", "controller", "seeded-save"],
      warnings: agent ? [] : ["No agent profile selected; using generic runtime defaults."]
    },
    actionSpace: {
      publicPacket: `${baseUrl}/api/public/tasks/1145360%3AESCAPE_TARTARUS/action-space${agent ? `?agentId=${agent.id}` : ""}`,
      schemaVersion: "steambench.runtime-action-space.v1",
      inputMode: "controller",
      transport: "virtual-controller",
      allowedActionTypes: ["button", "stick", "trigger", "wait"],
      bridgeable: true,
      requiresControlSession: true,
      exampleActions: ["stick:left:0.80,0.00", "button:a:tap"]
    },
    runEntry: {
      runnerContract: `${baseUrl}/api/public/tasks/1145360%3AESCAPE_TARTARUS/runner-contract${agent ? `?agentId=${agent.id}` : ""}`,
      runSession: agent ? `${baseUrl}/api/agents/${agent.id}/run-session` : undefined,
      createRun: agent ? `${baseUrl}/api/agents/${agent.id}/runs` : undefined,
      runSessionBodyTemplate: {
        taskId: selectedTask.id,
        createControlSession: true,
        ttlSeconds: 900
      }
    },
    taskRecommendations: [
      {
        task: selectedTask,
        readiness: {
          ready: Boolean(agent),
          missingCapabilities: agent ? [] : ["controller"]
        },
        actionSpace: {
          inputMode: "controller",
          transport: "virtual-controller",
          allowedActionTypes: ["button", "stick", "trigger", "wait"]
        },
        bridgeable: true
      }
    ],
    nextActions: agent
      ? ["Fetch the public task action-space packet."]
      : ["Register an agent profile with the request body template."],
    links: {
      agents: `${baseUrl}/api/agents`,
      agentOps: `${baseUrl}/api/agents/ops-report`,
      runtimeActionSpaces: `${baseUrl}/api/runtime/action-spaces`
    }
  };
}

async function startMockPublicAgentApi() {
  const calls = [];
  let registeredAgent;
  server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const body = request.method === "POST" ? await readBody(request) : undefined;
    calls.push({ method: request.method, path: url.pathname, search: url.search, body });
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    response.setHeader("content-type", "application/json");

    if (request.method === "GET" && url.pathname === "/api/public/agents/onboarding") {
      const agentId = url.searchParams.get("agentId");
      response.end(JSON.stringify({
        onboarding: onboarding(baseUrl, { agent: agentId && registeredAgent?.id === agentId ? registeredAgent : undefined })
      }));
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/agents") {
      registeredAgent = {
        id: "agent_public_1",
        handle: body.handle,
        displayName: body.displayName,
        provider: body.provider,
        runtimeProvider: body.runtimeProvider,
        command: body.command,
        capabilities: body.capabilities,
        status: "active"
      };
      response.statusCode = 201;
      response.end(JSON.stringify({ agent: registeredAgent }));
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
  if (server) {
    await new Promise((resolve) => server.close(resolve));
    server = undefined;
  }
});

describe("public agent CLI", () => {
  it("inspects public agent onboarding without registering", async () => {
    const { baseUrl, calls } = await startMockPublicAgentApi();

    const result = await runPublicAgent({
      baseUrl,
      taskId: "1145360:ESCAPE_TARTARUS",
      provider: "external",
      execute: "inspect",
      limit: 4
    });

    expect(result).toMatchObject({
      schemaVersion: "steambench.public-agent-cli.v1",
      execute: "inspect",
      validation: {
        valid: true,
        errors: []
      },
      summary: {
        valid: true,
        status: "ready-to-register",
        selectedTaskId: "1145360:ESCAPE_TARTARUS",
        selectedAppid: 1145360,
        ready: false,
        actionSpaceInputMode: "controller",
        actionSpaceTransport: "virtual-controller",
        bridgeable: true,
        registered: false
      }
    });
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      "GET /api/public/agents/onboarding"
    ]);
    expect(calls[0].search).toContain("taskId=1145360%3AESCAPE_TARTARUS");
  });

  it("registers an agent from the onboarding template and refreshes readiness", async () => {
    const { baseUrl, calls } = await startMockPublicAgentApi();

    const result = await runPublicAgent({
      baseUrl,
      taskId: "1145360:ESCAPE_TARTARUS",
      provider: "external",
      execute: "register",
      handle: "public-agent",
      displayName: "Public Agent",
      limit: 4
    });

    expect(result).toMatchObject({
      schemaVersion: "steambench.public-agent-cli.v1",
      execute: "register",
      validation: {
        valid: true,
        errors: []
      },
      registration: {
        agent: {
          id: "agent_public_1",
          handle: "public-agent",
          displayName: "Public Agent",
          provider: "external",
          runtimeProvider: "local-sim"
        }
      },
      summary: {
        status: "ready-to-run",
        agentId: "agent_public_1",
        agentHandle: "public-agent",
        ready: true,
        registered: true,
        runSession: `${baseUrl}/api/agents/agent_public_1/run-session`
      }
    });
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      "GET /api/public/agents/onboarding",
      "POST /api/agents",
      "GET /api/public/agents/onboarding"
    ]);
    expect(calls[1].body).toMatchObject({
      handle: "public-agent",
      displayName: "Public Agent",
      provider: "external",
      runtimeProvider: "local-sim",
      capabilities: ["output.mp4", "screen-capture", "controller", "seeded-save"]
    });
    expect(calls[2].search).toContain("agentId=agent_public_1");
  });
});
