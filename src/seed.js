// Демо-данные MVP. Пароль всех демо-пользователей: demo123
import { rmSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { openDb, tx } from './db.js';
import { hashPassword } from './auth.js';
import { addDays, today as getToday } from './dates.js';
import { createProject } from './projects.js';

export const DEMO_PASSWORD = 'demo123';

const USERS = [
  ['ceo', 'Иван Петрович Смирнов', 'ceo@example.test', 'ceo'],
  ['prod', 'Сергей Николаевич Волков', 'prod@example.test', 'prod_director'],
  ['tech', 'Андрей Викторович Козлов', 'tech@example.test', 'chief_tech'],
  ['sales', 'Елена Сергеевна Орлова', 'sales@example.test', 'sales_head'],
  ['master1', 'Пётр Иванович Лосев', 'master1@example.test', 'master'],
  ['master2', 'Николай Сергеевич Рябов', 'master2@example.test', 'master'],
];

// [название, длительность в днях, этап испытаний]
const TEMPLATES = [
  ['Простая деталь', 'Короткий маршрут: пуансоны, вставки, матрицы', [
    ['Поставка заготовок (металлопрокат)', 3],
    ['Токарная и фрезерная обработка', 4],
    ['Термообработка (закалка, отпуск)', 3],
    ['Шлифование и полирование', 3],
    ['Контроль ОТК и отгрузка', 1],
  ]],
  ['Штамп', 'Вырубные, гибочные, вытяжные штампы', [
    ['Разработка конструкторской документации', 5],
    ['Поставка металлопроката и нормализованных элементов', 3],
    ['Черновое фрезерование деталей блока', 5],
    ['Обработка пуансонов и матриц до термообработки', 3],
    ['Термообработка (закалка, отпуск)', 3],
    ['Шлифование', 3],
    ['Электроэрозионная обработка', 4],
    ['Слесарная доводка', 3],
    ['Сборка штампа', 2],
    ['Испытания на прессе', 1, 1],
    ['Приёмка', 1],
  ]],
  ['Пресс-форма', 'Литьевые пресс-формы', [
    ['Проектирование оснастки (3D-модель, КД)', 7],
    ['Поставка металлопроката и нормализованных элементов', 5],
    ['Черновая обработка плит и вставок', 5],
    ['Обработка формообразующих до термообработки', 4],
    ['Термообработка (закалка, отпуск)', 3],
    ['Чистовая обработка (фрезерование, шлифование)', 5],
    ['Электроэрозионная обработка', 4],
    ['Полирование формообразующих', 3],
    ['Сборка пресс-формы', 2],
    ['Испытания на литьевой машине', 1, 1],
    ['Приёмка заказчиком', 1],
  ]],
];

const CLIENTS = ['Компания А', 'Компания Б', 'Компания В', 'Компания Г', 'Компания Д', 'Компания Е'];

const WORK_TYPES = [
  ['Конструирование и проектирование', 2500],
  ['Фрезерная обработка с ЧПУ', 3000],
  ['Токарная обработка', 2200],
  ['Шлифование', 2400],
  ['Электроэрозионная обработка', 2800],
  ['Термообработка', 1500],
  ['Слесарные работы', 1800],
  ['Полирование', 1800],
  ['Сборка и испытания', 2000],
];

const MATERIALS = [
  ['Сталь Х12МФ', 'кг', 650],
  ['Сталь 40Х', 'кг', 180],
  ['Сталь 1.2343', 'кг', 900],
  ['Сталь 1.2311', 'кг', 750],
  ['Сталь 45', 'кг', 120],
  ['Нормализованные элементы (комплект)', 'компл', 35000],
  ['Пружины, крепёж', 'компл', 4500],
];

// [код, клиент, изделие, шаблон, выполнено этапов, смещение плана текущего этапа от сегодня, согласование]
const PROJECTS = [
  ['1Д', 'Компания А', 'вставка пресс-формы', 'Пресс-форма', 5, 2, 'in_work'],
  ['2Д', 'Компания Б', 'пресс-форма корпуса', 'Пресс-форма', 2, -2, 'in_work'],
  ['3Д', 'Компания В', 'пуансон', 'Простая деталь', 3, 0, 'in_work'],
  ['4Д', 'Компания Г', 'формообразующая вставка', 'Простая деталь', 0, 2, 'in_work'],
  ['5Д', 'Компания А', 'пресс-форма колпачка', 'Пресс-форма', 8, 3, 'in_work'],
  ['6Д', 'Компания Д', 'вытяжной штамп', 'Штамп', 4, 4, 'in_work'],
  ['7Д', 'Компания Б', 'матрица', 'Простая деталь', 1, 2, 'in_work'],
  ['8Д', 'Компания Е', 'пресс-форма крышки', 'Пресс-форма', 0, 5, 'approved'],
  // заявка: ТКП отправлено, в производство не запущена — не на доске «в работе», писем о просрочке нет
  ['9Д', 'Компания В', 'матрица вырубная', 'Простая деталь', 0, -1, 'quote_sent'],
];

export function seed(db, { today = getToday() } = {}) {
  tx(db, () => {
    const pw = hashPassword(DEMO_PASSWORD);
    const u = db.prepare('INSERT INTO users (login, name, email, role, pass_hash) VALUES (?, ?, ?, ?, ?)');
    for (const [login, name, email, role] of USERS) u.run(login, name, email, role, pw);

    const c = db.prepare('INSERT INTO clients (name) VALUES (?)');
    for (const name of CLIENTS) c.run(name);

    const t = db.prepare('INSERT INTO route_templates (name, description) VALUES (?, ?)');
    const ts = db.prepare('INSERT INTO route_template_stages (template_id, pos, name, duration_days, is_test) VALUES (?, ?, ?, ?, ?)');
    for (const [name, descr, stages] of TEMPLATES) {
      const id = Number(t.run(name, descr).lastInsertRowid);
      stages.forEach(([sn, dur, isTest], i) => ts.run(id, i + 1, sn, dur, isTest ? 1 : 0));
    }

    const w = db.prepare('INSERT INTO work_types (name, rate) VALUES (?, ?)');
    for (const [n, r] of WORK_TYPES) w.run(n, r);
    const m = db.prepare('INSERT INTO materials (name, unit, price) VALUES (?, ?, ?)');
    for (const [n, un, p] of MATERIALS) m.run(n, un, p);
  });

  const id = (sql, v) => db.prepare(sql).get(v).id;
  const techId = id('SELECT id FROM users WHERE login = ?', 'tech');
  const salesId = id('SELECT id FROM users WHERE login = ?', 'sales');

  for (const [code, client, title, tplName, doneCount, offset, approval] of PROJECTS) {
    const tplId = id('SELECT id FROM route_templates WHERE name = ?', tplName);
    const durs = db.prepare('SELECT duration_days FROM route_template_stages WHERE template_id = ? ORDER BY pos').all(tplId).map((r) => r.duration_days);
    const cum = durs.slice(0, doneCount + 1).reduce((a, b) => a + b, 0);
    const start = addDays(today, offset - cum);
    const pid = createProject(db, {
      code, client_id: id('SELECT id FROM clients WHERE name = ?', client), title, template_id: tplId,
      responsible_id: techId, approval_status: approval, start_date: start,
    }, salesId);
    const stages = db.prepare('SELECT * FROM project_stages WHERE project_id = ? ORDER BY pos').all(pid);
    const done = db.prepare('UPDATE project_stages SET fact_date = ?, comment = ? WHERE id = ?');
    stages.slice(0, doneCount).forEach((s) => done.run(s.plan_date, null, s.id));
  }

  // Сценарий из макета КП и промо-ролика: 2Д — поставка сдвинулась на 2 дня, черновая обработка плит просрочена
  const p2 = id('SELECT id FROM projects WHERE code = ?', '2Д');
  const st2 = db.prepare('SELECT * FROM project_stages WHERE project_id = ? ORDER BY pos').all(p2);
  const late = 'Поставщик отгрузил металлопрокат с опозданием на 2 дня';
  const cur = 'Поставка стали Х12МФ задержалась на 2 дня, завершение этапа ожидается ' + fmtRu(addDays(today, 1));
  db.prepare('UPDATE project_stages SET plan_date = ?, baseline_plan_date = ?, fact_date = ?, comment = ? WHERE id = ?').run(addDays(st2[1].fact_date, -2), addDays(st2[1].fact_date, -2), st2[1].fact_date, late, st2[1].id);
  db.prepare('UPDATE project_stages SET comment = ? WHERE id = ?').run(cur, st2[2].id);
  const addC = db.prepare('INSERT INTO stage_comments (stage_id, user_id, text) VALUES (?, ?, ?)');
  addC.run(st2[1].id, techId, late);
  addC.run(st2[2].id, techId, cur);

  // Пример расчёта стоимости
  const est = db.prepare('INSERT INTO estimates (title, client_id, project_id, markup_pct, vat_pct, created_by) VALUES (?, ?, ?, ?, ?, ?)')
    .run('Пресс-форма корпуса — Компания Б', id('SELECT id FROM clients WHERE name = ?', 'Компания Б'), p2, 25, 22, salesId);
  const el = db.prepare('INSERT INTO estimate_lines (estimate_id, kind, name, unit, qty, price) VALUES (?, ?, ?, ?, ?, ?)');
  const eid = Number(est.lastInsertRowid);
  el.run(eid, 'material', 'Сталь Х12МФ', 'кг', 42, 650);
  el.run(eid, 'material', 'Сталь 45', 'кг', 120, 120);
  el.run(eid, 'material', 'Нормализованные элементы (комплект)', 'компл', 1, 35000);
  el.run(eid, 'labor', 'Конструирование и проектирование', 'н/ч', 24, 2500);
  el.run(eid, 'labor', 'Фрезерная обработка с ЧПУ', 'н/ч', 46, 3000);
  el.run(eid, 'labor', 'Термообработка', 'н/ч', 8, 1500);
  el.run(eid, 'labor', 'Шлифование', 'н/ч', 18, 2400);
  el.run(eid, 'labor', 'Электроэрозионная обработка', 'н/ч', 22, 2800);
  el.run(eid, 'labor', 'Слесарные работы', 'н/ч', 30, 1800);
  el.run(eid, 'labor', 'Сборка и испытания', 'н/ч', 12, 2000);

  // Мастера отвечают за текущие этапы части проектов (роль «Мастер / исполнитель»)
  const m1 = id('SELECT id FROM users WHERE login = ?', 'master1');
  const m2 = id('SELECT id FROM users WHERE login = ?', 'master2');
  const setResp = db.prepare(`UPDATE project_stages SET responsible_id = ? WHERE project_id = (SELECT id FROM projects WHERE code = ?) AND fact_date IS NULL`);
  setResp.run(m1, '4Д');
  setResp.run(m1, '7Д');
  setResp.run(m2, '3Д');

  // Пример переноса плана с причиной (журнал изменений и базовый план) — проект 1Д
  const p1 = id('SELECT id FROM projects WHERE code = ?', '1Д');
  const s1 = db.prepare('SELECT * FROM project_stages WHERE project_id = ? AND fact_date IS NULL ORDER BY pos LIMIT 1').get(p1);
  const reason1 = 'Фрезерный станок с ЧПУ на плановом ремонте 2 дня';
  db.prepare('UPDATE project_stages SET baseline_plan_date = ? WHERE id = ?').run(addDays(s1.plan_date, -2), s1.id);
  db.prepare('INSERT INTO stage_changes (stage_id, user_id, field, old_value, new_value, reason) VALUES (?, ?, ?, ?, ?, ?)').run(s1.id, techId, 'plan_date', addDays(s1.plan_date, -2), s1.plan_date, reason1);
  db.prepare('INSERT INTO stage_comments (stage_id, user_id, text) VALUES (?, ?, ?)').run(s1.id, techId, `Перенос плана ${fmtRu(addDays(s1.plan_date, -2))} → ${fmtRu(s1.plan_date)}: ${reason1}`);

  // Реквизиты для шапки ТКП — демонстрационные, заменяются в «Справочники → Реквизиты и ТКП»
  const setS = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  for (const [k, v] of Object.entries({
    company_name: 'ООО «Инструментальное производство» (демо-реквизиты)',
    company_address: 'Калужская обл., г. Обнинск (пример)',
    company_inn: 'ИНН 0000000000 / КПП 000000000 (пример)',
    company_phone: '+7 (000) 000-00-00',
    company_email: 'sales@example.test',
    company_signer: 'Начальник коммерческого отдела Е. С. Орлова',
    vat_pct: '22',
    quote_valid_days: '30',
    payment_terms: 'Предоплата 50% по счёту, остаток — после приёмки оснастки.',
  })) setS.run(k, v);
}

function fmtRu(s) {
  const [, m, d] = s.split('-');
  return `${d}.${m}`;
}

export function isEmpty(db) {
  return db.prepare('SELECT COUNT(*) AS n FROM users').get().n === 0;
}

// node src/seed.js --reset — пересоздать БД с демо-данными
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const file = process.env.DB_FILE || 'data/app.db';
  if (process.argv.includes('--reset')) for (const f of [file, file + '-wal', file + '-shm']) rmSync(f, { force: true });
  const db = openDb(file);
  if (isEmpty(db)) { seed(db); console.log('Демо-данные загружены в', file); } else console.log('БД не пуста, пропуск. Используйте --reset');
}
