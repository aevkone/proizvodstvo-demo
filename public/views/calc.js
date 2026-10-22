import { state, api, esc, can, toast, money, dfull, diffDays } from '../lib.js';
import { icon } from '../icons.js';

const r2 = (n) => Math.round(n * 100) / 100;

// Та же формула, что на сервере (src/estimates.js)
function totals(lines, markupPct, vatPct) {
  const sum = (k) => r2(lines.filter((l) => l.kind === k).reduce((a, l) => a + (Number(l.qty) || 0) * (Number(l.price) || 0), 0));
  const materials = sum('material'), labor = sum('labor'), other = sum('other');
  const hours = r2(lines.filter((l) => l.kind === 'labor').reduce((a, l) => a + (Number(l.qty) || 0), 0));
  const cost = r2(materials + labor + other);
  const markup = r2((cost * (Number(markupPct) || 0)) / 100);
  const net = r2(cost + markup);
  const vat = r2((net * (Number(vatPct) || 0)) / 100);
  return { materials, labor, other, hours, cost, markup, net, vat, total: r2(net + vat) };
}

export async function renderCalcList(el) {
  const list = await api('/estimates');
  el.innerHTML = `
    <div class="topbar">
      <div><h1>Калькулятор стоимости</h1><div class="sub">Материалы и комплектующие + нормо-часы × стоимость нормо-часа. Расценки — в справочниках, тестовый режим</div></div>
      ${can('calc.edit') ? `<a class="btn primary" href="#/calc/new">${icon('plus', 16)}Новый расчёт</a>` : ''}
    </div>
    ${list.length ? `
    <table class="tablelist">
      <thead><tr><th>№</th><th>Расчёт</th><th>Клиент</th><th>Проект</th><th class="num">Нормо-часы</th><th class="num">Итого с НДС</th><th>Дата</th></tr></thead>
      <tbody>${list.map((e) => `
        <tr class="click" data-id="${e.id}">
          <td class="num">${e.id}</td><td><b>${esc(e.title)}</b></td><td>${esc(e.client_name || '—')}</td>
          <td>${e.project_code ? esc(e.project_code) : '—'}</td><td class="num">${e.totals.hours}</td>
          <td class="num"><b>${money(e.totals.total)}</b></td><td class="muted">${dfull(e.created_at.slice(0, 10))}</td>
        </tr>`).join('')}</tbody>
    </table>` : '<div class="empty">Расчётов пока нет</div>'}`;
  el.querySelectorAll('tr[data-id]').forEach((tr) => (tr.onclick = () => (location.hash = `#/calc/${tr.dataset.id}`)));
}

export async function renderCalc(el, id, projectId) {
  const refs = state.refs;
  const projects = await api('/projects');
  let e;
  if (id) e = await api(`/estimates/${id}`);
  else {
    const p = projects.find((x) => x.id === projectId);
    e = {
      title: p ? `${p.title} — ${p.client_name || ''}`.replace(/ — $/, '') : '',
      client_id: p?.client_id || null, project_id: p?.id || null, markup_pct: 20, vat_pct: Number(refs.settings?.vat_pct ?? 22), notes: '',
      lines: [
        { kind: 'material', name: '', unit: 'кг', qty: 0, price: 0 },
        { kind: 'labor', name: '', unit: 'н/ч', qty: 0, price: 0 },
      ],
    };
  }
  const ro = !can('calc.edit');
  const lines = e.lines.map((l) => ({ ...l }));
  // свежий контейнер, чтобы обработчики не копились при перерисовке
  const host = el;
  el = document.createElement('div');
  host.replaceChildren(el);
  const dis = ro ? 'disabled' : '';

  el.innerHTML = `
    <div class="crumbs"><a href="#/calc">Калькулятор</a> / ${id ? `Расчёт №${id}` : 'Новый расчёт'}</div>
    <div class="topbar"><div><h1>${id ? esc(e.title) : 'Новый расчёт'}</h1>
      ${e.project_code ? `<div class="muted">Проект: <a href="#/projects/${e.project_id}">${esc(e.project_code)}. ${esc(e.project_title)}</a></div>` : ''}</div></div>
    <div class="calc">
      <div>
        <div class="panel edit-panel">
          <div class="field" style="grid-column:span 2"><label for="title">Название расчёта *</label><input class="input" id="title" value="${esc(e.title)}" ${dis}></div>
          <div class="field"><label for="client">Клиент</label><select class="input" id="client" ${dis}><option value="">—</option>${refs.clients.map((c) => `<option value="${c.id}" ${c.id === e.client_id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></div>
          <div class="field"><label for="project">Проект</label><select class="input" id="project" ${dis}><option value="">— без проекта —</option>${projects.map((p) => `<option value="${p.id}" ${p.id === e.project_id ? 'selected' : ''}>${esc(p.code)}. ${esc(p.title)}</option>`).join('')}</select></div>
        </div>
        <div class="panel section"><h2>Материалы и комплектующие <small id="s-material"></small></h2>
          <table class="lines"><thead><tr><th>Наименование</th><th style="width:64px">Ед.</th><th style="width:84px">Кол-во</th><th style="width:100px">Цена, ₽</th><th style="width:108px;text-align:right">Сумма</th><th style="width:30px"></th></tr></thead><tbody data-kind="material"></tbody></table>
          ${ro ? '' : '<button class="btn small ghost" data-add="material">+ Материал</button>'}
        </div>
        <div class="panel section"><h2>Работы (нормо-часы) <small id="s-labor"></small></h2>
          <table class="lines"><thead><tr><th>Вид работ</th><th style="width:64px">Ед.</th><th style="width:84px">Нормо-часы</th><th style="width:100px">Ставка, ₽/ч</th><th style="width:108px;text-align:right">Сумма</th><th style="width:30px"></th></tr></thead><tbody data-kind="labor"></tbody></table>
          ${ro ? '' : '<button class="btn small ghost" data-add="labor">+ Вид работ</button>'}
        </div>
        <div class="panel section"><h2>Прочие расходы <small id="s-other"></small></h2>
          <table class="lines"><thead><tr><th>Наименование</th><th style="width:64px">Ед.</th><th style="width:84px">Кол-во</th><th style="width:100px">Цена, ₽</th><th style="width:108px;text-align:right">Сумма</th><th style="width:30px"></th></tr></thead><tbody data-kind="other"></tbody></table>
          ${ro ? '' : '<button class="btn small ghost" data-add="other">+ Расход</button>'}
        </div>
        <div class="field"><label for="notes">Примечание (попадёт в ТКП)</label><textarea class="input" id="notes" rows="2" ${dis}>${esc(e.notes || '')}</textarea></div>
      </div>
      <div class="panel totals" id="totals"></div>
    </div>
    <datalist id="mats">${refs.materials.map((m) => `<option value="${esc(m.name)}">`).join('')}</datalist>`;

  const $ = (s) => el.querySelector(s);

  const lineRow = (l, i) => {
    const sum = (Number(l.qty) || 0) * (Number(l.price) || 0);
    const nameCell = l.kind === 'labor'
      ? `<select data-i="${i}" data-k="name" aria-label="Вид работ, строка ${i + 1}" ${dis}><option value="">— выбрать —</option>${refs.work_types.map((w) => `<option ${w.name === l.name ? 'selected' : ''}>${esc(w.name)}</option>`).join('')}${l.name && !refs.work_types.some((w) => w.name === l.name) ? `<option selected>${esc(l.name)}</option>` : ''}</select>`
      : `<input data-i="${i}" data-k="name" aria-label="Наименование, ${l.kind === 'material' ? 'материал' : l.kind === 'labor' ? 'вид работ' : 'расход'} ${i + 1}" value="${esc(l.name)}" ${l.kind === 'material' ? 'list="mats"' : ''} placeholder="Наименование" ${dis}>`;
    return `<tr>
      <td>${nameCell}</td>
      <td><input data-i="${i}" data-k="unit" aria-label="Единица, ${l.kind === 'material' ? 'материал' : l.kind === 'labor' ? 'вид работ' : 'расход'} ${i + 1}" value="${esc(l.unit || '')}" ${dis}></td>
      <td><input data-i="${i}" data-k="qty" aria-label="${l.kind === 'labor' ? 'Нормо-часы' : 'Количество'}, ${l.kind === 'material' ? 'материал' : l.kind === 'labor' ? 'вид работ' : 'расход'} ${i + 1}" type="number" min="0" step="any" value="${l.qty}" ${dis}></td>
      <td><input data-i="${i}" data-k="price" aria-label="${l.kind === 'labor' ? 'Ставка, ₽ за час' : 'Цена, ₽'}, ${l.kind === 'material' ? 'материал' : l.kind === 'labor' ? 'вид работ' : 'расход'} ${i + 1}" type="number" min="0" step="any" value="${l.price}" ${dis}></td>
      <td class="sum" data-sum="${i}">${money(sum)}</td>
      <td>${ro ? '' : `<button class="x" data-del="${i}" title="Удалить строку" aria-label="Удалить строку">${icon('x', 16)}</button>`}</td>
    </tr>`;
  };

  const drawLines = () => {
    for (const kind of ['material', 'labor', 'other']) {
      const rows = lines.map((l, i) => (l.kind === kind ? lineRow(l, i) : '')).join('');
      $(`tbody[data-kind=${kind}]`).innerHTML = rows || `<tr><td colspan="6" class="faint">Нет строк</td></tr>`;
    }
    drawTotals();
  };

  let markup = e.markup_pct, vat = e.vat_pct;
  const drawTotals = () => {
    const t = totals(lines, markup, vat);
    $('#s-material').textContent = money(t.materials);
    $('#s-labor').textContent = `${t.hours} н/ч · ${money(t.labor)}`;
    $('#s-other').textContent = money(t.other);
    lines.forEach((l, i) => { const c = el.querySelector(`[data-sum="${i}"]`); if (c) c.textContent = money((Number(l.qty) || 0) * (Number(l.price) || 0)); });
    $('#totals').innerHTML = `
      <h2>Итог</h2>
      <div class="tl"><span>Материалы</span><span>${money(t.materials)}</span></div>
      <div class="tl"><span>Работы, ${t.hours} н/ч</span><span>${money(t.labor)}</span></div>
      <div class="tl"><span>Прочее</span><span>${money(t.other)}</span></div>
      <div class="tl sep"><b>Себестоимость</b><b>${money(t.cost)}</b></div>
      <div class="tl"><span><label for="markup">Наценка, %</label> <input id="markup" type="number" min="0" step="any" value="${markup}" ${dis}></span><span>${money(t.markup)}</span></div>
      <div class="tl"><span>Цена без НДС</span><span>${money(t.net)}</span></div>
      <div class="tl"><span><label for="vat">НДС, %</label> <input id="vat" type="number" min="0" step="any" value="${vat}" ${dis}></span><span>${money(t.vat)}</span></div>
      <div class="tl big"><span>Цена для клиента</span><span>${money(t.total)}</span></div>
      <div style="display:flex;flex-direction:column;gap:8px;margin-top:16px" class="no-print">
        ${ro ? '' : `<button class="btn primary" id="save">${icon('check', 16)}Сохранить расчёт</button>`}
        ${id ? `<a class="btn" href="#/calc/${id}/quote">${icon('file', 16)}ТКП для клиента</a>` : ''}
        ${id && !ro ? `<button class="btn ghost" id="copy">${icon('copy', 16)}Копировать в новый</button>${e.project_id ? '' : `<button class="linkbtn" id="del" style="align-self:flex-start;margin-top:4px">${icon('trash', 14)}Удалить расчёт</button>`}` : ''}
      </div>`;
    bindTotals();
  };

  const bindTotals = () => {
    const mk = $('#markup'), vt = $('#vat');
    // пересчёт сразу при вводе, фокус остаётся в поле
    const live = (inp, set) => { inp.oninput = () => { set(Number(inp.value) || 0); const pos = inp.selectionStart; drawTotals(); const n = $(`#${inp.id}`); n.focus(); try { n.setSelectionRange(pos, pos); } catch { /* number input */ } }; };
    live(mk, (v) => { markup = v; });
    live(vt, (v) => { vat = v; });
    $('#save')?.addEventListener('click', save);
    $('#del')?.addEventListener('click', async () => {
      if (!confirm('Удалить расчёт без возможности восстановления?')) return;
      await api(`/estimates/${id}`, { method: 'DELETE' });
      toast('Расчёт удалён');
      location.hash = '#/calc';
    });
    $('#copy')?.addEventListener('click', async () => {
      // копия — новый вариант без привязки к проекту, чтобы не путать с действующим расчётом
      const ne = await api('/estimates', { method: 'POST', body: { ...collect(), project_id: null, title: collect().title + ' (копия)' } });
      toast('Создана копия');
      location.hash = `#/calc/${ne.id}`;
    });
  };

  const collect = () => ({
    title: $('#title').value,
    client_id: $('#client').value ? Number($('#client').value) : null,
    project_id: $('#project').value ? Number($('#project').value) : null,
    markup_pct: markup, vat_pct: vat, notes: $('#notes').value,
    lines: lines.filter((l) => String(l.name).trim() || Number(l.qty) || Number(l.price)),
  });

  const save = async () => {
    const body = collect();
    if (!body.title.trim()) { toast('Укажите название расчёта', true); $('#title').focus(); return; }
    if (body.lines.some((l) => !String(l.name).trim())) { toast('У каждой строки должно быть наименование', true); return; }
    try {
      const saved = await api(id ? `/estimates/${id}` : '/estimates', { method: id ? 'PUT' : 'POST', body });
      toast('Расчёт сохранён');
      if (!id) location.hash = `#/calc/${saved.id}`;
      else renderCalc(host, id);
    } catch (err) {
      toast(err.message, true);
    }
  };

  el.addEventListener('input', (ev) => {
    const t = ev.target;
    if (t.dataset.i === undefined) return;
    const l = lines[Number(t.dataset.i)];
    l[t.dataset.k] = t.type === 'number' ? t.value : t.value;
    if (t.dataset.k === 'qty' || t.dataset.k === 'price') drawTotals();
  });
  el.addEventListener('change', (ev) => {
    const t = ev.target;
    if (t.dataset.i !== undefined && t.dataset.k === 'name') {
      const l = lines[Number(t.dataset.i)];
      l.name = t.value;
      // подставляем цену и единицу из справочника
      const w = l.kind === 'labor' && refs.work_types.find((x) => x.name === t.value);
      const m = l.kind === 'material' && refs.materials.find((x) => x.name === t.value);
      if (w) { l.price = w.rate; l.unit = 'н/ч'; drawLines(); }
      if (m) { l.price = m.price; l.unit = m.unit; drawLines(); }
    }
    if (t.id === 'project' && t.value) {
      const p = projects.find((x) => x.id === Number(t.value));
      if (p?.client_id && !$('#client').value) $('#client').value = p.client_id;
      if (p && !$('#title').value.trim()) $('#title').value = `${p.title} — ${p.client_name || ''}`;
    }
  });
  el.addEventListener('click', (ev) => {
    const add = ev.target.closest('[data-add]');
    if (add) {
      const kind = add.dataset.add;
      lines.push({ kind, name: '', unit: kind === 'labor' ? 'н/ч' : kind === 'material' ? 'кг' : 'шт', qty: kind === 'other' ? 1 : 0, price: 0 });
      drawLines();
      const rows = el.querySelectorAll(`tbody[data-kind=${kind}] [data-k=name]`);
      rows[rows.length - 1]?.focus();
    }
    const del = ev.target.closest('[data-del]');
    if (del) { lines.splice(Number(del.dataset.del), 1); drawLines(); }
  });

  drawLines();
}

export async function renderQuote(el, id) {
  const e = await api(`/estimates/${id}`);
  const co = state.refs.settings || {};
  // дата ТКП — дата последнего сохранения расчёта, а не «сегодня»: повторная печать даёт тот же документ
  const qdate = (e.updated_at || e.created_at).slice(0, 10);
  const qnum = `ТКП-${id}-${qdate.replaceAll('-', '')}`;
  const vd = new Date(qdate + 'T00:00:00Z');
  vd.setUTCDate(vd.getUTCDate() + Number(co.quote_valid_days || 30));
  const validTo = vd.toISOString().slice(0, 10);
  const t = e.totals;
  const k = t.cost ? t.net / t.cost : 1; // наценка распределяется пропорционально
  let project = null;
  if (e.project_id) { try { project = await api(`/projects/${e.project_id}`); } catch { /* нет доступа */ } }
  const labor = e.lines.filter((l) => l.kind === 'labor');
  const mats = e.lines.filter((l) => l.kind === 'material');
  const other = e.lines.filter((l) => l.kind === 'other');
  const term = project?.start_date && project?.due_date ? `${diffDays(project.due_date, project.start_date)} календарных дней с даты согласования` : 'по согласованию';
  const row = (name, q, s) => `<tr><td>${esc(name)}</td><td class="r">${q}</td><td class="r">${money(s * k)}</td></tr>`;
  el.innerHTML = `
    <div class="crumbs no-print"><a href="#/calc">Калькулятор</a> / <a href="#/calc/${id}">Расчёт №${id}</a> / ТКП</div>
    <div class="topbar no-print"><div class="muted">Предпросмотр технико-коммерческого предложения. Внутренние нормо-часы и себестоимость в документ не попадают, наценка распределена по позициям.</div>
      <button class="btn primary" onclick="window.print()">${icon('printer', 16)}Печать / PDF</button></div>
    ${co.company_name ? '' : `<div class="empty no-print" style="margin-bottom:14px;text-align:left"><b>Заполните реквизиты предприятия</b>Шапка ТКП берётся из «Справочники → Реквизиты и ТКП». ${can('refs.edit') ? '<a href="#/refs">Открыть справочник</a>' : 'Попросите директора производства или главного технолога.'}</div>`}
    <div class="doc">
      <div class="head"><div>${co.company_name ? `<b style="color:var(--ink)">${esc(co.company_name)}</b>` : ''}${[co.company_address, co.company_inn, [co.company_phone, co.company_email].filter(Boolean).join(' · ')].filter(Boolean).map((x) => `<br>${esc(x)}`).join('')}</div><div style="text-align:right">№ ${qnum}<br>от ${dfull(qdate)}</div></div>
      <h1>Технико-коммерческое предложение</h1>
      <div class="muted" style="margin-bottom:18px">${e.client_name ? `для ${esc(e.client_name)}` : ''}</div>
      <p><b>Предмет:</b> ${esc(e.title)}</p>
      <table>
        <thead><tr><th>Позиция</th><th class="r">Объём</th><th class="r">Стоимость без НДС</th></tr></thead>
        <tbody>
          ${mats.length ? row('Материалы и комплектующие', `${mats.length} поз.`, t.materials) : ''}
          ${labor.map((l) => row(l.name, '', l.qty * l.price)).join('')}
          ${other.map((l) => row(l.name, `${l.qty} ${esc(l.unit || '')}`, l.qty * l.price)).join('')}
          <tr class="tot"><td colspan="2">Итого без НДС</td><td class="r">${money(t.net)}</td></tr>
          <tr><td colspan="2">НДС ${e.vat_pct}%</td><td class="r">${money(t.vat)}</td></tr>
          <tr class="tot"><td colspan="2">Итого с НДС</td><td class="r">${money(t.total)}</td></tr>
        </tbody>
      </table>
      <p><b>Срок изготовления:</b> ${term}.</p>
      ${co.payment_terms ? `<p><b>Условия оплаты:</b> ${esc(co.payment_terms)}</p>` : ''}
      <p><b>Предложение действительно до:</b> ${dfull(validTo)}.</p>
      ${e.notes ? `<p>${esc(e.notes)}</p>` : ''}
      <p class="muted" style="margin-top:40px">${esc(co.company_signer || e.author_name || state.me.name)}</p>
    </div>`;
}
