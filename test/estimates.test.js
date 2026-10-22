import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { seed } from '../src/seed.js';
import { createApp } from '../src/app.js';
import { calcTotals } from '../src/estimates.js';

test('расчёт: материалы + нормо-часы × ставка + наценка + НДС', () => {
  const t = calcTotals([
    { kind: 'material', qty: 10, price: 650 },
    { kind: 'labor', qty: 20, price: 3000 },
    { kind: 'labor', qty: 5, price: 1800 },
    { kind: 'other', qty: 1, price: 5000 },
  ], 25, 20);
  assert.equal(t.materials, 6500);
  assert.equal(t.labor, 69000);
  assert.equal(t.hours, 25);
  assert.equal(t.cost, 80500);
  assert.equal(t.markup, 20125);
  assert.equal(t.net, 100625);
  assert.equal(t.vat, 20125);
  assert.equal(t.total, 120750);
});

let server, base;
before(async () => {
  const db = openDb(':memory:');
  seed(db, { today: '2026-10-22' });
  server = createApp(db, { today: () => '2026-10-22' }).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

async function login(l) {
  const r = await fetch(base + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ login: l, password: 'demo123' }) });
  const sid = r.headers.get('set-cookie').match(/sid=[^;]+/)[0];
  return (path, opts = {}) => fetch(base + path, { ...opts, headers: { 'content-type': 'application/json', cookie: sid } });
}

test('API калькулятора: создать, изменить, права', async () => {
  const sales = await login('sales');
  const ceo = await login('ceo');
  const body = { title: 'Пуансон', markup_pct: 20, vat_pct: 20, lines: [{ kind: 'material', name: 'Сталь Х12МФ', unit: 'кг', qty: 5, price: 650 }, { kind: 'labor', name: 'Шлифование', unit: 'н/ч', qty: 4, price: 2400 }] };
  assert.equal((await ceo('/api/estimates', { method: 'POST', body: JSON.stringify(body) })).status, 403);
  let r = await sales('/api/estimates', { method: 'POST', body: JSON.stringify(body) });
  assert.equal(r.status, 201);
  const e = await r.json();
  assert.equal(e.totals.cost, 12850);
  assert.equal(e.totals.total, 18504);
  r = await sales(`/api/estimates/${e.id}`, { method: 'PUT', body: JSON.stringify({ ...body, markup_pct: 0, vat_pct: 0 }) });
  assert.equal((await r.json()).totals.total, 12850);
  r = await sales('/api/estimates', { method: 'POST', body: JSON.stringify({ ...body, lines: [{ kind: 'labor', name: 'x', qty: -1, price: 1 }] }) });
  assert.equal(r.status, 400);
  const list = await (await ceo('/api/estimates')).json();
  assert.equal(list.length, 2);
});
