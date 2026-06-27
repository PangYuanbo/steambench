# Benchmark Design

Steambench tasks should measure game competence, not account age, wallet access, event timing, or unsafe automation. The suitability model scores Steam achievements, stats, leaderboards, and capture tasks before they enter ranked human-vs-agent comparisons.

## Suitability Score

The model returns a 0-100 score plus one of four ratings:

- `recommended`: good ranked candidate after normal proof validation.
- `usable-with-review`: promising, but requires benchmark controls before ranking.
- `poor-fit`: weak benchmark signal or fairness problems; use only for experiments.
- `reject`: unsuitable for ranked human-vs-agent evaluation.

Inputs include track type, existing catalog `benchmarkFit`, harness risk, achievement rarity, estimated runtime, and explicit risk flags. Achievement rarity helps, but rarity alone is not enough: very rare achievements may be grind-heavy or long-horizon rather than skill-heavy.

Every task should expose an explainable review record before ranking. The review includes a rank/review/reject decision, active risk findings, fairness controls, and recommendations for redesigning weak tasks. Achievement imports should enter the candidate queue first; reviewers can then promote only tasks whose controls make human and agent attempts comparable.

The review catalog is the aggregate operator surface for those records. It should expose counts by decision, rating, fairness verdict, risk flag, and registry status, plus a short queue of candidate, controlled, or rejected tasks that need an explicit review action before public ranking.

Publication should enforce the review result. Ranked-ready tasks can be promoted directly. Review-required tasks need an explicit approval and review notes. Rejected tasks should stay out of ranked play unless an administrator records a force override for isolated testing.

## Benchmark Suites

Suites group tasks into raceable game packs instead of leaving operators to pick one achievement at a time. The first generated tiers are:

- `starter`: levels 1-3 for onboarding and baseline calibration.
- `ranked`: levels 4-6 for regular human-vs-agent ladder play.
- `expert`: levels 7-10 for high-signal skill tasks and controlled challenges.
- `marathon`: the full game task set for long-form exhibitions and broad capability audits.

Suites are derived from the active task catalog and review records. Each suite reports task IDs, tracks, level range, estimated runtime, ranked-ready count, controlled count, required controls, risk flags, and a readiness score. A suite marked `ranked-ready` can be used directly for competition; `controlled` suites need published controls; `review-required` suites should stay in operator review.

## Track Contracts

Every ranked task should state the source signal, metric, target, and scoring rule:

- `achievement`: Steam achievement API name, global rarity, linked-user Steam proof, and canonical `output.mp4` audit capture.
- `stat`: bounded metric such as gold earned, ante reached, or survival time, plus save/log/replay proof where possible.
- `leaderboard`: frozen seed/rules/build and explicit tie-breakers; do not rely on live public leaderboard rank alone.
- `capture`: evaluator-readable objective and timing/completion evidence from `output.mp4`, replay metadata, or save state.

Until game-specific stat and leaderboard verifiers are implemented, non-achievement tracks should require verified manual review plus the canonical artifact before publishing a scored row. Manual review proof should include `metricValue` when the reviewer can read the task metric from a score screen, replay, save file, or capture. The evaluator uses that value with the task's `metricName`, `targetValue`, and `scoringRule` so seeded stat, leaderboard, and capture tasks rank by actual performance rather than a flat task completion score.

New non-achievement task designs enter through `/api/steam/apps/:appid/task-proposals`. A proposal must name the track, level, metric, target value, objective, runtime estimate, scoring rule, and optional risk flags/proof text. The API converts it into the same reviewable task registry used by Steam achievement imports, so leaderboard/stat/capture ideas can be scaled into benchmark candidates without bypassing fairness review or the canonical `output.mp4` artifact contract.

For batch Steam expansion, operators can use `npm run steam:ingest -- --query=<game> --top=<n>` or `--appid=<appid[,appid]>`. The command is intentionally API-facing: it does discovery, ladder preview, achievement import, optional publication, and onboarding summary through the same endpoints as the dashboard. That keeps bulk imports reviewable; a game search result never becomes a ranked task until suitability review and publication gates pass.

Once an app is competition-ready, `npm run competition:bootstrap -- --query=<game> --fixture=true` or `--appid=<appid>` turns the ingestion result into a local human-vs-agent smoke race. It uses the API to create or reuse the competitors, attach the human Steam proof stub, execute the app coverage plan, and start a scored suite race. The output is a versioned `steambench.app-competition-bootstrap.v1` report so operators can verify coverage totals, suite status, winner, and public-share readiness before exposing a new app in the ranked surface.

After bootstrap, `/api/games/:appid/competition/ops-report` is the read-only operator checkpoint. It combines game standings, coverage-plan gaps, suite readiness, recent coverage runs, and recommended next API actions into `steambench.game-competition-ops-report.v1`. The paired `npm run competition:ops -- --appid=<appid>` command should be used before scheduling more work because it shows whether the next move is publication, coverage, local smoke execution, or another suite race. The CLI remains read-only unless `--execute=<recommended_action_id>` is passed, at which point it executes only that named action from the report, refreshes the report, and returns the action result for audit.

## Risk Flags

- `grind`: repeated account progression dominates task performance.
- `multiplayer`: success depends on teammates, opponents, matchmaking, or social coordination.
- `dlc`: paid add-on ownership affects eligibility.
- `seasonal`: content is only available during an event window or on certain dates.
- `antiCheat`: automation may violate anti-cheat rules or trigger protected modes.
- `longHorizon`: expected completion is too long for a clean benchmark attempt.

`antiCheat`, live `multiplayer`, and unfrozen `seasonal` tasks are blockers for ranked agent automation. `grind`, `dlc`, and `longHorizon` tasks can still be useful when separated into controlled tracks with clear eligibility and scoring rules.

## Human-vs-Agent Fairness

Ranked comparisons need symmetric conditions:

- Same game build, task text, scoring window, and evidence requirements.
- Linked SteamID proof, run metadata, and capture or replay evidence.
- Fresh profile, fixed save, or documented checkpoint when prior progress matters.
- Wall-clock caps and partial-credit milestones for long tasks.
- Matching DLC entitlement checks, or a separate DLC-only track.
- Solo/private/deterministic-bot setup instead of live matchmaking.
- Approved offline harnesses only for automation-sensitive games.

If those controls cannot be enforced, keep the task out of the ranked benchmark even if the Steam achievement or stat looks attractive.
