import { state, api, esc, can, dlong, dm, plural, badge, firstName, routeStrip, diffDays } from '../lib.js';
import { icon } from '../icons.js';

let filter = 'active';
let query = '';

export async function renderProjects(el) {
  const all = await api('/projects');
  const today = state.me.today;
  const active = all.filter((p) => p.in_production && p.status.code !== 'done');
  const requests = all.filter((p) => ['request', 'quote_sent'].includes(p.approval_status));
  const mine = active.filter((p) => p.stages.some((s) => !s.fact_date && s.responsible_id === state.me.id));
  const overdue = active.filter((p) => p.status.code === 'overdue');
  const attention = active.filter((p) => p.status.code === 'attention');
  const ok = active.filter((p) => p.status.code === 'ok');
  const sets = { active, overdue, attention, ok, all, requests, mine };
  if (!sets[filter]) filter = 'active';

  el.innerHTML = `
    <div class="topbar">
      <div>
        <h1>Добрый день, ${esc(firstName(state.me.name))}</h1>
        <div class="sub">Доска на ${dlong(today)} · ${plural(active.length, 'проект', 'проекта', 'проектов')} в работе</div>
      </div>
      ${can('project.create') ? `<a class="btn primary" href="#/new" data-tour="new">${icon('plus', 16)}Новый проект</a>` : ''}
    </div>
    <div class="chips" role="group" aria-label="Фильтр по статусу" data-tour="chips">
      <button class="chip" data-f="active"><b>${active.length}</b> в работе</button>
      <button class="chip" data-f="overdue"><span class="magnet overdue"></span><b>${overdue.length}</b> с просрочкой</button>
      <button class="chip" data-f="attention"><span class="magnet attention"></span><b>${attention.length}</b> срок сегодня / завтра</button>
      <button class="chip" data-f="ok"><span class="magnet ok"></span><b>${ok.length}</b> в срок</button>
      <button class="chip" data-f="mine" title="Проекты, где на мне есть незакрытые этапы">${icon('user', 15)}<b>${mine.length}</b> мои</button>
      <button class="chip" data-f="requests" title="Заявки и отправленные ТКП — ещё не в производстве">${icon('file', 15)}<b>${requests.length}</b> заявки</button>
      <button class="chip" data-f="all">Все, с завершёнными</button>
    </div>
    <div class="board">
      <div>
        <div class="toolbar">
          <label class="search">${icon('search', 16)}
            <input class="input" id="q" type="search" placeholder="Номер, клиент или изделие" value="${esc(query)}" aria-label="Поиск по проектам">
          </label>
          <span class="faint" id="found" aria-live="polite"></span>
        </div>
        <div id="list" data-tour="cards"></div>
      </div>
      ${departures(active, today)}
    </div>`;

  const draw = () => {
    const q = query.trim().toLowerCase();
    const list = sets[filter]
      .filter((p) => !q || `${p.code} ${p.client_name || ''} ${p.title}`.toLowerCase().includes(q))
      .sort((a, b) => rank(a) - rank(b) || (b.status.days - a.status.days) || a.id - b.id);
    el.querySelectorAll('.chip').forEach((c) => { c.classList.toggle('on', c.dataset.f === filter); c.setAttribute('aria-pressed', c.dataset.f === filter); });
    el.querySelector('#found').textContent = q ? `Найдено: ${list.length}` : '';
    el.querySelector('#list').innerHTML = list.length
      ? `<div class="grid">${list.map((p) => card(p, today)).join('')}</div>`
      : emptyState(q);
  };
  el.querySelectorAll('.chip').forEach((c) => (c.onclick = () => { filter = c.dataset.f; draw(); }));
  el.querySelector('#q').oninput = (e) => { query = e.target.value; draw(); };
  draw();
}

function emptyState(q) {
  if (q) return `<div class="empty"><b>Ничего не нашлось</b>Проверьте номер заказа или название клиента.</div>`;
  if (filter === 'overdue') return `<div class="empty"><b>Просрочек нет</b>Все текущие этапы укладываются в план.</div>`;
  if (filter === 'attention') return `<div class="empty"><b>Ближайшие два дня спокойные</b>Сроков на сегодня и завтра нет.</div>`;
  if (filter === 'mine') return `<div class="empty"><b>На вас сейчас нет открытых этапов</b>Здесь появятся проекты, где вы ответственный за этап.</div>`;
  if (filter === 'requests') return `<div class="empty"><b>Заявок нет</b>Заявки и отправленные ТКП живут здесь, пока заказчик не согласует — писем о просрочке по ним не бывает.</div>`;
  return `<div class="empty"><b>На доске пока пусто</b>${can('project.create') ? 'Создайте первый проект — этапы подставятся из типового маршрута.<br><br><a class="btn primary" href="#/new">Новый проект</a>' : 'Проекты появятся, когда их заведёт коммерческий отдел.'}</div>`;
}

// Сначала просрочки (самые большие сверху), потом «внимание», потом остальные
function rank(p) {
  return { overdue: 0, attention: 1, ok: 2, done: 3 }[p.status.code] ?? 2;
}

function card(p, today) {
  const s = p.status;
  const stageLine = p.current_stage
    ? `<span>Этап ${s.current_pos}/${s.total} · ${esc(p.current_stage.name)}</span><span class="num">${dm(p.current_stage.plan_date)}</span>`
    : `<span>${s.total ? 'Все этапы выполнены' : 'Этапы не заданы'}</span>`;
  const approval = p.approval_status !== 'in_work' ? `<span class="tag">${esc(p.approval_label)}</span>` : '';
  const due = p.due_date ? diffDays(p.due_date, today) : null;
  let dueTxt = due === null ? '' : due < 0 ? `сдача просрочена на ${plural(-due, 'день', 'дня', 'дней')}` : due === 0 ? 'сдача сегодня' : `сдача ${dm(p.due_date)} · через ${plural(due, 'день', 'дня', 'дней')}`;
  if (p.forecast_slip > 0 && due !== null && due >= 0) dueTxt = `<span class="bad-text">прогноз сдачи ${dm(p.forecast_due)} · +${p.forecast_slip} дн. к сроку</span>`;
  if (!p.in_production) dueTxt = 'не в производстве';
  return `
    <a class="card is-${esc(s.code)}" href="#/projects/${p.id}">
      <div class="head"><span class="code-tag">${esc(p.code)}</span>${badge(s)}</div>
      <div class="title">${esc(p.title)}</div>
      <div class="client">${esc(p.client_name || 'Без клиента')}</div>
      ${s.total ? routeStrip(p, today) : ''}
      <div class="stage">${stageLine}</div>
      <div class="foot"><span>${dueTxt}</span>${approval}</div>
    </a>`;
}

// Табло ближайших переходов: что и когда должно перейти на следующий этап
function departures(active, today) {
  const rows = active
    .filter((p) => p.current_stage)
    .map((p) => ({ p, left: diffDays(p.current_stage.plan_date, today) }))
    .filter((x) => x.left <= 7)
    .sort((a, b) => a.left - b.left)
    .slice(0, 8);
  const when = (left) => left < 0 ? ['late', `−${-left} дн`] : left === 0 ? ['today', 'сегодня'] : left === 1 ? ['today', 'завтра'] : ['later', `+${left} дн`];
  return `
    <aside class="departures" aria-label="Ближайшие переходы этапов" data-tour="departures">
      <h2>${icon('clock', 16)}Ближайшие переходы</h2>
      <div class="sub">Текущие этапы со сроком в пределах недели</div>
      ${rows.length ? rows.map(({ p, left }) => {
        const [cls, txt] = when(left);
        return `<a class="dep" href="#/projects/${p.id}">
          <span class="when ${cls}">${txt}</span>
          <span><b>${esc(p.code)}</b> <span class="what">${esc(p.current_stage.name)}</span>
          <span class="next">${p.next_stage ? `→ ${esc(p.next_stage.name)}` : '→ сдача клиенту'}</span></span>
        </a>`;
      }).join('') : '<div class="empty-dep">На неделю переходов нет</div>'}
    </aside>`;
}
