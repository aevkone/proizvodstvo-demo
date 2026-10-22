import { tx, getSetting } from './db.js';

// НДС в РФ с 01.01.2026 — 22%. Значение по умолчанию можно изменить в справочнике «Реквизиты и ТКП».
export const DEFAULT_VAT_PCT = 22;
export const vatDefault = (db) => Number(getSetting(db, 'vat_pct', DEFAULT_VAT_PCT));

const round2 = (n) => Math.round(n * 100) / 100;

// Себестоимость = материалы + нормо-часы × ставка + прочее; цена = себестоимость + наценка; итог = цена + НДС
export function calcTotals(lines, markupPct = 0, vatPct = 0) {
  const sum = (kind) => round2(lines.filter((l) => l.kind === kind).reduce((a, l) => a + (Number(l.qty) || 0) * (Number(l.price) || 0), 0));
  const materials = sum('material');
  const labor = sum('labor');
  const other = sum('other');
  const hours = round2(lines.filter((l) => l.kind === 'labor').reduce((a, l) => a + (Number(l.qty) || 0), 0));
  const cost = round2(materials + labor + other);
  const markup = round2((cost * (Number(markupPct) || 0)) / 100);
  const net = round2(cost + markup);
  const vat = round2((net * (Number(vatPct) || 0)) / 100);
  return { materials, labor, other, hours, cost, markup, net, vat, total: round2(net + vat) };
}

const BASE = `SELECT e.*, c.name AS client_name, p.code AS project_code, p.title AS project_title, u.name AS author_name
  FROM estimates e LEFT JOIN clients c ON c.id = e.client_id LEFT JOIN projects p ON p.id = e.project_id
  LEFT JOIN users u ON u.id = e.created_by`;

export function listEstimates(db) {
  const rows = db.prepare(`${BASE} ORDER BY e.id DESC`).all();
  const lines = db.prepare('SELECT * FROM estimate_lines WHERE estimate_id = ?');
  return rows.map((e) => ({ ...e, totals: calcTotals(lines.all(e.id), e.markup_pct, e.vat_pct) }));
}

export function getEstimate(db, id) {
  const e = db.prepare(`${BASE} WHERE e.id = ?`).get(id);
  if (!e) return null;
  const lines = db.prepare('SELECT * FROM estimate_lines WHERE estimate_id = ? ORDER BY id').all(id);
  return { ...e, lines, totals: calcTotals(lines, e.markup_pct, e.vat_pct) };
}

export function validateEstimate(b) {
  if (!String(b.title || '').trim()) return 'Укажите название расчёта';
  if (!Array.isArray(b.lines)) return 'Нет строк расчёта';
  for (const l of b.lines) {
    if (!['material', 'labor', 'other'].includes(l.kind)) return 'Неверный тип строки';
    if (!String(l.name || '').trim()) return 'У каждой строки должно быть наименование';
    if (!(Number(l.qty) >= 0) || !(Number(l.price) >= 0)) return `Строка «${l.name}»: количество и цена должны быть неотрицательными числами`;
  }
  if (!(Number(b.markup_pct ?? 0) >= 0) || !(Number(b.vat_pct ?? 0) >= 0)) return 'Наценка и НДС должны быть неотрицательными';
  return null;
}

export function saveEstimate(db, id, b, userId) {
  return tx(db, () => {
    const vat = b.vat_pct === undefined || b.vat_pct === null || b.vat_pct === '' ? vatDefault(db) : Number(b.vat_pct);
    const vals = [String(b.title).trim(), b.client_id || null, b.project_id || null, Number(b.markup_pct) || 0, vat, b.notes || null];
    if (id) {
      db.prepare("UPDATE estimates SET title = ?, client_id = ?, project_id = ?, markup_pct = ?, vat_pct = ?, notes = ?, updated_at = datetime('now') WHERE id = ?").run(...vals, id);
      db.prepare('DELETE FROM estimate_lines WHERE estimate_id = ?').run(id);
    } else {
      id = Number(db.prepare("INSERT INTO estimates (title, client_id, project_id, markup_pct, vat_pct, notes, created_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))").run(...vals, userId).lastInsertRowid);
    }
    const ins = db.prepare('INSERT INTO estimate_lines (estimate_id, kind, name, unit, qty, price) VALUES (?, ?, ?, ?, ?, ?)');
    for (const l of b.lines) ins.run(id, l.kind, String(l.name).trim(), l.unit || null, Number(l.qty) || 0, Number(l.price) || 0);
    return id;
  });
}
