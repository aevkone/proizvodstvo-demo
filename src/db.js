import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  login TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  email TEXT,
  role TEXT NOT NULL CHECK (role IN ('ceo','prod_director','chief_tech','sales_head')),
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
  vat_pct REAL NOT NULL DEFAULT 20,
  notes TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
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
CREATE INDEX IF NOT EXISTS idx_stages_project ON project_stages(project_id, pos);
`;

export function openDb(file = process.env.DB_FILE || 'data/app.db') {
  if (file !== ':memory:') mkdirSync(dirname(resolve(file)), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
  db.exec(SCHEMA);
  // Миграции для баз, созданных ранними версиями
  const cols = db.prepare('PRAGMA table_info(notifications_log)').all().map((c) => c.name);
  if (!cols.includes('body_html')) db.exec('ALTER TABLE notifications_log ADD COLUMN body_html TEXT');
  return db;
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
