-- Peachy D1 schema. Matches master-build-prompt.md section 7.

CREATE TABLE users (
  id TEXT PRIMARY KEY,                 -- Google `sub`
  email TEXT NOT NULL,
  name TEXT,
  youtube_channel_id TEXT,
  oauth_refresh_token TEXT,            -- AES-GCM encrypted, see src/lib/crypto.ts
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  status TEXT NOT NULL DEFAULT 'active'
);

CREATE TABLE wizard_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id),
  current_step INTEGER NOT NULL DEFAULT 1,
  prefill_from_job_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT
);

CREATE TABLE jobs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'pending_payment', -- pending_payment|active|expired|cancelled
  title_style TEXT NOT NULL,
  title_angle TEXT NOT NULL,
  started_at TEXT,
  expires_at TEXT,
  runs_completed INTEGER NOT NULL DEFAULT 0,
  renewed_from_job_id TEXT,
  polar_checkout_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  cancelled_at TEXT
);

CREATE TABLE job_videos (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES jobs(id),
  youtube_video_id TEXT NOT NULL,
  original_title TEXT NOT NULL,
  description TEXT,
  user_summary TEXT
);
CREATE INDEX idx_job_videos_job ON job_videos(job_id);
CREATE INDEX idx_job_videos_yt ON job_videos(youtube_video_id);

CREATE TABLE weekly_runs (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES jobs(id),
  run_number INTEGER NOT NULL,
  run_at TEXT NOT NULL DEFAULT (datetime('now')),
  status TEXT NOT NULL DEFAULT 'ok'
);

CREATE TABLE title_changes (
  id TEXT PRIMARY KEY,
  job_video_id TEXT NOT NULL REFERENCES job_videos(id),
  weekly_run_id TEXT NOT NULL REFERENCES weekly_runs(id),
  old_title TEXT NOT NULL,
  new_title TEXT NOT NULL,
  applied_at TEXT NOT NULL DEFAULT (datetime('now')),
  revert_token TEXT NOT NULL UNIQUE,
  reverted_at TEXT,
  transcript_status TEXT NOT NULL -- ok|failed|truncated
);
CREATE INDEX idx_title_changes_token ON title_changes(revert_token);

CREATE TABLE payments (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  job_id TEXT NOT NULL REFERENCES jobs(id),
  polar_checkout_id TEXT,
  amount INTEGER,
  status TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE leadgen_samples (
  id TEXT PRIMARY KEY,
  youtube_video_id TEXT NOT NULL,
  original_title TEXT NOT NULL,
  generated_title TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  contacted INTEGER NOT NULL DEFAULT 0
);

-- Backstop for the one-active-job-per-video rule (application layer enforces the
-- active/pending_payment scoping; this partial-unique-style guard is emulated via
-- a trigger since D1/SQLite doesn't support partial UNIQUE indexes with subqueries
-- inline -- enforce in application code at wizard step 2 + pre-checkout, see
-- src/routes/wizard.ts).
CREATE INDEX idx_jobs_user_status ON jobs(user_id, status);

-- Cache trend/keyword inference per topic per week (KV would also work; D1 keeps
-- it in one place and query-able for the internal dashboard).
CREATE TABLE trend_cache (
  cache_key TEXT PRIMARY KEY,   -- `${topicHash}:${isoWeek}`
  payload TEXT NOT NULL,        -- JSON blob: {autocomplete:[], competitorTitles:[], trendsScore:[]}
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
