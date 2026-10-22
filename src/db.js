import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  login TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  email TEXT,
  role TEXT NOT NULL,
  pass_hash TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS clients (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  contact TEXT, email TEXT, phone TEXT
);
CREATE TABLE IF NOT EXISTS route_templates (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT
);
CREATE TABLE IF NOT EXISTS route_template_stages (
  id INTEGER PRIMARY KEY,
  template_id INTEGER NOT NULL REFERENCES route_templates(id) ON DELETE CASCADE,
  pos INTEGER NOT NULL,
  name TEXT NOT NULL,
  duration_days INTEGER NOT NULL DEFAULT 1,
  is_test INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL,
  client_id INTEGER REFERENCES clients(id),
  title TEXT NOT NULL,
  template_id INTEGER REFERENCES route_templates(id),
  responsible_id INTEGER REFERENCES users(id),
  approval_status TEXT NOT NULL DEFAULT 'request',
  start_date TEXT,
  due_date TEXT,
  notes TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS project_stages (
  id INTEGER PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  pos INTEGER NOT NULL,
  name TEXT NOT NULL,
  responsible_id INTEGER REFERENCES users(id),
  plan_date TEXT NOT NULL,
  baseline_plan_date TEXT,
  fact_date TEXT,
  comment TEXT,
  is_test INTEGER NOT NULL DEFAULT 0,
  is_rework INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS stage_comments (
  id INTEGER PRIMARY KEY,
  stage_id INTEGER NOT NULL REFERENCES project_stages(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id),
  text TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS work_types (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  rate REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS materials (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  unit TEXT NOT NULL DEFAULT 'кг',
  price REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS estimates (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  client_id INTEGER REFERENCES clients(id),
  project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  markup_pct REAL NOT NULL DEFAULT 0,
  vat_pct REAL NOT NULL DEFAULT 22,
  notes TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT
);
CREATE TABLE IF NOT EXISTS estimate_lines (
  id INTEGER PRIMARY KEY,
  estimate_id INTEGER NOT NULL REFERENCES estimates(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('material','labor','other')),
  name TEXT NOT NULL,
  unit TEXT,
  qty REAL NOT NULL DEFAULT 0,
  price REAL NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS notifications_log (
  id INTEGER PRIMARY KEY,
  dedup_key TEXT NOT NULL,
  kind TEXT NOT NULL,
  project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
  stage_id INTEGER REFERENCES project_stages(id) ON DELETE CASCADE,
  recipient TEXT NOT NULL,
  subject TEXT NOT NULL,
  channel TEXT NOT NULL,
  status TEXT NOT NULL,
  error TEXT,
  body_html TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (dedup_key, recipient)
);
CREATE TABLE IF NOT EXISTS stage_changes (
  id INTEGER PRIMARY KEY,
  stage_id INTEGER NOT NULL REFERENCES project_stages(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id),
  field TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT,
  reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);
CREATE INDEX IF NOT EXISTS idx_stages_project ON project_stages(project_id, pos);
CREATE INDEX IF NOT EXISTS idx_changes_stage ON stage_changes(stage_id);
`;

export function openDb(file = process.env.DB_FILE || 'data/app.db') {
  if (file !== ':memory:') mkdirSync(dirname(resolve(file)), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
  db.exec(SCHEMA);
  migrate(db);
  return db;
}

// Миграции баз ранних версий. Только SQL — работают и в node:sqlite, и в sql.js (демо).
function migrate(db) {
  const cols = (t) => db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
  const addCol = (t, c, def) => { if (!cols(t).includes(c)) db.exec(`ALTER TABLE ${t} ADD COLUMN ${c} ${def}`); };
  addCol('notifications_log', 'body_html', 'TEXT');
  addCol('project_stages', 'baseline_plan_date', 'TEXT');
  addCol('estimates', 'updated_at', 'TEXT');
  db.exec('UPDATE project_stages SET baseline_plan_date = plan_date WHERE baseline_plan_date IS NULL');
  db.exec('UPDATE estimates SET updated_at = created_at WHERE updated_at IS NULL');
  // Роли больше не зашиты в схему (проверяются по ROLES в коде): пересобираем users без CHECK
  const usersSql = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'users'").get()?.sql || '';
  if (/CHECK\s*\(\s*role\s+IN/i.test(usersSql)) {
    db.exec('PRAGMA foreign_keys = OFF');
    db.exec(`BEGIN;
      CREATE TABLE users_new (id INTEGER PRIMARY KEY, login TEXT NOT NULL UNIQUE, name TEXT NOT NULL, email TEXT,
        role TEXT NOT NULL, pass_hash TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1);
      INSERT INTO users_new SELECT id, login, name, email, role, pass_hash, active FROM users;
      DROP TABLE users;
      ALTER TABLE users_new RENAME TO users;
      COMMIT;`);
    db.exec('PRAGMA foreign_keys = ON');
  }
}

export function getSetting(db, key, fallback = null) {
  const r = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return r ? r.value : fallback;
}

export function tx(db, fn) {
  db.exec('BEGIN');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}
