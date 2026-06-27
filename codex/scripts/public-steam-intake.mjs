import { pathToFileURL } from "node:url";
import { parseCliArgs } from "./steam-ingest.mjs";

const args = parseCliArgs();

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
  const appid = Number(args.get("appid"));
  if (!Number.isFinite(appid) || appid <= 0) {
    throw new Error("Provide --appid=<steam_appid>.");
  }
  return {
    baseUrl: args.get("api") ?? process.env.STEAMBENCH_API_URL ?? "http://127.0.0.1:8787",
    appid,
    useFixture: boolArg("fixture", boolArg("use-fixture", false)),
    refresh: boolArg("refresh", false),
    limit: intArg("limit", 12, { min: 1, max: 50 }),
    gameName: args.get("game-name"),
    benchmarkFit: args.get("benchmark-fit") === undefined ? undefined : Number(args.get("benchmark-fit")),
    harnessRisk: args.get("harness-risk")
  };
}

function resolveUrl(baseUrl, pathOrUrl) {
  if (/^https?:\/\//.test(pathOrUrl)) return pathOrUrl;
  return `${baseUrl.replace(/\/$/, "")}${pathOrUrl.startsWith("/") ? pathOrUrl : `/${pathOrUrl}`}`;
}

async function readJson(baseUrl, pathOrUrl, options) {
  const url = resolveUrl(baseUrl, pathOrUrl);
  const response = await fetch(url, {
    headers: { "content-type": "application/json" },
    ...options
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

function intakePath(config) {
  const query = new URLSearchParams();
  query.set("limit", String(config.limit));
  if (config.useFixture) query.set("useFixture", "true");
  if (config.refresh) query.set("refresh", "true");
  if (config.gameName) query.set("gameName", config.gameName);
  if (Number.isFinite(config.benchmarkFit)) query.set("benchmarkFit", String(config.benchmarkFit));
  if (config.harnessRisk) query.set("harnessRisk", config.harnessRisk);
  return `/api/public/steam/apps/${encodeURIComponent(config.appid)}/intake?${query}`;
}

function validateIntake(intake, config) {
  const errors = [];
  if (intake?.schemaVersion !== "steambench.public-steam-app-intake.v1") errors.push("invalid_intake_schema");
  if (intake?.appid !== config.appid) errors.push("appid_mismatch");
  if (intake?.canonicalArtifactName !== "output.mp4") errors.push("canonical_artifact_name_mismatch");
  if (intake?.dataPolicy?.officialSteamSourcesOnly !== true) errors.push("official_sources_policy_missing");
  if (intake?.dataPolicy?.proofConsentRequiredBeforePublicRanking !== true) errors.push("proof_consent_policy_missing");
  if (!Array.isArray(intake?.dataPolicy?.allowedSources) || intake.dataPolicy.allowedSources.length === 0) errors.push("allowed_sources_missing");
  if (!intake?.game?.appid || !intake?.game?.name) errors.push("game_summary_missing");
  if (!intake?.publicReadiness) errors.push("public_readiness_missing");
  if (!intake?.sourceCoverage?.totals) errors.push("source_totals_missing");
  if (!intake?.sourceCoverage?.sources?.achievement) errors.push("achievement_source_missing");
  if (!Array.isArray(intake?.sourceCoverage?.recommendedActions)) errors.push("source_actions_missing");
  if (!Array.isArray(intake?.taskPipeline?.taskLadder) || intake.taskPipeline.taskLadder.length === 0) errors.push("task_ladder_missing");
  if (!Array.isArray(intake?.onboarding?.stages) || intake.onboarding.stages.length < 5) errors.push("onboarding_stages_missing");
  if (intake?.runtimeContract?.targetArtifactName !== "output.mp4") errors.push("runtime_artifact_mismatch");
	  if (!Array.isArray(intake?.runtimeContract?.stage2StartConstraints) || intake.runtimeContract.stage2StartConstraints.length === 0) errors.push("stage2_constraints_missing");
	  if (!String(intake?.publicEntrypoints?.benchmarkPack ?? "").includes("/api/public/games/")) errors.push("public_game_pack_missing");
	  if (!String(intake?.publicEntrypoints?.agentOnboarding ?? "").includes("/api/public/agents/onboarding")) errors.push("public_agent_onboarding_missing");
	  if (!String(intake?.publicEntrypoints?.taskActionSpaceTemplate ?? "").includes("/api/public/tasks/{taskId}/action-space")) errors.push("public_action_space_template_missing");
	  if (!String(intake?.publicEntrypoints?.raceEntryTemplate ?? "").includes("/api/public/tasks/{taskId}/race-entry")) errors.push("public_race_entry_template_missing");
	  if (!String(intake?.publicEntrypoints?.runnerContractTemplate ?? "").includes("/api/public/tasks/{taskId}/runner-contract")) errors.push("public_runner_template_missing");
  if (!String(intake?.publicEntrypoints?.publicWatchTemplate ?? "").includes("/api/public/broadcasts/{streamId}/watch")) errors.push("public_watch_template_missing");
  if (!String(intake?.operatorEntrypoints?.importRecommended ?? "").includes("/achievement-ladder/import-recommended")) errors.push("import_endpoint_missing");
  if (!String(intake?.operatorEntrypoints?.publishCandidates ?? "").includes("/publish-candidates")) errors.push("publish_endpoint_missing");
  return errors;
}

async function runPublicSteamIntake(config = configFromArgs()) {
  const payload = await readJson(config.baseUrl, intakePath(config));
  const intake = payload.intake;
  const validationErrors = validateIntake(intake, config);
  return {
    schemaVersion: "steambench.public-steam-intake-cli.v1",
    generatedAt: new Date().toISOString(),
    api: config.baseUrl,
    request: {
      appid: config.appid,
      useFixture: config.useFixture,
      refresh: config.refresh,
      limit: config.limit,
      gameName: config.gameName
    },
    intake,
    validation: {
      valid: validationErrors.length === 0,
      errors: validationErrors
    },
    summary: {
      valid: validationErrors.length === 0,
      appid: intake?.appid,
      game: intake?.game?.name,
      publicReadiness: intake?.publicReadiness,
      readinessScore: intake?.intake?.readinessScore,
      sourceStatus: intake?.intake?.sourceStatus,
      blueprintStatus: intake?.intake?.blueprintStatus,
      sourceRecords: intake?.sourceCoverage?.totals?.sourceRecords,
      newImportsAvailable: intake?.sourceCoverage?.totals?.newImportsAvailable,
      activeTasks: intake?.taskPipeline?.activeTasks,
      candidateTasks: intake?.taskPipeline?.candidateTasks,
      rankedReadyTasks: intake?.taskPipeline?.rankedReadyTasks,
      reviewRequiredTasks: intake?.taskPipeline?.reviewRequiredTasks,
      suites: intake?.taskPipeline?.suites?.length ?? 0,
      onboardingStatus: intake?.onboarding?.status,
      onboardingStages: intake?.onboarding?.stages?.map((stage) => `${stage.id}:${stage.status}`) ?? [],
      actions: intake?.sourceCoverage?.recommendedActions?.map((action) => action.id) ?? []
    }
  };
}

export { runPublicSteamIntake };

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  runPublicSteamIntake()
    .then((result) => {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      if (!result.validation.valid) process.exitCode = 2;
    })
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exit(1);
    });
}
