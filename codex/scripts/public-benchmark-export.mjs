import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseCliArgs } from "./steam-ingest.mjs";

const args = parseCliArgs();
const seasonScopes = new Set(["all", "daily", "weekly"]);

function boolArg(name, fallback = false) {
  const value = args.get(name);
  if (value === undefined) return fallback;
  return value === "1" || value === "true" || value === "yes";
}

function intArg(name, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const value = args.get(name);
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

function configFromArgs() {
  const season = args.get("season") ?? "weekly";
  if (!seasonScopes.has(season)) {
    throw new Error("Provide --season=all|daily|weekly.");
  }
  return {
    baseUrl: args.get("api") ?? process.env.STEAMBENCH_API_URL ?? "http://127.0.0.1:8787",
    season,
    appid: Number(args.get("appid") ?? 620),
    taskId: args.get("task-id") ?? args.get("task"),
    limit: intArg("limit", 12, { min: 1, max: 50 }),
    includeIntake: boolArg("intake", true),
    useFixture: boolArg("fixture", boolArg("use-fixture", false)),
    refresh: boolArg("refresh", false),
    includeCertificateIndex: boolArg("certificates", true),
    out: args.get("out")
  };
}

function apiUrl(baseUrl, path) {
  if (/^https?:\/\//.test(path)) return path;
  return `${baseUrl.replace(/\/$/, "")}${path.startsWith("/") ? path : `/${path}`}`;
}

async function readJson(baseUrl, path) {
  const url = apiUrl(baseUrl, path);
  const response = await fetch(url, {
    headers: { "content-type": "application/json" }
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;
  if (!response.ok) {
    const error = new Error(`${url} failed with ${response.status}: ${text}`);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return payload;
}

function validateBundle({ config, catalog, publicStandings, hub, eventEntry, quickstart, snapshot, steamIntake, agentOnboarding, gamePack, taskScoreboard, taskActionSpace, bridgeHandoff, raceEntry, runnerContract, certificateIndex }) {
  const errors = [];
  if (catalog?.schemaVersion !== "steambench.public-catalog.v1") errors.push("invalid_catalog_schema");
  if (catalog?.scope !== config.season) errors.push("catalog_scope_mismatch");
  if (catalog?.canonicalArtifactName !== "output.mp4") errors.push("catalog_artifact_mismatch");
  if (!catalog?.games?.some((game) => game.appid === config.appid)) errors.push("catalog_game_missing");
  if (!catalog?.tasks?.some((task) => task.id === config.taskId)) errors.push("catalog_task_missing");
  if (!String(catalog?.entrypoints?.quickstartTemplate ?? "").includes("/api/public/quickstart")) errors.push("catalog_quickstart_template_missing");
  if (!String(catalog?.entrypoints?.bridgeHandoffTemplate ?? "").includes("/api/public/tasks/{taskId}/bridge-handoff")) errors.push("catalog_bridge_template_missing");
  if (publicStandings?.schemaVersion !== "steambench.public-standings.v1") errors.push("invalid_public_standings_schema");
  if (publicStandings?.scope !== config.season) errors.push("public_standings_scope_mismatch");
  if (publicStandings?.canonicalArtifactName !== "output.mp4") errors.push("public_standings_artifact_mismatch");
  if (publicStandings?.filters?.appid !== config.appid) errors.push("public_standings_appid_mismatch");
  if (!String(publicStandings?.entrypoints?.taskScoreboardTemplate ?? "").includes("/api/public/tasks/{taskId}/scoreboard")) errors.push("public_standings_scoreboard_template_missing");
  if (!String(publicStandings?.links?.catalog ?? "").includes("/api/public/catalog")) errors.push("public_standings_catalog_link_missing");
  if (hub?.schemaVersion !== "steambench.public-competition-hub.v1") errors.push("invalid_hub_schema");
  if (hub?.scope !== config.season) errors.push("hub_scope_mismatch");
  if (hub?.selected?.game?.appid !== config.appid) errors.push("hub_appid_mismatch");
  if (hub?.selected?.task?.id !== config.taskId) errors.push("hub_task_mismatch");
  if (hub?.canonicalArtifactName !== "output.mp4") errors.push("hub_artifact_mismatch");
  if (!String(hub?.entrypoints?.taskRaceEntryTemplate ?? "").includes("/api/public/tasks/{taskId}/race-entry")) errors.push("hub_race_entry_template_missing");
  if (!String(hub?.entrypoints?.quickstartTemplate ?? "").includes("/api/public/quickstart")) errors.push("hub_quickstart_template_missing");
  if (!String(hub?.entrypoints?.eventEntryTemplate ?? "").includes("/api/public/events/")) errors.push("hub_event_entry_template_missing");
  if (eventEntry?.schemaVersion !== "steambench.public-event-entry.v1") errors.push("invalid_event_entry_schema");
  if (eventEntry?.scope !== config.season) errors.push("event_entry_scope_mismatch");
  if (eventEntry?.selected?.task?.id !== config.taskId) errors.push("event_entry_task_mismatch");
  if (eventEntry?.canonicalArtifactName !== "output.mp4") errors.push("event_entry_artifact_mismatch");
  if (eventEntry?.registration?.method !== "POST") errors.push("event_entry_registration_method_missing");
  if (eventEntry?.packets?.raceEntry?.schemaVersion !== "steambench.public-task-race-entry.v1") errors.push("event_entry_race_packet_missing");
  if (eventEntry?.packets?.bridgeHandoff?.schemaVersion !== "steambench.public-bridge-handoff.v1") errors.push("event_entry_bridge_packet_missing");
  if (eventEntry?.packets?.opsReport?.schemaVersion !== "steambench.competition-event-ops-report.v1") errors.push("event_entry_ops_packet_missing");
  if (quickstart?.schemaVersion !== "steambench.public-quickstart.v1") errors.push("invalid_quickstart_schema");
  if (quickstart?.scope !== config.season) errors.push("quickstart_scope_mismatch");
  if (quickstart?.selected?.game?.appid !== config.appid) errors.push("quickstart_appid_mismatch");
  if (quickstart?.selected?.task?.id !== config.taskId) errors.push("quickstart_task_mismatch");
  if (quickstart?.canonicalArtifactName !== "output.mp4") errors.push("quickstart_artifact_mismatch");
  if (!Array.isArray(quickstart?.steps) || quickstart.steps.length < 10) errors.push("quickstart_steps_missing");
  if (!quickstart?.steps?.some((step) => step.id === "agent-run-session")) errors.push("quickstart_run_session_step_missing");
  if (!quickstart?.steps?.some((step) => step.id === "submit-evidence" && step.bodyTemplate?.artifactPath === "output/output.mp4")) errors.push("quickstart_canonical_artifact_step_missing");
  if (snapshot?.schemaVersion !== "steambench.public-benchmark-snapshot.v1") errors.push("invalid_snapshot_schema");
  if (snapshot?.scope !== config.season) errors.push("snapshot_scope_mismatch");
  if (snapshot?.canonicalArtifactName !== "output.mp4") errors.push("snapshot_artifact_mismatch");
  if (steamIntake) {
    if (steamIntake?.schemaVersion !== "steambench.public-steam-app-intake.v1") errors.push("invalid_steam_intake_schema");
    if (steamIntake?.appid !== config.appid) errors.push("steam_intake_appid_mismatch");
    if (steamIntake?.canonicalArtifactName !== "output.mp4") errors.push("steam_intake_artifact_mismatch");
    if (steamIntake?.dataPolicy?.officialSteamSourcesOnly !== true) errors.push("steam_intake_policy_missing");
    if (!Array.isArray(steamIntake?.taskPipeline?.taskLadder) || steamIntake.taskPipeline.taskLadder.length === 0) errors.push("steam_intake_task_ladder_missing");
    if (!Array.isArray(steamIntake?.onboarding?.stages) || steamIntake.onboarding.stages.length < 5) errors.push("steam_intake_onboarding_missing");
    if (steamIntake?.runtimeContract?.targetArtifactName !== "output.mp4") errors.push("steam_intake_runtime_artifact_mismatch");
    if (!String(steamIntake?.publicEntrypoints?.raceEntryTemplate ?? "").includes("/api/public/tasks/{taskId}/race-entry")) errors.push("steam_intake_race_entry_template_missing");
    if (!String(steamIntake?.publicEntrypoints?.runnerContractTemplate ?? "").includes("/api/public/tasks/{taskId}/runner-contract")) errors.push("steam_intake_runner_template_missing");
  }
	  if (gamePack?.schemaVersion !== "steambench.public-game-benchmark-pack.v1") errors.push("invalid_game_pack_schema");
	  if (gamePack?.appid !== config.appid) errors.push("game_pack_appid_mismatch");
	  if (gamePack?.scope !== config.season) errors.push("game_pack_scope_mismatch");
	  if (gamePack?.canonicalArtifactName !== "output.mp4") errors.push("game_pack_artifact_mismatch");
	  if (agentOnboarding?.schemaVersion !== "steambench.public-agent-onboarding.v1") errors.push("invalid_agent_onboarding_schema");
	  if (agentOnboarding?.selectedTask?.id !== config.taskId) errors.push("agent_onboarding_task_mismatch");
	  if (!Array.isArray(agentOnboarding?.registration?.requiredCapabilities) || agentOnboarding.registration.requiredCapabilities.length === 0) errors.push("agent_onboarding_capabilities_missing");
	  if (!String(agentOnboarding?.actionSpace?.publicPacket ?? "").includes("/api/public/tasks/")) errors.push("agent_onboarding_action_space_missing");
	  if (taskScoreboard?.schemaVersion !== "steambench.public-task-scoreboard.v1") errors.push("invalid_task_scoreboard_schema");
  if (taskScoreboard?.scope !== config.season) errors.push("task_scoreboard_scope_mismatch");
  if (taskScoreboard?.canonicalArtifactName !== "output.mp4") errors.push("task_scoreboard_artifact_mismatch");
  if (taskScoreboard?.task?.id !== config.taskId) errors.push("task_scoreboard_task_mismatch");
  if (taskActionSpace?.schemaVersion !== "steambench.public-task-action-space.v1") errors.push("invalid_task_action_space_schema");
  if (taskActionSpace?.canonicalArtifactName !== "output.mp4") errors.push("task_action_space_artifact_mismatch");
  if (taskActionSpace?.task?.id !== config.taskId) errors.push("task_action_space_task_mismatch");
  if (taskActionSpace?.task?.appid !== config.appid) errors.push("task_action_space_appid_mismatch");
  if (taskActionSpace?.permissions?.privilegedSystemInput !== false) errors.push("task_action_space_privileged_input_enabled");
  if (taskActionSpace?.permissions?.constraints?.requireCanonicalCapture !== true) errors.push("task_action_space_capture_not_required");
  if (!Array.isArray(taskActionSpace?.permissions?.allowedActionTypes) || taskActionSpace.permissions.allowedActionTypes.length === 0) errors.push("task_action_space_actions_missing");
  if (bridgeHandoff?.schemaVersion !== "steambench.public-bridge-handoff.v1") errors.push("invalid_bridge_handoff_schema");
  if (bridgeHandoff?.task?.id !== config.taskId) errors.push("bridge_handoff_task_mismatch");
  if (bridgeHandoff?.canonicalArtifactName !== "output.mp4") errors.push("bridge_handoff_artifact_mismatch");
  if (bridgeHandoff?.permissions?.privilegedSystemInput !== false) errors.push("bridge_handoff_privileged_input_enabled");
  if (bridgeHandoff?.grant?.bodyTemplate?.taskId !== config.taskId) errors.push("bridge_handoff_grant_task_mismatch");
  if (bridgeHandoff?.postGrantPackets?.accessPacket?.schemaVersion !== "steambench.runtime-control-access-packet.v1") errors.push("bridge_handoff_access_packet_missing");
  if (bridgeHandoff?.postGrantPackets?.bridgeManifest?.schemaVersion !== "steambench.control-bridge-manifest.v1") errors.push("bridge_handoff_manifest_missing");
  if (bridgeHandoff?.executor?.requestSchemaVersion !== "steambench.controller-executor-request.v1") errors.push("bridge_handoff_executor_request_missing");
  if (bridgeHandoff?.executor?.reportSchemaVersion !== "steambench.controller-executor-report.v1") errors.push("bridge_handoff_executor_report_missing");
  if (bridgeHandoff?.evidence?.canonicalArtifact !== "output/output.mp4") errors.push("bridge_handoff_canonical_artifact_mismatch");
  if (raceEntry?.schemaVersion !== "steambench.public-task-race-entry.v1") errors.push("invalid_race_entry_schema");
  if (raceEntry?.task?.id !== config.taskId) errors.push("race_entry_task_mismatch");
  if (raceEntry?.canonicalArtifactName !== "output.mp4") errors.push("race_entry_artifact_mismatch");
  if (raceEntry?.actionSpace?.task?.id !== config.taskId) errors.push("race_entry_action_space_mismatch");
  if (raceEntry?.match?.preflight?.bodyTemplate?.taskId !== config.taskId) errors.push("race_entry_preflight_task_mismatch");
  if (!String(raceEntry?.runnerContract?.endpoint ?? "").includes("/api/public/tasks/")) errors.push("race_entry_runner_link_missing");
  if (runnerContract?.schemaVersion !== "steambench.public-task-runner-contract.v1") errors.push("invalid_runner_contract_schema");
  if (runnerContract?.canonicalArtifactName !== "output.mp4") errors.push("runner_contract_artifact_mismatch");
  if (runnerContract?.proof?.canonicalArtifactPath !== "output/output.mp4") errors.push("runner_contract_proof_path_mismatch");
  if (runnerContract?.task?.appid !== config.appid) errors.push("runner_contract_appid_mismatch");
  if (!gamePack?.tasks?.some((task) => task.id === runnerContract?.task?.id)) errors.push("runner_contract_task_not_in_game_pack");
  if (certificateIndex && certificateIndex?.schemaVersion !== "steambench.result-certificate-index.v1") errors.push("invalid_certificate_index_schema");
  if (certificateIndex && certificateIndex?.requested?.readyForPublicShare !== true) errors.push("certificate_index_not_public_ready");
  return errors;
}

async function writeOutput(out, bundle) {
  const outputPath = resolve(out);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(bundle, null, 2)}\n`, "utf8");
  return outputPath;
}

async function runPublicBenchmarkExport(config = configFromArgs()) {
  config = {
    includeIntake: true,
    useFixture: false,
    refresh: false,
    includeCertificateIndex: true,
    ...config
  };
  if (!Number.isInteger(config.appid) || config.appid <= 0) {
    throw new Error("Provide --appid=<positive integer>.");
  }
  const snapshotPath = `/api/public/benchmark-snapshot?season=${encodeURIComponent(config.season)}&limit=${encodeURIComponent(String(config.limit))}`;
  const catalogPath = `/api/public/catalog?season=${encodeURIComponent(config.season)}&appid=${encodeURIComponent(String(config.appid))}&provider=external&limit=${encodeURIComponent(String(config.limit))}`;
  const publicStandingsPath = `/api/public/standings?season=${encodeURIComponent(config.season)}&appid=${encodeURIComponent(String(config.appid))}&limit=${encodeURIComponent(String(config.limit))}`;
  const intakeQuery = new URLSearchParams();
  intakeQuery.set("limit", String(config.limit));
  if (config.useFixture) intakeQuery.set("useFixture", "true");
  if (config.refresh) intakeQuery.set("refresh", "true");
  const steamIntakePath = `/api/public/steam/apps/${encodeURIComponent(String(config.appid))}/intake?${intakeQuery}`;
  const gamePackPath = `/api/public/games/${encodeURIComponent(String(config.appid))}/benchmark-pack?season=${encodeURIComponent(config.season)}&limit=${encodeURIComponent(String(config.limit))}`;
  const catalogPayload = await readJson(config.baseUrl, catalogPath);
  const publicStandingsPayload = await readJson(config.baseUrl, publicStandingsPath);
  const snapshotPayload = await readJson(config.baseUrl, snapshotPath);
  const steamIntakePayload = config.includeIntake
    ? await readJson(config.baseUrl, steamIntakePath)
    : undefined;
  const gamePackPayload = await readJson(config.baseUrl, gamePackPath);
  const gamePack = gamePackPayload?.pack;
  const selectedTaskId = config.taskId ?? gamePack?.tasks?.[0]?.id;
  if (!selectedTaskId) {
    throw new Error("No task id available. Provide --task-id or choose a game pack with tasks.");
  }
  const hubPath = `/api/public/competition-hub?season=${encodeURIComponent(config.season)}&appid=${encodeURIComponent(String(config.appid))}&taskId=${encodeURIComponent(selectedTaskId)}&provider=external&limit=${encodeURIComponent(String(config.limit))}`;
  const hubPayload = await readJson(config.baseUrl, hubPath);
  const eventEntryPath = `/api/public/events/${encodeURIComponent(config.season)}/entry?appid=${encodeURIComponent(String(config.appid))}&taskId=${encodeURIComponent(selectedTaskId)}&provider=external&limit=${encodeURIComponent(String(config.limit))}`;
  const eventEntryPayload = await readJson(config.baseUrl, eventEntryPath);
  const quickstartPath = `/api/public/quickstart?season=${encodeURIComponent(config.season)}&appid=${encodeURIComponent(String(config.appid))}&taskId=${encodeURIComponent(selectedTaskId)}&provider=external&limit=${encodeURIComponent(String(config.limit))}`;
  const quickstartPayload = await readJson(config.baseUrl, quickstartPath);
	  const taskScoreboardPath = `/api/public/tasks/${encodeURIComponent(selectedTaskId)}/scoreboard?season=${encodeURIComponent(config.season)}&limit=${encodeURIComponent(String(config.limit))}`;
	  const taskScoreboardPayload = await readJson(config.baseUrl, taskScoreboardPath);
	  const agentOnboardingPath = `/api/public/agents/onboarding?taskId=${encodeURIComponent(selectedTaskId)}&provider=external&limit=${encodeURIComponent(String(config.limit))}`;
	  const agentOnboardingPayload = await readJson(config.baseUrl, agentOnboardingPath);
	  const taskActionSpacePath = `/api/public/tasks/${encodeURIComponent(selectedTaskId)}/action-space`;
	  const taskActionSpacePayload = await readJson(config.baseUrl, taskActionSpacePath);
  const bridgeHandoffPath = `/api/public/tasks/${encodeURIComponent(selectedTaskId)}/bridge-handoff?provider=external&ttlSeconds=900`;
  const bridgeHandoffPayload = await readJson(config.baseUrl, bridgeHandoffPath);
  const raceEntryPath = `/api/public/tasks/${encodeURIComponent(selectedTaskId)}/race-entry?provider=external&limit=${encodeURIComponent(String(config.limit))}`;
  const raceEntryPayload = await readJson(config.baseUrl, raceEntryPath);
  const runnerPath = `/api/public/tasks/${encodeURIComponent(selectedTaskId)}/runner-contract`;
  const runnerPayload = await readJson(config.baseUrl, runnerPath);
  const certificateIndexPayload = config.includeCertificateIndex
    ? await readJson(config.baseUrl, `/api/result-certificates?kind=all&limit=${encodeURIComponent(String(config.limit))}`)
    : undefined;
  const bundle = {
    schemaVersion: "steambench.public-benchmark-export.v1",
    generatedAt: new Date().toISOString(),
    api: config.baseUrl,
    request: {
      season: config.season,
      appid: config.appid,
      taskId: selectedTaskId,
      limit: config.limit,
      intake: config.includeIntake,
      fixture: config.useFixture,
      refresh: config.refresh,
      certificates: config.includeCertificateIndex
    },
    sources: {
      catalog: apiUrl(config.baseUrl, catalogPath),
      publicStandings: apiUrl(config.baseUrl, publicStandingsPath),
      hub: apiUrl(config.baseUrl, hubPath),
      eventEntry: apiUrl(config.baseUrl, eventEntryPath),
      quickstart: apiUrl(config.baseUrl, quickstartPath),
      snapshot: apiUrl(config.baseUrl, snapshotPath),
      steamIntake: config.includeIntake ? apiUrl(config.baseUrl, steamIntakePath) : undefined,
	      gamePack: apiUrl(config.baseUrl, gamePackPath),
	      agentOnboarding: apiUrl(config.baseUrl, agentOnboardingPath),
      taskScoreboard: apiUrl(config.baseUrl, taskScoreboardPath),
      taskActionSpace: apiUrl(config.baseUrl, taskActionSpacePath),
      bridgeHandoff: apiUrl(config.baseUrl, bridgeHandoffPath),
      raceEntry: apiUrl(config.baseUrl, raceEntryPath),
      runnerContract: apiUrl(config.baseUrl, runnerPath),
      certificateIndex: config.includeCertificateIndex
        ? apiUrl(config.baseUrl, `/api/result-certificates?kind=all&limit=${config.limit}`)
        : undefined
    },
    catalog: catalogPayload?.catalog,
    publicStandings: publicStandingsPayload?.standings,
    hub: hubPayload?.hub,
    eventEntry: eventEntryPayload?.entry,
    quickstart: quickstartPayload?.quickstart,
    snapshot: snapshotPayload?.snapshot,
	    steamIntake: steamIntakePayload?.intake,
	    agentOnboarding: agentOnboardingPayload?.onboarding,
	    gamePack,
    taskScoreboard: taskScoreboardPayload?.scoreboard,
    taskActionSpace: taskActionSpacePayload?.actionSpace,
    bridgeHandoff: bridgeHandoffPayload?.handoff,
    raceEntry: raceEntryPayload?.raceEntry,
    runnerContract: runnerPayload?.contract,
    certificateIndex: certificateIndexPayload?.index
  };
  const errors = validateBundle({
    config: { ...config, taskId: selectedTaskId },
    catalog: bundle.catalog,
    publicStandings: bundle.publicStandings,
    hub: bundle.hub,
    eventEntry: bundle.eventEntry,
    quickstart: bundle.quickstart,
	    snapshot: bundle.snapshot,
	    steamIntake: bundle.steamIntake,
	    agentOnboarding: bundle.agentOnboarding,
	    gamePack: bundle.gamePack,
    taskScoreboard: bundle.taskScoreboard,
    taskActionSpace: bundle.taskActionSpace,
    bridgeHandoff: bundle.bridgeHandoff,
    raceEntry: bundle.raceEntry,
    runnerContract: bundle.runnerContract,
    certificateIndex: bundle.certificateIndex
  });
  const summary = {
    valid: errors.length === 0,
    errors,
    activeTasks: bundle.snapshot?.totals?.activeTasks,
    catalogGames: bundle.catalog?.games?.length ?? 0,
    catalogTasks: bundle.catalog?.tasks?.length ?? 0,
    catalogBridgeableTasks: bundle.catalog?.totals?.bridgeableTasks,
    publicStandingsRows: bundle.publicStandings?.totals?.rows,
    publicStandingsTaskLeaderboards: bundle.publicStandings?.taskLeaderboards?.length ?? 0,
    hubGames: bundle.hub?.games?.length ?? 0,
    hubFeaturedTasks: bundle.hub?.featuredTasks?.length ?? 0,
    hubSelectedTaskId: bundle.hub?.selected?.task?.id,
    eventEntryScope: bundle.eventEntry?.scope,
    eventEntryHumanStatus: bundle.eventEntry?.readiness?.human?.status,
    eventEntryAgentStatus: bundle.eventEntry?.readiness?.agent?.status,
    eventEntryRegisteredPairs: bundle.eventEntry?.readiness?.eventOps?.registeredPairs,
    quickstartSteps: bundle.quickstart?.steps?.length ?? 0,
    quickstartHumanStatus: bundle.quickstart?.readiness?.human?.status,
    quickstartAgentStatus: bundle.quickstart?.readiness?.agent?.status,
    intakeReadiness: bundle.steamIntake?.publicReadiness,
    intakeSourceStatus: bundle.steamIntake?.intake?.sourceStatus,
    intakeSourceRecords: bundle.steamIntake?.sourceCoverage?.totals?.sourceRecords,
	    gameTasks: bundle.gamePack?.tasks?.length ?? 0,
	    suites: bundle.gamePack?.suites?.length ?? 0,
	    agentOnboardingStatus: bundle.agentOnboarding?.status,
	    agentRequiredCapabilities: bundle.agentOnboarding?.registration?.requiredCapabilities,
	    taskScoreboardRows: bundle.taskScoreboard?.totals?.rows ?? 0,
    taskScoreboardMatchup: bundle.taskScoreboard?.matchup?.status,
    actionSpaceInputMode: bundle.taskActionSpace?.permissions?.inputMode,
    actionSpaceTransport: bundle.taskActionSpace?.permissions?.transport,
    actionSpaceBridgeable: bundle.taskActionSpace?.bridge?.bridgeable,
    bridgeHandoffStatus: bundle.bridgeHandoff?.status,
    bridgeHandoffBridgeable: bundle.bridgeHandoff?.bridgeable,
    bridgeHandoffGrantCreatesControlSession: bundle.bridgeHandoff?.grant?.createsControlSession,
    raceEntryHumanStatus: bundle.raceEntry?.human?.status,
    raceEntryAgentStatus: bundle.raceEntry?.agent?.status,
    raceEntryReadyForMatch: bundle.raceEntry?.readyForMatch,
    runnerTaskId: bundle.runnerContract?.task?.id,
    runnerRunnable: bundle.runnerContract?.runnable,
    certificates: bundle.certificateIndex?.totals?.readyForPublicShare
  };
  const exportBundle = {
    ...bundle,
    summary
  };
  const outputPath = config.out ? await writeOutput(config.out, exportBundle) : undefined;
  return {
    ...exportBundle,
    outputPath
  };
}

export { runPublicBenchmarkExport };

function cliResponse(bundle) {
  if (!bundle.outputPath) return bundle;
  return {
    schemaVersion: bundle.schemaVersion,
    generatedAt: bundle.generatedAt,
    outputPath: bundle.outputPath,
    request: bundle.request,
    sources: bundle.sources,
    summary: bundle.summary
  };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  runPublicBenchmarkExport()
    .then((summary) => {
      process.stdout.write(`${JSON.stringify(cliResponse(summary), null, 2)}\n`);
      if (!summary.summary.valid) process.exitCode = 2;
    })
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exit(1);
    });
}
