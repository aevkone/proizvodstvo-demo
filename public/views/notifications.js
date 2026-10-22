import { state, api, apiText, esc, can, toast, isDemo } from '../lib.js';
import { icon } from '../icons.js';

const KIND = {
  overdue: ['Просрочка этапа', 'overdue'],
  project_overdue: ['Просрочка срока сдачи', 'overdue'],
  due_today: ['Срок сегодня', 'attention'],
  transition: ['Переход этапа', 'ok'],
};
const STATUS = { sent: 'Отправлено', outbox: isDemo() ? 'демо' : 'outbox', error: 'Ошибка' };

export async function renderNotifications(el) {
  const list = await api('/notifications');
  const me = state.me;
  el.innerHTML = `
    <div class="topbar">
      <div><h1>Уведомления</h1>
        <div class="sub">Письма о просрочках, сроках «сегодня» и переходах этапов. Получатели — ответственный и руководители (ген. директор, директор производства). Повторно одно и то же не отправляется.</div>
        <div class="muted" style="margin-top:6px">Канал: e-mail ${isDemo() ? '— на демо-стенде письма не отправляются, их можно посмотреть здесь' : me.mail_mode === 'smtp' ? '(SMTP)' : '— SMTP не настроен, письма сохраняются в папку outbox/ на сервере'}${me.telegram ? ' · Telegram-группа' : ''}</div>
      </div>
      ${can('notify.run') ? `<button class="btn primary" id="run">${icon('reset', 16)}Проверить сейчас</button>` : ''}
    </div>
    <div class="calc" style="grid-template-columns:minmax(0,3fr) minmax(320px,2fr)">
      <div style="overflow-x:auto">${list.length ? `
        <table class="tablelist">
          <thead><tr><th>Когда</th><th>Событие</th><th>Проект</th><th>Кому</th><th>Статус</th></tr></thead>
          <tbody>${list.map((n) => `
            <tr class="click" data-id="${n.id}">
              <td class="muted num" style="white-space:nowrap">${esc(fmtTime(n.created_at))}</td>
              <td><span class="badge ${KIND[n.kind]?.[1] || ''}">${esc(KIND[n.kind]?.[0] || n.kind)}</span></td>
              <td>${n.project_code ? `<a href="#/projects/${n.project_id}" onclick="event.stopPropagation()">${esc(n.project_code)}</a>` : '—'}</td>
              <td>${esc(n.recipient)}</td>
              <td class="${n.status === 'error' ? '' : 'muted'}" title="${esc(n.error || '')}">${n.status === 'error' ? '<b style="color:var(--bad)">Ошибка</b>' : esc(STATUS[n.status] || n.status)}</td>
            </tr>`).join('')}</tbody>
        </table>` : '<div class="empty">Уведомлений пока не было</div>'}
      </div>
      <div class="panel" style="padding:0;overflow:hidden;position:sticky;top:20px">
        <div class="muted" style="padding:12px 16px;border-bottom:1px solid var(--line);font-size:13px">Предпросмотр письма — выберите строку слева</div>
        <iframe id="pv" title="Предпросмотр письма" style="width:100%;height:520px;border:0;background:#f6f6f4"></iframe>
      </div>
    </div>`;

  const pv = el.querySelector('#pv');
  const show = async (id) => {
    pv.srcdoc = await apiText(`/notifications/${id}/preview`);
    el.querySelectorAll('tr[data-id]').forEach((tr) => tr.classList.toggle('sel', tr.dataset.id === String(id)));
  };
  el.querySelectorAll('tr[data-id]').forEach((tr) => (tr.onclick = () => show(tr.dataset.id)));
  if (list.length) show(list[0].id);

  el.querySelector('#run')?.addEventListener('click', async (e) => {
    e.target.disabled = true;
    try {
      const r = await api('/notifications/run', { method: 'POST' });
      toast(r.sent ? `Отправлено писем: ${r.sent}` : 'Новых событий нет');
      renderNotifications(el);
    } catch (err) {
      toast(err.message, true);
      e.target.disabled = false;
    }
  });
}

// created_at хранится в UTC (SQLite datetime('now'))
function fmtTime(s) {
  const d = new Date(s.replace(' ', 'T') + 'Z');
  return d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}
