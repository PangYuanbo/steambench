# Steambench

Steambench is an early benchmark product prototype for comparing human players and runtime agents on Steam games. The first vertical turns Steam apps, achievements, and run evidence into scored benchmark tasks.

## Current Slice

- Local web dashboard for human-vs-agent standings, task discovery, Steam linking flow, and runtime queue planning.
- Express API with offline fixtures and Steam Web API adapters.
- Task scoring model that maps achievements, controlled stats, leaderboard-style metrics, and capture challenges into benchmark levels.
- Stage 2 task contract example for evaluated gameplay capture artifacts.

## Run

```bash
npm install
npm run dev
```

Open `http://127.0.0.1:5173`.

For a production-shaped local run:

```bash
npm run build
npm run start
```

## Verify

```bash
npm test
npm run build
npm run audit:contracts
npm run smoke:task
```

With the API server running:

```bash
npm run smoke:api
npm run worker:local
```

## Steam Data Sources

The implementation uses Valve/Steamworks-owned endpoints where possible:

- `ISteamApps/GetAppList/v2` for the Steam app catalog.
- `ISteamUserStats/GetGlobalAchievementPercentagesForApp` for global achievement rarity.
- `ISteamUserStats/GetSchemaForGame/v2` for game stat schema fields when a server-side Steam Web API key is configured.
- `ISteamLeaderboards/GetLeaderboardsForGame/v2` for game leaderboard metadata when a server-side Steam publisher key is configured.
- `ISteamUserStats/GetPlayerAchievements` for linked-user proof when a Steam Web API key and user SteamID are available.

Store media is currently represented by Steam CDN header image URLs derived from app IDs. Steam app-list search and global achievement metadata use a server-side TTL cache so local review and import flows do not repeatedly crawl broad Steam surfaces. Data-policy endpoints expose cache status, allowed official sources, and user-proof constraints.

Achievement tasks are generated from Steam achievement metadata. Stat tasks can be proposed directly from Steam schema fields or from fixtures when no Steam key is available. Leaderboard tasks can be proposed from Steam leaderboard metadata or fixtures, but they remain controlled review candidates because live leaderboard rank alone is not a fair benchmark contract. Stat, leaderboard, and capture tasks can also enter the catalog as controlled benchmark seeds or reviewable metric proposal manifests with explicit metric names, target values, proof requirements, and scoring rules. Verified manual-review proof can include `metricValue`, which the evaluator converts into a metric-aware run score so humans and agents can rank by actual time, score, kills, ante, or stat values instead of a fixed task score. Those metric proposals keep the platform multi-track while real Steam stat, leaderboard, replay, and game-harness adapters are added.

Before importing achievements, operators can inspect `/api/steam/apps/:appid/achievement-ladder` to see the achievement set grouped into starter, ranked, expert, and review bands. The ladder reuses the benchmark review rubric, avoids recommending duplicates already active or in the candidate registry, and keeps the `output.mp4` evidence contract attached to every recommended task. The paired recommended-import route only upserts new ladder recommendations, so it is safe to run against already-ranked games without duplicating active tasks.

Steam account binding, public proof consent, and competition event registration are separate gates. A human can link a SteamID without entering ranked runs or public events; human submissions, Steam proof verification, matches, suite races, and human event registration require explicit proof consent.

## Core API

- `GET /api/state`: complete local product state for the dashboard, including event summaries, event evidence-bundle health summaries, task review catalog health, broadcast center summaries, per-game profile summaries, agent runtime lab summaries, agent campaign reports and standings, human campaign plan and comparison summaries, and recent competitor profile summaries.
- `GET /api/public/catalog?season=all|daily|weekly&appid=&track=&transport=&bridgeable=&provider=&limit=`: public game/task discovery catalog with active and candidate tasks, bridgeable GeForce NOW controller targets, canonical `output/output.mp4` evidence requirements, and links into hub, event entry, quickstart, action-space, bridge-handoff, race-entry, runner, and scoreboard packets.
- `GET /api/public/standings?season=all|daily|weekly&appid=&track=&competitor=&limit=`: compact public season standings packet with human-vs-agent totals, competitor leaders, game standings, task leaderboards, and links into catalog, task scoreboards, quickstart, race-entry, and certificates.
- `GET /api/public/competition-hub?season=all|daily|weekly&appid=&taskId=&provider=&limit=`: public homepage packet with platform totals, selected game/task, game benchmark pack, task action-space, race-entry template, featured tasks, public broadcasts, certificate links, and human/agent/match entrypoints.
- `GET /api/public/events/:scope/entry?appid=&taskId=&humanUserId=&agentId=&provider=&suiteId=&limit=`: read-only public event entry packet for `all`, `daily`, or `weekly`, joining event summary, registration eligibility, human/agent registration body templates, quickstart, race-entry, bridge handoff, event ops, scoreboard, evidence-bundle, and certificate links.
- `GET /api/public/quickstart?season=all|daily|weekly&appid=&taskId=&humanUserId=&agentId=&provider=&limit=`: read-only public quickstart packet that turns the selected hub/race/action-space facts into ordered human registration, Steam proof, agent onboarding, match preflight, run-session, action-batch, evidence-submit, and watch/replay command templates.
- `GET /api/public/benchmark-snapshot?season=all|daily|weekly&limit=`: public embed snapshot with human-vs-agent standings, season leaders, event summaries, broadcast rollups, data-policy posture, share-ready certificate metadata, and verification links.
- `GET /api/public/steam/apps/:appid/intake?useFixture=&refresh=&limit=`: public Steam app intake packet that combines official-source policy, discovery status, source coverage, benchmark task pipeline, onboarding stages, Stage 2 runtime artifact constraints, and public/operator entrypoints for turning one Steam app into benchmark tasks.
- `GET /api/public/agents/onboarding?taskId=&agentId=&provider=&limit=`: public agent entry packet with registration body templates, required capabilities, selected-task readiness, action-space links, run-session body templates, and next steps for external/local/Modal runtime agents.
- `GET /api/public/games/:appid/benchmark-pack?season=all|daily|weekly&limit=`: public per-game benchmark pack with task levels, review controls, suites, standings, coverage gaps, broadcast replays, certificate metadata, and human/agent runner entrypoints.
- `GET /api/public/tasks/:taskId/scoreboard?season=all|daily|weekly&limit=`: public task-level human-vs-agent scoreboard packet with global, human, and agent entries, canonical `output.mp4` evidence links, run certificate links, submit templates, and certificate verification links.
- `GET /api/public/tasks/:taskId/action-space?agentId=`: public agent action-space packet for one benchmark task with allowed gamepad/keyboard/turn actions, canonical `output/output.mp4` capture constraints, GeForce NOW bridgeability, control-session prerequisites, executor protocol hints, and an example action-batch template.
- `GET /api/public/tasks/:taskId/bridge-handoff?agentId=&provider=&ttlSeconds=`: read-only GeForce NOW bridge handoff contract for one task/agent, including bridgeability, required capabilities, run-session grant body, post-grant access packet and bridge manifest links, executor request/report schemas, action-batch template, and canonical evidence requirements before any control lease is granted.
- `GET /api/public/tasks/:taskId/race-entry?humanUserId=&agentId=&provider=&limit=`: public human-vs-agent race entry packet for one task, joining the human Steam proof entry packet, agent onboarding, action-space permissions, runner-contract link, scoreboard link, and match preflight/create body templates without creating a run or match.
- `GET /api/public/tasks/:taskId/runner-contract?humanUserId=&agentId=`: public pre-run contract for one benchmark task with scoring, proof requirements, canonical `output/output.mp4`, runtime action-space permissions, agent action-batch templates, controller execution-plan/executor-report protocol hints, eligibility, and human/agent/match entrypoints.
- `GET /api/public/broadcasts/:streamId/watch?timelineLimit=`: public gameplay watch packet for live or replay broadcasts with playback metadata, timeline preview, canonical evidence readiness, full broadcast result certificate payload, and verification links.
- `npm run public:catalog -- --season=weekly --appid=1145360 --transport=virtual-controller --bridgeable=true --provider=external`: validates the public discovery catalog before a frontend or external agent chooses a benchmark task.
- `npm run public:standings -- --season=all --appid=620 --track=achievement --limit=12`: validates the compact public standings packet before rendering public leaderboards or external scoreboard widgets.
- `npm run public:hub -- --season=weekly --appid=620 --task-id=620:ACH.WAKE_UP`: validates the public competition hub packet before rendering a public homepage, embedded standings page, or external dashboard.
- `npm run public:event-entry -- --scope=weekly --task-id=1145360:ESCAPE_TARTARUS --human-user-id=<user_id> --agent-id=<agent_id>`: validates the read-only public event entry packet before displaying event registration, race readiness, bridge handoff, or certificate links.
- `npm run public:quickstart -- --season=weekly --appid=1145360 --task-id=1145360:ESCAPE_TARTARUS --provider=external`: validates the read-only public quickstart packet before a frontend, external agent, or docs page displays the end-to-end registration-to-run-session checklist.
- `npm run public:intake -- --appid=620 --fixture=true --limit=12`: validates the public Steam app intake packet before importing, publishing, or scheduling benchmark coverage for a game.
- `npm run public:agent -- --task-id=1145360:ESCAPE_TARTARUS --provider=external`: validates the public agent onboarding packet; add `--execute=register --handle=<agent_handle>` to register an agent profile from the advertised capability template and refresh readiness.
- `npm run public:action-space -- --task-id=1145360:ESCAPE_TARTARUS --agent-id=<agent_id>`: validates the public task action-space packet before granting a bounded control session or sending controller input through a bridge.
- `npm run public:bridge-handoff -- --task-id=1145360:ESCAPE_TARTARUS --agent-id=<agent_id>`: validates the read-only GeForce NOW bridge handoff contract before opening an agent run-session or handing a lease to a bridge executor.
- `npm run public:race-entry -- --task-id=1145360:ESCAPE_TARTARUS --human-user-id=<user_id> --agent-id=<agent_id>`: validates the public race-entry packet before match preflight or match creation.
- `npm run public:export -- --season=weekly --appid=620 --limit=12 --out=public-export.json`: static public benchmark export that stitches the public catalog, standings, hub, event entry, quickstart, snapshot, Steam app intake, agent onboarding, per-game benchmark pack, task scoreboard, task action-space, bridge handoff, task race-entry packet, task runner contract, and share-ready certificate index into one JSON bundle for static hosting or external dashboards.
- `npm run public:runner -- --task-id=1145360:ESCAPE_TARTARUS --agent-id=<agent_id> --execute=advance-public-runner`: validates a public runner contract, opens the advertised agent run session, submits the contract's example action batch, and records a side-effect-free controller executor report when the task requires a virtual-controller bridge.
- `npm run public:human -- --task-id=620:ACH.WAKE_UP --execute=advance-public-human --steamid=<17_digit_id>`: creates or uses a human competitor, links Steam with proof consent, submits the task proof through the public human entrypoint, verifies the result certificate, and confirms the human run appears in the public task scoreboard.
- `npm run public:match -- --task-id=620:ACH.WAKE_UP --human-user-id=<user_id> --agent-id=<agent_id> --execute=advance-public-match`: validates the public match contract, runs preflight, creates a human-vs-agent match, executes the local benchmark arena, verifies the match certificate, and confirms both child runs appear in the public task scoreboard.
- `npm run public:watch -- --stream-id=<stream_id> --execute=verify-public-watch`: validates a public gameplay watch packet and verifies the embedded broadcast result certificate locally and through `/api/result-certificates/verify`.
- `npm run public:submit -- --run-id=<run_id>`: attaches canonical `output/output.mp4`, submits achievement or manual metric proof, evaluates the run, and verifies the returned public result certificate locally and through `/api/result-certificates/verify`.
- `GET /api/platform/ops-report?scope=all|daily|weekly&limit=`: platform-wide read-only operations rollup across Steam source coverage, task review, benchmark blueprint readiness, focused per-game competition coverage, human onboarding, human Steam proof readiness, human-agent campaign comparison readiness, agent runtime readiness, action-space and GeForce NOW bridgeability coverage, dispatch queue, agent trace readiness, control-bridge leases, challenge queue, match arena execution, scoreboard integrity, broadcasts, and event registration.
- `GET /api/result-certificates?kind=all|run|match|challenge|suite-race|agent-campaign|human-agent-comparison|competition-event|broadcast|game-competition|game-coverage-run&limit=`: public transparency index of share-ready result certificates with compact metadata, evidence/result links, and SHA-256 verification fingerprints.
- `POST /api/result-certificates/verify`: verifies a public `steambench.result-certificate.v1` SHA-256 fingerprint from `{ "certificate": ... }` or a raw certificate payload, returning a `steambench.result-certificate-verification.v1` report and rejecting tampered signed fields.
- `GET /api/competition-events`: all-time, daily, and weekly event summaries with entrants, scores, matches, suite races, operations, and leaders.
- `GET /api/competition-events/:scope`: one event summary for `all`, `daily`, or `weekly`.
- `GET /api/competition-events/:scope/evidence-bundle`: public event evidence bundle with registrations, scoped suite race bundles, campaign comparison bundles, standings, and integrity checklist.
- `GET /api/competition-events/:scope/ops-report`: read-only event operations report with registered pair gaps, suite race readiness, campaign comparison readiness, recommended next actions, and certificate links.
- `GET /api/competition-events/:scope/result-certificate`: public event certificate summarizing entrants, tasks, aggregate scores, event evidence readiness, and share links.
- `GET /api/competition-events/registrations`: lists explicit event opt-ins with resolved human or agent records.
- `POST /api/competition-events/:scope/register`: registers a consented human or active agent for `all`, `daily`, or `weekly`.
- `POST /api/competition-events/:scope/schedule-suite`: creates suite races for eligible registered human-agent pairs in that event scope, skipping pairs already scheduled for the suite.
- `POST /api/competition-events/:scope/run-suite`: executes scheduled event suite races through local orchestration, returning completed and incomplete race bundles.
- `POST /api/competition-events/:scope/run-campaign-comparisons-local`: executes registered human-agent event pairs against existing agent campaigns and human campaign proof packs, returning comparison bundles and the event certificate.
- `POST /api/competition-events/registrations/:registrationId/withdraw`: withdraws one event registration without deleting its audit record.
- `GET /api/standings`: derived human-vs-agent totals, competitor standings, task matchups, and game leaders.
- `GET /api/comparisons/human-agent/standings`: aggregate human-vs-agent campaign comparison leaderboard with human, agent, and matchup totals.
- `GET /api/comparisons/human-agent/ops-report`: read-only comparison operations report with human-run gaps, agent-campaign gaps, share-ready certificates, and recommended next actions.
- `GET /api/scoreboard/ops-report`: read-only scoreboard integrity report for scored run publication, proof gaps, stale rows, orphan rows, and share-ready standings.
- `GET /api/competitors/:participantType/:participantId/profile`: public human or agent profile with Steam/agent metadata, event registrations, scored runs, matches, suite races, campaign comparison history, evidence counts, and scoreboard rows.
- `GET /api/leaderboards`: per-task leaderboards with global, human, and agent leaders plus metric values when available.
- `GET /api/tasks/:taskId/leaderboard`: one task's ranked submissions and human-vs-agent leaders.
- `GET /api/benchmark-suites`: generated per-game benchmark packs grouped by starter/ranked/expert/full-game tiers with review status, tracks, estimated runtime, and readiness score.
- `GET /api/games/:appid/benchmark-suites`: benchmark packs scoped to one Steam game.
- `GET /api/games/:appid/profile`: one Steam game's benchmark profile with tasks, review health, suites, task leaderboards, recent scored rows, and broadcast replays.
- `GET /api/games/:appid/standings`: one Steam game's human-vs-agent standings with season filtering, task coverage, leaders, and task leaderboards.
- `GET /api/games/:appid/competition/ops-report`: one Steam game's operator report combining standings, coverage gaps, suite readiness, recent coverage runs, and recommended next API actions.
- `POST /api/games/:appid/competition/run-local`: creates and executes a ranked local suite race for one linked human and one active agent, returning suite evidence, certificate, and refreshed game standings.
- `GET /api/games/:appid/coverage-plan`: operator plan for one Steam game's missing human/agent coverage, selected competitor readiness, and next scheduling actions.
- `POST /api/games/:appid/coverage-plan/schedule`: converts ready coverage-plan actions into normal queued human/agent runs and optional local/Modal dispatch tickets.
- `POST /api/games/:appid/coverage-plan/run-local`: executes ready coverage-plan gaps through the local human proof and simulated agent scoring paths for demos and CI.
- `GET /api/games/:appid/coverage-runs`: recent persisted game coverage executions with linked human/agent runs and evidence links.
- `GET /api/game-coverage-runs/:recordId`: one persisted game coverage execution record resolved with its scored runs, tasks, and evidence links.
- `GET /api/game-coverage-runs/:recordId/evidence-bundle`: public roll-up bundle for one persisted game coverage execution and all scored run evidence.
- `GET /api/game-coverage-runs/:recordId/result-certificate`: shareable result certificate for a completed game coverage execution.
- `GET /api/games/:appid/evidence-bundle`: public evidence bundle for one Steam game's human-vs-agent standings, task coverage, and top scoreboard rows.
- `GET /api/games/:appid/result-certificate`: public result certificate for one Steam game's human-vs-agent standings.
- `GET /api/games/:appid/benchmark-blueprint`: reviewer-facing blueprint that combines task ladders, source-plan import opportunities, executable source actions, runtime requirements, and human-agent competition readiness for one Steam app. Add `useFixture=true` or `includeSourcePlan=true` to enrich the source plan with achievement, stat, and leaderboard proposal counts.
- `GET /api/suite-races`: lists scheduled suite races with their generated match set.
- `GET /api/suite-races/standings`: suite-race standings and per-suite leaderboards derived from scored suite race aggregates.
- `GET /api/suite-races/:raceId`: resolves one suite race with its matches, human, and agent.
- `GET /api/suite-races/:raceId/audit`: returns the suite race audit projection with child match run audits, aggregate evidence counts, missing evidence, and scoreboard readiness.
- `GET /api/suite-races/:raceId/evidence-bundle`: returns a versioned suite-race evidence bundle with the audit report and aggregate integrity checklist.
- `GET /api/suite-races/:raceId/result-certificate`: returns a public result certificate summarizing suite participants, scores, tasks, evidence counts, and share-readiness.
- `POST /api/suite-races/:raceId/run-local`: runs every child match through local arena orchestration, evaluates the aggregate suite race, and returns audit and evidence bundle results.
- `POST /api/suite-races/:raceId/evaluate`: aggregates child match scores into a suite-level winner, margin, and human/agent total.
- `POST /api/benchmark-suites/:suiteId/preflight`: checks every task in a suite before scheduling a multi-match race.
- `POST /api/benchmark-suites/:suiteId/races`: creates one head-to-head match per suite task after suite-level eligibility passes.
- `GET /api/tasks/review-catalog`: filterable task review catalog and operator queue with ranked-ready, review-required, rejected, fairness, and risk summaries.
- `GET /api/tasks/:taskId/review`: explainable benchmark suitability review with risk findings, controls, and rank/review/reject decision.
- `GET /api/tasks/:taskId/eligibility`: race preflight for a task, linked human, and agent profile, including proof requirements, blockers, controls, and missing agent capabilities.
- `GET /api/tasks/review-catalog` and `npm run task:review-ops -- --decision=review-required --limit=10`: summarizes ranked-ready, review-required, blocked, fairness, and risk-flag health for Steam-derived benchmark task candidates.
- `GET /api/broadcasts`: lists recent AI/human gameplay broadcasts with stream, run, task, proof, artifact, and broadcast center summaries.
- `GET /api/broadcasts/center`: aggregate live/replay broadcast center with featured stream, viewer counts, proof-ready counts, and scoreboard-ready replays.
- `GET /api/broadcasts/ops-report?status=&limit=`: summarizes live, scheduled, failed, proof-missing, and public-ready broadcasts with next operator actions.
- `GET /api/broadcasts/:streamId`: returns broadcast detail with event timeline, artifacts, proofs, and scoreboard readiness.
- `GET /api/broadcasts/:streamId/evidence-bundle`: returns a broadcast evidence bundle with timeline, proof, artifact, playback, scoreboard, and controller executor-report integrity checks.
- `GET /api/broadcasts/:streamId/result-certificate`: returns a public result certificate for a scoreboard-ready gameplay broadcast replay, including controller executor report counts when present.
- `GET /api/challenges`: lists queued human-vs-agent challenges with resolved task, human, agent, and match records.
- `GET /api/challenges/ops-report` and `npm run challenge:ops -- --status=open --limit=10`: summarizes open, accepted, running, evidence-missing, and share-ready human-vs-agent challenges with the next operator action. Add `--execute=accept-open-challenge`, `--execute=run-challenge-local`, or `--execute=share-challenge-certificate` only when intentionally advancing the named recommendation.
- `POST /api/challenges`: opens a challenge after the same eligibility preflight used by match creation.
- `GET /api/challenges/:challengeId/evidence-bundle`: returns a challenge evidence bundle with the challenge contract, match result, both run bundles, and public-share integrity checks.
- `GET /api/challenges/:challengeId/result-certificate`: returns a public result certificate for a challenge after it has a match and scored run audits.
- `POST /api/challenges/:challengeId/accept`: converts an open challenge into a benchmark match.
- `POST /api/challenges/:challengeId/run-local`: accepts and executes a challenge through local arena orchestration.
- `GET /api/matches`: lists head-to-head human-vs-agent benchmark matches.
- `GET /api/matches/arena-ops-report?status=&limit=` and `npm run match:arena-ops -- --status=needs-start --limit=10`: summarizes direct human-vs-agent matches that need paired run start, human proof, agent evidence, winner evaluation, or certificate sharing. Add `--execute=run-match-local`, `--execute=start-match`, `--execute=submit-human-proof`, `--execute=evaluate-match`, or `--execute=share-match-certificate` only when intentionally advancing the named arena action; use `--execute=advance-match-actions --max-steps=<n>` to run consecutive non-inspection recommendations with duplicate terminal actions suppressed.
- `GET /api/matches/:matchId/arena-packet`: returns a `steambench.match-arena-packet.v1` handoff for one direct human-vs-agent match, including the human proof entry packet, agent action-space/run endpoints, canonical `output/output.mp4` evidence contract, next arena actions, and certificate links.
- `GET /api/matches/:matchId/result-certificate`: returns a public result certificate for a direct human-vs-agent match.
- `POST /api/matches/preflight`: checks whether a human and agent can race on a task before creating a match.
- `POST /api/matches`: creates a match contract for one linked human, one active agent, and one task, returning the initial arena packet.
- `POST /api/matches/:matchId/start`: creates the paired human and agent runs.
- `POST /api/matches/:matchId/evaluate`: publishes the match winner after both runs are scored.
- `POST /api/matches/:matchId/run-local`: local arena orchestration that starts the match, submits local human proof, simulates the agent, publishes the winner, and returns the scored arena packet.
- `GET /api/tasks`: seeded and active imported benchmark tasks.
- `GET /api/steam/data-policy`: returns the Steam source policy, cache status, and user proof handling posture.
- `GET /api/steam/cache`: lists server-side cached Steam metadata entries.
- `POST /api/steam/cache/clear`: clears the local Steam metadata cache.
- `GET /api/steam/source-queue`: ranks Steam apps by cross-source benchmark import/publication readiness across achievements, stats, leaderboards, discovery fit, and harness risk.
- `GET /api/steam/apps/discovery`: lists discovered Steam app candidates, optionally filtered by `status`.
- `POST /api/steam/apps/discover`: searches Steam apps or fixtures and stores benchmark-suitability candidates.
- `POST /api/steam/apps/discovery/:candidateId/status`: shortlists, rejects, reopens, or marks a discovered app imported.
- `POST /api/steam/apps/discovery/:candidateId/import-achievements`: imports achievement tasks from a discovered app candidate.
- `GET /api/steam/apps/discovery/:candidateId/benchmark-blueprint`: returns the benchmark blueprint for a discovered app, including apps not yet in the curated catalog. Add `useFixture=true` or `includeSourcePlan=true` to enrich the source plan with achievement, stat, and leaderboard proposal counts plus executable source actions.
- `GET /api/steam/apps/:appid/onboarding`: returns the full Steam app onboarding pipeline from discovery through achievement ladder, publication, coverage, and competition readiness.
- `POST /api/steam/apps/:appid/onboarding/advance`: safely advances onboarding by importing new ladder recommendations, publishing review-cleared candidates, and returning the refreshed coverage plan.
- `POST /api/steam/apps/:appid/onboarding/run-local`: advances the safe onboarding steps and runs ready local human/agent coverage gaps, returning the persisted coverage run, evidence links, and refreshed onboarding state.
- `GET /api/steam/apps/:appid/achievement-ladder`: groups Steam achievements into starter, ranked, expert, and review bands with import-safe benchmark suitability recommendations.
- `POST /api/steam/apps/:appid/achievement-ladder/import-recommended`: imports only new ladder-recommended achievement tasks as review candidates and reports active/candidate/rejected skips.
- `GET /api/steam/apps/:appid/achievement-tasks`: previews generated achievement task contracts from live or fixture Steam achievement metadata.
- `POST /api/steam/apps/:appid/import-achievements`: imports Steam achievement metadata as reviewable task candidates.
- `POST /api/steam/apps/:appid/publish-candidates`: bulk-publishes review-cleared imported task candidates for one app into the active benchmark catalog and reports blocked review failures.
- `GET /api/steam/apps/:appid/stat-proposals`: previews stat benchmark task contracts generated from Steam game schema fields or local stat fixtures.
- `POST /api/steam/apps/:appid/stat-proposals/import-recommended`: imports schema-derived stat proposals as reviewable task candidates without publishing them.
- `GET /api/steam/apps/:appid/leaderboard-proposals`: previews leaderboard benchmark task contracts generated from Steam leaderboard metadata or local fixtures.
- `POST /api/steam/apps/:appid/leaderboard-proposals/import-recommended`: imports metadata-derived leaderboard proposals as controlled review candidates without publishing them.
- `GET /api/steam/apps/:appid/task-source-ops`: summarizes achievement, stat, and leaderboard source readiness, existing candidate registry coverage, and next import or publication actions for one app.
- `POST /api/steam/apps/:appid/task-proposals`: creates reviewable stat, leaderboard, or capture task candidates from a manually specified metric contract.
- `POST /api/steam/apps/:appid/metric-proposals`: bulk-imports stat, leaderboard, or capture metric proposal manifests as reviewable task candidates.
- `POST /api/tasks/:taskId/status`: publishes, reopens, or rejects imported task candidates; controlled tasks require `reviewApproved` and rejected tasks require an explicit override.
- `GET /api/seasons`: returns all-time, daily, and rolling weekly standing snapshots.
- `GET /api/standings?season=all|daily|weekly`: returns human-vs-agent standings for one leaderboard window.
- `GET /api/leaderboards?season=all|daily|weekly`: returns task leaderboards for one leaderboard window.
- `GET /api/matches/feed?season=all|daily|weekly`: returns human-vs-agent match cards with run scores and task context.
- `POST /api/users`: registers a local human or agent competitor.
- `GET /api/agents`: lists registered runtime agent profiles.
- `GET /api/agents/ops-report?provider=&limit=`: summarizes cross-agent readiness, queue state, campaign opportunities, dispatch needs, and recommended operator actions.
- `POST /api/agents`: registers an agent profile with provider, command, runtime provider, and capabilities.
- `GET /api/agents/:agentId/lab`: returns one agent's runtime lab with queue state, recommended tasks, readiness gaps, recent runs, challenges, broadcasts, proofs, and scoreboard rows.
- `GET /api/agents/:agentId/campaign-plan`: previews a multi-task agent benchmark campaign from ready lab recommendations without creating runs.
- `POST /api/agents/:agentId/campaigns`: queues a multi-task agent benchmark campaign and can create local/Modal dispatch tickets with manifest, playbook, trace, and submission links.
- `GET /api/agents/:agentId/campaigns`: lists persisted campaign reports for one agent.
- `GET /api/campaigns/:campaignId`: returns a campaign report with run, dispatch, proof, artifact, scoreboard, and next-action state.
- `GET /api/campaigns/:campaignId/evidence-bundle`: returns the campaign-level evidence bundle with child run bundles, standings entry, dispatch completion, and integrity checklist.
- `GET /api/campaigns/:campaignId/result-certificate`: returns the public result certificate for a scored agent campaign.
- `GET /api/campaign-standings`: ranks completed and in-flight agent campaigns by total campaign score, task coverage, and completion rate.
- `GET /api/comparisons/human-agent/standings?humanUserId=&agentId=&campaignId=&status=&limit=`: ranks completed and incomplete human-vs-agent campaign comparisons and aggregates participant matchups.
- `GET /api/comparisons/human-agent/ops-report?humanUserId=&agentId=&campaignId=&status=&limit=`: summarizes comparison readiness and recommends local human campaign runs, agent campaign inspection, or certificate sharing.
- `GET /api/comparisons/human-agent?humanUserId=&campaignId=`: compares one Steam-linked human's scored runs against an agent campaign on the campaign task set.
- `GET /api/comparisons/human-agent/evidence-bundle?humanUserId=&campaignId=`: returns the comparison-level evidence bundle with the campaign bundle plus per-task human and agent run bundles.
- `GET /api/comparisons/human-agent/result-certificate?humanUserId=&campaignId=`: returns the public result certificate for a human-vs-agent campaign comparison.
- `POST /api/campaigns/:campaignId/run-local`: local demo runner that executes all campaign runs through the simulated agent proof/scoring path and refreshes the campaign report.
- `POST /api/agents/:agentId/runs`: queues a benchmark attempt for a registered agent profile after runtime readiness checks pass.
- `POST /api/agents/:agentId/run-session`: queues a readiness-gated agent run, grants a bounded control lease when the task uses a virtual controller, and returns the runner handoff, access packet, and bridge manifest in one response. Pass `createLivestream=true` with optional `livestreamStatus=scheduled|live`, `livestreamTitle`, `currentScene`, and `viewerCount` to also open the broadcast handoff and receive stream, broadcast detail, evidence bundle, and result-certificate links.
- `POST /api/agents/:agentId/status`: pauses or reactivates a runtime agent profile.
- `GET /api/dispatches`: lists local/Modal dispatch tickets with resolved run, task, and agent records.
- `GET /api/dispatches/ops-report`: returns a read-only dispatch operations report with pending local/Modal tickets, run audit readiness, worker queue health, links, and recommended next actions.
- `POST /api/runs/:runId/dispatch`: creates an idempotent local or Modal worker dispatch plan for an existing queued run.
- `GET /api/dispatches/:dispatchId/modal-package`: returns the Modal app/image/volume/entrypoint handoff package for Modal dispatches.
- `POST /api/dispatches/:dispatchId/status`: marks a dispatch ticket planned, launched, claimed, completed, failed, or canceled.
- `POST /api/users/:userId/steam`: links a registered competitor to a SteamID; local/demo callers can pass `proofConsent=true` when the user explicitly opts into public proof use.
- `POST /api/users/:userId/steam-proof-consent`: grants or revokes consent for using linked Steam proof in public benchmark runs.
- `GET /api/human-onboarding/ops-report?scope=all|daily|weekly&limit=`: summarizes human registration, Steam linking, proof consent, and explicit event registration gates.
- `GET /api/human-proof/ops-report?appid=&limit=&userLimit=`: summarizes cross-user Steam proof readiness, onboarding blockers, and next proof submission actions for human competitors.
- `GET /api/users/:userId/steam-proof-plan`: returns a task-by-task human Steam proof plan with blockers, proof type, recent run state, submission endpoints, and a `steambench.human-benchmark-entry-packet.v1` per task containing the Steam/consent gates, canonical `output/output.mp4` evidence contract, and proof submission handoff.
- `GET /api/users/:userId/steam-proof-report?appid=&live=true&refresh=true`: returns a versioned Steam proof fetch report with linked-user blockers, cache/live fetch metadata, and per-task proof source status.
- `GET /api/users/:userId/human-campaign-plan?campaignId=&limit=`: returns a human benchmark campaign plan aligned to an agent campaign task set or the ranked task catalog.
- `POST /api/users/:userId/human-campaigns/run-local`: local/demo runner that submits every ready task in a human campaign plan and returns the refreshed comparison bundle and certificate.
- `POST /api/users/:userId/steam-proof-submissions`: local/demo path that creates a human run from the proof plan, attaches `output/output.mp4`, submits proof, evaluates, and returns the entry packet used plus evidence/certificate artifacts.
- `POST /api/steam/link-intents`: creates a Steam OpenID link intent and server-generated Steam login URL.
- `GET /api/steam/callback`: verifies Steam OpenID and links the resolved SteamID to the intent/user.
- `GET /api/users/:userId/steam/apps/:appid/achievements`: fetches linked-user achievement proof with server-side `STEAM_WEB_API_KEY` and returns cache-safe fetch metadata.
- `POST /api/runs`: queues a human or agent benchmark attempt.
- `POST /api/users/:userId/runs`: queues a Steam-linked human benchmark attempt with `runtimeProvider = manual`.
- `POST /api/worker/claim`: lets a worker claim the oldest queued run.
- `GET /api/worker/queue`: returns queued, leased, and expired worker leases for operations dashboards.
- `POST /api/worker/requeue-expired`: releases expired `preparing`/`running` worker leases back to `queued`.
- `POST /api/runs/:runId/claim`: lets a worker claim a specific queued run.
- `POST /api/runs/:runId/heartbeat`: extends the worker lease and writes a heartbeat event.
- `POST /api/runs/:runId/fail`: fails a run with a safe failure code/message.
- `GET /api/runs/:runId/plan`: resolves a run into a game/runtime/evidence plan.
- `GET /api/runs/:runId/execution-manifest`: returns the versioned worker handoff manifest with the run, task, agent, Steam game adapter, launch command, runtime readiness, livestream refs, proof requirements, canonical artifact contract, and Stage 2 start constraints.
- `GET /api/runs/:runId/runtime-package`: returns the legacy execution package plus `manifestUrl` and the same Stage 2 contract for workers that have not switched to the manifest endpoint yet.
- `GET /api/runs/:runId/audit`: returns the run audit report with proof requirements, artifacts, timeline, stream evidence, and scoreboard readiness.
- `GET /api/runs/:runId/evidence-bundle`: returns the versioned reproducibility bundle combining execution manifest, run audit, proof/artifact/event evidence, controller executor report evidence, and an integrity checklist.
- `GET /api/runs/:runId/result-certificate`: returns a compact public result certificate derived from the run evidence bundle, including controller executor report counts when present.
- `GET /api/runs/:runId/agent-playbook`: returns the agent control loop, allowed action types, evidence hints, stop conditions, and submission endpoints for one run.
- `GET /api/runs/:runId/agent-handoff`: returns a read-only agent runtime handoff packet combining playbook, trace coverage, control-session state, broadcast stream context, bridge links, the typed controller executor-report endpoint, and next actions. Runs without a stream recommend `open-livestream`; runs with a scheduled/live stream include broadcast detail, evidence-bundle, result-certificate, and stream status links.
- `npm run agent:handoff -- --run=<run_id>`: summarizes the handoff packet for external agent runners and bridge operators, including active access-packet, bridge-manifest, executor-report, broadcast stream, and replay/evidence endpoints when present.
- `npm run agent:run-session -- --agent-id=<agent_id> --task-id=<task_id>`: creates a readiness-gated run session and returns the handoff, access packet, executor-report link, and compact `steambench.agent-control-grant.v1` permission summary for an external runner. Add `--create-livestream=true --livestream-status=live` when the bridge runner should get broadcast/evidence links in the same packet.
- `npm run agent:probe -- --run=<run_id>`: read-only by default; fetches the playbook and trace readiness without granting controller access or submitting actions. Add `--execute=create-control-session` to grant only the bounded controller lease, `--execute=submit-action-batch` to submit the supplied or example actions, or `--execute=advance-probe` to create/grant/submit in one explicit probe. Using `--task=<task_id>` creates a run and therefore requires `--execute=advance-probe`.
- `GET /api/runs/:runId/agent-trace/audit` and `npm run agent:trace-audit -- --run=<run_id>`: validates observation/action coverage, controller lease binding, execution-plan metadata, and side-effect-free executor reports.
- `GET /api/agent-traces/ops-report` and `npm run agent:trace-ops -- --verdict=needs-executor-report --limit=10`: summarizes cross-run agent trace readiness so operators can find missing actions, missing control leases, pending bridge executor reports, and trace-ready runs. Add `--execute=create-control-session --ttl-seconds=120` only when intentionally granting the named bounded control lease, or `--execute=advance-trace-actions --max-steps=<n>` to refresh and grant pending control leases while stopping before explicit action-batch and bridge-executor handoffs.
- `GET /api/runtime/action-spaces?agentId=&appid=&inputMode=&transport=&limit=` and `npm run runtime:action-spaces -- --agent-id=<agent_id> --input-mode=controller --transport=virtual-controller`: inspect task-level action-space permissions before creating a run, including GeForce NOW bridgeability, required capabilities, forbidden privileged actions, and compatible agents. Add `--execute=create-control-run-session` only when intentionally queueing the recommended ready agent run with a bounded control lease, or `--execute=create-agent-run` when intentionally queueing a run without granting the bridge lease in the same call.
- `GET /api/runs/:runId/control-sessions`: lists bounded runtime control leases granted for one run.
- `POST /api/runs/:runId/control-sessions`: grants a TTL-bound runtime control session containing the run's action-space permissions, heartbeat/revoke endpoints, action batch endpoint, access/bridge manifest links, and typed executor-report endpoint.
- `GET /api/control-sessions/ops-report` and `npm run bridge:ops -- --status=active --transport=virtual-controller`: summarizes active, expired, revoked, ready, and executor-pending control leases for GeForce NOW or other virtual-controller bridges. Add `--execute=run-control-bridge` only when intentionally running the named bridge executor handoff through `bridge:control`.
- `GET /api/control-sessions/:sessionId/access-packet`: returns the bounded agent control permission packet with lease TTL, allowed action types, controller schema, GeForce NOW executor request/report protocol, bridge handoff checklist, forbidden actions, canonical capture contract, and action/bridge/executor-report/audit endpoints.
- `GET /api/control-sessions/:sessionId/bridge-manifest`: returns the GeForce NOW bridge handoff manifest with the active lease, virtual-controller action space, controller execution-plan schema, action/executor-report endpoints, canonical `output/output.mp4` capture contract, forbidden artifact names, and audit counters.
- `POST /api/control-sessions/:sessionId/heartbeat`: records that a runtime control bridge is still alive before the lease expires.
- `POST /api/control-sessions/:sessionId/revoke`: revokes a runtime control session; subsequent action batches using that session are rejected.
- `GET /api/runs/:runId/agent-trace`: returns a compact observe/act/checkpoint replay trace derived from runtime events.
- `POST /api/runs/:runId/action-batches`: appends a structured observe/act action batch and optional checkpoint for runtime-agent gameplay, returning a `steambench.agent-action-batch-receipt.v1` with accepted/rejected counts, trace/audit/submission endpoints, canonical `output/output.mp4` capture requirements, normalized actions, accepted action labels, a `steambench.controller-execution-plan.v1` low-level virtual-gamepad plan for controller leases, and a ready-to-pipe `steambench.controller-executor-request.v1` for GeForce NOW bridges when a bounded controller session is attached. Controller tasks expose a `steambench.runtime-action-space.v1` virtual-controller schema with XInput-style buttons, sticks, triggers, batch limits, and forbidden privileged actions; keyboard/mouse and turn-based tasks expose their own constrained action spaces.
- `POST /api/runs/:runId/controller-executor-reports`: accepts a `steambench.controller-executor-report.v1` from the GeForce NOW bridge, validates run/task/control-session consistency and side-effect-free execution, then records the standard checkpoint metadata used by trace audits, bridge manifests, and evidence bundles.
- `POST /api/runs/:runId/events`: appends audit events for agent or human attempts.
- `POST /api/runs/:runId/simulate-agent`: local simulated agent lifecycle for smoke testing the run pipeline.
- `GET /api/runs/:runId/proofs`: lists proof records used by the evaluator.
- `POST /api/runs/:runId/proofs`: submits Steam/artifact/manual proof records.
- `POST /api/runs/:runId/submission`: attaches the canonical artifact, records Steam or manual metric proof, evaluates the run, and returns a submission receipt with audit, evidence bundle, and result certificate.
- `GET /api/proofs/review`: lists pending proof records with their run and task context.
- `POST /api/proofs/:proofId/status`: verifies or fails a proof record and stores reviewer notes.
- `POST /api/runs/:runId/verify-steam-proof`: verifies a linked user's Steam achievement proof and can trigger proof-gated evaluation.
- `POST /api/runs/:runId/evaluate`: gates scoring on verified Steam achievement and canonical artifact proof.
- `GET /api/runs/:runId/artifacts`: lists stored evidence artifacts for a run.
- `POST /api/runs/:runId/artifacts/presign`: returns a local placeholder upload URL for worker handoff.
- `POST /api/runs/:runId/artifacts`: registers replay/log/save/screenshot/video evidence.

Steam app ingestion can also run from the CLI against any Steambench API URL:

```bash
npm run steam:ingest -- --query=Portal --fixture=true --top=1 --import-limit=4
npm run steam:ingest -- --appid=620 --dry-run=true
npm run steam:ingest -- --query=Hades --publish=true --review-approved=true
npm run steam:onboard -- --appid=620 --fixture=true
npm run steam:onboard -- --appid=620 --fixture=true --execute=advance --review-approved=true
npm run steam:source-queue -- --fixture=true --limit=4 --proposal-limit=2
npm run steam:source-queue -- --fixture=true --execute=next --review-notes="queue import"
npm run steam:source-queue -- --fixture=true --execute=advance-next --review-approved=true --max-steps=3 --review-notes="queue import and publish"
npm run benchmark:blueprint-ops -- --status=all --limit=6
npm run benchmark:blueprint-ops -- --status=import-ready --limit=6
npm run benchmark:blueprint-ops -- --appid=620
npm run benchmark:blueprint-ops -- --appid=620 --fixture=true --execute=next
npm run benchmark:blueprint-ops -- --appid=620 --fixture=true --execute=advance-source-actions --max-steps=3
```

The command calls the same discovery, achievement ladder, import, publication, and onboarding endpoints as the dashboard. Imported achievements remain review candidates until `/api/steam/apps/:appid/publish-candidates` accepts the review decision.

Use `steam:onboard` when an AppID is already known and the operator wants the onboarding checkpoint directly. It is read-only by default; `--execute=advance` runs the safe import/publish/coverage-plan progression, and `--execute=run-local --human-user-id=<id> --agent-id=<id>` additionally runs local human/agent coverage through the same API path as CI smoke tests.

Use `steam:source-queue` when choosing the next game to import across the Steam source surface. It is read-only by default, ranks apps by source readiness and harness risk, and shows achievement, Steam stat, Steam leaderboard, active-track, candidate-track, and missing-track breakdowns for the top import target. It only runs a queue recommendation when `--execute=<recommended_action_id>` or `--execute=next` is provided. Passing `--execute=advance-next` repeatedly refreshes the queue and advances consecutive write recommendations for the same top app, such as importing recommended tasks and then publishing candidates; use `--max-steps=<n>` to cap the run, and include `--review-approved=true` plus review notes when the sequence may publish candidates.

Use `benchmark:blueprint-ops` to audit the per-game benchmark blueprints exposed by `/api/state`, or pass `--appid=<steam_appid>` to inspect one `/api/games/:appid/benchmark-blueprint`. It is read-only unless `--execute=<source_action_id>` is paired with `--appid=<steam_appid>`, in which case it POSTs the focused blueprint `sourceActions` endpoint and refreshes the blueprint summary. `--execute=next` runs the current first focused `sourceAction`, while `--execute=advance-source-actions --max-steps=<n>` refreshes the focused blueprint after each write and advances consecutive sourceActions up to the bounded step count. It summarizes which games are ranked-ready, import-ready, review-required, or missing Steam data while checking the canonical `output.mp4` artifact and Stage 2 start constraints remain attached. A focused blueprint response now includes a `sourcePlan` with achievement, stat, and leaderboard endpoints and source counts, plus `sourceActions` that point to the matching import or publish POST endpoints with default `useFixture`, `limit`, and publication-review body fields where applicable; pass `useFixture=true` on the API route, or `--fixture=true --appid=<steam_appid>` on the CLI, when you need fixture-backed proposal counts without live Steam access. Platform ops mirrors the focused blueprint source totals, source action ids, new import availability, and missing candidate tracks in its `benchmark-blueprints` subsystem.

Metric proposal manifests bulk-import non-achievement Steam signals:

```bash
npm run steam:metrics -- --appid=620 --file=metric-proposals.json
npm run steam:metrics -- --appid=620 --file=metric-proposals.json --publish=true --review-approved=true
npm run steam:ops -- --appid=620 --fixture=true --limit=2
npm run steam:ops -- --appid=620 --fixture=true --limit=2 --execute=import-achievement-recommendations
npm run steam:ops -- --appid=620 --fixture=true --limit=2 --execute=publish-candidates --review-approved=true --review-notes="approved source ops candidates"
npm run steam:ops -- --appid=620 --fixture=true --limit=2 --execute=advance-source-actions --max-steps=4 --review-approved=true --review-notes="advance source ops candidates"
```

The manifest can be a JSON array of proposal contracts or an object with `gameName`, `benchmarkFit`, `harnessRisk`, `reviewNotes`, and `proposals`. Each proposal uses the same contract as `/api/steam/apps/:appid/task-proposals`: `track` is `stat`, `leaderboard`, or `capture`; `metricName`, `targetValue`, `objective`, `estimatedRuntimeMinutes`, and `scoringRule` define how humans and agents will be compared. Imported metric proposals stay as review candidates until the normal publication endpoint approves them.

The source ops command is read-only by default. Passing `--execute=import-achievement-recommendations`, `--execute=import-stat-proposals`, or `--execute=import-leaderboard-proposals` writes the named source recommendations into the task registry as candidates. Passing `--execute=publish-candidates` promotes review-cleared candidates and should include `--review-approved=true` plus non-empty `--review-notes` when controlled tasks are present. Passing `--execute=advance-source-actions --max-steps=<n>` refreshes the one-app source ops report after each write and advances consecutive writable recommendations, stopping before read-only inspection actions.

Steam stat schema proposal import can generate stat benchmark candidates from `GetSchemaForGame` or fixture metadata:

```bash
npm run steam:stats -- --appid=620 --fixture=true --limit=2
npm run steam:stats -- --appid=620 --fixture=true --limit=2 --import=true
npm run steam:stats -- --appid=620 --fixture=true --limit=2 --import=true --publish=true --review-approved=true
```

Without `--import=true`, the command only previews schema-derived task contracts. Imported stat proposals stay as candidates until the normal publication endpoint approves them.

Steam leaderboard metadata proposal import follows the same candidate flow, but leaderboard proposals normally require review approval because rules, seed, build, and tie-breakers must be frozen before ranking:

```bash
npm run steam:leaderboards -- --appid=620 --fixture=true --limit=2
npm run steam:leaderboards -- --appid=620 --fixture=true --limit=2 --import=true
npm run steam:leaderboards -- --appid=620 --fixture=true --limit=2 --import=true --publish=true --review-approved=true --force-review-override=true
```

Human Steam proof readiness can be audited across competitors before scheduling matches:

```bash
npm run human:proof-ops -- --appid=620 --limit=4 --user-limit=20
```

To bootstrap a complete local human-vs-agent competition for an onboarded app, use:

```bash
npm run competition:bootstrap -- --query=Portal --fixture=true --top=1 --import-limit=2 --coverage-limit=2 --suite-tier=ranked
npm run competition:bootstrap -- --appid=620 --human-user-id=<user_id> --agent-id=<agent_id>
npm run competition:ops -- --appid=620 --human-user-id=<user_id> --agent-id=<agent_id> --suite-tier=ranked
npm run competition:ops -- --appid=620 --human-user-id=<user_id> --agent-id=<agent_id> --execute=run-suite-race
npm run competition:ops -- --appid=620 --human-user-id=<user_id> --agent-id=<agent_id> --execute=advance-competition-actions --max-steps=2
npm run event:ops -- --scope=weekly --suite-id=620:ranked
npm run event:ops -- --scope=weekly --suite-id=620:ranked --execute=schedule-suite
npm run event:ops -- --scope=weekly --suite-id=620:ranked --execute=advance-event-actions --max-steps=3
npm run human:onboarding-ops -- --scope=weekly --limit=20
npm run human:onboarding-ops -- --scope=weekly --execute=link-steam --steamid=<17_digit_id>
npm run human:onboarding-ops -- --scope=weekly --execute=register-event
npm run human:onboarding-ops -- --scope=weekly --execute=advance-onboarding-actions --handle=<handle> --steamid=<17_digit_id> --max-steps=4
npm run human:proof-ops -- --appid=620 --limit=4 --user-limit=20
npm run human:proof-ops -- --appid=620 --execute=submit-human-proof
npm run human:proof-ops -- --appid=620 --execute=advance-human-proof-actions --max-steps=2 --steamid=<17_digit_id>
npm run human:campaign-ops -- --user-id=<user_id> --campaign-id=<campaign_id>
npm run human:campaign-ops -- --user-id=<user_id> --campaign-id=<campaign_id> --execute=run-local
npm run human:comparison-ops -- --human-user-id=<user_id> --campaign-id=<campaign_id>
npm run human:comparison-ops -- --human-user-id=<user_id> --campaign-id=<campaign_id> --execute=share-comparison-certificate
npm run human:comparison-ops -- --human-user-id=<user_id> --campaign-id=<campaign_id> --execute=advance-comparison-actions --max-steps=2
npm run challenge:ops -- --status=open --limit=10
npm run challenge:ops -- --status=open --limit=10 --execute=accept-open-challenge
npm run challenge:ops -- --status=accepted --limit=10 --execute=run-challenge-local
npm run challenge:ops -- --limit=10 --execute=advance-challenge-actions --max-steps=3
npm run match:arena-ops -- --status=needs-start --limit=10
npm run match:arena-ops -- --limit=10 --execute=advance-match-actions --max-steps=2
```

The bootstrap command first runs the Steam ingest flow, then creates or reuses a human competitor, binds a consented SteamID proof stub, creates or reuses a local runtime agent, runs the app coverage plan, and starts a scored suite race through the public API. It prints a `steambench.app-competition-bootstrap.v1` summary with the selected app, created competitors, coverage totals, suite race status, winner, and public-share readiness.

The competition ops command reads `/api/games/:appid/competition/ops-report` without side effects by default. Use it after bootstrap or periodic coverage runs to see remaining human/agent gaps, selected suite readiness, recent coverage executions, public-share readiness, and concrete API actions such as publishing candidates, queueing coverage runs, running local coverage, or launching another suite race. Passing `--execute=<recommended_action_id>` explicitly executes that one recommended action, refreshes the ops report, and returns the action result for audit. Passing `--execute=advance-competition-actions --max-steps=<n>` refreshes the per-game competition report after each action and advances candidate publication, coverage scheduling/local coverage, and suite race execution while skipping certificate inspection.

The event ops command reads `/api/competition-events/:scope/ops-report` without side effects by default. Use it after event registration to see whether the event needs more registrations, suite scheduling, local suite execution, campaign comparison runs, or only certificate inspection. Passing `--execute=<recommended_action_id>` explicitly executes one recommended event action, refreshes the event ops report, and returns the action result. Passing `--execute=advance-event-actions --max-steps=<n>` refreshes the event report after each action and advances suite scheduling, local suite execution, and campaign comparison runs while skipping inspection-only recommendations.

The human onboarding ops command is read-only by default. It shows whether a human competitor needs account creation, Steam linking, proof consent, or event registration before public races can be scheduled. Passing `--execute=create-human --handle=<handle>`, `--execute=link-steam --steamid=<17_digit_id>`, `--execute=grant-proof-consent`, or `--execute=register-event` advances only that recommended gate through the public API. Passing `--execute=advance-onboarding-actions --max-steps=<n>` refreshes the onboarding report after each action and advances human creation, Steam linking, proof consent, and event registration while skipping inspection-only recommendations; include `--handle` when creation may be needed and `--steamid` when linking may be needed.

The human proof ops command is also read-only by default. Passing `--execute=submit-human-proof` runs the next ready human proof submission through `/api/users/:userId/steam-proof-submissions`, while `--execute=grant-proof-consent` or `--execute=link-steam --steamid=<17_digit_id>` advances human onboarding when the recommended action requires it. Passing `--execute=advance-human-proof-actions --max-steps=<n>` refreshes the human proof report after each action and advances ready proof submission, proof consent, and Steam linking while skipping inspection-only recommendations; include `--steamid` when linking may be needed.

The human campaign ops command is read-only by default and summarizes the human side of an agent campaign comparison from `/api/users/:userId/human-campaign-plan`. Passing `--execute=run-local` submits every ready human campaign task through the local proof runner, refreshes the plan, and returns comparison bundle/certificate readiness.

The human comparison ops command is read-only by default and summarizes `/api/comparisons/human-agent/ops-report` across completed and incomplete campaign comparisons. Passing `--execute=run-human-campaign-local` runs the recommended human-side local campaign action, while `--execute=share-comparison-certificate` resolves the next public comparison certificate without changing scores. Passing `--execute=advance-comparison-actions --max-steps=<n>` refreshes the comparison report after each action and advances human-side local campaign execution plus certificate sharing while skipping inspection-only recommendations.

The challenge ops command is read-only by default. Passing `--execute=accept-open-challenge` creates the match contract for the next open challenge, `--execute=run-challenge-local` runs the next accepted challenge through local human and agent scoring, and `--execute=share-challenge-certificate` resolves a public challenge certificate for an already scoreboard-ready challenge. Passing `--execute=advance-challenge-actions --max-steps=<n>` refreshes the challenge report after each action and advances consecutive non-inspection recommendations, such as accepting, running, and resolving the certificate for an open challenge.

The match arena ops command is read-only by default. Passing `--execute=advance-match-actions --max-steps=<n>` refreshes the direct match arena report after each action and advances consecutive non-inspection recommendations such as local match execution and public certificate resolution, while suppressing repeated terminal certificate actions.

Local dispatch tickets can be drained from the CLI:

```bash
npm run platform:ops -- --scope=weekly --limit=20
npm run task:review-ops -- --decision=review-required --limit=10
npm run agent:ops -- --provider=local --limit=20
npm run agent:ops -- --provider=local --limit=20 --execute=open-agent-run-session --ttl-seconds=900
npm run agent:ops -- --provider=local --limit=20 --execute=create-agent-campaign --campaign-limit=2
npm run agent:ops -- --provider=local --limit=20 --execute=advance-agent-actions --max-steps=2 --ttl-seconds=900 --campaign-limit=2
npm run dispatch:ops -- --limit=20
npm run dispatch:ops -- --provider=local --status=planned,launched
npm run dispatch:ops -- --provider=local --status=planned,launched --execute=drain-local-dispatches --limit=1
npm run dispatch:ops -- --provider=local --status=planned,launched --execute=advance-dispatch-actions --max-steps=2 --limit=1
npm run dispatch:drain -- --dry-run=true --limit=5
npm run dispatch:drain -- --provider=local --status=planned,launched --limit=1
npm run agent:run-session -- --agent-id=<agent_id> --task-id=<task_id> --ttl-seconds=900
npm run agent:run-session -- --agent-id=<agent_id> --task-id=<task_id> --ttl-seconds=900 --create-livestream=true --livestream-status=live --livestream-title="Agent bridge stream"
npm run agent:trace-ops -- --verdict=needs-control-session --execute=advance-trace-actions --max-steps=1 --ttl-seconds=120
npm run runtime:action-spaces -- --agent-id=<agent_id> --input-mode=controller --transport=virtual-controller
npm run runtime:action-spaces -- --agent-id=<agent_id> --input-mode=controller --transport=virtual-controller --execute=create-control-run-session
npm run runtime:action-spaces -- --agent-id=<agent_id> --input-mode=controller --transport=virtual-controller --execute=create-agent-run
npm run runtime:action-spaces -- --agent-id=<agent_id> --input-mode=controller --transport=virtual-controller --execute=advance-action-space-actions --max-steps=1
npm run broadcast:ops -- --status=scheduled --execute=start-scheduled-broadcast
npm run broadcast:ops -- --status=scoreboard-ready --execute=advance-broadcast-actions --max-steps=2
npm run platform:ops -- --scope=weekly --execute=broadcasts:start-scheduled-broadcast
npm run platform:ops -- --scope=weekly --execute=game-competition:schedule-coverage
npm run platform:ops -- --scope=weekly --execute=game-competition:run-suite-race
npm run platform:ops -- --scope=weekly --execute=agent-traces:create-control-session
npm run bridge:ops -- --status=active --transport=virtual-controller
npm run bridge:ops -- --status=active --transport=virtual-controller --execute=run-control-bridge --executor=audit
npm run bridge:ops -- --status=active --transport=virtual-controller --execute=advance-control-bridge-actions --max-steps=1 --executor=audit
npm run scoreboard:ops -- --appid=620 --status=scoreboard-missing --execute=republish-scoreboard-row
npm run scoreboard:ops -- --appid=620 --status=scoreboard-ready --execute=share-standings
npm run scoreboard:ops -- --appid=620 --execute=advance-scoreboard-actions --max-steps=2
curl "http://127.0.0.1:3000/api/public/benchmark-snapshot?season=weekly&limit=12"
curl "http://127.0.0.1:3000/api/public/competition-hub?season=weekly&appid=620&taskId=620:ACH.WAKE_UP&limit=12"
curl "http://127.0.0.1:3000/api/public/events/weekly/entry?taskId=1145360:ESCAPE_TARTARUS&humanUserId=<user_id>&agentId=<agent_id>&provider=external&limit=12"
curl "http://127.0.0.1:3000/api/public/quickstart?season=weekly&appid=1145360&taskId=1145360:ESCAPE_TARTARUS&provider=external&limit=12"
curl "http://127.0.0.1:3000/api/public/steam/apps/620/intake?useFixture=true&limit=12"
curl "http://127.0.0.1:3000/api/public/catalog?season=weekly&appid=1145360&transport=virtual-controller&bridgeable=true&provider=external&limit=12"
curl "http://127.0.0.1:3000/api/public/standings?season=all&appid=620&track=achievement&limit=12"
curl "http://127.0.0.1:3000/api/public/agents/onboarding?taskId=1145360:ESCAPE_TARTARUS&provider=external"
curl "http://127.0.0.1:3000/api/public/games/620/benchmark-pack?season=all&limit=12"
curl "http://127.0.0.1:3000/api/public/tasks/1145360:ESCAPE_TARTARUS/action-space"
curl "http://127.0.0.1:3000/api/public/tasks/1145360:ESCAPE_TARTARUS/bridge-handoff?agentId=<agent_id>&provider=external&ttlSeconds=900"
curl "http://127.0.0.1:3000/api/public/tasks/620:ACH.WAKE_UP/runner-contract"
npm run public:catalog -- --season=weekly --appid=1145360 --transport=virtual-controller --bridgeable=true --provider=external --limit=12
npm run public:standings -- --season=all --appid=620 --track=achievement --limit=12
npm run public:hub -- --season=weekly --appid=620 --task-id=620:ACH.WAKE_UP --limit=12
npm run public:event-entry -- --scope=weekly --task-id=1145360:ESCAPE_TARTARUS --human-user-id=<user_id> --agent-id=<agent_id> --provider=external --limit=12
npm run public:quickstart -- --season=weekly --appid=1145360 --task-id=1145360:ESCAPE_TARTARUS --provider=external --limit=12
npm run public:intake -- --appid=620 --fixture=true --limit=12
npm run public:agent -- --task-id=1145360:ESCAPE_TARTARUS --provider=external
npm run public:agent -- --task-id=1145360:ESCAPE_TARTARUS --provider=external --execute=register --handle=<agent_handle>
npm run public:action-space -- --task-id=1145360:ESCAPE_TARTARUS --agent-id=<agent_id>
npm run public:bridge-handoff -- --task-id=1145360:ESCAPE_TARTARUS --agent-id=<agent_id> --provider=external --ttl-seconds=900
npm run public:race-entry -- --task-id=1145360:ESCAPE_TARTARUS --human-user-id=<user_id> --agent-id=<agent_id>
npm run public:export -- --season=weekly --appid=620 --limit=12 --task-id=620:ACH.WAKE_UP --out=public-export.json
npm run public:runner -- --task-id=1145360:ESCAPE_TARTARUS --agent-id=<agent_id> --execute=advance-public-runner
npm run public:human -- --task-id=620:ACH.WAKE_UP --execute=advance-public-human --steamid=<17_digit_id>
npm run public:match -- --task-id=620:ACH.WAKE_UP --human-user-id=<user_id> --agent-id=<agent_id> --execute=advance-public-match
npm run public:watch -- --stream-id=<stream_id> --execute=verify-public-watch
npm run public:submit -- --run-id=<run_id>
npm run certificate:index -- --kind=all --limit=50 --verify=true --remote=true
npm run certificate:verify -- --url="/api/comparisons/human-agent/result-certificate?humanUserId=<user_id>&campaignId=<campaign_id>" --remote=true
npm run certificate:verify -- --certificate=certificate.json
npm run platform:ops -- --scope=weekly --execute=challenges:accept-open-challenge
npm run platform:ops -- --scope=weekly --execute=challenges:run-challenge-local
npm run platform:ops -- --scope=weekly --execute=challenges:share-challenge-certificate
npm run platform:ops -- --scope=weekly --execute=match-arena:run-match-local
npm run platform:ops -- --scope=weekly --execute=match-arena:share-match-certificate
npm run platform:ops -- --scope=weekly --execute=advance-platform-actions --max-steps=3
```

The platform ops command is read-only by default and summarizes the whole benchmark operating surface from `/api/platform/ops-report`. It normalizes subsystem recommendations with prefixed ids such as `steam-sources:run-source-queue-next`, `task-review:inspect-review-required`, `benchmark-blueprints:import-achievement-recommendations`, `benchmark-blueprints:import-stat-proposals`, `benchmark-blueprints:import-leaderboard-proposals`, `benchmark-blueprints:publish-candidates`, `benchmark-blueprints:inspect-focused-blueprint`, `benchmark-blueprints:inspect-import-ready-blueprints`, `game-competition:publish-candidates`, `game-competition:schedule-coverage`, `game-competition:run-local-coverage`, `game-competition:run-suite-race`, `human-onboarding:link-steam`, `human-proof:submit-human-proof`, `human-proof:grant-proof-consent`, `human-agent-comparisons:run-human-campaign-local`, `human-agent-comparisons:share-comparison-certificate`, `events:register-agent`, `events:schedule-suite`, `events:run-suite-local`, `events:run-campaign-comparisons-local`, `events:inspect-event-certificate`, `agent-runtime:open-agent-run-session`, `action-spaces:create-control-run-session`, `action-spaces:inspect-control-bridge-docs`, `broadcasts:start-scheduled-broadcast`, `broadcasts:end-live-broadcast`, `broadcasts:share-broadcast-certificate`, `runtime-dispatch:drain-dispatches`, `agent-traces:create-control-session`, `control-bridge:inspect-bridge-manifest`, `challenges:accept-open-challenge`, `challenges:run-challenge-local`, `challenges:share-challenge-certificate`, `match-arena:run-match-local`, and `match-arena:share-match-certificate`; passing `--execute=<prefixed_action_id>` only executes GET/POST API recommendations, while CLI handoffs remain explicit commands. Passing `--execute=advance-platform-actions --max-steps=<n>` refreshes the platform report after each safe POST recommendation and advances writable subsystem actions while skipping inspection, CLI handoffs, Steam linking, human creation, and action-batch payload actions. The `steam-sources` subsystem rolls up source queue achievement, stat, leaderboard, import-availability, and missing-track breakdowns. The `benchmark-blueprints` subsystem chooses the current Steam game blueprint needing import, review, or source-data attention, exposes focused blueprint source actions, and checks the `output.mp4` plus Stage 2 start contracts; the `game-competition` subsystem chooses the current Steam game needing human/agent coverage or suite execution attention; the `human-proof` subsystem shows whether linked humans can submit Steam proof or need Steam linking/proof consent first; the `human-agent-comparisons` subsystem shows campaign comparison gaps and share-ready result certificates.

The certificate index command reads `/api/result-certificates`, pulls each indexed `resultCertificate` link, recomputes every signed-field SHA-256 fingerprint locally, and with `--remote=true` also cross-checks each certificate against `/api/result-certificates/verify`. The certificate verify command reads one public result certificate from a local JSON file or an API URL, recomputes the signed-field SHA-256 fingerprint locally, and reports whether the certificate is valid. Passing `--remote=true` also calls `/api/result-certificates/verify` and checks that the server-side verifier agrees with the local result.

The agent ops command is read-only by default. Passing `--execute=open-agent-run-session` executes the next ready single-run recommendation, grants a bounded control lease when the task requires one, and returns the run id, handoff status, control session id, access-packet readiness, and bridge readiness. Passing `--execute=create-agent-campaign` executes the named campaign API recommendation from `/api/agents/ops-report`, queues a local or Modal campaign with `--campaign-limit=<n>`, and returns the campaign id, run count, and dispatch count. Passing `--execute=advance-agent-actions --max-steps=<n>` refreshes the agent ops report after each API-backed action and advances run-session creation, campaign creation, or paused-agent activation while stopping before CLI handoffs such as dispatch draining.

The agent trace ops command is read-only by default. Passing `--execute=create-control-session` executes the named API recommendation from `/api/agent-traces/ops-report`, grants a TTL-bound control session with `--ttl-seconds=<n>` and optional `--idempotency-key=<key>`, and returns the control session id/status. Passing `--execute=advance-trace-actions --max-steps=<n>` refreshes the trace ops report after each API-backed action and grants pending control sessions while stopping before explicit action-batch payloads and bridge-executor handoffs.

The runtime action-spaces command is read-only by default and filters benchmark tasks by agent, game, input mode, and transport. Passing `--execute=create-control-run-session` creates a run plus bounded virtual-controller lease for the selected bridgeable task, while `--execute=create-agent-run` queues a run without opening the bridge lease. Passing `--execute=advance-action-space-actions --max-steps=<n>` refreshes the action-space catalog after each API-backed action and advances the first bridge-ready run handoff while stopping before inspection recommendations.

The scoreboard ops command is also read-only by default. Passing `--execute=republish-scoreboard-row` executes the named scoreboard repair recommendation from `/api/scoreboard/ops-report` and returns the published run id, rank, and score. Passing `--execute=share-standings` resolves the share-ready standings action without changing scores. Passing `--execute=advance-scoreboard-actions --max-steps=<n>` refreshes the scoreboard report after each action and advances scoreboard row publication plus standings sharing while skipping inspection-only recommendations.

The dispatch ops command reads `/api/dispatches/ops-report` without side effects by default. Use it before drain or cloud launch handoff to see pending local tickets, pending Modal tickets, run audit readiness, expired worker leases, and concrete links for audits, evidence bundles, result certificates, and Modal packages. Passing `--execute=drain-local-dispatches` runs the named local drain handoff through `dispatch:drain`; passing `--execute=requeue-expired-workers` calls the expired worker requeue endpoint. Passing `--execute=advance-dispatch-actions --max-steps=<n>` refreshes the dispatch ops report after each writable handoff and advances expired-worker requeue plus local dispatch drain while stopping before Modal package or inspection recommendations.

The drain command reads `/api/dispatches`, filters local dispatch tickets, marks each selected ticket `launched`, runs its planned worker command, and then marks it `completed` or `failed`. It intentionally skips Modal tickets; use `/api/dispatches/:dispatchId/modal-package` and the generated Modal command for cloud execution.

Local bridge adapters can use `npm run bridge:ops -- --status=active --transport=virtual-controller` to inspect control leases before handing them to a bridge. The command is read-only by default; `--execute=run-control-bridge` explicitly runs the recommended bridge handoff through `bridge:control` and returns the persisted executor report status. Passing `--execute=advance-control-bridge-actions --max-steps=<n>` refreshes the bridge ops report after each writable handoff and advances bridge executor runs, lease heartbeats, or expired lease revocation while skipping manifest inspection. `npm run bridge:control -- --session=<control_session_id>` consumes the bridge manifest, heartbeats the lease, submits the manifest's allowed controller actions through the API, and validates the returned execution plan through the configured executor. The default `--executor=audit` produces a `steambench.controller-executor-report.v1` with no host-input side effects. `--executor=geforce-now` requires `--executor-command=<path>` or `STEAMBENCH_GEFORCE_NOW_EXECUTOR_CMD`; the runner sends a `steambench.controller-executor-request.v1` JSON payload on stdin and validates the external process's `steambench.controller-executor-report.v1` stdout. The included executor command is `npm run executor:geforce-now`; by default it runs an audit backend, and a real GeForce NOW gamepad driver can be connected behind it with `--backend=command --backend-command=<path>` or `STEAMBENCH_GEFORCE_NOW_BACKEND_CMD`. Successful executor reports are persisted back to the run as `checkpoint` events so bridge manifests, traces, broadcasts, and evidence bundles can audit the controller executor result. Use `--run=<run_id>` to auto-select the active lease, `--actions=actions.json` for a custom JSON action list, `--dry-run=true` to validate the lease without sending input, and `--revoke=true` to close the lease after the probe.

- `POST /api/runs/:runId/artifact`: attaches the canonical `output.mp4` proof artifact.
- `POST /api/runs/:runId/livestreams`: creates a livestream session for a run.
- `POST /api/livestreams/:streamId/status`: moves a livestream through scheduled/live/ended states.
- `npm run broadcast:ops -- --status=scoreboard-ready --limit=10`: summarizes public-ready or attention-needed gameplay broadcasts without changing stream state. Add `--status=scheduled --execute=start-scheduled-broadcast` to move the next scheduled stream into live monitoring, `--execute=end-live-broadcast` to close a live stream from the recommended action, or `--execute=share-broadcast-certificate` to resolve the public replay certificate. Use `--execute=advance-broadcast-actions --max-steps=<n>` to refresh after each action and advance scheduled/live/certificate recommendations while skipping proof-inspection and center-inspection actions.
- `npm run scoreboard:ops -- --appid=620 --status=scoreboard-ready --limit=10`: audits scored runs, proof readiness, and public scoreboard row consistency without modifying scores.
- `POST /api/runs/:runId/score`: scores the attempt and updates the scoreboard.

## Stage 2 Contract Note

The canonical evaluated gameplay capture artifact is `output.mp4`. Keep `TARGET_VIDEO_NAME`, task docs, smoke helpers, blind-eval helpers, VM packages, and bucket fixtures aligned if that name changes.
Run `npm run audit:contracts` before publishing task packages; it checks the manifest artifact contract, canonical `TARGET_VIDEO_NAME` default, and forbidden Stage 2 `start()` actions.
