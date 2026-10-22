import { state, api, esc, dm, dfull, diffDays, plural, badge, routeStrip } from '../lib.js';
import { icon } from '../icons.js';

// Сводка для руководителя: сколько в работе, где узкие места, какие сроки под угрозой, что впереди
export async function renderReports(el) {
  const all = await api('/projects');
  const today = state.me.today;
  const active = all.filter((p) => p.status.code !== 'done' && !['done', 'cancelled'].includes(p.approval_status));
  const overdue = active.filter((p) => p.status.code === 'overdue');
  const attention = active.filter((p) => p.status.code === 'attention');
  const finished = all.filter((p) => p.status.code === 'done' || p.approval_status === 'done');

  // Узкие места: этапы (по названию), где чаще и дольше всего срываются сроки — текущие просрочки + выполненные с опозданием
  const byStage = new Map();
  const byPerson = new Map();
  for (const p of all) {
    for (const s of p.stages) {
      const late = s.status.code === 'overdue' || s.status.code === 'done_late' ? s.status.days : 0;
      if (!late) continue;
      const k = s.name;
      const v = byStage.get(k) || { name: k, count: 0, days: 0, now: 0 };
      v.count++; v.days += late; if (s.status.code === 'overdue') v.now++;
      byStage.set(k, v);
      if (s.status.code === 'overdue') {
        const pk = s.responsible_name || 'не назначен';
        const pv = byPerson.get(pk) || { name: pk, count: 0, days: 0 };
        pv.count++; pv.days += late;
        byPerson.set(pk, pv);
      }
    }
  }
  const bottlenecks = [...byStage.values()].sort((a, b) => b.days - a.days).slice(0, 8);
  const maxDays = Math.max(1, ...bottlenecks.map((b) => b.days));

  // Ближайшие переходы на следующий этап (7 дней)
  const upcoming = active
    .filter((p) => p.current_stage)
    .map((p) => ({ p, left: diffDays(p.current_stage.plan_date, today) }))
    .filter((x) => x.left >= 0 && x.left <= 7)
    .sort((a, b) => a.left - b.left);

  // Сроки сдачи клиентам в ближайшие 30 дней
  const deliveries = active
    .filter((p) => p.due_date)
    .map((p) => ({ p, left: diffDays(p.due_date, today) }))
    .filter((x) => x.left <= 30)
    .sort((a, b) => a.left - b.left);

  const risk = [...overdue, ...attention];
  el.innerHTML = `
    <div class="topbar"><div><h1>Отчёты</h1><div class="sub">Сводка на ${dfull(today)}. Без сложных графиков — только то, что нужно каждый день</div></div>
      <button class="btn no-print" onclick="window.print()">${icon('printer', 16)}Печать</button></div>
    <div class="summary-strip" data-tour="summary">
      <div><b>${active.length}</b><span>проектов<br>в работе</span></div>
      <div><span class="magnet overdue lg"></span><b>${overdue.length}</b><span>с просрочкой</span></div>
      <div><span class="magnet attention lg"></span><b>${attention.length}</b><span>срок сегодня<br>или завтра</span></div>
      <div><span class="magnet ok lg"></span><b>${active.length - overdue.length - attention.length}</b><span>идут в срок</span></div>
      <div><b>${finished.length}</b><span>завершено</span></div>
    </div>
    <div class="rep-grid">
      <div class="panel"><h2>Сроки под угрозой</h2>
        ${risk.length ? risk.map((p) => `
          <div class="rep-row"><div><a href="#/projects/${p.id}"><b>${esc(p.code)}</b> · ${esc(p.title)}</a> <span class="faint">${esc(p.client_name || '')}</span>
            <div class="sub">${p.current_stage ? `Этап ${p.status.current_pos}/${p.status.total}: ${esc(p.current_stage.name)} · план ${dm(p.current_stage.plan_date)}` : ''}</div>
            <div style="margin-top:8px">${routeStrip(p, today)}</div>
            ${commentOf(p)}</div>
          <div>${badge(p.status)}</div></div>`).join('') : '<p class="muted">Все проекты идут в срок</p>'}
      </div>
      <div class="panel"><h2>Узкие места — этапы с отставанием</h2>
        ${bottlenecks.length ? `<table class="lines" style="table-layout:auto;min-width:0"><thead><tr><th>Этап</th><th>Случаев</th><th>Сейчас</th><th style="width:35%">Дней отставания</th></tr></thead><tbody>${bottlenecks.map((b) => `
          <tr><td>${esc(b.name)}</td><td class="num">${b.count}</td><td class="num">${b.now || '—'}</td>
          <td><div style="display:flex;align-items:center;gap:8px"><div class="bar" style="width:${Math.round((b.days / maxDays) * 100)}%"></div><span class="num">${b.days}</span></div></td></tr>`).join('')}</tbody></table>
          <p class="faint" style="font-size:12px;margin:8px 0 0">Учитываются текущие просрочки и этапы, закрытые позже плана, по всем проектам.</p>` : '<p class="muted">Отставаний по этапам нет</p>'}
      </div>
      <div class="panel"><h2>Переходы на следующий этап — 7 дней</h2>
        ${upcoming.length ? `<table class="lines" style="table-layout:auto;min-width:0"><tbody>${upcoming.map(({ p, left }) => `
          <tr><td class="num" style="white-space:nowrap;width:90px"><b>${left === 0 ? 'сегодня' : left === 1 ? 'завтра' : dm(p.current_stage.plan_date)}</b></td>
          <td><a href="#/projects/${p.id}">${esc(p.code)}</a> · ${esc(p.current_stage.name)}${p.next_stage ? ` <span class="muted">→ ${esc(p.next_stage.name)}</span>` : ' <span class="muted">→ сдача</span>'}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">Нет плановых переходов на неделю</p>'}
      </div>
      <div class="panel"><h2>Сдача клиентам — 30 дней</h2>
        ${deliveries.length ? `<table class="lines" style="table-layout:auto;min-width:0"><tbody>${deliveries.map(({ p, left }) => `
          <tr><td class="num" style="white-space:nowrap;width:90px"><b>${dfull(p.due_date)}</b></td>
          <td><a href="#/projects/${p.id}">${esc(p.code)}. ${esc(p.client_name || '')} — ${esc(p.title)}</a></td>
          <td class="muted" style="text-align:right;white-space:nowrap">${left < 0 ? `<b style="color:var(--bad)">просрочено на ${plural(-left, 'день', 'дня', 'дней')}</b>` : left === 0 ? 'сегодня' : `через ${plural(left, 'день', 'дня', 'дней')}`}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">В ближайший месяц сдач нет</p>'}
      </div>
      <div class="panel"><h2>Просрочки по ответственным</h2>
        ${byPerson.size ? `<table class="lines" style="table-layout:auto;min-width:0"><thead><tr><th>Ответственный</th><th>Этапов</th><th>Дней суммарно</th></tr></thead><tbody>${[...byPerson.values()].sort((a, b) => b.days - a.days).map((v) => `
          <tr><td>${esc(v.name)}</td><td class="num">${v.count}</td><td class="num">${v.days}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">Просроченных этапов нет</p>'}
        <p class="faint" style="font-size:12px;margin:8px 0 0">Загрузка сотрудников — следующий этап, после того как накопятся данные (раздел 3.3 КП).</p>
      </div>
    </div>`;
}

function commentOf(p) {
  const s = p.stages.find((x) => x.id === p.current_stage?.id);
  return s?.comment ? `<q>${esc(s.comment)}</q>` : '';
}
