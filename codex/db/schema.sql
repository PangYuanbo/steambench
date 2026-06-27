begin;

create extension if not exists pgcrypto;

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  legacy_id text unique,
  handle text not null,
  display_name text not null,
  user_type text not null default 'human' check (user_type in ('human', 'agent', 'admin')),
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists users_handle_lower_idx on users (lower(handle));

create table if not exists agent_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  handle text not null,
  display_name text not null,
  provider text not null default 'local' check (provider in ('local', 'modal', 'external')),
  runtime_provider text not null default 'local-sim' check (runtime_provider in ('manual', 'local-sim', 'modal')),
  command text not null,
  capabilities jsonb not null default '[]'::jsonb,
  status text not null default 'active' check (status in ('active', 'paused')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists agent_profiles_handle_lower_idx on agent_profiles (lower(handle));
create index if not exists agent_profiles_user_id_idx on agent_profiles (user_id);
create index if not exists agent_profiles_status_idx on agent_profiles (status);

create table if not exists steam_links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete set null,
  legacy_state text unique,
  openid_state text not null unique,
  return_url text not null,
  status text not null default 'pending' check (status in ('pending', 'linked', 'failed', 'revoked', 'expired')),
  steam_id text check (steam_id is null or steam_id ~ '^[0-9]{17}$'),
  claimed_id text,
  persona_name text,
  profile_url text,
  visibility_state integer,
  proof_consent_at timestamptz,
  proof_consent_revoked_at timestamptz,
  created_at timestamptz not null default now(),
  verified_at timestamptz,
  expires_at timestamptz,
  revoked_at timestamptz,
  failure_reason text,
  metadata jsonb not null default '{}'::jsonb
);

create unique index if not exists steam_links_active_steam_id_idx
  on steam_links (steam_id)
  where steam_id is not null and status = 'linked';

create index if not exists steam_links_user_id_idx on steam_links (user_id);
create index if not exists steam_links_status_created_at_idx on steam_links (status, created_at desc);

create table if not exists tasks (
  id uuid primary key default gen_random_uuid(),
  task_key text not null unique,
  appid integer not null,
  game_name text not null,
  title text not null,
  track text not null check (track in ('achievement', 'leaderboard', 'stat', 'capture')),
  level integer not null check (level between 1 and 10),
  score integer not null check (score >= 0),
  objective text not null,
  proof jsonb not null default '[]'::jsonb,
  target_artifact_name text not null default 'output.mp4',
  estimated_runtime_minutes integer not null check (estimated_runtime_minutes > 0),
  suitability text not null check (suitability in ('baseline', 'ranked', 'expert', 'needs-review')),
  suitability_score integer not null check (suitability_score between 0 and 100),
  review_required boolean not null default false,
  fairness_verdict text not null check (fairness_verdict in ('good', 'controlled', 'not-comparable', 'exclude')),
  risk_flags jsonb not null default '[]'::jsonb,
  source text not null default 'fixture' check (source in ('fixture', 'steam-live', 'manual')),
  status text not null default 'candidate' check (status in ('candidate', 'active', 'rejected', 'retired')),
  imported_at timestamptz,
  review_notes text,
  contract jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists tasks_appid_idx on tasks (appid);
create index if not exists tasks_status_track_idx on tasks (status, track);
create index if not exists tasks_level_score_idx on tasks (level desc, score desc);

create table if not exists steam_app_discoveries (
  id uuid primary key default gen_random_uuid(),
  legacy_id text unique,
  appid integer not null unique,
  name text not null,
  query text not null,
  source text not null check (source in ('fixture', 'steam-live')),
  status text not null default 'candidate' check (status in ('candidate', 'shortlisted', 'imported', 'rejected')),
  benchmark_fit integer not null check (benchmark_fit between 0 and 100),
  harness_risk text not null check (harness_risk in ('low', 'medium', 'high')),
  tracks jsonb not null default '[]'::jsonb,
  estimated_achievement_tasks integer not null default 0 check (estimated_achievement_tasks >= 0),
  reasons jsonb not null default '[]'::jsonb,
  risk_notes jsonb not null default '[]'::jsonb,
  discovered_at timestamptz not null default now(),
  imported_at timestamptz,
  review_notes text,
  updated_at timestamptz not null default now()
);

create index if not exists steam_app_discoveries_status_fit_idx
  on steam_app_discoveries (status, benchmark_fit desc);

create table if not exists runs (
  id uuid primary key default gen_random_uuid(),
  legacy_id text unique,
  task_id uuid not null references tasks(id) on delete restrict,
  requested_by_user_id uuid references users(id) on delete set null,
  competitor_user_id uuid references users(id) on delete set null,
  agent_profile_id uuid references agent_profiles(id) on delete set null,
  competitor_label text not null,
  competitor_type text not null check (competitor_type in ('human', 'agent')),
  status text not null default 'queued' check (
    status in ('queued', 'preparing', 'running', 'artifact-submitted', 'evaluating', 'scored', 'failed', 'canceled')
  ),
  runtime_provider text not null default 'local-sim' check (runtime_provider in ('manual', 'local-sim', 'modal')),
  runtime_ref text,
  worker_id text,
  target_artifact_name text not null default 'output.mp4',
  event_count integer not null default 0 check (event_count >= 0),
  score integer check (score is null or score >= 0),
  score_metadata jsonb not null default '{}'::jsonb,
  failure_code text,
  failure_message text,
  queued_at timestamptz not null default now(),
  started_at timestamptz,
  claimed_at timestamptz,
  heartbeat_at timestamptz,
  lease_expires_at timestamptz,
  artifact_submitted_at timestamptz,
  evaluated_at timestamptz,
  completed_at timestamptz,
  canceled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists runs_task_id_idx on runs (task_id);
create index if not exists runs_status_created_at_idx on runs (status, created_at desc);
create index if not exists runs_competitor_user_id_idx on runs (competitor_user_id);
create index if not exists runs_agent_profile_id_idx on runs (agent_profile_id);

create table if not exists runtime_dispatches (
  id uuid primary key default gen_random_uuid(),
  legacy_id text unique,
  run_id uuid not null references runs(id) on delete cascade,
  task_id uuid not null references tasks(id) on delete restrict,
  agent_profile_id uuid references agent_profiles(id) on delete set null,
  provider text not null check (provider in ('local', 'modal')),
  status text not null default 'planned' check (status in ('planned', 'launched', 'claimed', 'completed', 'failed', 'canceled')),
  worker_id text not null,
  command text not null,
  manifest_url text not null,
  runtime_package_url text not null,
  idempotency_key text unique,
  summary text,
  launched_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists runtime_dispatches_run_id_idx on runtime_dispatches (run_id);
create index if not exists runtime_dispatches_status_created_at_idx on runtime_dispatches (status, created_at desc);
create index if not exists runtime_dispatches_agent_profile_id_idx on runtime_dispatches (agent_profile_id);

create table if not exists benchmark_matches (
  id uuid primary key default gen_random_uuid(),
  legacy_id text unique,
  task_id uuid not null references tasks(id) on delete restrict,
  human_user_id uuid not null references users(id) on delete restrict,
  agent_profile_id uuid not null references agent_profiles(id) on delete restrict,
  human_run_id uuid references runs(id) on delete set null,
  agent_run_id uuid references runs(id) on delete set null,
  status text not null default 'scheduled' check (status in ('scheduled', 'running', 'scored', 'failed', 'canceled')),
  winner text check (winner is null or winner in ('human', 'agent', 'tie')),
  margin integer check (margin is null or margin >= 0),
  summary text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists benchmark_matches_task_id_idx on benchmark_matches (task_id);
create index if not exists benchmark_matches_status_created_at_idx on benchmark_matches (status, created_at desc);
create index if not exists benchmark_matches_human_user_id_idx on benchmark_matches (human_user_id);
create index if not exists benchmark_matches_agent_profile_id_idx on benchmark_matches (agent_profile_id);

create table if not exists benchmark_challenges (
  id uuid primary key default gen_random_uuid(),
  legacy_id text unique,
  task_id uuid not null references tasks(id) on delete restrict,
  human_user_id uuid not null references users(id) on delete restrict,
  agent_profile_id uuid not null references agent_profiles(id) on delete restrict,
  match_id uuid references benchmark_matches(id) on delete set null,
  created_by text not null check (created_by in ('human', 'agent', 'system')),
  created_by_id uuid,
  status text not null default 'open' check (status in ('open', 'accepted', 'running', 'scored', 'declined', 'canceled', 'blocked')),
  summary text,
  accepted_at timestamptz,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists benchmark_challenges_task_id_idx on benchmark_challenges (task_id);
create index if not exists benchmark_challenges_status_created_at_idx on benchmark_challenges (status, created_at desc);
create index if not exists benchmark_challenges_human_user_id_idx on benchmark_challenges (human_user_id);
create index if not exists benchmark_challenges_agent_profile_id_idx on benchmark_challenges (agent_profile_id);

create table if not exists benchmark_suite_races (
  id uuid primary key default gen_random_uuid(),
  legacy_id text unique,
  suite_id text not null,
  event_scope text check (event_scope is null or event_scope in ('all', 'daily', 'weekly')),
  appid integer not null,
  title text not null,
  task_ids jsonb not null default '[]'::jsonb,
  match_ids jsonb not null default '[]'::jsonb,
  human_user_id uuid not null references users(id) on delete restrict,
  agent_profile_id uuid not null references agent_profiles(id) on delete restrict,
  status text not null default 'scheduled' check (status in ('scheduled', 'running', 'scored', 'blocked')),
  winner text check (winner is null or winner in ('human', 'agent', 'tie')),
  margin integer check (margin is null or margin >= 0),
  human_score integer check (human_score is null or human_score >= 0),
  agent_score integer check (agent_score is null or agent_score >= 0),
  summary text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists benchmark_suite_races_suite_id_idx on benchmark_suite_races (suite_id);
create index if not exists benchmark_suite_races_event_scope_idx on benchmark_suite_races (event_scope);
create index if not exists benchmark_suite_races_status_created_at_idx on benchmark_suite_races (status, created_at desc);
create index if not exists benchmark_suite_races_human_user_id_idx on benchmark_suite_races (human_user_id);
create index if not exists benchmark_suite_races_agent_profile_id_idx on benchmark_suite_races (agent_profile_id);

create table if not exists competition_event_registrations (
  id uuid primary key default gen_random_uuid(),
  event_scope text not null check (event_scope in ('all', 'daily', 'weekly')),
  participant_type text not null check (participant_type in ('human', 'agent')),
  human_user_id uuid references users(id) on delete cascade,
  agent_profile_id uuid references agent_profiles(id) on delete cascade,
  status text not null default 'registered' check (status in ('registered', 'withdrawn')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (participant_type = 'human' and human_user_id is not null and agent_profile_id is null) or
    (participant_type = 'agent' and agent_profile_id is not null and human_user_id is null)
  )
);

create unique index if not exists competition_event_registrations_active_human_idx
  on competition_event_registrations (event_scope, human_user_id)
  where status = 'registered' and human_user_id is not null;
create unique index if not exists competition_event_registrations_active_agent_idx
  on competition_event_registrations (event_scope, agent_profile_id)
  where status = 'registered' and agent_profile_id is not null;
create index if not exists competition_event_registrations_scope_status_idx
  on competition_event_registrations (event_scope, status, created_at desc);

create table if not exists runtime_events (
  id uuid primary key default gen_random_uuid(),
  legacy_id text unique,
  run_id uuid not null references runs(id) on delete cascade,
  sequence bigint not null,
  event_type text not null check (
    event_type in ('plan', 'launch', 'observe', 'act', 'checkpoint', 'proof', 'score', 'heartbeat', 'artifact', 'livestream', 'error')
  ),
  idempotency_key text,
  message text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (run_id, sequence)
);

create index if not exists runtime_events_run_created_at_idx on runtime_events (run_id, created_at);
create index if not exists runtime_events_type_idx on runtime_events (event_type);
create unique index if not exists runtime_events_run_idempotency_key_idx
  on runtime_events (run_id, idempotency_key)
  where idempotency_key is not null;

create table if not exists artifacts (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references runs(id) on delete cascade,
  kind text not null check (kind in ('video', 'log', 'screenshot', 'save', 'replay', 'proof', 'other')),
  name text not null,
  is_primary boolean not null default false,
  idempotency_key text,
  storage_provider text not null check (storage_provider in ('railway_volume', 's3', 'gcs', 'r2', 'modal_volume')),
  bucket text,
  object_key text,
  uri text,
  sha256 text check (sha256 is null or sha256 ~ '^[a-f0-9]{64}$'),
  byte_size bigint check (byte_size is null or byte_size >= 0),
  content_type text,
  uploaded_by_worker text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

create unique index if not exists artifacts_one_primary_per_run_idx
  on artifacts (run_id)
  where is_primary and deleted_at is null;

create index if not exists artifacts_run_id_idx on artifacts (run_id);
create index if not exists artifacts_object_idx on artifacts (storage_provider, bucket, object_key);
create unique index if not exists artifacts_run_idempotency_key_idx
  on artifacts (run_id, idempotency_key)
  where idempotency_key is not null;

create table if not exists run_proofs (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references runs(id) on delete cascade,
  proof_type text not null check (proof_type in ('steam-achievement', 'canonical-artifact', 'livestream', 'manual-review')),
  status text not null default 'pending' check (status in ('pending', 'verified', 'failed')),
  summary text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  verified_at timestamptz
);

create index if not exists run_proofs_run_id_idx on run_proofs (run_id);
create index if not exists run_proofs_status_idx on run_proofs (status);

create table if not exists livestreams (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references runs(id) on delete cascade,
  provider text not null check (provider in ('modal', 'webrtc', 'hls', 'rtmp')),
  status text not null default 'scheduled' check (status in ('scheduled', 'live', 'ended', 'failed')),
  title text,
  playback_url text,
  thumbnail_url text,
  viewer_count integer not null default 0 check (viewer_count >= 0),
  current_scene text,
  ingest_url_ciphertext text,
  stream_key_ciphertext text,
  started_at timestamptz,
  ended_at timestamptz,
  failure_reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists livestreams_run_id_idx on livestreams (run_id);
create index if not exists livestreams_status_idx on livestreams (status);

create table if not exists scoreboard_rows (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references runs(id) on delete cascade,
  task_id uuid not null references tasks(id) on delete restrict,
  rank_scope text not null default 'global',
  rank integer not null check (rank > 0),
  competitor_label text not null,
  competitor_type text not null check (competitor_type in ('human', 'agent')),
  appid integer not null,
  game_name text not null,
  task_title text not null,
  level integer not null check (level between 1 and 10),
  score integer not null check (score >= 0),
  evidence text not null,
  completed_at timestamptz not null,
  published_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  unique (rank_scope, run_id)
);

create index if not exists scoreboard_rows_scope_rank_idx on scoreboard_rows (rank_scope, rank);
create index if not exists scoreboard_rows_task_score_idx on scoreboard_rows (task_id, score desc);
create index if not exists scoreboard_rows_competitor_type_score_idx on scoreboard_rows (competitor_type, score desc);

commit;
