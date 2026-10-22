import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { seed } from '../src/seed.js';
import { createApp } from '../src/app.js';

const TODAY = '2026-10-22';
let server, base;

before(async () => {
  const db = openDb(':memory:');
  seed(db, { today: TODAY });
  server = createApp(db, { today: () => TODAY }).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

async function login(l) {
  const r = await fetch(base + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ login: l, password: 'demo123' }) });
  assert.equal(r.status, 200);
  const sid = r.headers.get('set-cookie').match(/sid=[^;]+/)[0];
  return (path, opts = {}) => fetch(base + path, { ...opts, headers: { 'content-type': 'application/json', cookie: sid, ...(opts.headers || {}) } });
}

test('без входа — 401, неверный пароль — 401', async () => {
  assert.equal((await fetch(base + '/api/projects')).status, 401);
  const r = await fetch(base + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ login: 'ceo', password: 'x' }) });
  assert.equal(r.status, 401);
});

test('главный экран: 8 проектов, 2 требуют внимания, 6 в срок', async () => {
  const api = await login('ceo');
  const ps = await (await api('/api/projects')).json();
  assert.equal(ps.length, 8);
  const by = (c) => ps.filter((p) => p.status.code === c).length;
  assert.equal(by('ok'), 6);
  assert.equal(by('overdue') + by('attention'), 2);
  const p2 = ps.find((p) => p.code === '2Д');
  assert.equal(p2.status.label, 'Просрочка 2 дня');
  assert.equal(p2.status.current_pos, 3);
  assert.equal(p2.current_stage.name, 'Черновое фрезерование деталей блока');
});

test('ген.директор только смотрит', async () => {
  const api = await login('ceo');
  const r = await api('/api/projects', { method: 'POST', body: JSON.stringify({ code: 'X', title: 'x', template_id: 1, start_date: TODAY }) });
  assert.equal(r.status, 403);
});

test('коммерческий отдел создаёт проект по маршруту, этапы и срок считаются', async () => {
  const api = await login('sales');
  const refs = await (await api('/api/refs')).json();
  const tpl = refs.templates.find((t) => t.name === 'Простая деталь');
  const r = await api('/api/projects', { method: 'POST', body: JSON.stringify({ code: '9Д', title: 'пуансон', client_name: 'Новый клиент', template_id: tpl.id, start_date: TODAY }) });
  assert.equal(r.status, 201);
  const p = await r.json();
  assert.equal(p.stages.length, 5);
  assert.equal(p.stages[0].plan_date, '2026-10-25');
  assert.equal(p.due_date, '2026-11-05');
  assert.equal(p.approval_status, 'request');
  assert.equal(p.client_name, 'Новый клиент');
});

test('просроченный этап нельзя сохранить без комментария', async () => {
  const api = await login('tech');
  const ps = await (await api('/api/projects')).json();
  const p4 = ps.find((p) => p.code === '4Д');
  const st = p4.stages[0];
  // сдвигаем план в прошлое без комментария
  let r = await api(`/api/projects/${p4.id}/stages`, { method: 'PUT', body: JSON.stringify({ stages: [{ id: st.id, plan_date: '2026-10-20' }] }) });
  assert.equal(r.status, 422);
  r = await api(`/api/projects/${p4.id}/stages`, { method: 'PUT', body: JSON.stringify({ stages: [{ id: st.id, plan_date: '2026-10-20', comment: 'Ждём металл' }] }) });
  assert.equal(r.status, 200);
  const p = await r.json();
  assert.equal(p.stages[0].status.code, 'overdue');
  assert.equal(p.stages[0].comments.length, 1);
});

test('цикл доработки вставляется после испытаний и сдвигает срок', async () => {
  const api = await login('prod');
  const ps = await (await api('/api/projects')).json();
  const p = ps.find((x) => x.code === '6Д');
  const r = await api(`/api/projects/${p.id}/rework`, { method: 'POST' });
  assert.equal(r.status, 200);
  const q = await r.json();
  assert.equal(q.stages.length, 16);
  const names = q.stages.map((s) => s.name);
  const i = names.indexOf('Испытания на прессе');
  assert.deepEqual(names.slice(i + 1, i + 5), ['Разборка', 'Подгонка', 'Повторная сборка', 'Повторные испытания']);
  assert.ok(q.due_date > p.due_date);
});

test('статус согласования меняет коммерческий отдел, технолог — нет', async () => {
  const sales = await login('sales');
  const tech = await login('tech');
  assert.equal((await tech('/api/projects/8', { method: 'PATCH', body: JSON.stringify({ approval_status: 'in_work' }) })).status, 403);
  const r = await sales('/api/projects/8', { method: 'PATCH', body: JSON.stringify({ approval_status: 'in_work' }) });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).approval_label, 'В работе');
});
