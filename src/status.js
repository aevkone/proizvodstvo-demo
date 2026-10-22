import { diffDays } from './dates.js';

// Статус одного этапа на дату today.
// done        — выполнен в срок
// done_late   — выполнен с опозданием (факт позже плана)
// overdue     — не выполнен, план прошёл
// attention   — не выполнен, срок сегодня или завтра
// pending     — впереди
export function stageStatus(stage, today) {
  if (stage.fact_date) {
    const late = diffDays(stage.fact_date, stage.plan_date);
    return late > 0 ? { code: 'done_late', days: late } : { code: 'done', days: 0 };
  }
  const left = diffDays(stage.plan_date, today);
  if (left < 0) return { code: 'overdue', days: -left };
  if (left <= 1) return { code: 'attention', days: left };
  return { code: 'pending', days: left };
}

// Отклонение от срока требует комментария ответственного.
export function needsComment(stage, today) {
  const s = stageStatus(stage, today);
  return s.code === 'overdue' || s.code === 'done_late';
}

// Сводный статус проекта: ok | attention | overdue | done
export function projectStatus(project, stages, today) {
  const total = stages.length;
  const doneCount = stages.filter((s) => s.fact_date).length;
  const current = stages.find((s) => !s.fact_date) || null;
  const currentIndex = current ? stages.indexOf(current) : total;

  if (total > 0 && doneCount === total) {
    return { code: 'done', label: 'Завершён', days: 0, total, doneCount, current: null, currentIndex };
  }

  let maxOverdue = 0;
  let attention = null;
  for (const st of stages) {
    if (st.fact_date) continue;
    const s = stageStatus(st, today);
    if (s.code === 'overdue') maxOverdue = Math.max(maxOverdue, s.days);
    else if (s.code === 'attention' && (attention === null || s.days < attention)) attention = s.days;
  }
  // Итоговый срок перед клиентом
  if (project.due_date) {
    const left = diffDays(project.due_date, today);
    if (left < 0) maxOverdue = Math.max(maxOverdue, -left);
    else if (left <= 1 && (attention === null || left < attention)) attention = left;
  }

  const base = { total, doneCount, current, currentIndex };
  if (maxOverdue > 0) return { ...base, code: 'overdue', days: maxOverdue, label: `Просрочка ${plural(maxOverdue, 'день', 'дня', 'дней')}` };
  if (attention !== null) return { ...base, code: 'attention', days: attention, label: attention === 0 ? 'Внимание: срок сегодня' : 'Внимание: срок завтра' };
  return { ...base, code: 'ok', days: 0, label: 'В срок' };
}

export function plural(n, one, few, many) {
  const m10 = n % 10, m100 = n % 100;
  const w = m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? few : many;
  return `${n} ${w}`;
}
