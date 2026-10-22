import { addDays, diffDays, ru } from './dates.js';
import { tx } from './db.js';
import { projectStatus, stageStatus, needsComment, forecast } from './status.js';
import { calcTotals } from './estimates.js';

export const APPROVAL = {
  request: 'Заявка',
  quote_sent: 'ТКП отправлено',
  approved: 'Согласовано',
  in_work: 'В работе',
  done: 'Завершён',
  cancelled: 'Отменён',
};

// Заявки до согласования не считаются производством: не на доске «в работе», без писем о просрочке
export const PRODUCTION = ['approved', 'in_work'];

export const REWORK_STAGES = [
  ['Разборка', 1],
  ['Подгонка', 2],
  ['Повторная сборка', 1],
  ['Повторные испытания', 1],
];

function err(message, status = 400, details) {
  const e = new Error(message);
  e.status = status;
  e.details = details;
  return e;
}

// Создаёт проект и его этапы из шаблона маршрута; план-даты считаются от даты старта
export function createProject(db, data, userId) {
  return tx(db, () => {
    const p = db.prepare(`INSERT INTO projects (code, client_id, title, template_id, responsible_id, approval_status, start_date, due_date, notes, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      data.code, data.client_id || null, data.title, data.template_id || null, data.responsible_id || null,
      data.approval_status || 'request', data.start_date, data.due_date || null, data.notes || null, userId || null);
    const projectId = Number(p.lastInsertRowid);
    if (data.template_id) {
      const tpl = db.prepare('SELECT * FROM route_template_stages WHERE template_id = ? ORDER BY pos').all(data.template_id);
      const ins = db.prepare(`INSERT INTO project_stages (project_id, pos, name, responsible_id, plan_date, baseline_plan_date, is_test) VALUES (?, ?, ?, ?, ?, ?, ?)`);
      let d = data.start_date;
      tpl.forEach((s, i) => {
        d = addDays(d, s.duration_days);
        ins.run(projectId, i + 1, s.name, data.responsible_id || null, d, d, s.is_test);
      });
      if (!data.due_date && tpl.length) db.prepare('UPDATE projects SET due_date = ? WHERE id = ?').run(d, projectId);
    }
    return projectId;
  });
}

// Цикл доработки после последних испытаний: разборка → подгонка → повторная сборка → повторные испытания.
// Обязателен результат испытаний. Договорной срок сдачи НЕ меняется — отставание показывает прогноз.
export function addReworkCycle(db, projectId, { result, userId } = {}) {
  if (!String(result || '').trim()) throw err('Опишите результат испытаний: что не прошло и что дорабатываем');
  return tx(db, () => {
    const stages = db.prepare('SELECT * FROM project_stages WHERE project_id = ? ORDER BY pos').all(projectId);
    if (!stages.length) throw err('У проекта нет этапов');
    const tests = stages.filter((s) => s.is_test);
    const anchor = tests.length ? tests[tests.length - 1] : stages[stages.length - 1];
    const iteration = stages.filter((s) => s.is_rework && s.is_test).length + 2;
    const total = REWORK_STAGES.reduce((a, [, d]) => a + d, 0);
    const after = stages.filter((s) => s.pos > anchor.pos);
    const shift = db.prepare('UPDATE project_stages SET pos = ?, plan_date = ? WHERE id = ?');
    const log = db.prepare('INSERT INTO stage_changes (stage_id, user_id, field, old_value, new_value, reason) VALUES (?, ?, ?, ?, ?, ?)');
    for (const s of after) {
      const np = s.fact_date ? s.plan_date : addDays(s.plan_date, total);
      shift.run(s.pos + REWORK_STAGES.length, np, s.id);
      if (np !== s.plan_date) log.run(s.id, userId || null, 'plan_date', s.plan_date, np, `Цикл доработки (итерация ${iteration})`);
    }
    const ins = db.prepare(`INSERT INTO project_stages (project_id, pos, name, responsible_id, plan_date, baseline_plan_date, is_test, is_rework) VALUES (?, ?, ?, ?, ?, ?, ?, 1)`);
    let d = anchor.fact_date || anchor.plan_date;
    REWORK_STAGES.forEach(([name, dur], i) => {
      d = addDays(d, dur);
      ins.run(projectId, anchor.pos + i + 1, `${name} (итерация ${iteration})`, anchor.responsible_id, d, d, name === 'Повторные испытания' ? 1 : 0);
    });
    db.prepare('INSERT INTO stage_comments (stage_id, user_id, text) VALUES (?, ?, ?)').run(anchor.id, userId || null, `Результат испытаний: ${String(result).trim()}`);
    return iteration;
  });
}

const BASE = `SELECT p.*, c.name AS client_name, u.name AS responsible_name, t.name AS template_name
  FROM projects p LEFT JOIN clients c ON c.id = p.client_id LEFT JOIN users u ON u.id = p.responsible_id
  LEFT JOIN route_templates t ON t.id = p.template_id`;
const STAGES = `SELECT s.*, u.name AS responsible_name FROM project_stages s
  LEFT JOIN users u ON u.id = s.responsible_id WHERE s.project_id = ? ORDER BY s.pos`;

// Последний расчёт по проекту — сумма заказа без НДС (для «суммы под угрозой»)
function lastEstimate(db, projectId) {
  const e = db.prepare('SELECT * FROM estimates WHERE project_id = ? ORDER BY id DESC LIMIT 1').get(projectId);
  if (!e) return null;
  const lines = db.prepare('SELECT * FROM estimate_lines WHERE estimate_id = ?').all(e.id);
  return { id: e.id, ...calcTotals(lines, e.markup_pct, e.vat_pct) };
}

export function loadProject(db, id, today) {
  const p = db.prepare(`${BASE} WHERE p.id = ?`).get(id);
  if (!p) return null;
  const stages = db.prepare(STAGES).all(id);
  const comments = db.prepare(`SELECT sc.*, u.name AS user_name FROM stage_comments sc
    JOIN project_stages s ON s.id = sc.stage_id LEFT JOIN users u ON u.id = sc.user_id
    WHERE s.project_id = ? ORDER BY sc.id`).all(id);
  const changes = db.prepare(`SELECT ch.*, u.name AS user_name FROM stage_changes ch
    JOIN project_stages s ON s.id = ch.stage_id LEFT JOIN users u ON u.id = ch.user_id
    WHERE s.project_id = ? ORDER BY ch.id`).all(id);
  const out = decorate(p, stages, today, comments, changes, lastEstimate(db, id));
  out.estimates = db.prepare('SELECT id, title, markup_pct, vat_pct, created_at, updated_at FROM estimates WHERE project_id = ? ORDER BY id DESC').all(id)
    .map((e) => ({ ...e, totals: calcTotals(db.prepare('SELECT * FROM estimate_lines WHERE estimate_id = ?').all(e.id), e.markup_pct, e.vat_pct) }));
  return out;
}

export function listProjects(db, today) {
  const st = db.prepare(STAGES);
  return db.prepare(`${BASE} ORDER BY p.id`).all().map((p) => decorate(p, st.all(p.id), today, null, null, lastEstimate(db, p.id)));
}

function decorate(p, stages, today, comments, changes, est) {
  const fc = forecast(p, stages, today);
  const ds = stages.map((s, i) => ({
    ...s,
    status: stageStatus(s, today),
    needs_comment: needsComment(s, today),
    forecast_date: fc.dates[i],
    moved_days: s.baseline_plan_date ? diffDays(s.plan_date, s.baseline_plan_date) : 0,
    comments: comments ? comments.filter((c) => c.stage_id === s.id) : undefined,
    changes: changes ? changes.filter((c) => c.stage_id === s.id) : undefined,
  }));
  const status = projectStatus(p, stages, today);
  const cur = status.current;
  return {
    ...p,
    approval_label: APPROVAL[p.approval_status] || p.approval_status,
    in_production: PRODUCTION.includes(p.approval_status),
    status: { code: status.code, label: status.label, days: status.days, total: status.total, done: status.doneCount, current_pos: status.currentIndex + 1 },
    current_stage: cur ? { id: cur.id, name: cur.name, plan_date: cur.plan_date, responsible_id: cur.responsible_id, responsible_name: stages[status.currentIndex].responsible_name } : null,
    next_stage: cur ? (stages[status.currentIndex + 1] ? { name: stages[status.currentIndex + 1].name } : null) : null,
    forecast_due: status.code === 'done' ? null : fc.due,
    forecast_slip: status.code === 'done' ? 0 : fc.slip,
    amount_net: est ? est.net : null,
    estimate_id: est ? est.id : null,
    stages: ds,
  };
}

// Обновление этапов проекта. updates: [{id, plan_date?, fact_date?, comment?, responsible_id?, name?, reason?}]
// Правила: отклонение от срока требует комментария; перенос плана требует причины и попадает в журнал;
// факт не может быть в будущем.
export function updateStages(db, projectId, updates, userId, today) {
  return tx(db, () => {
    const get = db.prepare('SELECT * FROM project_stages WHERE id = ? AND project_id = ?');
    const upd = db.prepare('UPDATE project_stages SET name = ?, plan_date = ?, fact_date = ?, comment = ?, responsible_id = ? WHERE id = ?');
    const addComment = db.prepare('INSERT INTO stage_comments (stage_id, user_id, text) VALUES (?, ?, ?)');
    const log = db.prepare('INSERT INTO stage_changes (stage_id, user_id, field, old_value, new_value, reason) VALUES (?, ?, ?, ?, ?, ?)');
    const errors = [];
    for (const u of updates) {
      const s = get.get(u.id, projectId);
      if (!s) { errors.push({ id: u.id, error: 'Этап не найден' }); continue; }
      const next = {
        name: u.name !== undefined ? String(u.name).trim() || s.name : s.name,
        plan_date: u.plan_date !== undefined ? u.plan_date : s.plan_date,
        fact_date: u.fact_date !== undefined ? (u.fact_date || null) : s.fact_date,
        comment: u.comment !== undefined ? (String(u.comment || '').trim() || null) : s.comment,
        responsible_id: u.responsible_id !== undefined ? (u.responsible_id || null) : s.responsible_id,
      };
      const reason = String(u.reason || '').trim();
      const planMoved = next.plan_date !== s.plan_date;
      if (!next.plan_date) { errors.push({ id: s.id, error: 'Не указана плановая дата' }); continue; }
      if (next.fact_date && diffDays(next.fact_date, today) > 0) {
        errors.push({ id: s.id, field: 'fact_date', error: `Этап «${next.name}»: факт не может быть в будущем` });
        continue;
      }
      if (planMoved && !reason) {
        errors.push({ id: s.id, field: 'reason', error: `Этап «${next.name}»: перенос плана ${ru(s.plan_date)} → ${ru(next.plan_date)} — укажите причину` });
        continue;
      }
      if (needsComment(next, today) && !next.comment) {
        errors.push({ id: s.id, field: 'comment', error: `Этап «${next.name}»: отклонение от срока — нужен комментарий, почему задержка и что делается` });
        continue;
      }
      upd.run(next.name, next.plan_date, next.fact_date, next.comment, next.responsible_id, s.id);
      if (planMoved) {
        log.run(s.id, userId || null, 'plan_date', s.plan_date, next.plan_date, reason);
        addComment.run(s.id, userId || null, `Перенос плана ${ru(s.plan_date)} → ${ru(next.plan_date)}: ${reason}`);
      }
      if ((next.fact_date || null) !== (s.fact_date || null)) log.run(s.id, userId || null, 'fact_date', s.fact_date, next.fact_date, null);
      if ((next.responsible_id || null) !== (s.responsible_id || null)) log.run(s.id, userId || null, 'responsible_id', s.responsible_id, next.responsible_id, null);
      if (next.comment && next.comment !== s.comment) addComment.run(s.id, userId || null, next.comment);
    }
    if (errors.length) throw err(errors.map((x) => x.error).join('; '), 422, errors);
  });
}

// Удалять можно только «пустой» проект; с фактами и комментариями — только отменять
export function deleteProject(db, id) {
  const used = db.prepare(`SELECT
    (SELECT COUNT(*) FROM project_stages WHERE project_id = ? AND fact_date IS NOT NULL) +
    (SELECT COUNT(*) FROM stage_comments sc JOIN project_stages s ON s.id = sc.stage_id WHERE s.project_id = ?) AS n`).get(id, id).n;
  if (used) throw err('В проекте уже есть факты и комментарии — его нельзя удалить. Переведите проект в статус «Отменён».', 409);
  db.prepare('DELETE FROM projects WHERE id = ?').run(id);
}
