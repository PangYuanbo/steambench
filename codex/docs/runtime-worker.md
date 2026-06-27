# Runtime Worker Plan

The web API should coordinate benchmark state, but Steam gameplay should run in isolated workers. Modal is the preferred first worker backend because it can run long-lived VM/container jobs with mounted account state, game dependencies, recording tools, and controlled network access.

## Responsibilities

The API owns:

- User, Steam link, task, run, artifact, livestream, and scoreboard records in Postgres.
- Steam OpenID callback handling and Steam Web API proof checks.
- Agent profile registration, run creation, task contract lookup, and final score publication.
- Signed upload URLs or object-storage credentials scoped to one run.

The worker owns:

- Preparing a Steam-capable runtime.
- Installing or verifying the target app and eval dependencies.
- Running the agent or manual control bridge.
- Capturing `output.mp4` and any required logs/proof files.
- Emitting structured runtime events.
- Uploading artifacts and reporting completion.

## Run Lifecycle

1. API creates a `runs` row with `status = 'queued'` and `target_artifact_name = 'output.mp4'`.
2. Dispatcher starts a Modal function with `run_id`, `task_key`, and a short-lived worker token.
3. Worker fetches the runtime package from the API.
4. Worker emits `plan`, then marks the run `preparing`.
5. Worker creates minimal output directories and installs only small eval-required dependencies.
6. Worker starts recording and emits `launch`.
7. Worker runs the agent/control loop and emits `observe`, `act`, `checkpoint`, and `proof` events.
8. Worker uploads `output/output.mp4` as the primary video artifact.
9. Worker marks the run `artifact-submitted`.
10. Evaluator verifies Steam proof and artifacts, then marks the run `scored` or `failed`.
11. API inserts or refreshes the public `scoreboard_rows` entry.

Achievement tasks require `steam-achievement` proof. Stat, leaderboard, and capture tasks currently require `manual-review` proof plus the canonical artifact until a game-specific verifier can replace reviewer approval. When the worker or reviewer can extract a task metric, submit it as proof metadata `metricValue` with `metricName` and `targetValue`; the evaluator converts that metric into the final benchmark score.

Head-to-head matches create one human run and one agent run for the same task. Workers only execute the agent run; the API evaluates the match after both run records reach `scored`.

For local demos and smoke tests, `POST /api/matches/:matchId/run-local` executes the same high-level arena flow in one call: start the match, submit local human proof, simulate the agent run, and evaluate the winner. Production dispatch can still use the lower-level start, proof, worker, and evaluate endpoints.

Stage 2 `start()` must stay minimal:

- Do not call `session.run_file(...)`.
- Do not copy task inputs into `output/`.
- Do not copy software project files into `output/`.
- Do not perform GCS sync inside `start()`.
- Do not clear existing output directories by default.
- Limit setup to `makedirs` and small eval-required installs.

## Worker API Contract

Use a worker-scoped bearer token with permissions limited to one run.

Suggested API calls:

- `POST /api/agents`: register an agent profile with provider, command, runtime provider, and capabilities.
- `GET /api/platform/ops-report?scope=&limit=` / `npm run platform:ops -- --scope=weekly --limit=20`: inspect the whole benchmark operating surface across Steam sources, human onboarding, agent runtime readiness, dispatch queue, scoreboard integrity, broadcasts, and event registration before deciding which specialized ops command to run.
- `GET /api/agents/ops-report?provider=&limit=`: inspect cross-agent readiness, queue state, campaign opportunities, dispatch needs, and recommended operator actions.
- `GET /api/agents/:agentId/lab`: inspect the agent's queue, readiness gaps, recommended tasks, challenges, recent evidence, and scoreboard rows before dispatching another run.
- `GET /api/competitors/:participantType/:participantId/profile`: inspect the public competitor profile, including Steam/agent identity, event registrations, scored runs, suite races, campaign comparison history, evidence counts, and scoreboard rows.
- `GET /api/agents/:agentId/campaign-plan`: preview the next ready tasks for a multi-run benchmark campaign without creating runs.
- `POST /api/agents/:agentId/campaigns`: queue a multi-run benchmark campaign and optionally create local/Modal dispatch tickets with manifest, playbook, trace, and submission links for each run.
- `GET /api/agents/:agentId/campaigns`: list persisted campaign reports for one agent.
- `GET /api/campaigns/:campaignId`: inspect one campaign's run, dispatch, proof, artifact, scoreboard, and next-action state.
- `GET /api/campaigns/:campaignId/evidence-bundle`: fetch the campaign-level evidence bundle with child run bundles and aggregate integrity checks.
- `GET /api/campaigns/:campaignId/result-certificate`: fetch the public certificate for a scored agent campaign.
- `GET /api/campaign-standings`: rank agent campaigns and aggregate agent-level campaign scores.
- `npm run agent:ops -- --provider=local --limit=20`: summarize agent readiness and campaign or dispatch next actions without creating runs. Add `--execute=open-agent-run-session --ttl-seconds=900` when intentionally opening the next ready bounded runner session, or `--execute=create-agent-campaign --campaign-limit=2` when intentionally executing the named campaign API recommendation; dispatch drain recommendations remain explicit `dispatch:drain` handoffs.
- `GET /api/games/:appid/standings`: inspect game-scoped human-vs-agent standings, task coverage, and task leaderboards before scheduling more runs for that Steam app.
- `GET /api/games/:appid/coverage-plan`: inspect per-task human/agent coverage gaps, selected competitor readiness, and next scheduling actions for one Steam app.
- `POST /api/games/:appid/coverage-plan/schedule`: queue the ready human/agent coverage-plan actions as normal runs, optionally adding local or Modal dispatch tickets for agent attempts.
- `POST /api/games/:appid/coverage-plan/run-local`: execute the ready coverage-plan gaps locally, producing scored runs, proof records, evidence bundles, and run certificates for demos and CI.
- `GET /api/games/:appid/coverage-runs` and `GET /api/game-coverage-runs/:recordId`: inspect persisted game coverage executions and jump to the underlying run audits, evidence bundles, and certificates.
- `GET /api/game-coverage-runs/:recordId/evidence-bundle` and `/result-certificate`: publish coverage-run rollups after local/demo execution fills human or agent gaps.
- `GET /api/games/:appid/evidence-bundle`: fetch shareable evidence for one Steam game's standings, active task coverage, and top scored rows.
- `GET /api/games/:appid/result-certificate`: fetch the public result certificate for one Steam game's human-vs-agent standings.
- `GET /api/comparisons/human-agent?humanUserId=&campaignId=`: compare a Steam-linked human's scored runs against an agent campaign task set.
- `GET /api/comparisons/human-agent/evidence-bundle?humanUserId=&campaignId=`: fetch the comparison-level evidence bundle that rolls up the agent campaign bundle and the per-task human/agent run bundles.
- `GET /api/comparisons/human-agent/result-certificate?humanUserId=&campaignId=`: fetch the public certificate for a human-vs-agent campaign comparison.
- `GET /api/competition-events/:scope/result-certificate`: fetch the public certificate for an all-time, daily, or weekly competition event.
- `GET /api/competition-events/:scope/ops-report`: inspect event-level operator readiness across registrations, suite races, campaign comparisons, evidence bundles, and certificate links.
- `POST /api/campaigns/:campaignId/run-local`: execute a campaign through the local simulated agent path for demos and CI, then refresh campaign dispatch and scoreboard state.
- `POST /api/competition-events/:scope/run-campaign-comparisons-local`: execute registered event human-agent pairs through existing agent campaigns plus local human campaign proof packs, then return comparison bundles and the event certificate.
- `npm run event:ops -- --scope=weekly --suite-id=<suite_id>`: summarize event readiness and recommended actions without side effects; add `--execute=<recommended_action_id>` to run one explicit event action.
- `POST /api/games/:appid/competition/run-local`: create and execute one local ranked app competition for a linked human and active agent, returning suite race evidence and a public certificate.
- `GET /api/steam/apps/:appid/onboarding`: inspect the discovery, achievement ladder, task publication, coverage, and competition stages for one Steam app.
- `POST /api/steam/apps/:appid/onboarding/advance`: run the safe onboarding progression: recommended imports, review-cleared publication, and refreshed coverage readiness.
- `POST /api/steam/apps/:appid/onboarding/run-local`: run safe onboarding progression plus ready local human/agent coverage, returning the coverage run evidence and refreshed competition readiness.
- `npm run steam:onboard -- --appid=<appid> --fixture=true`: read the onboarding checkpoint from the CLI; add `--execute=advance` or `--execute=run-local --human-user-id=<id> --agent-id=<id>` only when the operator wants the safe write path.
- `GET /api/steam/apps/:appid/achievement-ladder`: inspect Steam achievement suitability bands, duplicate-safe import recommendations, and review status before importing benchmark tasks.
- `POST /api/steam/apps/:appid/achievement-ladder/import-recommended`: upsert only new ladder-recommended achievement tasks as candidates while reporting active, candidate, or rejected skips.
- `GET /api/steam/apps/:appid/stat-proposals`: preview Steam schema-derived stat benchmark contracts before writing candidates.
- `POST /api/steam/apps/:appid/stat-proposals/import-recommended`: upsert schema-derived stat benchmark contracts as review candidates.
- `GET /api/steam/apps/:appid/leaderboard-proposals`: preview Steam leaderboard metadata as frozen benchmark contracts before writing candidates.
- `POST /api/steam/apps/:appid/leaderboard-proposals/import-recommended`: upsert metadata-derived leaderboard contracts as controlled review candidates.
- `GET /api/steam/apps/:appid/task-source-ops` / `npm run steam:ops -- --appid=<appid> --fixture=true --limit=2`: summarize achievement, stat, and leaderboard source readiness plus import or publication next actions. Add `--execute=import-achievement-recommendations`, `--execute=import-stat-proposals`, `--execute=import-leaderboard-proposals`, or `--execute=publish-candidates` only when intentionally writing task candidates or publishing review-cleared candidates.
- `POST /api/steam/apps/:appid/metric-proposals`: bulk-import stat, leaderboard, or capture metric proposal manifests as review candidates for non-achievement benchmark tracks.
- `POST /api/steam/apps/:appid/publish-candidates`: bulk-promote review-cleared Steam task candidates for one app into the active benchmark catalog before scheduling runs, suites, or campaigns.
- `npm run steam:stats -- --appid=<appid> --fixture=true --limit=2 --import=true`: generate stat candidates from Steam schema or local fixtures through the candidate review path.
- `npm run steam:leaderboards -- --appid=<appid> --fixture=true --limit=2 --import=true`: generate controlled leaderboard candidates from Steam metadata or local fixtures.
- `npm run steam:ops -- --appid=<appid> --fixture=true --limit=2`: inspect one app's unified Steam task source readiness without writing candidates.
- `npm run steam:metrics -- --appid=<appid> --file=metric-proposals.json`: submit non-achievement Steam metric contracts through the same review and publication path as achievement imports.
- `POST /api/agents/:agentId/runs`: queue a run for a registered agent profile.
- `POST /api/agents/:agentId/run-session` / `npm run agent:run-session -- --agent-id=<id> --task-id=<task_id>`: queue a readiness-gated run, grant a bounded control lease when required, and return the handoff, access packet, and bridge manifest in one response for external runners.
- `GET /api/dispatches`: inspect local/Modal dispatch tickets and their resolved run, task, and agent context.
- `GET /api/dispatches/ops-report`: inspect a read-only operations roll-up for pending local/Modal dispatches, audit readiness, worker queue health, and links to the next operator action.
- `POST /api/runs/:runId/dispatch`: create an idempotent dispatch plan for an existing queued run, including command, worker ID, manifest URL, and runtime package URL.
- `GET /api/dispatches/:dispatchId/modal-package`: fetch the Modal app, image, volume, entrypoint, artifact, and Stage 2 policy package for a Modal dispatch.
- `POST /api/dispatches/:dispatchId/status`: update operator-visible dispatch state after a scheduler launches, claims, completes, fails, or cancels the worker.
- `npm run dispatch:ops -- --provider=local --status=planned,launched`: summarize dispatch ticket health and recommended next actions without executing any worker command. Add `--execute=drain-local-dispatches --limit=<n>` only when intentionally running the named local drain handoff; add `--execute=requeue-expired-workers` only when intentionally releasing expired worker leases.
- `npm run dispatch:drain -- --provider=local --limit=1`: execute planned local dispatch tickets from the CLI, updating each ticket through launched and completed or failed status. Use `--dry-run=true` to inspect selected commands without running them.
- `GET /api/tasks/:taskId/eligibility`: check task review status, human Steam binding, agent runtime readiness, blockers, controls, and proof requirements before creating a race.
- `POST /api/challenges`: open a challenge queue item after race eligibility passes.
- `GET /api/challenges/ops-report` / `npm run challenge:ops -- --status=open --limit=10`: inspect cross-challenge queue state and the next action for open, accepted, running, evidence-missing, or share-ready challenges. Add `--execute=accept-open-challenge`, `--execute=run-challenge-local`, or `--execute=share-challenge-certificate` only when intentionally advancing a named recommendation.
- `POST /api/challenges/:challengeId/accept`: convert a challenge into a match contract.
- `POST /api/challenges/:challengeId/run-local`: local demo path that accepts, runs, and scores a challenge.
- `GET /api/challenges/:challengeId/evidence-bundle`: fetch the public challenge evidence bundle that rolls up the challenge contract, match result, and both run evidence bundles.
- `POST /api/matches`: create a human-vs-agent match contract.
- `POST /api/matches/preflight`: preflight a planned match without creating it.
- `POST /api/matches/:matchId/start`: create the paired human and agent runs.
- `POST /api/matches/:matchId/evaluate`: publish the match winner after both runs score.
- `GET /api/human-proof/ops-report?appid=&limit=&userLimit=`: inspect cross-user Steam proof readiness and human onboarding blockers before scheduling public runs.
- `GET /api/users/:userId/steam-proof-plan`: inspect a linked human's task-by-task Steam proof readiness before opening submissions.
- `GET /api/users/:userId/steam-proof-report?appid=&live=true&refresh=true`: inspect live/cache/mock Steam achievement proof source state before public scoring.
- `GET /api/users/:userId/human-campaign-plan?campaignId=&limit=`: inspect the human's multi-task benchmark plan against the same task set as an agent campaign, including ready/already-scored blockers and comparison links.
- `POST /api/users/:userId/human-campaigns/run-local`: execute every ready task in the human campaign plan through the local proof shortcut, then return the refreshed comparison bundle and certificate.
- `GET /api/comparisons/human-agent/standings?humanUserId=&agentId=&campaignId=&status=&limit=`: inspect aggregate campaign comparison standings across humans, agents, and head-to-head matchups.
- `GET /api/comparisons/human-agent/ops-report?humanUserId=&agentId=&campaignId=&status=&limit=`: inspect human-run gaps, agent-campaign gaps, and share-ready comparison certificates before publishing.
- `POST /api/users/:userId/steam-proof-submissions`: local/demo shortcut that creates a human run from the proof plan, attaches the canonical artifact, verifies proof, and returns evidence/certificate artifacts.
- `npm run human:proof-ops -- --appid=<appid> --limit=4 --user-limit=20`: summarize human proof submission readiness from the API without creating runs; add `--execute=submit-human-proof`, `--execute=grant-proof-consent`, or `--execute=link-steam --steamid=<17_digit_id>` only when intentionally advancing a recommended human proof action.
- `npm run human:campaign-ops -- --user-id=<id> --campaign-id=<campaign_id>`: summarize the human campaign plan without creating submissions; add `--execute=run-local` only when intentionally completing the local human side of an agent campaign comparison.
- `npm run human:comparison-ops -- --human-user-id=<id> --campaign-id=<campaign_id>`: summarize aggregate human-vs-agent comparison readiness; add `--execute=run-human-campaign-local` or `--execute=share-comparison-certificate` only when intentionally advancing the recommended comparison action.
- `GET /api/runs/:runId/plan`: fetch app ID, task title, control surface, proof requirements, max runtime, and canonical artifact name.
- `GET /api/runs/:runId/execution-manifest`: fetch the versioned worker handoff manifest, including the Steam game adapter, launch command, readiness verdict, stream refs, proof requirements, artifact contract, and Stage 2 start constraints.
- `GET /api/runs/:runId/runtime-package`: fetch the legacy execution package with `manifestUrl` and the same Stage 2 contract.
- `GET /api/runs/:runId/agent-playbook`: fetch the action loop, allowed input actions, stop conditions, proof expectations, submission endpoint, and runtime action-space schema for an agent runner.
- `GET /api/runs/:runId/agent-handoff` / `npm run agent:handoff -- --run=<run_id>`: fetch the read-only runner handoff with playbook, trace coverage, control-session status, bridge links, and next actions.
- `npm run agent:run-session -- --agent-id=<id> --task-id=<task_id>`: open a new runner session in one step, including the active access packet when the selected task uses a virtual controller.
- `npm run agent:probe -- --run=<run_id>` or `--task=<task_id>`: perform a read/write action-space probe by fetching the playbook, granting a controller lease when needed, submitting example or supplied actions, and reading the resulting trace.
- `GET /api/runs/:runId/agent-trace/audit` / `npm run agent:trace-audit -- --run=<run_id>`: validate observation/action coverage, controller lease binding, execution-plan metadata, and side-effect-free executor reports before treating a trace as runner-ready.
- `GET /api/agent-traces/ops-report` / `npm run agent:trace-ops -- --verdict=needs-executor-report --limit=10`: inspect cross-run agent trace readiness and queue the next missing runtime step, such as action submission, control lease creation, or bridge executor validation. Add `--execute=create-control-session --ttl-seconds=<n>` only when intentionally granting the named control lease; bridge executor recommendations stay explicit handoffs to `bridge:control`.
- `GET /api/runtime/action-spaces?agentId=&appid=&inputMode=&transport=&limit=` / `npm run runtime:action-spaces -- --agent-id=<id> --input-mode=controller --transport=virtual-controller`: inspect task-level action-space permissions, GeForce NOW bridgeability, required capabilities, compatible agents, and forbidden privileged actions before creating a run. Add `--execute=create-agent-run` only when intentionally queueing the recommended ready agent run through the existing readiness-gated API.
- `POST /api/runs/:runId/control-sessions`: grant a TTL-bound control lease for the run's action space; GeForce NOW or other control bridges should require this before translating agent actions into gamepad input.
- `GET /api/control-sessions/ops-report` / `npm run bridge:ops -- --status=active --transport=virtual-controller`: inspect active, expired, revoked, ready, and executor-pending control leases before running a bridge. Add `--execute=run-control-bridge --executor=audit` only when intentionally running the named bridge handoff through `bridge:control`.
- `GET /api/control-sessions/:sessionId/access-packet`: fetch the agent-facing bounded control permission packet with lease TTL, allowed action types, controller schema, forbidden actions, canonical capture contract, and action/bridge/audit endpoints.
- `GET /api/control-sessions/:sessionId/bridge-manifest`: fetch the bridge-facing handoff with lease status, virtual-controller permissions, controller execution-plan schema, heartbeat/revoke/action endpoints, canonical capture contract, forbidden artifact names, and action audit counters.
- `POST /api/control-sessions/:sessionId/heartbeat`: keep a control lease active while the bridge is connected.
- `POST /api/control-sessions/:sessionId/revoke`: close a control lease so later action batches using it are rejected.
- `POST /api/runs/:runId/action-batches`: append one observe/act batch plus an optional checkpoint; the API normalizes legacy string actions or structured controller/keyboard/turn actions into the run's allowed action space, returns accepted action labels and a `steambench.controller-execution-plan.v1` plan for controller leases, then stores them as standard runtime events.
- `GET /api/runs/:runId/agent-trace`: inspect the replayable action trace, coverage, event counts, and next actions before submission.
- `npm run bridge:ops -- --status=active --transport=virtual-controller`: summarize bridge-ready leases, missing executor reports, expired sessions, and the next bridge command. The command is read-only by default; `--execute=run-control-bridge` runs the recommended bridge handoff, submits allowed controller actions, and persists a side-effect-free executor report when using `--executor=audit`.

Controller-input games use `steambench.runtime-action-space.v1` with `transport = "virtual-controller"`, XInput-style buttons, left/right sticks, LT/RT triggers, batch duration limits, canonical capture requirements, and forbidden privileged/system actions. A GeForce NOW bridge should first fetch the control session bridge manifest, require `readyForBridge = true`, heartbeat the lease while connected, translate only the returned `steambench.controller-execution-plan.v1` steps into controller input, and never expose raw OS automation beyond the declared permissions.
The local bridge scaffold is `npm run bridge:control -- --session=<control_session_id>`. It consumes the same bridge manifest, heartbeats the lease, submits only allowed controller actions through `/api/runs/:runId/action-batches`, then passes the returned plan to the configured executor. The default `--executor=audit` only validates the plan and emits `steambench.controller-executor-report.v1` with `sideEffects = false`. `--executor=geforce-now` is an external command protocol: configure `--executor-command=<path>` or `STEAMBENCH_GEFORCE_NOW_EXECUTOR_CMD`, read the `steambench.controller-executor-request.v1` JSON payload from stdin, apply the plan steps to the streamed gamepad, and return `steambench.controller-executor-report.v1` on stdout. The included command `npm run executor:geforce-now` implements that protocol, validates the plan, and converts it to `steambench.geforce-now-gamepad-backend-request.v1`; its default audit backend performs no host input, while `--backend=command --backend-command=<path>` delegates to a real gamepad backend that must return `steambench.geforce-now-gamepad-backend-report.v1` with `sideEffects = false`. The runner writes successful executor reports back as `checkpoint` events, and the bridge manifest audit exposes the latest executor status, provider, side-effect flag, and step counts. The GeForce NOW adapter should keep this manifest/heartbeat/action-batch/revoke flow and replace only the final backend command.

- `GET /api/runs/:runId/audit`: fetch the assembled evidence report after or during review.
- `GET /api/runs/:runId/evidence-bundle`: fetch the versioned reproducibility bundle combining manifest, audit, event, artifact, proof, stream, scoreboard, and controller executor report evidence.
- `GET /api/runs/:runId/result-certificate`: fetch the compact public result certificate derived from the evidence bundle, including controller executor report counts when present.
- `GET /api/matches/:matchId/result-certificate`: fetch the public certificate for a direct human-vs-agent match.
- `GET /api/challenges/:challengeId/result-certificate`: fetch the public certificate for a scored human-vs-agent challenge.
- `GET /api/suite-races/:raceId/result-certificate`: fetch the public certificate for a scored suite race.
- `GET /api/broadcasts/:streamId`: fetch the public broadcast timeline assembled from runtime events, artifacts, and proofs.
- `GET /api/broadcasts/:streamId/evidence-bundle`: fetch playback, timeline, proof, artifact, scoreboard, and controller executor-report integrity for a broadcast replay.
- `GET /api/broadcasts/:streamId/result-certificate`: fetch the public certificate for a proof-ready broadcast replay, including controller executor report counts when present.
- `GET /api/broadcasts/ops-report?status=&limit=` / `npm run broadcast:ops -- --limit=10`: inspect live, failed, proof-missing, and public-ready gameplay broadcast operations without changing stream state. Add `--execute=end-live-broadcast` or `--execute=share-broadcast-certificate` only when intentionally advancing the named broadcast recommendation.
- `GET /api/worker/queue`: inspect queued, leased, and expired worker leases.
- `POST /api/worker/requeue-expired`: return expired `preparing`/`running` runs to the queue for another worker.
- `POST /api/worker/claim`: claim the oldest queued run.
- `POST /api/runs/:runId/claim`: claim a specific queued run after dispatch.
- `POST /api/runs/:runId/heartbeat`: extend a worker lease and emit a heartbeat event.
- `POST /api/runs/:runId/events`: append durable runtime events.
- `POST /api/runs/:runId/artifacts/presign`: request upload locations.
- `POST /api/runs/:runId/artifacts`: attach artifact metadata after upload.
- `POST /api/runs/:runId/proofs`: submit proof records for evaluator review.
- `POST /api/runs/:runId/submission`: submit the canonical `output.mp4`, Steam or manual metric proof, run evaluation, and receive a receipt with audit, evidence bundle, and result certificate.
- `GET /api/proofs/review`: list proof records waiting for reviewer action.
- `POST /api/proofs/:proofId/status`: verify or fail a proof with reviewer metadata and a durable proof event.
- `POST /api/runs/:runId/verify-steam-proof`: verify a linked user's achievement state before scoring human submissions.
- `POST /api/runs/:runId/evaluate`: trigger proof-gated evaluation.
- `POST /api/runs/:runId/fail`: report a safe failure code and message.
- `POST /api/runs/:runId/score`: evaluator-only score publication.
- `GET /api/standings`: read derived human-vs-agent standings after scored runs publish.
- `GET /api/scoreboard/ops-report` / `npm run scoreboard:ops -- --appid=<appid>`: audit scored run publication, proof readiness, and stale or orphan scoreboard rows before sharing standings. Add `--execute=republish-scoreboard-row` only when intentionally executing a recommended repair for a scored run missing its public row; `--execute=share-standings` follows the read-only share action.
- `GET /api/matches/feed`: read public head-to-head match cards for arena history.

Current prototype endpoints cover claim, queue recovery, plan, execution manifest, evidence bundle, heartbeat, events, proof review, local presign placeholders, artifact attach, failure, and scoring. A production worker should replace local presign placeholders with object-storage signed URLs and enforce worker-token validation before public execution.

Human Steam proof submissions follow the same artifact contract as agent runs. The proof plan endpoint is safe to show before submission because it only reports blockers and task state; the proof fetch report exposes whether per-task achievement proof came from the Steam Web API, cache, or local mock proof, without leaking the server-side API key. The human campaign plan narrows that same readiness model to a multi-task benchmark pack, usually the task set from an agent campaign, so the human can complete comparable tasks before opening a comparison certificate. The local single-task and campaign runners are for demos and smoke tests. Production human submissions should capture a real `output/output.mp4` per task, then use live Steam Web API proof verification when `STEAM_WEB_API_KEY` is configured.

The execution manifest is the canonical Stage 2 contract. `start()` must stay limited to lightweight setup such as creating `output/` and small eval-required installs. The manifest explicitly forbids `session.run_file(...)`, copying task inputs or software project files into `output/`, GCS sync inside `start()`, and clearing existing output directories by default. The canonical evaluated capture remains `output/output.mp4`; legacy names such as `output-test.mp4` are forbidden.

The runtime package `plan.adapter` is the game-specific execution contract. Workers should use `launchUri` for Steam startup, `inputMode` for the control bridge, `captureMode` for recorder setup, `saveStrategy` for profile isolation, and `readinessChecks` before the agent loop starts.

The runtime package also includes a readiness verdict. Managed agent queueing should only proceed when the selected agent profile provides all required capabilities for the task adapter. Agent runtime lab projections summarize that readiness across recommended tasks, current queue state, challenges, recent broadcasts, proofs, and scoreboard rows, so a dispatcher can pick the next runnable task without bypassing the normal `/api/agents/:agentId/runs` gate. Campaign endpoints apply the same readiness and review rules across multiple tasks, skip tasks that already have queued or active runs for the agent, and return per-run manifest, playbook, trace, submission, and dispatch links. Runtime dispatch tickets then turn queued runs into local or Modal commands, but they do not claim the run by themselves; the worker still uses the normal claim and heartbeat endpoints. The local campaign and event campaign-comparison runners are for demos and smoke tests; production campaign execution should launch the generated dispatch commands and let workers submit the same canonical artifact and proof contract. Human-vs-agent campaign comparison bundles do not create new proof artifacts; they roll up existing `output/output.mp4` run bundles from the human, the agent campaign run bundles, and the campaign aggregate bundle into one shareable comparison certificate. Competition event evidence bundles include those campaign comparison bundles alongside suite race bundles so public event evidence can cover both tournament-style races and campaign-pack comparisons. Head-to-head match creation uses race eligibility preflight, which also checks the human Steam link and task review decision. Missing capabilities should be fixed on the agent profile rather than ignored in the worker.

## Event Contract

Workers should emit compact, structured events:

```json
{
  "type": "observe",
  "message": "Captured current chamber state.",
  "metadata": {
    "source": "screen-capture",
    "frame": 420,
    "confidence": 0.91
  }
}
```

Keep large data out of event payloads. Store screenshots, logs, videos, and save files as artifacts, then reference artifact IDs in event metadata.

Required event behavior:

- Emit `heartbeat` at least once per minute for long runs.
- Emit `error` with a safe message before failing a run when possible.
- Emit `artifact` after each successful upload.
- Emit `proof` when Steam/local proof is captured.
- Do not log Steam credentials, session cookies, ingest URLs, or bearer tokens.

## Artifact Contract

The evaluated gameplay capture is canonical:

- File name: `output.mp4`.
- Path inside task output: `output/output.mp4`.
- Artifact metadata: `kind = 'video'`, `is_primary = true`, `name = 'output.mp4'`.

If a task needs a different artifact name, update all of these together:

- task code default,
- bucket fixtures,
- VM package,
- task docs,
- local smoke helpers,
- blind-eval helpers,
- database task row `target_artifact_name`.

Do not accept a run as complete when the worker uploads `output-test.mp4` for a task whose contract expects `output.mp4`.

## Modal Deployment Notes

Use one Modal app for runtime workers and keep the web API on Railway.

Recommended Modal shape:

- A base image with Steam runtime dependencies, recording tools, Python/Node eval dependencies, and the worker client.
- A persistent Modal volume for Steam account state and downloaded game files, separated by app ID or test account.
- A per-run scratch directory for outputs.
- Secrets for worker API base URL, worker token issuer, Steam runtime credentials, and object-storage write credentials.
- A hard timeout based on `tasks.estimated_runtime_minutes` plus cleanup buffer.

Worker startup should be deterministic:

1. Validate environment and worker token.
2. Fetch the run plan.
3. Ensure Steam/app readiness.
4. Create `output/` if missing.
5. Start capture to `output/output.mp4`.
6. Execute the agent loop.
7. Stop capture, finalize the video, upload artifacts, and report result.

The prototype includes `modal/steambench_runtime.py` as the Modal entrypoint used by generated dispatch commands. It mounts the repository into `/root/steambench`, mounts the `steambench-steam-state` volume at `/steam-state`, and invokes `node scripts/runtime-worker.mjs --run=<run_id>` so Modal execution still uses the same claim, heartbeat, artifact, proof, audit, and scoring endpoints as local workers.

## Railway Deployment Notes

Railway should run the API and Postgres, not Steam gameplay.

- API service reads `DATABASE_URL`, `STEAM_WEB_API_KEY`, and object-storage variables.
- API service exposes `/api/health`.
- Postgres migration runs before API traffic is shifted.
- Runtime worker callbacks should use a public Railway API URL with HTTPS.
- Use idempotency keys for worker event and artifact posts so retries do not duplicate important records.

For early staging, a single API instance is fine. Before public runs, add row-level locking around run dispatch so two workers cannot claim the same queued run.

## Failure Handling

- If Modal startup fails, mark run `failed` with `failure_code = 'worker_start_failed'`.
- If heartbeat expires, mark run `failed` with `failure_code = 'worker_heartbeat_timeout'`.
- If `output.mp4` is missing, mark run `failed` with `failure_code = 'missing_primary_artifact'`.
- If Steam proof cannot be verified, keep the artifact but mark scoring as failed or pending review.
- If upload succeeds but API callback fails, retry artifact attach with the same idempotency key.

The worker should never delete prior run outputs unless the run-specific scratch directory is known to be isolated.
