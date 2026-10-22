import { addDays } from './dates.js';
import { tx } from './db.js';
import { projectStatus, stageStatus, needsComment } from './status.js';

export const APPROVAL = {
  request: 'Заявка',
  quote_sent: 'ТКП отправлено',
  approved: 'Согласовано',
  in_work: 'В работе',
  done: 'Завершён',
  cancelled: 'Отменён',
};

export const REWORK_STAGES = [
  ['Разборка', 1],
  ['Подгонка', 2],
  ['Повторная сборка', 1],
  ['Повторные испытания', 1],
];

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
      const ins = db.prepare(`INSERT INTO project_stages (project_id, pos, name, responsible_id, plan_date, is_test) VALUES (?, ?, ?, ?, ?, ?)`);
      let d = data.start_date;
      tpl.forEach((s, i) => {
        d = addDays(d, s.duration_days);
        ins.run(projectId, i + 1, s.name, data.responsible_id || null, d, s.is_test);
      });
      if (!data.due_date && tpl.length) db.prepare('UPDATE projects SET due_date = ? WHERE id = ?').run(d, projectId);
    }
    return projectId;
  });
}

// Вставляет цикл доработки (разборка → подгонка → повторная сборка → повторные испытания)
// после последнего этапа испытаний; последующие этапы сдвигаются по плану.
export function addReworkCycle(db, projectId) {
  return tx(db, () => {
    const stages = db.prepare('SELECT * FROM project_stages WHERE project_id = ? ORDER BY pos').all(projectId);
    if (!stages.length) throw new Error('У проекта нет этапов');
    const tests = stages.filter((s) => s.is_test);
    const anchor = tests.length ? tests[tests.length - 1] : stages[stages.length - 1];
    const total = REWORK_STAGES.reduce((a, [, d]) => a + d, 0);
    const after = stages.filter((s) => s.pos > anchor.pos);
    const shift = db.prepare('UPDATE project_stages SET pos = ?, plan_date = ? WHERE id = ?');
    for (const s of after) shift.run(s.pos + REWORK_STAGES.length, s.fact_date ? s.plan_date : addDays(s.plan_date, total), s.id);
    const ins = db.prepare(`INSERT INTO project_stages (project_id, pos, name, responsible_id, plan_date, is_test, is_rework) VALUES (?, ?, ?, ?, ?, ?, 1)`);
    let d = anchor.fact_date || anchor.plan_date;
    REWORK_STAGES.forEach(([name, dur], i) => {
      d = addDays(d, dur);
      ins.run(projectId, anchor.pos + i + 1, name, anchor.responsible_id, d, name === 'Повторные испытания' ? 1 : 0);
    });
    const p = db.prepare('SELECT due_date FROM projects WHERE id = ?').get(projectId);
    if (p?.due_date) db.prepare('UPDATE projects SET due_date = ? WHERE id = ?').run(addDays(p.due_date, total), projectId);
  });
}

export function loadProject(db, id, today) {
  const p = db.prepare(`SELECT p.*, c.name AS client_name, u.name AS responsible_name, t.name AS template_name
    FROM projects p LEFT JOIN clients c ON c.id = p.client_id LEFT JOIN users u ON u.id = p.responsible_id
    LEFT JOIN route_templates t ON t.id = p.template_id WHERE p.id = ?`).get(id);
  if (!p) return null;
  const stages = db.prepare(`SELECT s.*, u.name AS responsible_name FROM project_stages s
    LEFT JOIN users u ON u.id = s.responsible_id WHERE s.project_id = ? ORDER BY s.pos`).all(id);
  const comments = db.prepare(`SELECT sc.*, u.name AS user_name FROM stage_comments sc
    JOIN project_stages s ON s.id = sc.stage_id LEFT JOIN users u ON u.id = sc.user_id
    WHERE s.project_id = ? ORDER BY sc.id`).all(id);
  return decorate(p, stages, today, comments);
}

export function listProjects(db, today) {
  const ps = db.prepare(`SELECT p.*, c.name AS client_name, u.name AS responsible_name, t.name AS template_name
    FROM projects p LEFT JOIN clients c ON c.id = p.client_id LEFT JOIN users u ON u.id = p.responsible_id
    LEFT JOIN route_templates t ON t.id = p.template_id ORDER BY p.id`).all();
  const st = db.prepare(`SELECT s.*, u.name AS responsible_name FROM project_stages s
    LEFT JOIN users u ON u.id = s.responsible_id WHERE s.project_id = ? ORDER BY s.pos`);
  return ps.map((p) => decorate(p, st.all(p.id), today));
}

function decorate(p, stages, today, comments) {
  const ds = stages.map((s) => ({
    ...s,
    status: stageStatus(s, today),
    needs_comment: needsComment(s, today),
    comments: comments ? comments.filter((c) => c.stage_id === s.id) : undefined,
  }));
  const status = projectStatus(p, stages, today);
  const cur = status.current;
  return {
    ...p,
    approval_label: APPROVAL[p.approval_status] || p.approval_status,
    status: { code: status.code, label: status.label, days: status.days, total: status.total, done: status.doneCount, current_pos: status.currentIndex + 1 },
    current_stage: cur ? { id: cur.id, name: cur.name, plan_date: cur.plan_date } : null,
    next_stage: cur ? (stages[status.currentIndex + 1] ? { name: stages[status.currentIndex + 1].name } : null) : null,
    stages: ds,
  };
}

// Обновление этапов проекта. updates: [{id, plan_date?, fact_date?, comment?, responsible_id?, name?}]
// Правило КП: при отклонении от срока комментарий ответственного обязателен.
export function updateStages(db, projectId, updates, userId, today) {
  return tx(db, () => {
    const get = db.prepare('SELECT * FROM project_stages WHERE id = ? AND project_id = ?');
    const upd = db.prepare('UPDATE project_stages SET name = ?, plan_date = ?, fact_date = ?, comment = ?, responsible_id = ? WHERE id = ?');
    const addComment = db.prepare('INSERT INTO stage_comments (stage_id, user_id, text) VALUES (?, ?, ?)');
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
      if (!next.plan_date) { errors.push({ id: s.id, error: 'Не указана плановая дата' }); continue; }
      if (needsComment(next, today) && !next.comment) {
        errors.push({ id: s.id, error: `Этап «${next.name}»: отклонение от срока — нужен комментарий, почему задержка и что делается` });
        continue;
      }
      upd.run(next.name, next.plan_date, next.fact_date, next.comment, next.responsible_id, s.id);
      if (next.comment && next.comment !== s.comment) addComment.run(s.id, userId || null, next.comment);
    }
    if (errors.length) {
      const e = new Error(errors.map((x) => x.error).join('; '));
      e.status = 422;
      e.details = errors;
      throw e;
    }
  });
}
