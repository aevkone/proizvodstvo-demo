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
  const all = await (await api('/api/projects')).json();
  const ps = all.filter((p) => p.in_production);
  assert.equal(ps.length, 8);
  assert.equal(all.find((p) => p.code === '9Д').in_production, false, 'заявка не в производстве');
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
  let r = await api(`/api/projects/${p4.id}/stages`, { method: 'PUT', body: JSON.stringify({ stages: [{ id: st.id, plan_date: '2026-10-20', reason: 'ошибка ввода' }] }) });
  assert.equal(r.status, 422, 'просрочка без комментария');
  r = await api(`/api/projects/${p4.id}/stages`, { method: 'PUT', body: JSON.stringify({ stages: [{ id: st.id, plan_date: '2026-10-20', comment: 'Ждём металл' }] }) });
  assert.equal(r.status, 422, 'перенос плана без причины');
  r = await api(`/api/projects/${p4.id}/stages`, { method: 'PUT', body: JSON.stringify({ stages: [{ id: st.id, plan_date: '2026-10-20', comment: 'Ждём металл', reason: 'Уточнили срок поставки' }] }) });
  assert.equal(r.status, 200);
  const p = await r.json();
  assert.equal(p.stages[0].status.code, 'overdue');
  assert.equal(p.stages[0].baseline_plan_date, st.plan_date, 'базовый план сохранён');
  assert.equal(p.stages[0].moved_days, -4);
  assert.equal(p.stages[0].changes[0].reason, 'Уточнили срок поставки');
  assert.equal(p.stages[0].changes[0].old_value, st.plan_date);
});

test('цикл доработки вставляется после испытаний и сдвигает срок', async () => {
  const api = await login('prod');
  const ps = await (await api('/api/projects')).json();
  const p = ps.find((x) => x.code === '6Д');
  assert.equal((await api(`/api/projects/${p.id}/rework`, { method: 'POST', body: '{}' })).status, 400, 'без результата испытаний');
  const r = await api(`/api/projects/${p.id}/rework`, { method: 'POST', body: JSON.stringify({ result: 'Заусенец на вырубке, подогнать зазор' }) });
  assert.equal(r.status, 200);
  const q = await r.json();
  assert.equal(q.stages.length, 15);
  const names = q.stages.map((s) => s.name);
  assert.ok(!names.includes('Доработка по итогам испытаний'), 'нет дубля в шаблоне');
  const i = names.indexOf('Испытания на прессе');
  assert.deepEqual(names.slice(i + 1, i + 5), ['Разборка (итерация 2)', 'Подгонка (итерация 2)', 'Повторная сборка (итерация 2)', 'Повторные испытания (итерация 2)']);
  assert.equal(q.due_date, p.due_date, 'договорной срок не меняется');
  assert.ok(q.forecast_slip > 0, 'прогноз показывает отставание');
  const q2 = await (await api(`/api/projects/${p.id}/rework`, { method: 'POST', body: JSON.stringify({ result: 'ещё раз' }) })).json();
  assert.ok(q2.stages.some((s) => s.name === 'Подгонка (итерация 3)'));
});

test('статус согласования меняет коммерческий отдел, технолог — нет', async () => {
  const sales = await login('sales');
  const tech = await login('tech');
  assert.equal((await tech('/api/projects/8', { method: 'PATCH', body: JSON.stringify({ approval_status: 'in_work' }) })).status, 403);
  const r = await sales('/api/projects/8', { method: 'PATCH', body: JSON.stringify({ approval_status: 'in_work' }) });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).approval_label, 'В работе');
});

test('факт в будущем не принимается; проект с фактами нельзя удалить', async () => {
  const api = await login('prod');
  const p = (await (await api('/api/projects')).json()).find((x) => x.code === '1Д');
  const r = await api(`/api/projects/${p.id}/stages`, { method: 'PUT', body: JSON.stringify({ stages: [{ id: p.current_stage.id, fact_date: '2026-10-25' }] }) });
  assert.equal(r.status, 422);
  assert.equal((await api(`/api/projects/${p.id}`, { method: 'DELETE' })).status, 409);
});

test('мастер отмечает факт своего этапа, но не меняет план', async () => {
  const api = await login('master2');
  const p = (await (await api('/api/projects')).json()).find((x) => x.code === '3Д');
  assert.equal(p.current_stage.responsible_name, 'Николай Сергеевич Рябов');
  let r = await api(`/api/projects/${p.id}/stages`, { method: 'PUT', body: JSON.stringify({ stages: [{ id: p.current_stage.id, plan_date: '2026-10-30', reason: 'x' }] }) });
  assert.equal(r.status, 403);
  r = await api(`/api/projects/${p.id}/stages`, { method: 'PUT', body: JSON.stringify({ stages: [{ id: p.current_stage.id, fact_date: TODAY }] }) });
  assert.equal(r.status, 200);
  const other = (await (await api('/api/projects')).json()).find((x) => x.code === '2Д');
  r = await api(`/api/projects/${other.id}/stages`, { method: 'PUT', body: JSON.stringify({ stages: [{ id: other.current_stage.id, fact_date: TODAY, comment: 'x' }] }) });
  assert.equal(r.status, 403, 'чужой этап');
});

test('реквизиты ТКП и НДС 22% по умолчанию', async () => {
  const sales = await login('sales');
  const refs = await (await sales('/api/refs')).json();
  assert.equal(refs.settings.vat_pct, '22');
  assert.ok(refs.settings.company_name);
  assert.equal((await sales('/api/settings', { method: 'PUT', body: JSON.stringify({ vat_pct: 20 }) })).status, 403);
  const e = await (await sales('/api/estimates', { method: 'POST', body: JSON.stringify({ title: 'T', lines: [{ kind: 'labor', name: 'x', qty: 1, price: 100 }], markup_pct: 0 }) })).json();
  assert.equal(e.vat_pct, 22);
  assert.equal(e.totals.total, 122);
  assert.ok(e.updated_at);
});

test('после 5 неверных паролей вход блокируется', async () => {
  const bad = () => fetch(base + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ login: 'ceo', password: 'nope' }) });
  for (let i = 0; i < 5; i++) assert.equal((await bad()).status, 401);
  assert.equal((await bad()).status, 429);
});
