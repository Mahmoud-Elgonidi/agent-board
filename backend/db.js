const Database = require('better-sqlite3')
const path = require('path')
const os = require('os')
const fs = require('fs')

const dbPath = process.env.DB_PATH
  ? process.env.DB_PATH.replace('~', os.homedir())
  : path.join(os.homedir(), '.orchestrator', 'db.sqlite')

// Ensure the directory exists
const dbDir = path.dirname(dbPath)
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true })
}

const db = new Database(dbPath)

// Enable WAL mode for better concurrent read performance
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')

// Migrations — add columns that may not exist in older DBs
try { db.exec(`ALTER TABLE tasks ADD COLUMN target_agent TEXT`) } catch (_) {}

db.exec(`
  CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT DEFAULT '',
    status TEXT NOT NULL DEFAULT 'todo',
    priority TEXT NOT NULL DEFAULT 'medium',
    assigned_agent TEXT,
    target_agent TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    last_heartbeat INTEGER,
    progress INTEGER NOT NULL DEFAULT 0,
    position REAL NOT NULL DEFAULT 0,
    context TEXT DEFAULT '{}'
  );

  CREATE TABLE IF NOT EXISTS agents (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT DEFAULT 'openclaw',
    host TEXT DEFAULT 'localhost',
    port INTEGER,
    cli_command TEXT,
    max_idle_seconds INTEGER NOT NULL DEFAULT 180,
    status TEXT NOT NULL DEFAULT 'offline',
    current_task_id TEXT,
    last_heartbeat INTEGER,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (current_task_id) REFERENCES tasks(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL,
    agent_id TEXT,
    task_id TEXT,
    message TEXT,
    metadata TEXT DEFAULT '{}',
    timestamp INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS task_comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id TEXT NOT NULL,
    author TEXT NOT NULL DEFAULT 'user',
    body TEXT NOT NULL,
    is_instruction INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS task_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id TEXT NOT NULL,
    agent_id TEXT,
    step INTEGER NOT NULL DEFAULT 0,
    message TEXT NOT NULL,
    timestamp INTEGER NOT NULL,
    FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
  CREATE INDEX IF NOT EXISTS idx_tasks_position ON tasks(position);
  CREATE INDEX IF NOT EXISTS idx_events_agent ON events(agent_id);
  CREATE INDEX IF NOT EXISTS idx_events_task ON events(task_id);
  CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events(timestamp);
  CREATE INDEX IF NOT EXISTS idx_task_logs_task ON task_logs(task_id);
  CREATE INDEX IF NOT EXISTS idx_task_comments_task ON task_comments(task_id);

  CREATE TABLE IF NOT EXISTS session_map (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    run_id TEXT NOT NULL UNIQUE,
    task_id TEXT NOT NULL,
    agent_name TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_session_map_run ON session_map(run_id);
  CREATE INDEX IF NOT EXISTS idx_session_map_session ON session_map(session_id);

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS task_statuses (
    id           TEXT PRIMARY KEY,
    label        TEXT NOT NULL,
    color        TEXT NOT NULL DEFAULT 'slate',
    position     INTEGER NOT NULL DEFAULT 0,
    is_terminal  INTEGER NOT NULL DEFAULT 0,
    is_system    INTEGER NOT NULL DEFAULT 0,
    trigger_enabled  INTEGER NOT NULL DEFAULT 0,
    trigger_message  TEXT,
    created_at   INTEGER NOT NULL DEFAULT 0
  );
`)

// --- Task queries ---

const taskQueries = {
  getAll: db.prepare(`
    SELECT t.*, a.name as agent_name, a.status as agent_status
    FROM tasks t
    LEFT JOIN agents a ON t.assigned_agent = a.id
    ORDER BY t.position ASC, t.created_at ASC
  `),

  getById: db.prepare(`SELECT * FROM tasks WHERE id = ?`),

  getByStatus: db.prepare(`
    SELECT * FROM tasks WHERE status = ? ORDER BY position ASC, created_at ASC
  `),

  getNextQueued: db.prepare(`
    SELECT * FROM tasks WHERE status = 'todo' AND assigned_agent IS NULL
    ORDER BY
      CASE priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 END,
      position ASC, created_at ASC
    LIMIT 1
  `),

  /* Next task eligible for auto-assignment:
     - must be designated for this specific agent (target_agent = agent.id)
     - must have finished reformulation (reformulating flag is false/absent) */
  getNextQueuedForAgent: db.prepare(`
    SELECT * FROM tasks
    WHERE status = 'todo'
      AND assigned_agent IS NULL
      AND target_agent = ?
      AND (
        json_extract(context, '$.reformulating') IS NULL
        OR json_extract(context, '$.reformulating') != 1
      )
    ORDER BY
      CASE priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 END,
      position ASC, created_at ASC
    LIMIT 1
  `),

  /* Orphaned: active status but assigned agent is offline/null (and not terminal) */
  getOrphaned: db.prepare(`
    SELECT t.*, a.name as agent_name, a.status as agent_status
    FROM tasks t
    LEFT JOIN agents a ON t.assigned_agent = a.id
    LEFT JOIN task_statuses ts ON t.status = ts.id
    WHERE (ts.is_terminal = 0 OR ts.id IS NULL)
      AND t.status != 'todo'
      AND (t.assigned_agent IS NULL OR a.status = 'offline' OR a.id IS NULL)
    ORDER BY t.updated_at ASC
  `),

  /* Pending: todo and unassigned */
  getPending: db.prepare(`
    SELECT * FROM tasks WHERE status = 'todo' AND assigned_agent IS NULL
    ORDER BY
      CASE priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 END,
      position ASC, created_at ASC
  `),

  /* Active: assigned to a non-offline agent and in non-terminal status */
  getActive: db.prepare(`
    SELECT t.*, a.name as agent_name, a.status as agent_status
    FROM tasks t
    LEFT JOIN agents a ON t.assigned_agent = a.id
    LEFT JOIN task_statuses ts ON t.status = ts.id
    WHERE (ts.is_terminal = 0 OR ts.id IS NULL)
      AND t.status != 'todo'
      AND t.assigned_agent IS NOT NULL
      AND a.status != 'offline'
    ORDER BY t.updated_at DESC
  `),

  insert: db.prepare(`
    INSERT INTO tasks (id, title, description, status, priority, assigned_agent, target_agent, created_at, updated_at, progress, position, context)
    VALUES (@id, @title, @description, @status, @priority, @assigned_agent, @target_agent, @created_at, @updated_at, @progress, @position, @context)
  `),

  update: db.prepare(`
    UPDATE tasks SET
      title = COALESCE(@title, title),
      description = COALESCE(@description, description),
      status = COALESCE(@status, status),
      priority = COALESCE(@priority, priority),
      assigned_agent = CASE WHEN @clearAgent = 1 THEN NULL ELSE COALESCE(@assigned_agent, assigned_agent) END,
      target_agent = CASE WHEN @clearTarget = 1 THEN NULL ELSE COALESCE(@target_agent, target_agent) END,
      progress = COALESCE(@progress, progress),
      position = COALESCE(@position, position),
      context = COALESCE(@context, context),
      updated_at = @updated_at
    WHERE id = @id
  `),

  updateHeartbeat: db.prepare(`
    UPDATE tasks SET last_heartbeat = @last_heartbeat, progress = @progress, updated_at = @updated_at
    WHERE id = @id
  `),

  delete: db.prepare(`DELETE FROM tasks WHERE id = ?`),

  getMaxPosition: db.prepare(`SELECT MAX(position) as max_pos FROM tasks WHERE status = ?`),
}

// Seed default settings from env (only if key doesn't exist yet)
const DEFAULT_SETTINGS = {
  heartbeat_interval_ms:   process.env.HEARTBEAT_INTERVAL_MS   || '30000',
  stuck_threshold_seconds: process.env.STUCK_THRESHOLD_SECONDS  || '180',
  max_agent_retries:       process.env.MAX_AGENT_RETRIES        || '3',
  openclaw_bin:            process.env.OPENCLAW_BIN             || '/opt/homebrew/bin/openclaw',
  telegram_chat_id:        process.env.TELEGRAM_CHAT_ID         || '',
  telegram_token_doc:      process.env.TELEGRAM_BOT_TOKEN_DOC   || '',
  telegram_token_adam:     process.env.TELEGRAM_BOT_TOKEN_ADAM  || '',
  telegram_token_khaled:   process.env.TELEGRAM_BOT_TOKEN_KHALED || '',
  telegram_token_yusuf:    process.env.TELEGRAM_BOT_TOKEN_YUSUF || '',
  // Telegram follow-up settings
  telegram_followup_enabled:              '1',
  telegram_followup_first_delay_seconds:  '60',
  telegram_followup_repeat_seconds:       '120',
  telegram_followup_max_count:            '0',
  // Agent monitoring settings
  monitor_enabled:              '1',
  monitor_interval_seconds:     '30',
  monitor_process_check:        '1',
  monitor_file_check:           '1',
  monitor_file_stale_seconds:   '120',
  monitor_process_pattern:      'openclaw.*--agent',
  monitor_notify_stuck:            '1',
  monitor_notify_offline:          '1',
  monitor_notify_recovery:         '0',
  monitor_process_grace_period_ms: '60000',  // grace window before marking busy agent offline
  // Task reformulation via Claude
  task_reformulate_enabled:     '1',
  task_reformulate_agent_id:    '',   // registered agent ID to use; empty = direct API
  task_reformulate_model:       'claude-haiku-4-5-20251001',
  task_reformulate_api_key:     '',
  task_reformulate_timeout_ms:  '90000',
  // Completion guard: agent must move ticket to terminal status before stopping
  task_require_terminal_completion: '1',
  // Task creation: allow/block agents from opening new tasks
  agent_task_creation_enabled: '1',
}
const upsertSetting = db.prepare(`
  INSERT INTO settings (key, value, updated_at) VALUES (@key, @value, @updated_at)
  ON CONFLICT(key) DO NOTHING
`)
for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
  upsertSetting.run({ key, value, updated_at: Date.now() })
}

// Seed default statuses (only if table is empty)
const statusCount = db.prepare(`SELECT COUNT(*) as c FROM task_statuses`).get()
if (statusCount.c === 0) {
  const insertStatus = db.prepare(`
    INSERT INTO task_statuses (id, label, color, position, is_terminal, is_system, trigger_enabled, trigger_message, created_at)
    VALUES (@id, @label, @color, @position, @is_terminal, @is_system, @trigger_enabled, @trigger_message, @created_at)
  `)
  const now = Date.now()
  const DEFAULT_TRIGGER = `[حالة جديدة: {status_label}]\n\nمهمتك انتقلت إلى حالة "{status_label}". يرجى المتابعة وفق الحالة الجديدة.\n\nالمهمة: {task_title}\nالوصف: {task_description}\nTASK_ID: {task_id}`
  ;[
    { id: 'todo',        label: 'في الانتظار',   color: 'slate',   position: 0, is_terminal: 0, is_system: 1, trigger_enabled: 0, trigger_message: null,          created_at: now },
    { id: 'in_progress', label: 'قيد التنفيذ',   color: 'blue',    position: 1, is_terminal: 0, is_system: 1, trigger_enabled: 1, trigger_message: DEFAULT_TRIGGER, created_at: now },
    { id: 'blocked',     label: 'متوقفة',        color: 'orange',  position: 2, is_terminal: 0, is_system: 1, trigger_enabled: 0, trigger_message: null,          created_at: now },
    { id: 'done',        label: 'مكتملة',        color: 'emerald', position: 3, is_terminal: 1, is_system: 1, trigger_enabled: 0, trigger_message: null,          created_at: now },
  ].forEach((s) => insertStatus.run(s))
}

// --- Agent queries ---

const agentQueries = {
  getAll: db.prepare(`SELECT * FROM agents ORDER BY name ASC`),

  getById: db.prepare(`SELECT * FROM agents WHERE id = ?`),

  getIdle: db.prepare(`SELECT * FROM agents WHERE status = 'idle'`),

  getBusy: db.prepare(`SELECT * FROM agents WHERE status = 'busy'`),

  insert: db.prepare(`
    INSERT INTO agents (id, name, type, host, port, cli_command, max_idle_seconds, status, created_at)
    VALUES (@id, @name, @type, @host, @port, @cli_command, @max_idle_seconds, @status, @created_at)
  `),

  update: db.prepare(`
    UPDATE agents SET
      name = COALESCE(@name, name),
      status = COALESCE(@status, status),
      current_task_id = CASE WHEN @clearTask = 1 THEN NULL ELSE COALESCE(@current_task_id, current_task_id) END,
      last_heartbeat = COALESCE(@last_heartbeat, last_heartbeat),
      host = COALESCE(@host, host),
      port = COALESCE(@port, port),
      max_idle_seconds = COALESCE(@max_idle_seconds, max_idle_seconds)
    WHERE id = @id
  `),

  delete: db.prepare(`DELETE FROM agents WHERE id = ?`),

  updateConfig: db.prepare(`
    UPDATE agents SET
      name             = COALESCE(@name, name),
      type             = COALESCE(@type, type),
      host             = COALESCE(@host, host),
      port             = @port,
      cli_command      = @cli_command,
      max_idle_seconds = COALESCE(@max_idle_seconds, max_idle_seconds)
    WHERE id = @id
  `),
}

// --- Event queries ---

const eventQueries = {
  insert: db.prepare(`
    INSERT INTO events (type, agent_id, task_id, message, metadata, timestamp)
    VALUES (@type, @agent_id, @task_id, @message, @metadata, @timestamp)
  `),

  getAll: db.prepare(`
    SELECT * FROM events ORDER BY timestamp DESC LIMIT 200
  `),

  getByAgent: db.prepare(`
    SELECT * FROM events WHERE agent_id = ? ORDER BY timestamp DESC LIMIT 100
  `),

  getByTask: db.prepare(`
    SELECT * FROM events WHERE task_id = ? ORDER BY timestamp DESC LIMIT 100
  `),
}

// --- Task log queries ---

const logQueries = {
  insert: db.prepare(`
    INSERT INTO task_logs (task_id, agent_id, step, message, timestamp)
    VALUES (@task_id, @agent_id, @step, @message, @timestamp)
  `),

  getByTask: db.prepare(`
    SELECT * FROM task_logs WHERE task_id = ? ORDER BY step ASC, timestamp ASC
  `),

  getLastStep: db.prepare(`
    SELECT COALESCE(MAX(step), 0) as last_step FROM task_logs WHERE task_id = ?
  `),

  deleteByTask: db.prepare(`DELETE FROM task_logs WHERE task_id = ?`),
}

// --- Task comment queries ---

const commentQueries = {
  insert: db.prepare(`
    INSERT INTO task_comments (task_id, author, body, is_instruction, created_at)
    VALUES (@task_id, @author, @body, @is_instruction, @created_at)
  `),

  getByTask: db.prepare(`
    SELECT * FROM task_comments WHERE task_id = ? ORDER BY created_at ASC
  `),

  getById: db.prepare(`SELECT * FROM task_comments WHERE id = ?`),
}

// --- Session map queries ---

const sessionMapQueries = {
  insert: db.prepare(`
    INSERT OR IGNORE INTO session_map (session_id, run_id, task_id, agent_name, created_at)
    VALUES (@session_id, @run_id, @task_id, @agent_name, @created_at)
  `),
  getByRunId: db.prepare(`SELECT * FROM session_map WHERE run_id = ?`),
  getBySessionId: db.prepare(`SELECT * FROM session_map WHERE session_id = ? ORDER BY created_at DESC LIMIT 1`),
}

// --- Status queries ---

const statusQueries = {
  getAll: db.prepare(`SELECT * FROM task_statuses ORDER BY position ASC, created_at ASC`),
  getById: db.prepare(`SELECT * FROM task_statuses WHERE id = ?`),
  insert: db.prepare(`
    INSERT INTO task_statuses (id, label, color, position, is_terminal, is_system, trigger_enabled, trigger_message, created_at)
    VALUES (@id, @label, @color, @position, @is_terminal, @is_system, @trigger_enabled, @trigger_message, @created_at)
  `),
  update: db.prepare(`
    UPDATE task_statuses SET
      label           = COALESCE(@label, label),
      color           = COALESCE(@color, color),
      position        = COALESCE(@position, position),
      is_terminal     = COALESCE(@is_terminal, is_terminal),
      trigger_enabled = COALESCE(@trigger_enabled, trigger_enabled),
      trigger_message = @trigger_message
    WHERE id = @id
  `),
  delete: db.prepare(`DELETE FROM task_statuses WHERE id = ? AND is_system = 0`),
  maxPosition: db.prepare(`SELECT COALESCE(MAX(position), 0) as max_pos FROM task_statuses`),
}

// --- Settings queries ---

const settingsQueries = {
  getAll: db.prepare(`SELECT key, value FROM settings ORDER BY key ASC`),
  get:    db.prepare(`SELECT value FROM settings WHERE key = ?`),
  set:    db.prepare(`INSERT INTO settings (key, value, updated_at) VALUES (@key, @value, @updated_at)
                      ON CONFLICT(key) DO UPDATE SET value = @value, updated_at = @updated_at`),
  delete: db.prepare(`DELETE FROM settings WHERE key = ?`),
}

// --- Stats query ---

const statsQueries = {
  counts: db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM tasks) as total_tasks,
      (SELECT COUNT(*) FROM tasks WHERE status = 'done') as done_tasks,
      (SELECT COUNT(*) FROM tasks WHERE status = 'in_progress') as active_tasks,
      (SELECT COUNT(*) FROM tasks WHERE status = 'todo') as queued_tasks,
      (SELECT COUNT(*) FROM tasks WHERE status = 'blocked') as blocked_tasks,
      (SELECT COUNT(*) FROM agents) as total_agents,
      (SELECT COUNT(*) FROM agents WHERE status = 'busy') as busy_agents,
      (SELECT COUNT(*) FROM events) as total_events,
      (SELECT COUNT(*) FROM task_logs) as total_logs,
      (SELECT COUNT(*) FROM task_comments) as total_comments
  `),
  clearDoneTasks: db.prepare(`DELETE FROM tasks WHERE status = 'done'`),
  clearEvents:    db.prepare(`DELETE FROM events`),
}

module.exports = { db, taskQueries, agentQueries, eventQueries, logQueries, commentQueries, sessionMapQueries, settingsQueries, statsQueries, statusQueries }
