import { state, api, esc, can, dfull, badge, toast, needsComment, routeStrip, diffDays, plural, busy } from '../lib.js';
import { icon } from '../icons.js';

export async function renderProject(el, id) {
  const p = await api(`/projects/${id}`);
  draw(el, p);
}

function draw(el, p, justDone) {
  const me = state.me;
  const today = me.today;
  const users = state.refs.users.filter((u) => u.active);
  const fullEdit = can('stage.edit');
  const canEditStage = (s) => fullEdit || s.responsible_id === me.id;
  const anyEditable = p.stages.some(canEditStage);
  const curId = p.current_stage?.id;
  const approvalOpts = Object.entries(state.refs.approval);
  const due = p.due_date ? diffDays(p.due_date, today) : null;

  // локальные правки этапов до сохранения
  const edits = new Map();
  const val = (s, k) => (edits.get(s.id)?.[k] !== undefined ? edits.get(s.id)[k] : s[k]);
  const setDirty = () => { window.__dirty = edits.size > 0; };

  el.innerHTML = `
    <nav class="crumbs" aria-label="Навигация"><a href="#/projects">Проекты</a><span aria-hidden="true">/</span><span>${esc(p.code)}</span></nav>
    <div class="topbar">
      <div>
        <div style="display:flex;gap:10px;align-items:center;margin-bottom:8px"><span class="code-tag">${esc(p.code)}</span>${badge(p.status)}</div>
        <h1 class="cap">${esc(p.title)}</h1>
        <div class="meta"><span>${esc(p.client_name || 'Без клиента')}</span><span aria-hidden="true">·</span><span>Ответственный: ${esc(p.responsible_name || 'не назначен')}</span></div>
      </div>
      <div class="actions no-print">
        ${fullEdit && p.stages.some((s) => s.is_test) ? `<button class="btn" id="rework" title="Разборка → подгонка → повторная сборка → повторные испытания">${icon('rework', 16)}Цикл доработки</button>` : ''}
        ${can('project.edit') ? `<button class="btn" id="editbtn" aria-expanded="false" aria-controls="editf">${icon('pencil', 16)}Изменить</button>` : ''}
        ${can('calc.edit') ? `<a class="btn" href="#/calc/new?project=${p.id}">${icon('calc', 16)}Расчёт стоимости</a>` : ''}
        <button class="btn ghost" onclick="window.print()" title="Печать">${icon('printer', 16)}Печать</button>
      </div>
    </div>

    ${can('project.edit') ? `
    <form class="panel edit-panel no-print" id="editf" hidden>
      <div class="field"><label for="ef-code">Номер заказа</label><input class="input" id="ef-code" name="code" value="${esc(p.code)}" required></div>
      <div class="field"><label for="ef-title">Изделие</label><input class="input" id="ef-title" name="title" value="${esc(p.title)}" required></div>
      <div class="field"><label for="ef-client">Клиент</label><select class="input" id="ef-client" name="client_id"><option value="">—</option>${state.refs.clients.map((c) => `<option value="${c.id}" ${c.id === p.client_id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></div>
      <div class="field"><label for="ef-resp">Ответственный по проекту</label><select class="input" id="ef-resp" name="responsible_id"><option value="">—</option>${users.map((u) => `<option value="${u.id}" ${u.id === p.responsible_id ? 'selected' : ''}>${esc(u.name)}</option>`).join('')}</select></div>
      <div class="field"><label for="ef-due">Срок сдачи клиенту</label><input class="input" type="date" id="ef-due" name="due_date" value="${esc(p.due_date || '')}"></div>
      <div class="field"><label for="ef-notes">Примечание</label><input class="input" id="ef-notes" name="notes" value="${esc(p.notes || '')}"></div>
      <div class="actions"><button class="btn primary" type="submit">Сохранить данные</button><button class="btn ghost" type="button" id="editcancel">Отмена</button></div>
    </form>` : ''}

    <section class="panel route-panel" aria-label="Маршрут" data-tour="route">
      <div class="route-head">
        <span><b style="color:var(--ink)">Маршрут «${esc(p.template_name || '—')}»</b> · выполнено ${p.status.done} из ${p.status.total}</span>
        <span>${p.start_date ? `старт ${dfull(p.start_date)}` : ''}${p.due_date ? ` · сдача ${dfull(p.due_date)}${due !== null && due < 0 ? ` <b style="color:var(--bad-ink)">(просрочена на ${plural(-due, 'день', 'дня', 'дней')})</b>` : ''}` : ''}</span>
      </div>
      ${routeStrip(p, today, 'lg')}
      <div class="route-legend" aria-hidden="true">
        <span><i style="background:#8e9690"></i>выполнен</span>
        <span><i style="background:#c9a74a"></i>с опозданием</span>
        <span><i style="background:var(--cur)"></i>текущий</span>
        <span><i style="background:repeating-linear-gradient(-45deg,var(--bad) 0 3px,#f08a7f 3px 6px)"></i>просрочен</span>
        <span><i style="background:#dfe2dc"></i>впереди</span>
        <span style="margin-left:auto">длина сегмента — длительность этапа</span>
      </div>
    </section>

    <div class="panel facts">
      <div><span>Клиент</span>${esc(p.client_name || '—')}</div>
      <div><span>Старт</span><span class="num">${dfull(p.start_date)}</span></div>
      <div><span>Срок сдачи клиенту</span><span class="num">${dfull(p.due_date)}</span></div>
      <div><span>Согласование с заказчиком</span>${
        can('project.approval')
          ? `<select class="input" id="approval" aria-label="Статус согласования">${approvalOpts.map(([k, v]) => `<option value="${k}" ${k === p.approval_status ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select>`
          : esc(p.approval_label)}</div>
      ${p.notes ? `<div style="grid-column:1/-1"><span>Примечание</span>${esc(p.notes)}</div>` : ''}
    </div>

    <section class="panel" aria-label="Этапы" data-tour="stages">
      <div class="stages-wrap">
        <table class="stages">
          <thead><tr><th style="width:40px"><span hidden>Статус</span></th><th>Этап</th>${fullEdit ? '<th>Ответственный</th>' : ''}<th>План</th><th>Факт</th><th class="no-print" style="width:150px"></th></tr></thead>
          <tbody id="tb"></tbody>
        </table>
      </div>
      ${anyEditable ? `<div class="savebar sticky-save no-print" id="savebar">
        <button class="btn primary" id="save" disabled>${icon('check', 16)}Сохранить</button>
        <button class="btn ghost" id="undo" hidden>Отменить изменения</button>
        <span class="muted" id="hint">Изменения увидят все, у кого есть доступ к проекту</span>
      </div>` : ''}
    </section>`;

  const tb = el.querySelector('#tb');
  const saveBtn = el.querySelector('#save');
  const cols = fullEdit ? 6 : 5;

  const rowHtml = (s) => {
    const editable = canEditStage(s);
    const plan = val(s, 'plan_date');
    const fact = val(s, 'fact_date');
    const live = { plan_date: plan, fact_date: fact };
    const isCur = s.id === curId && !fact;
    let dotCls = 'dot';
    let dotIn = '';
    if (fact) { dotCls += diffDays(fact, plan) > 0 ? ' done_late' : ' done'; dotIn = icon('check', 14); if (justDone === s.id) dotCls += ' snap'; }
    else if (isCur) dotCls += ' cur' + (diffDays(today, plan) > 0 ? ' overdue' : s.status.code === 'attention' ? ' attention' : '');
    else if (diffDays(today, plan) > 0) dotCls += ' overdue';
    const need = needsComment(live, today);
    const lateDays = fact ? diffDays(fact, plan) : diffDays(today, plan);
    const comment = val(s, 'comment') || '';
    const ch = edits.get(s.id) || {};
    const respOpts = users.map((u) => `<option value="${u.id}" ${u.id === val(s, 'responsible_id') ? 'selected' : ''}>${esc(u.name)}</option>`).join('');
    const hist = (s.comments || []).filter((c) => c.text !== s.comment).slice(-3);
    const label = fact ? (lateDays > 0 ? `выполнен с опозданием ${lateDays} дн.` : 'выполнен') : isCur ? 'текущий этап' : lateDays > 0 ? 'просрочен' : 'впереди';
    let cmt = '';
    if (editable && (need || comment)) {
      cmt = `<tr class="cmt"><td></td><td colspan="${cols - 1}">
        <div class="comment-box" data-box="${s.id}">
          <label for="c${s.id}">${need && !s.comment ? `${icon('alert', 14)}Отклонение от срока — напишите, почему задержка и что делается` : need ? `${icon('alert', 14)}Комментарий об отклонении` : 'Комментарий'}</label>
          <textarea id="c${s.id}" data-id="${s.id}" data-k="comment" ${need ? 'required aria-required="true"' : ''} placeholder="Например: поставка стали задержалась на 2 дня, завершение ожидается 25.10">${esc(comment)}</textarea>
          ${hist.length ? `<div class="hist">${hist.map((c) => `<div>${esc(c.created_at.slice(0, 10).split('-').reverse().join('.'))} · ${esc(c.user_name || '')}: ${esc(c.text)}</div>`).join('')}</div>` : ''}
        </div></td></tr>`;
    } else if (comment) {
      cmt = `<tr class="cmt"><td></td><td colspan="${cols - 1}"><div class="comment-ro"><b>Комментарий ответственного:</b> ${esc(comment)}</div></td></tr>`;
    }
    return `
      <tr class="${isCur ? 'cur' : fact ? '' : 'future'}" data-row="${s.id}">
        <td><span class="${dotCls}" role="img" aria-label="${label}">${dotIn}</span></td>
        <td><span class="sname">${s.pos}. ${esc(s.name)}</span>${s.is_rework ? '<span class="rework">доработка</span>' : ''}${!fullEdit ? `<span class="sresp">${esc(s.responsible_name || 'ответственный не назначен')}</span>` : ''}</td>
        ${fullEdit ? `<td><select data-id="${s.id}" data-k="responsible_id" aria-label="Ответственный за этап ${s.pos}" class="${'responsible_id' in ch ? 'changed' : ''}"><option value="">—</option>${respOpts}</select></td>` : ''}
        <td>${fullEdit ? `<input type="date" data-id="${s.id}" data-k="plan_date" value="${esc(plan || '')}" aria-label="План этапа ${s.pos}" class="${'plan_date' in ch ? 'changed' : ''}">` : `<span class="date-ro">${dfull(plan)}</span>`}
          ${!fact && lateDays > 0 ? `<span class="late-note">−${lateDays} дн.</span>` : ''}</td>
        <td>${editable ? `<input type="date" data-id="${s.id}" data-k="fact_date" value="${esc(fact || '')}" aria-label="Факт этапа ${s.pos}" class="${'fact_date' in ch ? 'changed' : ''}">` : `<span class="date-ro">${dfull(fact)}</span>`}</td>
        <td class="no-print">${editable && !fact && isCur ? `<button class="btn small" data-done="${s.id}" data-tour="done">${icon('check', 14)}Готово сегодня</button>` : ''}</td>
      </tr>${cmt}`;
  };

  const refreshBar = () => {
    if (!saveBtn) return;
    saveBtn.disabled = edits.size === 0;
    saveBtn.innerHTML = `${icon('check', 16)}Сохранить${edits.size ? ` <span class="dirty-count">${edits.size}</span>` : ''}`;
    el.querySelector('#undo').hidden = edits.size === 0;
    el.querySelector('#savebar').classList.toggle('dirty', edits.size > 0);
    el.querySelector('#hint').textContent = edits.size ? `Не сохранено: ${plural(edits.size, 'этап', 'этапа', 'этапов')}` : 'Изменения увидят все, у кого есть доступ к проекту';
    setDirty();
  };

  const render = () => {
    tb.innerHTML = p.stages.map(rowHtml).join('');
    refreshBar();
  };

  const setEdit = (id, k, v) => {
    const s = p.stages.find((x) => x.id === id);
    const cur = edits.get(id) || {};
    cur[k] = v;
    // правка, вернувшая исходное значение, не считается изменением
    for (const key of Object.keys(cur)) if ((cur[key] ?? null) === (s[key] ?? null)) delete cur[key];
    if (Object.keys(cur).length) edits.set(id, cur); else edits.delete(id);
    if (k === 'comment') { refreshBar(); return; }
    render();
    if (needsComment({ plan_date: val(s, 'plan_date'), fact_date: val(s, 'fact_date') }, today) && !val(s, 'comment')) {
      el.querySelector(`#c${id}`)?.focus();
    }
  };

  tb.addEventListener('change', (e) => {
    const t = e.target;
    if (!t.dataset.id || t.dataset.k === 'comment') return;
    const v = t.dataset.k === 'responsible_id' ? (t.value ? Number(t.value) : null) : t.value || null;
    setEdit(Number(t.dataset.id), t.dataset.k, v);
  });
  tb.addEventListener('input', (e) => {
    if (e.target.dataset.k === 'comment') setEdit(Number(e.target.dataset.id), 'comment', e.target.value);
  });
  tb.addEventListener('click', (e) => {
    const b = e.target.closest('[data-done]');
    if (!b) return;
    const id = Number(b.dataset.done);
    const s = p.stages.find((x) => x.id === id);
    setEdit(id, 'fact_date', today);
    // этап без отклонения сохраняем сразу — «отметить факт» в один клик
    if (!needsComment({ plan_date: val(s, 'plan_date'), fact_date: today }, today) && edits.size === 1) save(id);
  });

  async function save(snapId) {
    // проверка до отправки — те же правила, что на сервере
    const missing = [];
    for (const [id, ch] of edits) {
      const s = p.stages.find((x) => x.id === id);
      const live = { plan_date: val(s, 'plan_date'), fact_date: val(s, 'fact_date') };
      if (needsComment(live, today) && !String(val(s, 'comment') || '').trim()) missing.push(s);
      if (!fullEdit) { delete ch.plan_date; delete ch.responsible_id; }
    }
    el.querySelectorAll('.comment-box').forEach((b) => b.classList.toggle('err', missing.some((s) => String(s.id) === b.dataset.box)));
    if (missing.length) {
      toast(`Этап «${missing[0].name}»: напишите, почему задержка и что делается`, true);
      el.querySelector(`#c${missing[0].id}`)?.focus();
      return;
    }
    busy(saveBtn, true);
    try {
      const body = { stages: [...edits].map(([id, ch]) => ({ id, ...ch })) };
      const np = await api(`/projects/${p.id}/stages`, { method: 'PUT', body });
      window.__dirty = false;
      const nextName = np.current_stage?.name;
      toast(snapId && nextName ? `Этап закрыт. Следующий: ${nextName}` : 'Сохранено');
      draw(el, np, typeof snapId === 'number' ? snapId : null);
    } catch (e) {
      toast(e.message, true);
      busy(saveBtn, false);
    }
  }
  if (saveBtn) {
    saveBtn.onclick = () => save();
    el.querySelector('#undo').onclick = () => { edits.clear(); render(); };
  }

  el.querySelector('#approval')?.addEventListener('change', async (e) => {
    try {
      const np = await api(`/projects/${p.id}`, { method: 'PATCH', body: { approval_status: e.target.value } });
      toast('Статус согласования: ' + np.approval_label);
      p.approval_status = np.approval_status;
      p.approval_label = np.approval_label;
    } catch (err) {
      toast(err.message, true);
    }
  });

  el.querySelector('#rework')?.addEventListener('click', async (ev) => {
    if (edits.size && !confirm('Есть несохранённые изменения — они пропадут. Продолжить?')) return;
    if (!confirm('Добавить цикл доработки (разборка → подгонка → повторная сборка → повторные испытания) после испытаний? Срок сдачи сдвинется на 5 дней.')) return;
    busy(ev.currentTarget, true);
    try {
      window.__dirty = false;
      draw(el, await api(`/projects/${p.id}/rework`, { method: 'POST' }));
      toast('Цикл доработки добавлен, срок сдачи сдвинут');
    } catch (e) {
      toast(e.message, true);
      busy(ev.currentTarget, false);
    }
  });

  const ef = el.querySelector('#editf');
  if (ef) {
    const eb = el.querySelector('#editbtn');
    eb.onclick = () => { ef.hidden = !ef.hidden; eb.setAttribute('aria-expanded', !ef.hidden); if (!ef.hidden) ef.querySelector('input').focus(); };
    el.querySelector('#editcancel').onclick = () => { ef.hidden = true; eb.setAttribute('aria-expanded', 'false'); };
    ef.onsubmit = async (ev) => {
      ev.preventDefault();
      const fd = Object.fromEntries(new FormData(ef));
      for (const k of ['client_id', 'responsible_id']) fd[k] = fd[k] ? Number(fd[k]) : null;
      try {
        const np = await api(`/projects/${p.id}`, { method: 'PATCH', body: fd });
        toast('Данные проекта сохранены');
        draw(el, np);
      } catch (e) {
        toast(e.message, true);
      }
    };
  }

  window.onbeforeunload = () => (edits.size ? true : undefined);
  render();
}

