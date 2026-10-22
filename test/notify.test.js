import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../src/db.js';
import { seed } from '../src/seed.js';
import { collectEvents, runNotifications } from '../src/notify.js';
import { updateStages } from '../src/projects.js';

const TODAY = '2026-10-22';

test('события: просрочка 2Д, срок сегодня 3Д', () => {
  const db = openDb(':memory:');
  seed(db, { today: TODAY });
  const ev = collectEvents(db, TODAY);
  const overdue = ev.filter((e) => e.kind === 'overdue');
  assert.equal(overdue.length, 1);
  assert.equal(overdue[0].project.code, '2Д');
  assert.match(overdue[0].lines[0], /просрочен на 2 дня/);
  assert.ok(ev.some((e) => e.kind === 'due_today' && e.project.code === '3Д'));
});

test('рассылка в outbox без повторов; переход на следующий этап', async () => {
  const db = openDb(':memory:');
  seed(db, { today: TODAY });
  const outbox = mkdtempSync(join(tmpdir(), 'outbox-'));
  try {
    const n = await runNotifications(db, TODAY, { outbox, appUrl: 'http://localhost:3000' });
    // 2 события × 3 получателя (технолог, ген.директор, дир. производства)
    assert.equal(n, 6);
    const files = readdirSync(outbox);
    assert.equal(files.filter((f) => f.endsWith('.eml')).length, 6);
    const html = readFileSync(join(outbox, files.find((f) => f.includes('overdue') && f.endsWith('.html'))), 'utf8');
    assert.match(html, /Просрочка этапа — проект «2Д\. Компания Б — пресс-форма корпуса»/);
    assert.match(html, /Комментарий ответственного: Поставка стали Х12МФ/);
    assert.match(html, /Открыть проект в системе/);

    assert.equal(await runNotifications(db, TODAY, { outbox }), 0, 'повторно не отправляем');

    // технолог закрывает этап 3 у 2Д — уходит письмо о переходе
    const p = db.prepare(`SELECT id FROM projects WHERE code = '2Д'`).get();
    const st = db.prepare('SELECT * FROM project_stages WHERE project_id = ? ORDER BY pos').all(p.id)[2];
    updateStages(db, p.id, [{ id: st.id, fact_date: TODAY }], null, TODAY);
    assert.equal(await runNotifications(db, TODAY, { outbox }), 3);
    const log = db.prepare(`SELECT * FROM notifications_log WHERE kind = 'transition'`).all();
    assert.equal(log.length, 3);
    assert.match(log[0].subject, /Переход на следующий этап/);
  } finally {
    rmSync(outbox, { recursive: true, force: true });
  }
});
