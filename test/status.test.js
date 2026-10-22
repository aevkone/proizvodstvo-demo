import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stageStatus, needsComment, projectStatus, plural, forecast } from '../src/status.js';

const T = '2026-10-22';

test('этап: просрочен, внимание, впереди, выполнен', () => {
  assert.deepEqual(stageStatus({ plan_date: '2026-10-20' }, T), { code: 'overdue', days: 2 });
  assert.equal(stageStatus({ plan_date: '2026-10-22' }, T).code, 'attention');
  assert.equal(stageStatus({ plan_date: '2026-10-23' }, T).code, 'attention');
  assert.equal(stageStatus({ plan_date: '2026-10-24' }, T).code, 'pending');
  assert.equal(stageStatus({ plan_date: '2026-10-20', fact_date: '2026-10-20' }, T).code, 'done');
  assert.deepEqual(stageStatus({ plan_date: '2026-10-18', fact_date: '2026-10-20' }, T), { code: 'done_late', days: 2 });
});

test('комментарий обязателен только при отклонении', () => {
  assert.equal(needsComment({ plan_date: '2026-10-21' }, T), true);
  assert.equal(needsComment({ plan_date: '2026-10-18', fact_date: '2026-10-19' }, T), true);
  assert.equal(needsComment({ plan_date: '2026-10-25' }, T), false);
  assert.equal(needsComment({ plan_date: '2026-10-18', fact_date: '2026-10-17' }, T), false);
});

test('проект: худший статус незавершённых этапов', () => {
  const st = [
    { plan_date: '2026-10-10', fact_date: '2026-10-12' },
    { plan_date: '2026-10-20' },
    { plan_date: '2026-10-30' },
  ];
  const s = projectStatus({}, st, T);
  assert.equal(s.code, 'overdue');
  assert.equal(s.days, 2);
  assert.equal(s.label, 'Просрочка 2 дня');
  assert.equal(s.currentIndex, 1);

  assert.equal(projectStatus({}, [{ plan_date: '2026-10-22' }], T).label, 'Внимание: срок сегодня');
  assert.equal(projectStatus({}, [{ plan_date: '2026-11-01' }], T).code, 'ok');
  assert.equal(projectStatus({}, [{ plan_date: '2026-10-01', fact_date: '2026-10-05' }], T).code, 'done');
  assert.equal(projectStatus({ due_date: '2026-10-21' }, [{ plan_date: '2026-11-01' }], T).code, 'overdue');
});

test('склонение', () => {
  assert.equal(plural(1, 'день', 'дня', 'дней'), '1 день');
  assert.equal(plural(3, 'день', 'дня', 'дней'), '3 дня');
  assert.equal(plural(11, 'день', 'дня', 'дней'), '11 дней');
  assert.equal(plural(22, 'день', 'дня', 'дней'), '22 дня');
});

test('прогноз сдачи: в срок = план, просрочка текущего сдвигает хвост', () => {
  const st = [
    { plan_date: '2026-10-15', fact_date: '2026-10-15' },
    { plan_date: '2026-10-25' },
    { plan_date: '2026-10-30' },
  ];
  const ok = forecast({ start_date: '2026-10-10', due_date: '2026-10-30' }, st, T);
  assert.equal(ok.due, '2026-10-30');
  assert.equal(ok.slip, 0);
  const late = forecast({ start_date: '2026-10-10', due_date: '2026-10-30' }, [st[0], { plan_date: '2026-10-20' }, { plan_date: '2026-10-25' }], T);
  assert.deepEqual(late.dates, ['2026-10-15', '2026-10-23', '2026-10-28']);
  const late2 = forecast({ start_date: '2026-10-10', due_date: '2026-10-25' }, [st[0], { plan_date: '2026-10-20' }, { plan_date: '2026-10-25' }], T);
  assert.equal(late2.slip, 3);
  const lateFact = forecast({ start_date: '2026-10-10', due_date: '2026-10-30' }, [{ plan_date: '2026-10-15', fact_date: '2026-10-19' }, { plan_date: '2026-10-28' }, { plan_date: '2026-10-30' }], T);
  assert.equal(lateFact.dates[1], '2026-11-01', 'опоздание факта сдвигает следующий этап на ту же длительность');
});
