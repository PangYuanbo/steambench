# Steambench Architecture Draft

## Product Surface

Steambench has three loops:

1. Humans connect Steam and explicitly consent before linked Steam proof can be used in public benchmark runs.
2. Agents run game tasks through a runtime harness and submit evidence artifacts.
3. The platform normalizes Steam achievements, controlled stats, leaderboard-style metrics, and run captures into comparable levels.

## Benchmark Levels

Achievement tasks are the initial task family because they have public rarity signals and clear pass/fail semantics. A task level is derived from global completion percentage:

- Level 1-2: onboarding and common achievements.
- Level 3-5: broad skill checks suitable for human and agent baselines.
- Level 6-8: rare achievements that imply deeper game competence.
- Level 9-10: elite or grind-heavy achievements requiring special harness review.

Non-achievement tasks are seeded with explicit metric contracts until each game has a stable adapter:

- `stat`: a bounded in-game or Steam stat such as gold earned, ante reached, or survival time.
- `leaderboard`: a controlled score target where rules, seed, build, and tie-breakers are frozen before ranking.
- `capture`: a timing or completion target verified from `output.mp4`, replay metadata, and reviewer/auditor evidence.

These tasks should carry `metricName`, `targetValue`, `scoringRule`, and proof requirements. Achievement tasks require verified Steam achievement proof plus the canonical artifact. Stat, leaderboard, and capture tasks require verified manual review plus the canonical artifact until stronger game-specific verifiers exist.

The scoring model intentionally separates rarity from suitability. Very rare achievements can be poor benchmarks if they require hundreds of hours, DLC, multiplayer coordination, seasonal events, or anti-cheat-sensitive automation.

Task leaderboards are the product view for direct competition. A scored run publishes enough metadata to rank one Steam task independently from the global ladder: source run, task key, appid, competitor type, score, evidence, and optional raw metric values from stat, leaderboard, or capture proof. The API aggregates these rows into overall task leaders plus separate human and agent leaders.

Season windows are derived from scoreboard rows rather than stored as separate mutable records. The first product scopes are all-time, daily, and a rolling 7-day weekly view. These windows reuse the same standings and task-leaderboard aggregation so global, seasonal, and per-task pages stay consistent.

Competition events are the public season surface built from those same windows. Each event projection combines eligible entrants, explicit event registrations, human-vs-agent score totals, match progress, suite race progress, operations load, and featured task leaders. Registration is the event opt-in record; consented humans and active agents can be counted as runnable, but registered pairs show who has explicitly entered a specific all-time, daily, or weekly event. Event scheduling turns those registered pairs into suite races after the same suite preflight used by manual scheduling, so blocked tasks and controlled packs cannot enter public brackets silently. Event execution can then run a bounded batch of scheduled suite races through the same local orchestration used by single suite races and returns each race's audit and evidence bundle. The event evidence bundle is the public result packet for the whole bracket: registrations, event-scoped suite race bundles, suite standings, and an integrity checklist.

Task review is the gate between Steam data ingestion and ranked play. Imported achievements and seeded tasks expose a review result with suitability score, risk findings, fairness controls, and a decision. The task review catalog aggregates those decisions into a public/operator projection with ranked-ready, review-required, blocked, fairness, risk, candidate, and rejected counts plus a bounded review queue. The dashboard surfaces that catalog above the task board and still links each task back to its detailed review so operators can see why a task is ranked-ready, review-required, or rejected.

Benchmark suites turn individual tasks into game-level competition packs. Suites are derived from the current catalog and review results, grouped into starter, ranked, expert, and full-game tiers. Each suite exposes readiness score, task count, tracks, runtime estimate, controls, and review status so operators can launch comparable human-vs-agent races without manually picking isolated achievements.

Game benchmark profiles are the per-Steam-app product surface. A profile projects the game catalog entry, active and candidate tasks, review health, suite packs, task leaderboards, recent scored rows, and broadcast replays into one appid-scoped view. This keeps the global arena from being the only way to inspect whether a single game is ready for ranked human-vs-agent competition.

Race eligibility is the preflight gate for head-to-head matches. It combines the task review decision, human Steam linking status, agent runtime readiness, required proof channels, and fairness controls into one verdict: `ready`, `controlled`, or `blocked`. Match creation rejects blocked tasks and requires explicit approval for controlled tasks so human-vs-agent races do not silently bypass review or capability checks.

Challenge queue is the product object before a match exists. A human, agent, or system event can open a challenge for one task, one consented human, and one active agent after the same eligibility preflight passes. Accepting the challenge creates the match contract; running it locally or through workers still uses the normal run, proof, artifact, audit, and scoreboard path.

Steam proof consent is a human-side eligibility requirement. Binding a SteamID only establishes identity; human submissions, Steam proof verification, matches, and suite races stay blocked until the user grants consent for using linked Steam proof in public ranking.

Suite races schedule a full benchmark pack as a multi-match event. The API preflights every task in the suite, rejects blocked packs, requires approval for controlled packs, and then creates one head-to-head match per suite task. After all child matches score, the suite race aggregates human and agent run scores into a suite-level winner, margin, and total. Suite-race standings then derive per-suite leaderboards and aggregate human-vs-agent suite totals from those scored race records. A suite-race audit projection assembles every child match, human run audit, agent run audit, aggregate totals, evidence counts, and missing evidence into one verdict, so the higher-level competition object stays tied to the underlying per-run proof chain.

The arena has two execution paths. Production workers can start a match, run each side independently, and evaluate when both runs are scored. Local demos use orchestration endpoints to run the same match contract end-to-end in one call. Suite races can use the same local path to execute every child match, aggregate the suite winner, and return the suite audit and evidence bundle in one response. This keeps the dashboard's Match and suite pack flows aligned with the backend competition lifecycle.

Match feeds are derived from match, run, task, and scoreboard records. They provide the public arena history: task context, human side, agent side, score, winner, margin, and the selected all-time/daily/weekly window. This keeps head-to-head browsing consistent with the same scored rows used by standings and task leaderboards.

Worker dispatch is lease-based. A claimed run moves from `queued` to `preparing`, records the worker ID, and receives a lease expiry. Heartbeats extend that lease. Operations can list queued, leased, and expired runs, then requeue only expired `preparing` or `running` runs so a new worker can claim them without touching artifact-submitted, failed, canceled, or scored attempts.

Runtime dispatch tickets are the operator handoff before a worker claim. They convert an existing queued run into a local or Modal command with a worker ID, execution manifest URL, and runtime package URL. A dispatch ticket can be planned, launched, claimed, completed, failed, or canceled, but it does not mutate run ownership by itself; the worker still claims and heartbeats through the run lifecycle. This keeps Modal scheduling, local smoke workers, and dashboard operations pointed at the same run contract.

Modal runtime packages are derived from Modal dispatch tickets. They describe the Modal app name, image dependencies, mounted repository path, Steam state volume, secret keys, entrypoint file, manifest URL, runtime package URL, canonical `output/output.mp4` artifact, and Stage 2 start restrictions. The package is data returned by the API; the actual cloud side effect remains an explicit `modal run modal/steambench_runtime.py ...` command.

Proof review is a separate moderation queue. Workers and humans can submit proof records as `pending`; reviewers verify or fail those records with reviewer notes. Each review writes durable proof metadata and a `proof` event so later scoring decisions have an audit trail.

Run audit reports are the per-attempt reproducibility surface. They assemble the run, task contract, required proof statuses, canonical `output.mp4` artifact, timeline events, livestream sessions, and scoreboard row into one report with a verdict such as `scoreboard-ready` or `proof-missing`.

Suite-race audit reports are the race-level reproducibility surface. They do not duplicate proof records; they project across child matches and run audits, then return `scoreboard-ready`, `match-incomplete`, `blocked`, or `in-progress` based on whether the aggregate race and every child run are ready for public ranking. Suite-race evidence bundles wrap that audit with a versioned integrity checklist for aggregate scoring, child match presence, scored child matches, child run audit readiness, and missing evidence.

Runtime readiness is checked before managed agent queueing. The task's Steam adapter determines required capabilities such as `keyboard-mouse`, `controller`, `turn-based-actions`, `screen-capture`, `stats-screen`, `action-log`, `seeded-save`, `manual-review`, and `output.mp4`. Agents missing required capabilities are rejected before a worker lease is created.

Agent runtime labs are the operator and dispatcher surface for those managed agents. A lab projects one agent's command, capabilities, readiness across recommended tasks, queued and active runs, expired leases, open challenges, recent broadcasts, verified proofs, and scoreboard rows. It is derived from existing run/match/challenge/evidence records and does not bypass the readiness gate; workers still queue through the managed agent run endpoint.

Execution manifests are the worker handoff boundary. Each run can resolve a versioned manifest containing the run, task, agent profile, Steam launch plan, readiness verdict, livestream refs, proof requirements, canonical artifact contract, and Stage 2 start constraints. This keeps workers, local smoke scripts, and dashboard summaries aligned on `output/output.mp4` and on the rule that Stage 2 `start()` performs only lightweight setup.

Evidence bundles are the shareable reproducibility object for scored runs. A bundle combines the execution manifest and run audit with artifact, proof, event, stream, and scoreboard evidence plus an integrity checklist. The dashboard links bundles from audit cards so operators can inspect why a run is or is not scoreboard-ready.

Result certificates are the public summary layer over those evidence objects. They use one versioned schema for scored runs, direct matches, challenges, and suite races, carrying participants, tasks, winner/score, evidence counts, canonical `output.mp4` status, links back to audits and bundles, and a share-readiness checklist. Certificates should stay compact enough for public result pages while evidence bundles remain the deeper reproducibility record.

Broadcast center is the public gameplay surface for live runs and replays. It projects livestream sessions across runs, tasks, runtime events, artifacts, proofs, and scoreboard status into one featured broadcast, live counts, viewer counts, proof-ready counts, and scoreboard-ready replay rows. It does not replace run audit or evidence bundles; it is the viewing/index layer that points back to those reproducibility records.

## Runtime Flow

1. Planner selects a task from the catalog and resolves app install requirements.
2. Runner launches a prepared VM/container with Steam, game files, and recording enabled.
3. Agent plays and emits structured events plus a video capture artifact.
4. Evaluator validates Steam proof, local save/progress evidence, and the required artifact.
5. Scoreboard updates human and agent standings with reproducible metadata.

## Data Policy

Prefer official Steamworks Web API surfaces for data that drives benchmark scores. Use non-key public endpoints only as optional enrichment, never as the only source of benchmark truth. Cache app and achievement metadata, keep API keys server-side, and store user proofs with explicit consent.

Steam app discovery and global achievement imports use an in-memory TTL cache in the prototype API. The cache reports each entry's source, fetch time, expiry, and stale state through `/api/steam/cache`, while `/api/steam/data-policy` lists allowed official endpoints and user-proof constraints. Fixture imports still return the same policy envelope so dashboards and smoke tests can distinguish fixture data from live Steam metadata without changing the task publication flow.

Steam app discovery is a review queue before task import. `/api/steam/apps/discover` projects app search results into benchmark-fit candidates with harness risk, track hints, and achievement-task estimates. Shortlisted candidates can then import achievements into the task registry, where existing review gates still decide whether any generated task becomes active.

Benchmark blueprints are read-only reviewer projections over a Steam app or discovery candidate. They combine the available task ladder, import opportunity, suite readiness, runtime adapter, Stage 2 restrictions, proof gates, and next actions so reviewers can decide whether to import achievements, publish candidates, add manual stat/capture seeds, or schedule human-agent suite races.
