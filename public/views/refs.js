import { state, api, esc, can, toast } from '../lib.js';
import { icon } from '../icons.js';

const TABS = [
  ['templates', 'Маршруты и этапы'],
  ['work_types', 'Виды работ и ставки'],
  ['materials', 'Материалы'],
  ['clients', 'Клиенты'],
  ['users', 'Пользователи'],
];

// Простые справочники: колонки [поле, заголовок, тип]
const SIMPLE = {
  work_types: { cols: [['name', 'Вид работ', 'text'], ['rate', 'Ставка нормо-часа, ₽', 'number']], hint: 'Ставки используются в калькуляторе. На старте — демонстрационные, калибруются по первым реальным заказам.' },
  materials: { cols: [['name', 'Материал', 'text'], ['unit', 'Ед.', 'text'], ['price', 'Цена за ед., ₽', 'number']], hint: 'Цены подставляются в калькулятор при выборе материала.' },
  clients: { cols: [['name', 'Название', 'text'], ['contact', 'Контактное лицо', 'text'], ['email', 'E-mail', 'text'], ['phone', 'Телефон', 'text']], hint: '' },
};

let tab = 'templates';

async function reload() {
  state.refs = await api('/refs');
}

export async function renderRefs(el) {
  await reload();
  const editable = can('refs.edit');
  el.innerHTML = `
    <div class="topbar"><div><h1>Справочники</h1>
      <div class="sub">${editable ? 'Изменения справочников не трогают уже созданные проекты и расчёты' : 'Только просмотр. Изменять справочники могут директор производства и главный технолог'}</div></div></div>
    <div class="tabs">${TABS.map(([k, v]) => `<button class="tab ${k === tab ? 'on' : ''}" data-tab="${k}">${v}</button>`).join('')}</div>
    <div id="pane"></div>`;
  el.querySelectorAll('[data-tab]').forEach((b) => (b.onclick = () => { tab = b.dataset.tab; renderRefs(el); }));
  const pane = el.querySelector('#pane');
  if (SIMPLE[tab]) return simple(pane, tab, editable);
  if (tab === 'templates') return templates(pane, editable);
  if (tab === 'users') return users(pane);
}

function simple(pane, table, editable) {
  const cfg = SIMPLE[table];
  const rows = state.refs[table];
  const dis = editable ? '' : 'disabled';
  const rowHtml = (r) => `<tr data-id="${r.id ?? ''}">
    ${cfg.cols.map(([f, , t]) => `<td><input class="input" style="width:100%" data-f="${f}" type="${t}" ${t === 'number' ? 'min="0" step="any"' : ''} value="${esc(r[f] ?? '')}" ${dis}></td>`).join('')}
    ${editable ? `<td style="white-space:nowrap"><button class="btn small primary" data-save>Сохранить</button> <button class="x-btn" data-del title="Удалить">${icon('trash', 14)}Удалить</button></td>` : ''}
  </tr>`;
  pane.innerHTML = `
    ${cfg.hint ? `<p class="muted">${cfg.hint}</p>` : ''}
    <div style="overflow-x:auto"><table class="tablelist">
      <thead><tr>${cfg.cols.map(([, h]) => `<th>${h}</th>`).join('')}${editable ? '<th style="width:200px"></th>' : ''}</tr></thead>
      <tbody>${rows.map(rowHtml).join('')}</tbody>
    </table></div>
    ${editable ? '<button class="btn ghost" id="add" style="margin-top:12px">+ Добавить</button>' : ''}`;
  const tbody = pane.querySelector('tbody');
  pane.querySelector('#add')?.addEventListener('click', () => {
    tbody.insertAdjacentHTML('beforeend', rowHtml({}));
    tbody.lastElementChild.querySelector('input').focus();
  });
  tbody.addEventListener('click', async (e) => {
    const tr = e.target.closest('tr');
    if (!tr) return;
    const id = tr.dataset.id;
    if (e.target.closest('[data-save]')) {
      const body = Object.fromEntries([...tr.querySelectorAll('[data-f]')].map((i) => [i.dataset.f, i.value]));
      try {
        const saved = await api(id ? `/${table}/${id}` : `/${table}`, { method: id ? 'PUT' : 'POST', body });
        tr.dataset.id = saved.id;
        await reload();
        toast('Сохранено');
      } catch (err) { toast(err.message, true); }
    }
    if (e.target.closest('[data-del]')) {
      if (!id) { tr.remove(); return; }
      if (!confirm('Удалить запись?')) return;
      try {
        await api(`/${table}/${id}`, { method: 'DELETE' });
        tr.remove();
        await reload();
        toast('Удалено');
      } catch (err) { toast(err.message, true); }
    }
  });
}

function templates(pane, editable) {
  const tpls = state.refs.templates;
  const dis = editable ? '' : 'disabled';
  const card = (t) => {
    const total = t.stages.reduce((a, s) => a + Number(s.duration_days || 0), 0);
    return `<form class="panel tpl" data-id="${t.id ?? ''}" style="padding:18px 22px;margin-bottom:16px">
      <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:end;margin-bottom:12px">
        <div class="field" style="flex:1;min-width:200px"><label>Название маршрута</label><input class="input" name="name" value="${esc(t.name || '')}" ${dis}></div>
        <div class="field" style="flex:2;min-width:240px"><label>Описание</label><input class="input" name="description" value="${esc(t.description || '')}" ${dis}></div>
        <div class="muted" style="padding-bottom:9px">${t.stages.length} этапов · ${total} дн.</div>
      </div>
      <table class="lines" style="min-width:480px">
        <thead><tr><th style="width:36px">№</th><th>Этап</th><th style="width:120px">Длительность, дн.</th><th style="width:110px">Испытания</th>${editable ? '<th style="width:96px"></th>' : ''}</tr></thead>
        <tbody>${t.stages.map((s, i) => stageRow(s, i, editable)).join('')}</tbody>
      </table>
      ${editable ? `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
        <button type="button" class="btn small ghost" data-addstage>+ Этап</button>
        <button type="submit" class="btn small primary">Сохранить маршрут</button>
        ${t.id ? `<button type="button" class="x-btn" data-deltpl>${icon('trash', 14)}Удалить маршрут</button>` : ''}
      </div>` : ''}
    </form>`;
  };
  pane.innerHTML = `
    <p class="muted">Этапы и нормативные длительности маршрута подставляются при создании проекта. «Испытания» — после этого этапа добавляется цикл доработки.</p>
    <div id="tpls">${tpls.map(card).join('')}</div>
    ${editable ? '<button class="btn ghost" id="addtpl">+ Новый маршрут</button>' : ''}`;

  pane.querySelector('#addtpl')?.addEventListener('click', () => {
    pane.querySelector('#tpls').insertAdjacentHTML('beforeend', card({ name: '', stages: [{ name: '', duration_days: 1 }] }));
    pane.querySelector('#tpls').lastElementChild.querySelector('input').focus();
  });
  pane.addEventListener('click', async (e) => {
    const form = e.target.closest('form.tpl');
    if (!form) return;
    const tb = form.querySelector('tbody');
    const renumber = () => tb.querySelectorAll('tr').forEach((tr, i) => (tr.firstElementChild.textContent = i + 1));
    if (e.target.closest('[data-addstage]')) { tb.insertAdjacentHTML('beforeend', stageRow({ name: '', duration_days: 1 }, tb.children.length, true)); renumber(); tb.lastElementChild.querySelector('input').focus(); }
    const tr = e.target.closest('tr');
    if (tr && e.target.closest('[data-up]') && tr.previousElementSibling) { tr.previousElementSibling.before(tr); renumber(); }
    if (tr && e.target.closest('[data-down]') && tr.nextElementSibling) { tr.nextElementSibling.after(tr); renumber(); }
    if (tr && e.target.closest('[data-rm]')) { tr.remove(); renumber(); }
    if (e.target.closest('[data-deltpl]')) {
      if (!confirm('Удалить маршрут?')) return;
      try { await api(`/templates/${form.dataset.id}`, { method: 'DELETE' }); form.remove(); await reload(); toast('Маршрут удалён'); } catch (err) { toast(err.message, true); }
    }
  });
  pane.addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const id = form.dataset.id;
    const body = {
      name: form.name.value, description: form.description.value,
      stages: [...form.querySelectorAll('tbody tr')].map((tr) => ({
        name: tr.querySelector('[data-f=name]').value,
        duration_days: Number(tr.querySelector('[data-f=duration_days]').value),
        is_test: tr.querySelector('[data-f=is_test]').checked,
      })),
    };
    try {
      const t = await api(id ? `/templates/${id}` : '/templates', { method: id ? 'PUT' : 'POST', body });
      form.dataset.id = t.id;
      await reload();
      toast('Маршрут сохранён');
    } catch (err) { toast(err.message, true); }
  });
}

function stageRow(s, i, editable) {
  const dis = editable ? '' : 'disabled';
  return `<tr>
    <td class="muted num">${i + 1}</td>
    <td><input data-f="name" value="${esc(s.name)}" ${dis}></td>
    <td><input data-f="duration_days" type="number" min="0" step="1" value="${s.duration_days}" ${dis}></td>
    <td style="text-align:center"><input data-f="is_test" type="checkbox" style="width:auto" ${s.is_test ? 'checked' : ''} ${dis}></td>
    ${editable ? `<td style="white-space:nowrap"><button type="button" class="x" data-up title="Выше">↑</button><button type="button" class="x" data-down title="Ниже">↓</button><button type="button" class="x" data-rm title="Удалить этап">×</button></td>` : ''}
  </tr>`;
}

function users(pane) {
  const editable = can('users.edit');
  const roles = state.refs.roles;
  const roleSel = (r, dis) => `<select class="input" data-f="role" ${dis}>${Object.entries(roles).map(([k, v]) => `<option value="${k}" ${k === r ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select>`;
  const dis = editable ? '' : 'disabled';
  const rowHtml = (u) => `<tr data-id="${u.id ?? ''}">
    <td>${u.id ? `<b>${esc(u.login)}</b>` : `<input class="input" data-f="login" placeholder="логин">`}</td>
    <td><input class="input" data-f="name" value="${esc(u.name || '')}" ${dis}></td>
    <td><input class="input" data-f="email" value="${esc(u.email || '')}" ${dis}></td>
    <td>${roleSel(u.role, dis)}</td>
    <td style="text-align:center"><input type="checkbox" data-f="active" ${u.active !== 0 ? 'checked' : ''} ${dis}></td>
    ${editable ? `<td><input class="input" data-f="password" type="password" autocomplete="new-password" placeholder="${u.id ? 'новый пароль' : 'пароль'}"></td>
    <td><button class="btn small primary" data-save>Сохранить</button></td>` : ''}
  </tr>`;
  pane.innerHTML = `
    <p class="muted">Узкий круг пользователей пилота. E-mail используется для уведомлений. ${editable ? 'Пользователя нельзя удалить — только отключить.' : 'Управляет пользователями директор производства.'}</p>
    <div style="overflow-x:auto"><table class="tablelist">
      <thead><tr><th>Логин</th><th>ФИО</th><th>E-mail</th><th>Роль</th><th>Активен</th>${editable ? '<th>Пароль</th><th></th>' : ''}</tr></thead>
      <tbody>${state.refs.users.map(rowHtml).join('')}</tbody>
    </table></div>
    ${editable ? '<button class="btn ghost" id="add" style="margin-top:12px">+ Пользователь</button>' : ''}`;
  const tbody = pane.querySelector('tbody');
  pane.querySelector('#add')?.addEventListener('click', () => { tbody.insertAdjacentHTML('beforeend', rowHtml({ role: 'chief_tech' })); tbody.lastElementChild.querySelector('input').focus(); });
  tbody.addEventListener('click', async (e) => {
    if (!e.target.closest('[data-save]')) return;
    const tr = e.target.closest('tr');
    const id = tr.dataset.id;
    const body = {};
    tr.querySelectorAll('[data-f]').forEach((i) => (body[i.dataset.f] = i.type === 'checkbox' ? i.checked : i.value));
    if (!body.password) delete body.password;
    try {
      const u = await api(id ? `/users/${id}` : '/users', { method: id ? 'PUT' : 'POST', body });
      await reload();
      toast(id ? 'Сохранено' : `Пользователь ${u.login} создан`);
      if (!id) users(pane);
      else tr.querySelector('[data-f=password]').value = '';
    } catch (err) { toast(err.message, true); }
  });
}

