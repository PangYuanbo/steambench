import { createServer } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { runHumanOnboardingOps } from "./human-onboarding-ops.mjs";

let server;

async function readBody(request) {
  let body = "";
  request.setEncoding("utf8");
  for await (const chunk of request) body += chunk;
  return body ? JSON.parse(body) : {};
}

function reportPayload(state) {
  const hasHuman = state !== "empty";
  const linked = state === "linked" || state === "registered";
  const registered = state === "registered";
  const recommendedActions = [];
  if (registered) {
    recommendedActions.push(
      {
        id: "inspect-event-registrations",
        method: "GET",
        endpoint: "/api/competition-events/registrations"
      },
      {
        id: "inspect-human-proof-ops",
        method: "GET",
        endpoint: "/api/human-proof/ops-report"
      }
    );
  } else if (linked) {
    recommendedActions.push(
      {
        id: "register-event",
        method: "POST",
        endpoint: "/api/competition-events/weekly/register",
        body: {
          participantType: "human",
          participantId: "human_a"
        }
      },
      {
        id: "inspect-event-registrations",
        method: "GET",
        endpoint: "/api/competition-events/registrations"
      }
    );
  } else if (hasHuman) {
    recommendedActions.push(
      {
        id: "link-steam",
        method: "POST",
        endpoint: "/api/users/human_a/steam"
      },
      {
        id: "inspect-human-proof-ops",
        method: "GET",
        endpoint: "/api/human-proof/ops-report"
      }
    );
  } else {
    recommendedActions.push(
      {
        id: "create-human",
        method: "POST",
        endpoint: "/api/users",
        body: {
          type: "human"
        }
      },
      {
        id: "inspect-event-registrations",
        method: "GET",
        endpoint: "/api/competition-events/registrations"
      }
    );
  }

  return {
    report: {
      schemaVersion: "steambench.human-onboarding-ops-report.v1",
      status: registered ? "event-covered" : linked ? "ready-to-register" : hasHuman ? "needs-human-onboarding" : "idle",
      filters: {
        scope: "weekly",
        limit: 1
      },
      totals: {
        humans: hasHuman ? 1 : 0,
        selectedHumans: hasHuman ? 1 : 0,
        linked: linked ? 1 : 0,
        consented: linked ? 1 : 0,
        registeredHumans: registered ? 1 : 0,
        readyForRegistration: linked && !registered ? 1 : 0,
        consentRequired: 0,
        steamNotLinked: hasHuman && !linked ? 1 : 0
      },
      tickets: hasHuman
        ? [
            {
              status: registered ? "event-registered" : linked ? "ready-for-event-registration" : "steam-not-linked",
              user: { id: "human_a", handle: "pilot" }
            }
          ]
        : [],
      recommendedActions,
      links: {
        proofOps: "/api/human-proof/ops-report",
        eventRegistrations: "/api/competition-events/registrations"
      }
    }
  };
}

async function startMockApi() {
  const calls = [];
  let state = "empty";
  server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const body = request.method === "POST" ? await readBody(request) : {};
    calls.push({ method: request.method, path: url.pathname, search: url.searchParams.toString(), body });
    response.setHeader("content-type", "application/json");

    if (request.method === "GET" && url.pathname === "/api/human-onboarding/ops-report") {
      response.end(JSON.stringify(reportPayload(state)));
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/users") {
      state = "unlinked";
      response.statusCode = 201;
      response.end(JSON.stringify({
        user: {
          id: "human_a",
          handle: body.handle,
          displayName: body.displayName,
          type: "human"
        }
      }));
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/users/human_a/steam") {
      state = body.proofConsent ? "linked" : "unlinked";
      response.end(JSON.stringify({
        user: {
          id: "human_a",
          linkedSteamId: body.steamid,
          proofConsentAt: body.proofConsent ? "2026-06-14T00:00:00.000Z" : undefined
        }
      }));
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/competition-events/weekly/register") {
      state = "registered";
      response.statusCode = 201;
      response.end(JSON.stringify({
        registration: {
          eventScope: "weekly",
          participantType: body.participantType,
          participantId: body.participantId,
          status: "registered"
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

describe("human onboarding ops CLI runner", () => {
  it("summarizes onboarding recommendations without side effects", async () => {
    const { baseUrl, calls } = await startMockApi();

    const summary = await runHumanOnboardingOps({
      baseUrl,
      scope: "weekly",
      limit: 1,
      execute: ""
    });

    expect(summary).toMatchObject({
      schemaVersion: "steambench.human-onboarding-ops-cli.v1",
      summary: {
        status: "idle",
        humans: 0,
        selectedHumans: 0,
        actions: ["create-human", "inspect-event-registrations"]
      }
    });
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      "GET /api/human-onboarding/ops-report"
    ]);
    expect(calls[0].search).toContain("scope=weekly");
    expect(calls[0].search).toContain("limit=1");
  });

  it("advances human creation, Steam linking, and event registration", async () => {
    const { baseUrl, calls } = await startMockApi();

    const summary = await runHumanOnboardingOps({
      baseUrl,
      scope: "weekly",
      limit: 1,
      execute: "advance-onboarding-actions",
      maxSteps: 4,
      handle: "pilot",
      displayName: "Pilot",
      steamid: "76561198000000065",
      proofConsent: true,
      notes: "weekly onboarding"
    });

    expect(summary).toMatchObject({
      schemaVersion: "steambench.human-onboarding-ops-cli.v1",
      executedAction: {
        action: { id: "create-human" }
      },
      summary: {
        status: "event-covered",
        humans: 1,
        linked: 1,
        consented: 1,
        registeredHumans: 1,
        steamNotLinked: 0,
        actions: ["inspect-event-registrations", "inspect-human-proof-ops"],
        executedActionId: "create-human",
        executedActionIds: [
          "create-human",
          "link-steam",
          "register-event"
        ],
        executedActionCount: 3,
        createdUserId: "human_a",
        linkedUserId: "human_a",
        registeredParticipantId: "human_a"
      }
    });
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      "GET /api/human-onboarding/ops-report",
      "POST /api/users",
      "GET /api/human-onboarding/ops-report",
      "POST /api/users/human_a/steam",
      "GET /api/human-onboarding/ops-report",
      "POST /api/competition-events/weekly/register",
      "GET /api/human-onboarding/ops-report"
    ]);
    expect(calls[1].body).toEqual({
      type: "human",
      handle: "pilot",
      displayName: "Pilot"
    });
    expect(calls[3].body).toEqual({
      steamid: "76561198000000065",
      proofConsent: true
    });
    expect(calls[5].body).toEqual({
      participantType: "human",
      participantId: "human_a",
      notes: "weekly onboarding"
    });
  });
});
