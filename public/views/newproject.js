import { state, api, esc, can, toast, dfull } from '../lib.js';
import { icon } from '../icons.js';

function addDays(s, n) {
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
}

export async function renderNewProject(el) {
  if (!can('project.create')) {
    el.innerHTML = '<div class="empty">Создавать проекты могут коммерческий отдел, директор производства и главный технолог</div>';
    return;
  }
  const refs = state.refs;
  const projects = await api('/projects');
  const nums = projects.map((p) => parseInt(p.code, 10)).filter((n) => !isNaN(n));
  const nextCode = `${(nums.length ? Math.max(...nums) : 0) + 1}Д`;
  const tech = refs.users.find((u) => u.role === 'chief_tech' && u.active);
  const today = state.me.today;

  el.innerHTML = `
    <div class="crumbs"><a href="#/projects">Проекты</a> / Новый проект</div>
    <div class="topbar"><div><h1>Новый проект</h1><div class="sub">Этапы и плановые даты подставятся из типового маршрута — их можно поправить в карточке проекта</div></div></div>
    <form id="f" class="form-grid">
      <div class="panel form-panel">
        <div class="field"><label for="code">Номер заказа *</label><input class="input" id="code" value="${esc(nextCode)}" required></div>
        <div class="field"><label for="client">Клиент</label>
          <select class="input" id="client">
            <option value="">— выбрать —</option>
            ${refs.clients.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}
            <option value="new">+ Новый клиент…</option>
          </select>
          <input class="input" id="client_name" placeholder="Название нового клиента" style="display:none;margin-top:6px">
        </div>
        <div class="field wide"><label for="title">Изделие *</label><input class="input" id="title" placeholder="Например: вырубной штамп" required></div>
        <div class="field"><label for="tpl">Тип маршрута *</label>
          <select class="input" id="tpl" required>
            ${refs.templates.map((t) => `<option value="${t.id}">${esc(t.name)} — ${t.stages.length} этапов</option>`).join('')}
          </select>
        </div>
        <div class="field"><label for="resp">Ответственный</label>
          <select class="input" id="resp">
            <option value="">—</option>
            ${refs.users.filter((u) => u.active).map((u) => `<option value="${u.id}" ${tech && u.id === tech.id ? 'selected' : ''}>${esc(u.name)} (${esc(refs.roles[u.role])})</option>`).join('')}
          </select>
        </div>
        <div class="field"><label for="start">Дата старта *</label><input class="input" type="date" id="start" value="${today}" required></div>
        <div class="field"><label for="due">Срок сдачи клиенту</label><input class="input" type="date" id="due"><small class="faint" id="duehint"></small></div>
        ${can('project.approval') ? `<div class="field"><label for="appr">Согласование с заказчиком</label>
          <select class="input" id="appr">${Object.entries(refs.approval).filter(([k]) => !['done', 'cancelled'].includes(k)).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}</select></div>` : ''}
        <div class="field wide"><label for="notes">Примечание</label><textarea class="input" id="notes" rows="2"></textarea></div>
        <div class="wide savebar"><button class="btn primary" type="submit">${icon('plus', 16)}Создать проект</button><a class="btn ghost" href="#/projects">Отмена</a></div>
      </div>
      <div class="panel form-panel preview">
        <h2>Этапы по маршруту</h2>
        <div id="pvroute"></div>
        <ol id="preview" class="stage-preview"></ol>
      </div>
    </form>`;

  const f = el.querySelector('#f');
  const $ = (id) => el.querySelector('#' + id);
  $('client').onchange = () => { $('client_name').style.display = $('client').value === 'new' ? '' : 'none'; if ($('client').value === 'new') $('client_name').focus(); };

  const preview = () => {
    const tpl = refs.templates.find((t) => t.id === Number($('tpl').value));
    let d = $('start').value || today;
    const rows = (tpl?.stages || []).map((s, i) => {
      d = addDays(d, s.duration_days);
      return `<li><span>${i + 1}. ${esc(s.name)} <span class="faint">· ${s.duration_days} дн.</span></span><span class="faint num">${dfull(d)}</span></li>`;
    });
    $('preview').innerHTML = rows.join('') || '<li class="faint">Нет этапов</li>';
    $('pvroute').innerHTML = tpl?.stages.length ? `<div class="route lg" aria-hidden="true">${tpl.stages.map((s) => `<i style="flex:${Math.max(1, s.duration_days)}" title="${esc(s.name)}"></i>`).join('')}</div>` : '';
    $('duehint').textContent = tpl?.stages.length ? `По маршруту: ${dfull(d)}` : '';
  };
  $('tpl').onchange = preview;
  $('start').onchange = preview;
  preview();

  f.onsubmit = async (ev) => {
    ev.preventDefault();
    const body = {
      code: $('code').value, title: $('title').value, template_id: Number($('tpl').value),
      responsible_id: $('resp').value ? Number($('resp').value) : null,
      start_date: $('start').value, due_date: $('due').value || null, notes: $('notes').value,
      approval_status: $('appr')?.value,
    };
    if ($('client').value === 'new') body.client_name = $('client_name').value;
    else if ($('client').value) body.client_id = Number($('client').value);
    if (projects.some((p) => p.code.toLowerCase() === body.code.trim().toLowerCase()) && !confirm(`Проект с номером ${body.code} уже есть. Всё равно создать?`)) return;
    const btn = f.querySelector('[type=submit]');
    btn.disabled = true;
    try {
      const p = await api('/projects', { method: 'POST', body });
      if (body.client_name) state.refs = await api('/refs');
      toast('Проект создан');
      location.hash = `#/projects/${p.id}`;
    } catch (e) {
      toast(e.message, true);
      btn.disabled = false;
    }
  };
}
