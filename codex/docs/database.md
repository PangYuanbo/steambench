# Database Plan

Steambench should move from the prototype JSON snapshot to Postgres before public runs. The database is the source of truth for users, agent profiles, Steam identity links, benchmark tasks, run lifecycle state, runtime events, artifacts, livestream metadata, and scoreboard rows.

The first migration should create the tables in [db/schema.sql](../db/schema.sql). Keep file/blob payloads out of Postgres; store object metadata in Postgres and upload videos, logs, save files, screenshots, and livestream recordings to object storage.

## Core Entities

### users

Stores competitors and account owners.

- `id`: UUID primary key.
- `handle`: public stable handle, unique case-insensitively.
- `display_name`: public display name.
- `user_type`: `human`, `agent`, or `admin`.
- `created_at`, `updated_at`: audit timestamps.

Use `users.user_type = 'agent'` for managed benchmark agents and `human` for Steam-linked players. If agents later need owners, add an `owner_user_id` nullable foreign key back to `users`.

### agent_profiles

Stores runnable AI competitors separately from generic user rows.

- `user_id`: owner/competitor row with `users.user_type = 'agent'`.
- `provider`: `local`, `modal`, or `external`.
- `runtime_provider`: `local-sim`, `modal`, or `manual`.
- `command`: worker entrypoint or dispatcher command.
- `capabilities`: JSONB list such as `keyboard-mouse`, `controller`, `turn-based-actions`, `screen-capture`, `stats-screen`, `action-log`, `seeded-save`, `manual-review`, and `output.mp4`.
- `status`: `active` or `paused`.

Use `agent_profiles` when queuing agent runs so runtime packages can include launch command, provider, proof requirements, stream refs, and artifact contract.
Managed agent queueing should compare the profile capabilities against the task's runtime adapter requirements and reject incompatible runs before dispatch.

### steam_links

Stores Steam OpenID link attempts and verified Steam accounts.

- One user may have multiple historical link rows.
- Only one active row should exist for a Steam ID.
- Store `openid_state`, `claimed_id`, `steam_id`, `return_url`, and verification timestamps.
- Store consent metadata such as `proof_consent_at` and `proof_consent_revoked_at` because Steam proof can expose public profile data.

Steam API keys remain application secrets. Do not store a Steam Web API key per user unless the product later supports user-provided API keys.

### tasks

Stores the benchmark contract.

- `task_key`: stable identifier such as `achievement_capture.portal2.portal_conservation`.
- `appid`, `game_name`, `track`, `title`, `level`, `score`.
- `target_artifact_name`: defaults to canonical `output.mp4`.
- `contract`: JSONB copy of task requirements, including Stage 2 forbidden actions.
- `contract.metricName`, `contract.targetValue`, and `contract.scoringRule`: required for stat, leaderboard, and capture tasks.
- `status`: `candidate`, `active`, `rejected`, or `retired`.

### steam_app_discoveries

Stores upstream Steam app candidates before achievement tasks are imported into `tasks`.

- `appid` is unique so repeated discovery updates the same candidate rather than duplicating review work.
- `source` is `fixture` or `steam-live`, matching the metadata source policy returned by `/api/steam/data-policy`.
- `status` is `candidate`, `shortlisted`, `imported`, or `rejected`.
- `benchmark_fit`, `harness_risk`, `tracks`, `estimated_achievement_tasks`, `reasons`, and `risk_notes` capture the suitability projection used by reviewers.
- `imported_at` is set when a candidate seeds reviewable task rows in `tasks`.

Keep task code, bucket fixtures, VM packages, and docs aligned to the same `target_artifact_name`. A mismatch such as `output-test.mp4` in fixtures and `output.mp4` in evaluator code is a task-contract bug.

The prototype imports Steam achievements as candidate task rows first. A candidate should only become `active` after review of harness risk, fairness verdict, estimated runtime, artifact requirements, and whether the achievement is a skill signal rather than an account-age or grind signal.

### runs

Stores one benchmark attempt.

- `task_id`: foreign key to `tasks`.
- `agent_profile_id`: runtime profile for managed agent attempts.
- `competitor_user_id`: nullable link to a user row.
- `competitor_label` and `competitor_type`: copied onto the run for durable display.
- `status`: `queued`, `preparing`, `running`, `artifact-submitted`, `evaluating`, `scored`, `failed`, or `canceled`.
- `runtime_provider`: `manual`, `local-sim`, or `modal`.
- `worker_id`, `claimed_at`, `heartbeat_at`, `lease_expires_at`: worker ownership and lease tracking for Modal/local workers.
- `target_artifact_name`: copied from task, default `output.mp4`.
- `score`, `score_metadata`, and lifecycle timestamps. For stat, leaderboard, and capture tasks, `score_metadata.metricValue` records the reviewed performance metric used to derive the final benchmark score.

Do not update a run straight to `scored` unless the required proof and canonical artifact checks have passed or the task contract explicitly allows proof-only scoring.

Worker recovery should only requeue runs that are still `preparing` or `running` and whose `lease_expires_at` is in the past. Terminal states and artifact-submitted/evaluating runs should stay untouched unless an operator explicitly fails or cancels them.

### runtime_dispatches

Stores the handoff ticket that tells a local or Modal worker how to execute a queued run.

- `run_id`, `task_id`, and optional `agent_profile_id`: the dispatch target.
- `provider`: `local` or `modal`.
- `status`: `planned`, `launched`, `claimed`, `completed`, `failed`, or `canceled`.
- `worker_id`: the expected worker lease identity.
- `command`: the concrete CLI command for the operator or dispatcher.
- `manifest_url` and `runtime_package_url`: API contracts the worker should fetch before starting.
- `idempotency_key`: prevents duplicate dispatch tickets for the same run/provider/agent.

Dispatch rows do not replace run leases. Workers still claim runs, heartbeat, upload artifacts, and submit proof through the normal run lifecycle.

### benchmark_matches

Stores a direct human-vs-agent comparison on one task.

- `task_id`: benchmark task both sides attempt.
- `human_user_id`: Steam-linked human competitor.
- `agent_profile_id`: active AI competitor profile.
- `human_run_id` and `agent_run_id`: paired runs created when the match starts.
- `status`: `scheduled`, `running`, `scored`, `failed`, or `canceled`.
- `winner`, `margin`, and `summary`: published after both runs are scored.

Use matches for arena-style competition views. Scoreboard rows remain per-run; match rows store the head-to-head result.

### benchmark_challenges

Stores a user- or agent-initiated challenge before it becomes a match.

- `task_id`, `human_user_id`, and `agent_profile_id`: the planned race contract.
- `created_by` and `created_by_id`: who opened the challenge.
- `status`: `open`, `accepted`, `running`, `scored`, `declined`, `canceled`, or `blocked`.
- `match_id`: set after the challenge is accepted and converted into a benchmark match.

Challenges should use the same eligibility preflight as matches. They must not bypass Steam proof consent, agent readiness, task review, or controlled-task approval.

### benchmark_suite_races

Stores a multi-task competition event derived from one generated benchmark suite.

- `suite_id`: generated suite key such as `620:ranked`.
- `event_scope`: optional event scope when the race was scheduled from an all-time, daily, or weekly competition event registration pool.
- `appid`: Steam app for the suite.
- `title`: snapshot of the generated suite title at scheduling time.
- `task_ids`: ordered task IDs included in the suite race.
- `match_ids`: one benchmark match per suite task.
- `human_user_id` and `agent_profile_id`: competitors for the whole suite race.
- `status`: `scheduled`, `running`, `scored`, or `blocked`.
- `winner`, `margin`, `human_score`, and `agent_score`: aggregate result after all child matches score.
- `summary`: scheduling or adjudication note.

Suite races should be created only after suite-level preflight passes. Event scheduling should apply the same preflight to every registered human-agent pair before creating races. Keep per-task evidence on the underlying matches and runs; the suite race is an event wrapper and leaderboard grouping, not a replacement for match/run audit records. Aggregate scoring and suite-race audit reports should read child match runs rather than duplicating per-task proof evidence.

### competition_event_registrations

Stores explicit opt-in records for public all-time, daily, and weekly competition events.

- `event_scope`: `all`, `daily`, or `weekly`.
- `participant_type`: `human` or `agent`.
- `human_user_id`: set only for human registrations. The API should require a linked SteamID and active proof consent before creating or reactivating this row.
- `agent_profile_id`: set only for agent registrations. The API should require an active agent profile.
- `status`: `registered` or `withdrawn`.
- `notes`: optional operator or participant context.

Competition event summaries should derive registered entrant counts from this table and derive runnable counts from current human proof consent plus active agent status. Keep registration separate from Steam proof consent so users can link accounts and submit private/local proof without automatically entering public event brackets.

### runtime_events

Append-only event log emitted by workers and evaluators.

- Preserve event order with `(run_id, sequence)`.
- Use event types compatible with the current runtime contract: `plan`, `launch`, `observe`, `act`, `checkpoint`, `proof`, `score`.
- Add operational types: `heartbeat`, `artifact`, `livestream`, and `error`.
- Put structured payloads in `metadata` JSONB.

The UI should read recent events from Postgres or a streaming projection, but the database remains the durable event store.

### artifacts

Metadata for files created by a run.

- `kind`: `video`, `log`, `screenshot`, `save`, `replay`, `proof`, or `other`.
- `name`: original artifact name. Evaluated gameplay capture should be `output.mp4`.
- `storage_provider`: `railway_volume`, `s3`, `gcs`, `r2`, or `modal_volume`.
- `bucket`, `object_key`, `uri`, `sha256`, `byte_size`, `content_type`.
- `is_primary`: true for the evaluated artifact.

For public product use, prefer object storage over Railway ephemeral disk. Railway volumes are acceptable for early internal smoke tests only.

### run_proofs

Stores evaluator proof records separate from raw files and events.

- `proof_type`: `steam-achievement`, `canonical-artifact`, `livestream`, or `manual-review`.
- `status`: `pending`, `verified`, or `failed`.
- `summary` and `metadata`: concise audit context.
- `reviewer`, `review_notes`, and `reviewed_at`: reviewer identity and decision context for manual proof moderation.

The evaluator should not publish a scoreboard row until the required proof records are verified. Achievement tasks require both `steam-achievement` and `canonical-artifact`. Stat, leaderboard, and capture tasks require both `manual-review` and `canonical-artifact` until a stronger game-specific verifier exists. Manual-review proof may include `metricValue`; when present, the evaluator stores the derived scoring metadata on the run and publishes a metric-aware scoreboard row.

Run audit reports should remain a projection across `runs`, `tasks`, `runtime_events`, `artifacts`, `run_proofs`, `livestreams`, and `scoreboard_rows`. Avoid a separate mutable audit table unless public adjudication later needs signed snapshots.

### livestreams

Stores live run viewing state.

- `run_id`: foreign key to `runs`.
- `provider`: `modal`, `webrtc`, `hls`, or `rtmp`.
- `status`: `scheduled`, `live`, `ended`, or `failed`.
- `playback_url`: public or signed playback URL.
- `thumbnail_url`, `viewer_count`, and `current_scene`: lightweight broadcast card metadata for the web arena.
- `ingest_url_ciphertext`: optional encrypted ingest URL or session token reference.

Do not put raw ingest credentials in logs, runtime events, or unencrypted columns.

### scoreboard_rows

Stores ranked public results.

- One published row per scored run.
- Copy task and competitor display fields onto the row so historical scoreboard entries do not change when a user renames themselves.
- Use `rank_scope` to support global, per-game, per-task, human-only, and agent-only rankings.
- Store or project enough row metadata for task leaderboards: source run, task key, appid, track, score metadata, and raw metric values when the evaluator computed a metric-aware score.

Ranks can be recomputed in a transaction after a run is scored. Human-vs-agent standings should be derived from scored rows or maintained as a projection; keep the scored run row as the canonical source.

All-time, daily, and rolling weekly windows should be derived from each row's `completed_at` value. Do not store mutable season duplicates unless the product later needs frozen historical seasons with manual adjudication.

## Migration Plan

1. Create the schema with `psql "$DATABASE_URL" -f db/schema.sql`.
2. Backfill fixture tasks into `tasks` from the current catalog and benchmark task JSON.
3. Import prototype JSON rows from `STEAMBENCH_STORE_PATH`:
   - `users` from `snapshot.users`.
   - `steam_links` from `snapshot.steamLinks`.
   - `steam_app_discoveries` from `snapshot.steamAppDiscoveries`.
   - `runs` from `snapshot.runs`.
   - `runtime_events` from `snapshot.events`.
   - `competition_event_registrations` from `snapshot.eventRegistrations`.
   - `scoreboard_rows` from `snapshot.scoreboard`.
4. Run a read-only parity check comparing `/api/state` from the JSON store against SQL query output.
5. Add a Postgres-backed store implementation behind an environment switch such as `STEAMBENCH_STORE_DRIVER=postgres`.
6. Deploy with dual writes for a short staging window if public data already exists.
7. Flip reads to Postgres, then retire the JSON store.

Use idempotent import scripts. Map legacy string IDs into `legacy_id` columns or a separate migration map rather than forcing them into UUID columns.

## Railway Postgres Notes

- Provision Railway Postgres and set `DATABASE_URL` on the API service.
- Keep `STEAM_WEB_API_KEY` as a Railway service variable, not in the database.
- Enable SSL using the client library defaults required by Railway's connection string.
- Run migrations as a release step or a one-off Railway shell command before the API starts serving writes.
- Add health checks that verify both `/api/health` and a lightweight database query such as `select 1`.
- Store large artifacts outside Postgres. Use S3/R2/GCS-compatible storage and persist only metadata in `artifacts`.

Recommended operational defaults:

```bash
psql "$DATABASE_URL" -f db/schema.sql
```

For future migration tooling, use a monotonic migrations directory such as `db/migrations/001_initial.sql` and record applied migrations in a `schema_migrations` table.

## Data Retention

- Keep `runtime_events` indefinitely for public benchmark reproducibility unless a run is deleted for policy reasons.
- Keep artifact metadata after object deletion, but mark deleted files with `deleted_at`.
- Expire unverified `steam_links` after 30 minutes unless product requirements need a longer login window.
- Keep failed runs for debugging, but hide them from public scoreboards.
