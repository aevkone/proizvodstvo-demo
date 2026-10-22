import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openDb } from '../src/db.js';

test('миграция старой схемы: роли без CHECK, базовый план, журнал, настройки', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mig-'));
  const file = join(dir, 'old.db');
  try {
    const old = new DatabaseSync(file);
    old.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, login TEXT NOT NULL UNIQUE, name TEXT NOT NULL, email TEXT,
      role TEXT NOT NULL CHECK (role IN ('ceo','prod_director','chief_tech','sales_head')), pass_hash TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1);
      CREATE TABLE sessions (token TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL);
      CREATE TABLE projects (id INTEGER PRIMARY KEY, code TEXT NOT NULL, client_id INTEGER, title TEXT NOT NULL, template_id INTEGER, responsible_id INTEGER REFERENCES users(id),
        approval_status TEXT NOT NULL DEFAULT 'request', start_date TEXT, due_date TEXT, notes TEXT, created_by INTEGER, created_at TEXT NOT NULL DEFAULT (datetime('now')));
      CREATE TABLE project_stages (id INTEGER PRIMARY KEY, project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE, pos INTEGER NOT NULL, name TEXT NOT NULL,
        responsible_id INTEGER REFERENCES users(id), plan_date TEXT NOT NULL, fact_date TEXT, comment TEXT, is_test INTEGER NOT NULL DEFAULT 0, is_rework INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE estimates (id INTEGER PRIMARY KEY, title TEXT NOT NULL, client_id INTEGER, project_id INTEGER, markup_pct REAL NOT NULL DEFAULT 0, vat_pct REAL NOT NULL DEFAULT 20,
        notes TEXT, created_by INTEGER, created_at TEXT NOT NULL DEFAULT (datetime('now')));
      CREATE TABLE notifications_log (id INTEGER PRIMARY KEY, dedup_key TEXT NOT NULL, kind TEXT NOT NULL, project_id INTEGER, stage_id INTEGER, recipient TEXT NOT NULL,
        subject TEXT NOT NULL, channel TEXT NOT NULL, status TEXT NOT NULL, error TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE (dedup_key, recipient));
      INSERT INTO users (login, name, role, pass_hash) VALUES ('a', 'A', 'ceo', 'x');
      INSERT INTO sessions VALUES ('t', 1, 9999999999999);
      INSERT INTO projects (code, title) VALUES ('1Д', 'деталь');
      INSERT INTO project_stages (project_id, pos, name, plan_date) VALUES (1, 1, 'Этап', '2026-10-20');`);
    old.close();
    const db = openDb(file);
    db.prepare("INSERT INTO users (login, name, role, pass_hash) VALUES ('m', 'M', 'master', 'x')").run();
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n, 1, 'сессии сохранились');
    assert.equal(db.prepare('SELECT baseline_plan_date AS b FROM project_stages').get().b, '2026-10-20');
    db.prepare('INSERT INTO stage_changes (stage_id, field) VALUES (1, ?)').run('plan_date');
    db.prepare("INSERT INTO settings (key, value) VALUES ('vat_pct', '22')").run();
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
    db.close();
    openDb(file).close(); // повторный запуск миграций безопасен
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
