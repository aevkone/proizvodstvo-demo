import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { seed } from '../src/seed.js';
import { createApp } from '../src/app.js';

let server, base;
before(async () => {
  const db = openDb(':memory:');
  seed(db, { today: '2026-10-22' });
  server = createApp(db, { today: () => '2026-10-22' }).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

async function login(l, pw = 'demo123') {
  const r = await fetch(base + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ login: l, password: pw }) });
  if (r.status !== 200) return null;
  const sid = r.headers.get('set-cookie').match(/sid=[^;]+/)[0];
  return (path, method = 'GET', body) => fetch(base + path, { method, headers: { 'content-type': 'application/json', cookie: sid }, body: body && JSON.stringify(body) });
}

test('ставки: технолог меняет, коммерческий отдел — нет', async () => {
  const tech = await login('tech');
  const sales = await login('sales');
  assert.equal((await sales('/api/work_types/1', 'PUT', { name: 'X', rate: 1 })).status, 403);
  const r = await tech('/api/work_types/1', 'PUT', { name: 'Конструирование и проектирование', rate: 2700 });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).rate, 2700);
  assert.equal((await tech('/api/work_types', 'POST', { name: 'Лазерная резка', rate: -5 })).status, 400);
  assert.equal((await tech('/api/materials', 'POST', { name: 'Бронза', unit: 'кг', price: 1200 })).status, 201);
});

test('клиента в проектах удалить нельзя', async () => {
  const prod = await login('prod');
  assert.equal((await prod('/api/clients/1', 'DELETE')).status, 409);
  const c = await (await prod('/api/clients', 'POST', { name: 'Пустой клиент' })).json();
  assert.equal((await prod(`/api/clients/${c.id}`, 'DELETE')).status, 200);
});

test('маршрут: создание с этапами и использование в проекте', async () => {
  const tech = await login('tech');
  let r = await tech('/api/templates', 'POST', { name: 'Вставка', stages: [{ name: 'Фрезеровка', duration_days: 2 }, { name: 'Испытания', duration_days: 1, is_test: true }] });
  assert.equal(r.status, 201);
  const t = await r.json();
  assert.equal(t.stages.length, 2);
  assert.equal((await tech('/api/templates', 'POST', { name: 'Пусто', stages: [] })).status, 400);
  r = await tech('/api/projects', 'POST', { code: '99Д', title: 'вставка', template_id: t.id, start_date: '2026-10-22' });
  assert.equal((await r.json()).due_date, '2026-10-25');
  assert.equal((await tech(`/api/templates/${t.id}`, 'DELETE')).status, 409);
});

test('пользователи: создаёт только директор производства, отключённый не входит', async () => {
  const prod = await login('prod');
  const tech = await login('tech');
  const body = { login: 'master', name: 'Пётр Мастер', email: 'master@example.test', role: 'chief_tech', password: 'secret1' };
  assert.equal((await tech('/api/users', 'POST', body)).status, 403);
  const u = await (await prod('/api/users', 'POST', body)).json();
  assert.ok(await login('master', 'secret1'));
  assert.equal((await prod(`/api/users/${u.id}`, 'PUT', { ...body, active: false })).status, 200);
  assert.equal(await login('master', 'secret1'), null);
  const me = await (await prod('/api/me')).json();
  assert.equal((await prod(`/api/users/${me.id}`, 'PUT', { name: me.name, role: 'prod_director', active: false })).status, 400);
});
