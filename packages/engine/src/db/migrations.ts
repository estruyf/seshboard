/**
 * Schema migrations for the cache database, applied in order and tracked with
 * `PRAGMA user_version`. The cache is never the source of truth (that is
 * ~/.claude), so a migration may drop and rebuild derived tables freely.
 */
export const migrations: readonly string[] = [
  // v1: initial schema (PLAN.md §4)
  `
  CREATE TABLE projects (
    id            TEXT PRIMARY KEY,
    path          TEXT NOT NULL UNIQUE,
    git_root      TEXT,
    name          TEXT NOT NULL,
    last_activity INTEGER
  );

  CREATE TABLE sessions (
    id                TEXT PRIMARY KEY,
    project_id        TEXT REFERENCES projects(id) ON DELETE SET NULL,
    title             TEXT,
    origin            TEXT NOT NULL DEFAULT 'cli' CHECK (origin IN ('app', 'cli', 'ide', 'desktop', 'sdk')),
    status            TEXT NOT NULL DEFAULT 'idle',
    model             TEXT,
    cwd               TEXT,
    created_at        INTEGER,
    updated_at        INTEGER,
    jsonl_path        TEXT,
    jsonl_offset      INTEGER NOT NULL DEFAULT 0,
    jsonl_mtime       INTEGER,
    message_count     INTEGER NOT NULL DEFAULT 0,
    cost_usd          REAL,
    parent_session_id TEXT,
    worktree_path     TEXT,
    pinned            INTEGER NOT NULL DEFAULT 0,
    archived          INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX sessions_project_updated ON sessions (project_id, updated_at DESC);

  CREATE VIRTUAL TABLE messages_fts USING fts5 (
    session_id UNINDEXED,
    uuid UNINDEXED,
    role UNINDEXED,
    text,
    tokenize = 'porter unicode61'
  );

  CREATE TABLE project_actions (
    id                     TEXT NOT NULL,
    project_id             TEXT REFERENCES projects(id) ON DELETE CASCADE,
    name                   TEXT NOT NULL,
    icon                   TEXT,
    type                   TEXT NOT NULL CHECK (type IN ('shell', 'prompt')),
    command                TEXT NOT NULL,
    cwd_mode               TEXT NOT NULL DEFAULT 'session' CHECK (cwd_mode IN ('session', 'project-root')),
    confirm                INTEGER NOT NULL DEFAULT 0,
    shortcut               TEXT,
    run_on_worktree_create INTEGER NOT NULL DEFAULT 0,
    sort                   INTEGER NOT NULL DEFAULT 0
  );
  -- project_id NULL means a global action; COALESCE keeps ids unique per scope.
  CREATE UNIQUE INDEX project_actions_scope_id ON project_actions (COALESCE(project_id, ''), id);

  CREATE TABLE trusted_commands (
    project_id   TEXT NOT NULL,
    command_hash TEXT NOT NULL,
    trusted_at   INTEGER NOT NULL,
    PRIMARY KEY (project_id, command_hash)
  );

  CREATE TABLE app_state (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  `,

  // v2: sessions become a cache of SessionSummary JSON keyed by transcript file (Phase 2).
  // Safe to drop: everything in it is rebuilt from ~/.claude on the next scan.
  `
  DROP TABLE sessions;
  CREATE TABLE sessions (
    id           TEXT PRIMARY KEY,
    project_root TEXT NOT NULL,
    updated_at   INTEGER NOT NULL,
    jsonl_path   TEXT,
    jsonl_mtime  INTEGER,
    entrypoint   TEXT,
    summary_json TEXT NOT NULL,
    pinned       INTEGER NOT NULL DEFAULT 0,
    archived     INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX sessions_project_updated ON sessions (project_root, updated_at DESC);
  `,

  // v3: sessions created by this app (origin badge). Kept apart from the
  // sessions cache, which may be dropped and rebuilt at any time.
  `
  CREATE TABLE owned_sessions (
    id         TEXT PRIMARY KEY,
    created_at INTEGER NOT NULL
  );
  `,

  // v4: user choices for the sidebar. Like owned_sessions, never dropped on rebuilds.
  `
  CREATE TABLE session_flags (
    id         TEXT PRIMARY KEY,
    pinned     INTEGER NOT NULL DEFAULT 0,
    settled_at INTEGER,
    viewed_at  INTEGER
  );
  CREATE TABLE project_settings (
    root      TEXT PRIMARY KEY,
    icon_json TEXT,
    added_at  INTEGER
  );
  `,

  // v5: project actions are keyed by project folder; v1 pointed them at the unused projects table.
  // Nothing could be saved under v1's foreign key, so the table is recreated empty.
  `
  DROP TABLE project_actions;
  CREATE TABLE project_actions (
    id                     TEXT NOT NULL,
    project_id             TEXT,
    name                   TEXT NOT NULL,
    icon                   TEXT,
    type                   TEXT NOT NULL CHECK (type IN ('shell', 'prompt')),
    command                TEXT NOT NULL,
    cwd_mode               TEXT NOT NULL DEFAULT 'session' CHECK (cwd_mode IN ('session', 'project-root')),
    confirm                INTEGER NOT NULL DEFAULT 0,
    shortcut               TEXT,
    run_on_worktree_create INTEGER NOT NULL DEFAULT 0,
    sort                   INTEGER NOT NULL DEFAULT 0
  );
  -- project_id NULL means a global action; COALESCE keeps ids unique per scope.
  CREATE UNIQUE INDEX project_actions_scope_id ON project_actions (COALESCE(project_id, ''), id);
  `,

  // v6: full-text search over transcripts (Phase 5). Derived from ~/.claude, rebuilt as needed.
  `
  DROP TABLE IF EXISTS messages_fts;
  CREATE VIRTUAL TABLE transcript_fts USING fts5 (
    session_id UNINDEXED,
    uuid UNINDEXED,
    role UNINDEXED,
    at UNINDEXED,
    text,
    tokenize = 'porter unicode61 remove_diacritics 2'
  );
  -- What was indexed per session, so only changed transcripts are read again.
  CREATE TABLE transcript_indexed (
    session_id TEXT PRIMARY KEY,
    version    TEXT NOT NULL
  );
  `,

  // v7: a session's updated_at is now its last message, not the file's mtime. Forgetting the
  // cached mtimes makes the next scan read every transcript's tail once.
  `
  UPDATE sessions SET jsonl_mtime = NULL;
  -- Sessions started elsewhere that the user continued in Switchboard. A user choice: keep it.
  CREATE TABLE continued_sessions (
    id         TEXT PRIMARY KEY,
    created_at INTEGER NOT NULL
  );
  `,

  // v8: projects are added by hand, with their own order and defaults for new sessions (user choices: keep them).
  // Upgrading users keep the projects they worked with in Switchboard: every folder with a session started or
  // continued here. On a new install these tables are empty, so the list starts empty.
  `
  ALTER TABLE project_settings ADD COLUMN sort INTEGER;
  ALTER TABLE project_settings ADD COLUMN defaults_json TEXT;
  INSERT INTO project_settings (root, added_at)
    SELECT project_root, MAX(updated_at) FROM sessions
    WHERE project_root LIKE '/%' AND (id IN (SELECT id FROM owned_sessions) OR id IN (SELECT id FROM continued_sessions))
    GROUP BY project_root
  ON CONFLICT (root) DO UPDATE SET added_at = COALESCE(project_settings.added_at, excluded.added_at);
  `,

  // v9: Claude profiles, one login per config folder, and the profile a project uses. User choices: keep them.
  // config_dir is NULL for the built-in profile (Claude Code's own folder); the engine adds that row itself.
  `
  CREATE TABLE claude_profiles (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    color      TEXT NOT NULL,
    config_dir TEXT UNIQUE,
    sort       INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );
  ALTER TABLE project_settings ADD COLUMN profile_id TEXT;
  `,

  // v10: actions brought in from a settings file. Imported shell actions need approval before they run,
  // like shared ones; approving or editing one clears the flag.
  `
  ALTER TABLE project_actions ADD COLUMN imported INTEGER NOT NULL DEFAULT 0;
  `,

  // v11: what each session last ran with (its permission mode, and the model and effort you picked), so a resume
  // after Stop, the idle timeout or an app restart carries on the same way. User choices: keep them.
  `
  CREATE TABLE session_settings (
    id              TEXT PRIMARY KEY,
    permission_mode TEXT,
    model           TEXT,
    effort          TEXT
  );
  `,

  // v12: archived sessions are hidden from the sidebar (Settled included) until they have new activity. A user choice: keep it.
  `
  ALTER TABLE session_flags ADD COLUMN archived_at INTEGER;
  `,

  // v13: settling and archiving become one thing, called archiving. A session hidden either way stays hidden,
  // from the later of the two moments, so activity after it still brings it back. A user choice: keep it.
  `
  UPDATE session_flags SET settled_at = MAX(COALESCE(settled_at, 0), archived_at) WHERE archived_at IS NOT NULL;
  ALTER TABLE session_flags DROP COLUMN archived_at;
  ALTER TABLE session_flags RENAME COLUMN settled_at TO archived_at;
  `,

  // v14: prompts saved for later instead of starting a session (the focus limit's Later list). A user choice: keep it.
  `
  CREATE TABLE later_prompts (
    id            TEXT PRIMARY KEY,
    cwd           TEXT NOT NULL,
    prompt        TEXT NOT NULL,
    settings_json TEXT NOT NULL,
    created_at    INTEGER NOT NULL
  );
  CREATE INDEX later_prompts_cwd ON later_prompts (cwd, created_at DESC);
  `,

  // v15: a project's own name, shown instead of its folder's name. A user choice: keep it.
  `
  ALTER TABLE project_settings ADD COLUMN name TEXT;
  `,

  // v16: the Later list becomes the queue: an order of its own, and what each item waits for (NULL: any session in
  // its project). Saved prompts keep their place by age, oldest first. Started items remember their session, so an
  // item waiting on one follows it. User choices: keep them.
  `
  ALTER TABLE later_prompts ADD COLUMN position INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE later_prompts ADD COLUMN wait_json TEXT;
  UPDATE later_prompts SET position = (
    SELECT COUNT(*) FROM later_prompts AS older
    WHERE older.created_at < later_prompts.created_at OR (older.created_at = later_prompts.created_at AND older.id < later_prompts.id)
  );
  DROP INDEX later_prompts_cwd;
  CREATE INDEX later_prompts_position ON later_prompts (position);
  CREATE TABLE later_started (
    item_id    TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    started_at INTEGER NOT NULL
  );
  `,

  // v17: full-text search over Claude Code memory (projects' and the personal folder). Derived from the memory
  // folders, which stay the source of truth: dropped and rebuilt as needed.
  `
  CREATE VIRTUAL TABLE memory_fts USING fts5 (
    path UNINDEXED,
    root UNINDEXED,
    profile_id UNINDEXED,
    type UNINDEXED,
    modified UNINDEXED,
    origin UNINDEXED,
    name,
    description,
    body,
    tokenize = 'porter unicode61 remove_diacritics 2'
  );
  -- What was indexed per file (its mtime and size), so only changed files are read again.
  CREATE TABLE memory_indexed (
    path    TEXT PRIMARY KEY,
    version TEXT NOT NULL
  );
  `,

  // v18: when a session was unarchived by hand. It stays in the main list, however quiet, until it has new
  // activity (then it's archived after 48 quiet hours, like any session). A user choice: keep it.
  `
  ALTER TABLE session_flags ADD COLUMN restored_at INTEGER;
  `,

  // v19: token usage from the transcripts, for the Usage view. `scope` is a config folder (its real path), so
  // profiles that share one count once. Claude Code deletes old transcripts (cleanupPeriodDays), and these totals
  // are the only record left of them: keep the tables when rebuilding the cache.
  `
  -- How far each transcript was read: its size and mtime then, the byte offset parsed up to (always after a
  -- newline), and a hash of the bytes just before it, to notice a file that was rewritten rather than appended to.
  CREATE TABLE usage_files (
    path      TEXT PRIMARY KEY,
    scope     TEXT NOT NULL,
    size      INTEGER NOT NULL,
    mtime     INTEGER NOT NULL,
    offset    INTEGER NOT NULL,
    tail_hash TEXT
  );
  -- One row per API response already counted (message.id + requestId), within a file and across files. Its time
  -- and session tell whether another session ran during a measured change in plan %.
  CREATE TABLE usage_messages (
    key        TEXT PRIMARY KEY,
    scope      TEXT NOT NULL,
    session_id TEXT NOT NULL,
    at         INTEGER NOT NULL
  ) WITHOUT ROWID;
  CREATE INDEX usage_messages_scope_at ON usage_messages (scope, at);
  -- Token totals per session, UTC hour and model. Hourly, because one session can span several windows.
  CREATE TABLE session_usage (
    scope       TEXT NOT NULL,
    session_id  TEXT NOT NULL,
    hour        INTEGER NOT NULL,
    model       TEXT NOT NULL,
    input       INTEGER NOT NULL DEFAULT 0,
    output      INTEGER NOT NULL DEFAULT 0,
    cache_read  INTEGER NOT NULL DEFAULT 0,
    cache_write INTEGER NOT NULL DEFAULT 0,
    turns       INTEGER NOT NULL DEFAULT 0,
    fast_turns  INTEGER NOT NULL DEFAULT 0,
    max_context INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (scope, session_id, hour, model)
  );
  CREATE INDEX session_usage_scope_hour ON session_usage (scope, hour);
  -- The folder a session ran in, from its transcript: its project after the transcript is gone.
  CREATE TABLE usage_sessions (
    scope      TEXT NOT NULL,
    session_id TEXT NOT NULL,
    cwd        TEXT,
    PRIMARY KEY (scope, session_id)
  );
  -- Plan % over time: every /usage result the usage monitor fetched, and Claude Code's rate-limit updates during a
  -- turn (with the session that caused them). History starts when this table does.
  CREATE TABLE plan_usage (
    scope      TEXT NOT NULL,
    at         INTEGER NOT NULL,
    kind       TEXT NOT NULL,
    limit_scope TEXT NOT NULL DEFAULT '',
    percent    REAL NOT NULL,
    resets_at  INTEGER,
    source     TEXT NOT NULL CHECK (source IN ('usage', 'event')),
    session_id TEXT
  );
  CREATE INDEX plan_usage_scope_at ON plan_usage (scope, at);
  `,

  // v20: Auto model. What Auto picked for a session (with its reason) is kept with the session's settings, and
  // each routing call's tokens are kept here, since the call leaves no transcript for the Usage scanner. Both are
  // user data (a choice made for the session, and the only record of those tokens): keep them when rebuilding.
  `
  ALTER TABLE session_settings ADD COLUMN auto_pick_json TEXT;
  CREATE TABLE auto_routing (
    id          TEXT PRIMARY KEY,
    scope       TEXT NOT NULL,
    at          INTEGER NOT NULL,
    model       TEXT NOT NULL,
    picked      TEXT,
    session_id  TEXT,
    input       INTEGER NOT NULL,
    output      INTEGER NOT NULL,
    cache_read  INTEGER NOT NULL,
    cache_write INTEGER NOT NULL
  );
  CREATE INDEX auto_routing_scope_at ON auto_routing (scope, at);
  `,

  // v21: Claude profiles have defaults for new sessions too, under the project's own (user choices: keep them).
  `
  ALTER TABLE claude_profiles ADD COLUMN defaults_json TEXT;
  `,

  // v22: Up next, the messages you sent while Claude was working that wait for their turn, with their images. Your
  // own messages, not derived from ~/.claude: keep them when rebuilding.
  `
  CREATE TABLE up_next (
    id               TEXT PRIMARY KEY,
    session_id       TEXT NOT NULL,
    position         INTEGER NOT NULL,
    text             TEXT NOT NULL,
    attachments_json TEXT NOT NULL,
    created_at       INTEGER NOT NULL
  );
  CREATE INDEX up_next_session ON up_next (session_id, position);
  `,

  // v23: Side questions (/btw) and their answers, per session. Claude Code doesn't write them to the transcript, so
  // this is the only record of them: keep them when rebuilding.
  `
  CREATE TABLE side_questions (
    id         TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    question   TEXT NOT NULL,
    answer     TEXT NOT NULL,
    at         INTEGER NOT NULL
  );
  CREATE INDEX side_questions_session ON side_questions (session_id, at);
  `,

  // v24: Catch-up, the briefing on each session's latest turn (one per session, replaced by the next turn), and the
  // tokens its Haiku summaries used. Summaries run with `persistSession: false`, so no transcript holds those tokens and
  // the Usage scanner never sees them; this is their only record.
  `
  CREATE TABLE catchup (
    session_id TEXT PRIMARY KEY,
    turn_id    TEXT NOT NULL,
    json       TEXT NOT NULL
  );
  CREATE TABLE catchup_usage (
    id          TEXT PRIMARY KEY,
    scope       TEXT NOT NULL,
    at          INTEGER NOT NULL,
    model       TEXT NOT NULL,
    session_id  TEXT,
    input       INTEGER NOT NULL,
    output      INTEGER NOT NULL,
    cache_read  INTEGER NOT NULL,
    cache_write INTEGER NOT NULL
  );
  CREATE INDEX catchup_usage_scope_at ON catchup_usage (scope, at);
  `,
];
