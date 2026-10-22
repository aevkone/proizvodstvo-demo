// Виртуальная экскурсия по интерфейсу: подсветка элемента + карточка с пояснением.
// Запускается автоматически при первом входе пользователя и по кнопке «Экскурсия».
import { state, api, can } from './lib.js';

const KEY = (login) => `pz-tour-done-${login}`;

function steps(projectId) {
  const list = [
    { route: '#/projects', sel: '.nav', title: 'Разделы системы', text: 'Слева — всё, что нужно в работе: доска проектов, калькулятор стоимости, отчёты для руководителя, справочники и журнал уведомлений. Красная цифра у «Проектов» — сколько заказов с просрочкой.' },
    { route: '#/projects', sel: '[data-tour=chips]', title: 'Магниты-фильтры', text: 'Как на магнитной доске в цеху: красный — просрочка, жёлтый — срок сегодня или завтра, зелёный — в срок. Нажмите на магнит, чтобы оставить на доске только такие заказы.' },
    { route: '#/projects', sel: '[data-tour=cards] .card', title: 'Бирка заказа', text: 'Номер, изделие, клиент и статус. Полоса под названием — маршрут: каждый отрезок — этап, его длина равна длительности. Серые выполнены, тёмный — текущий, красная штриховка — просрочен. Проблемные заказы всегда сверху.' },
    { route: '#/projects', sel: '[data-tour=departures]', title: 'Табло ближайших переходов', text: 'Какие этапы должны закончиться в ближайшую неделю и что идёт следом. «−2 дн» — этап просрочен на 2 дня, «сегодня» — срок сегодня, «+3 дн» — осталось 3 дня.' },
    { route: '#/projects', sel: '[data-tour=new]', title: 'Новый проект', text: 'Заказ заводится за минуту: номер, клиент, изделие и тип маршрута. Этапы и плановые даты подставятся из типового маршрута сами.', when: () => can('project.create') },
  ];
  if (projectId) {
    list.push(
      { route: `#/projects/${projectId}`, sel: '[data-tour=route]', title: 'Карточка заказа', text: 'Вверху — маршрут крупно, старт и срок сдачи клиенту. Наведите на отрезок, чтобы увидеть этап и его дату.' },
      { route: `#/projects/${projectId}`, sel: '[data-tour=stages]', title: 'Этапы: план и факт', text: 'По каждому этапу — ответственный, плановая и фактическая дата. Если этап выходит за срок, система не даст сохранить без комментария: почему задержка и что делается. Так причина видна всем, а не остаётся в звонках.' },
      { route: `#/projects/${projectId}`, sel: '[data-tour=done]', title: 'Отметить факт в один клик', text: '«Готово сегодня» закрывает этап. Если этап в срок — сохраняется сразу, магнит защёлкивается, следующий этап становится текущим.', optional: true },
    );
  }
  list.push(
    { route: '#/calc', sel: '.topbar', title: 'Калькулятор стоимости', text: 'Материалы плюс нормо-часы по видам работ умножить на ставку, затем наценка и НДС. Ставки и цены берутся из справочников. Из расчёта формируется ТКП для клиента — без себестоимости и внутренних нормо-часов.' },
    { route: '#/reports', sel: '[data-tour=summary]', title: 'Отчёты для руководителя', text: 'Без сложных графиков: сколько в работе, что под угрозой и почему, на каких этапах чаще срывы, что сдаём в ближайший месяц.' },
    { route: '#/notifications', sel: '.topbar', title: 'Уведомления', text: 'При просрочке, сроке «сегодня» и переходе на следующий этап ответственный и руководители получают письмо. Здесь — журнал отправленного и предпросмотр письма.' },
    { route: '#/projects', sel: '#tourbtn', title: 'Экскурсия всегда под рукой', text: 'Её можно пройти ещё раз в любой момент — кнопка «Экскурсия» внизу меню. Удачной работы!' },
  );
  return list.filter((s) => !s.when || s.when());
}

let active = null;

function waitFor(sel, timeout = 4000) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const tick = () => {
      const el = document.querySelector(sel);
      if (el && el.getBoundingClientRect().width > 0) return resolve(el);
      if (Date.now() - t0 > timeout) return resolve(null);
      setTimeout(tick, 60);
    };
    tick();
  });
}

function build() {
  const root = document.createElement('div');
  root.className = 'tour';
  root.innerHTML = `
    <div class="tour-hole" aria-hidden="true"></div>
    <div class="tour-card" role="dialog" aria-modal="true" aria-labelledby="tour-title" aria-describedby="tour-text" tabindex="-1">
      <div class="tour-step"></div>
      <h2 id="tour-title"></h2>
      <p id="tour-text"></p>
      <div class="tour-dots" aria-hidden="true"></div>
      <div class="tour-actions">
        <button class="linkbtn" data-t="skip">Пропустить</button>
        <span style="flex:1"></span>
        <button class="btn small ghost" data-t="prev">Назад</button>
        <button class="btn small primary" data-t="next">Далее</button>
      </div>
    </div>`;
  document.body.appendChild(root);
  return root;
}

function place(root, el) {
  const hole = root.querySelector('.tour-hole');
  const card = root.querySelector('.tour-card');
  const pad = 6;
  const r = el.getBoundingClientRect();
  // слишком большой элемент подсвечиваем верхней частью
  const h = Math.min(r.height, innerHeight * 0.6);
  hole.style.cssText = `top:${r.top - pad}px;left:${r.left - pad}px;width:${r.width + pad * 2}px;height:${h + pad * 2}px`;
  if (innerWidth < 640) { card.style.cssText = ''; card.classList.add('docked'); return; }
  card.classList.remove('docked');
  const cw = Math.min(380, innerWidth - 32);
  const ch = card.offsetHeight || 220;
  let top = r.top + h + pad + 14;
  if (top + ch > innerHeight - 12) top = r.top - ch - pad - 14;
  if (top < 12) top = Math.min(innerHeight - ch - 12, Math.max(12, r.top + 20));
  let left = r.left;
  if (r.width < cw) left = r.left + r.width / 2 - cw / 2;
  if (left + cw > innerWidth - 16) left = innerWidth - cw - 16;
  if (r.left > innerWidth * 0.55 && r.width < innerWidth * 0.4) left = Math.max(16, r.left - cw - 18), top = Math.max(12, Math.min(r.top, innerHeight - ch - 12));
  card.style.cssText = `top:${Math.max(12, top)}px;left:${Math.max(16, left)}px;width:${cw}px`;
}

async function show(i) {
  const t = active;
  if (!t) return;
  t.i = i;
  const s = t.steps[i];
  if (s.route && location.hash !== s.route) location.hash = s.route;
  const el = await waitFor(s.sel, s.optional ? 1500 : 4000);
  if (active !== t || t.i !== i) return;
  if (!el) { // элемента нет у этой роли/данных — пропускаем
    if (i < t.steps.length - 1) return show(t.dir < 0 && i > 0 ? i - 1 : i + 1);
    return finish(true);
  }
  el.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  const card = t.root.querySelector('.tour-card');
  t.root.querySelector('.tour-step').textContent = `Шаг ${i + 1} из ${t.steps.length}`;
  t.root.querySelector('#tour-title').textContent = s.title;
  t.root.querySelector('#tour-text').textContent = s.text;
  t.root.querySelector('.tour-dots').innerHTML = t.steps.map((_, k) => `<i class="${k === i ? 'on' : k < i ? 'past' : ''}"></i>`).join('');
  t.root.querySelector('[data-t=prev]').disabled = i === 0;
  t.root.querySelector('[data-t=next]').textContent = i === t.steps.length - 1 ? 'Готово' : 'Далее';
  t.el = el;
  setTimeout(() => { if (active === t && t.i === i) { place(t.root, el); card.focus({ preventScroll: true }); } }, 260);
  place(t.root, el);
}

function finish(done) {
  if (!active) return;
  const t = active;
  active = null;
  window.removeEventListener('resize', t.onResize);
  window.removeEventListener('scroll', t.onResize, true);
  document.removeEventListener('keydown', t.onKey, true);
  t.root.classList.add('out');
  setTimeout(() => t.root.remove(), 200);
  try { localStorage.setItem(KEY(state.me.login), done ? 'done' : 'skipped'); } catch { /* приватный режим */ }
  t.prevFocus?.focus?.();
}

export async function startTour(force = false) {
  if (active || !state.me) return;
  let seen = null;
  try { seen = localStorage.getItem(KEY(state.me.login)); } catch { seen = 'n/a'; }
  if (seen && !force) return;
  let pid = null;
  try {
    const ps = await api('/projects');
    const pick = ps.find((p) => p.status.code === 'overdue') || ps.find((p) => p.current_stage) || ps[0];
    pid = pick?.id || null;
  } catch { /* без примера проекта */ }
  const root = build();
  const t = { root, steps: steps(pid), i: 0, dir: 1, prevFocus: document.activeElement };
  active = t;
  t.onResize = () => t.el && place(root, t.el);
  t.onKey = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); finish(false); }
    else if (e.key === 'ArrowRight' || (e.key === 'Enter' && e.target.tagName !== 'BUTTON')) { e.preventDefault(); next(); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); prev(); }
    else if (e.key === 'Tab') { // фокус не уходит из карточки
      const f = [...root.querySelectorAll('.tour-card button:not(:disabled)')];
      if (!f.length) return;
      const idx = f.indexOf(document.activeElement);
      if (e.shiftKey && idx <= 0) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && idx === f.length - 1) { e.preventDefault(); f[0].focus(); }
    }
  };
  const next = () => { t.dir = 1; if (t.i < t.steps.length - 1) show(t.i + 1); else finish(true); };
  const prev = () => { t.dir = -1; if (t.i > 0) show(t.i - 1); };
  root.querySelector('[data-t=next]').onclick = next;
  root.querySelector('[data-t=prev]').onclick = prev;
  root.querySelector('[data-t=skip]').onclick = () => finish(false);
  root.addEventListener('click', (e) => { if (e.target === root) finish(false); });
  window.addEventListener('resize', t.onResize);
  window.addEventListener('scroll', t.onResize, true);
  document.addEventListener('keydown', t.onKey, true);
  requestAnimationFrame(() => root.classList.add('in'));
  show(0);
}

export function isTourActive() { return !!active; }
