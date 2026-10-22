// Общие помощники интерфейса

export const state = { me: null, refs: null };

export function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export const isDemo = () => !!window.__demo;

// В демо-сборке (GitHub Pages) сервер работает в браузере — запросы идут в него, а не в сеть
async function send(path, opts) {
  const method = opts.method || 'GET';
  if (window.__demo) {
    const body = opts.body !== undefined ? JSON.parse(JSON.stringify(opts.body)) : undefined;
    const r = await window.__demo.request(method, '/api' + path, body);
    return { status: r.status, ok: r.status < 400, json: async () => r.body, text: async () => String(r.body ?? '') };
  }
  return fetch('/api' + path, {
    method,
    headers: opts.body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
}

export async function apiText(path) {
  const r = await send(path, {});
  return r.ok ? r.text() : '';
}

export async function api(path, opts = {}) {
  const r = await send(path, opts);
  let data = null;
  try { data = await r.json(); } catch { /* пустой ответ */ }
  if (r.status === 401 && path !== '/login') {
    state.me = null;
    location.hash = '#/login';
  }
  if (!r.ok) {
    const e = new Error(data?.error || `Ошибка ${r.status}`);
    e.status = r.status;
    e.details = data?.details;
    throw e;
  }
  return data;
}

let toastTimer;
export function toast(msg, bad = false) {
  const el = document.getElementById('toast');
  // ошибки объявляются экранным диктором сразу (alert), остальное — вежливо (status)
  el.setAttribute('role', bad ? 'alert' : 'status');
  el.textContent = msg;
  el.className = 'show' + (bad ? ' bad' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.className = ''), bad ? 5000 : 2500);
}

export function can(perm) {
  return !!state.me?.perms?.includes(perm);
}

export function dm(s) {
  if (!s) return '—';
  const [, m, d] = s.split('-');
  return `${d}.${m}`;
}

export function dfull(s) {
  if (!s) return '—';
  const [y, m, d] = s.split('-');
  return `${d}.${m}.${y}`;
}

const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
export function dlong(s) {
  const [, m, d] = s.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]}`;
}

export function diffDays(a, b) {
  const p = (s) => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d); };
  return Math.round((p(a) - p(b)) / 86400000);
}

export function plural(n, one, few, many) {
  const m10 = n % 10, m100 = n % 100;
  const w = m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? few : many;
  return `${n} ${w}`;
}

export function money(n) {
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(Math.round((Number(n) || 0) * 100) / 100) + ' ₽';
}

// Такая же логика, как на сервере (src/status.js): отклонение требует комментария
export function needsComment(st, today) {
  if (!st.plan_date) return false;
  if (st.fact_date) return diffDays(st.fact_date, st.plan_date) > 0;
  return diffDays(today, st.plan_date) > 0;
}

export function badge(status) {
  return `<span class="badge ${esc(status.code)}">${esc(status.label)}</span>`;
}

// Полоса маршрута: длина сегмента = длительность этапа (от предыдущей плановой даты)
export function routeStrip(p, today, size = '') {
  let prev = p.start_date || p.stages[0]?.plan_date;
  const curId = p.current_stage?.id;
  const segs = p.stages.map((s) => {
    const dur = Math.max(1, prev ? diffDays(s.plan_date, prev) : 1);
    prev = s.plan_date;
    let cls = '';
    if (s.fact_date) cls = diffDays(s.fact_date, s.plan_date) > 0 ? 'done_late' : 'done';
    else if (diffDays(today, s.plan_date) > 0) cls = 'overdue';
    else if (s.id === curId) cls = 'cur' + (s.status?.code === 'attention' ? ' attention' : '');
    if (s.is_rework) cls += ' rework';
    const state = s.fact_date ? `факт ${dm(s.fact_date)}` : `план ${dm(s.plan_date)}`;
    return `<i class="${cls}" style="flex:${dur}" title="${s.pos}. ${esc(s.name)} — ${state}"></i>`;
  });
  return `<div class="route ${size}" role="img" aria-label="Маршрут: выполнено ${p.status.done} из ${p.status.total} этапов">${segs.join('')}</div>`;
}

export function busy(btn, on) {
  if (!btn) return;
  btn.classList.toggle('is-busy', on);
  btn.disabled = on;
}

export function firstName(full) {
  const parts = String(full || '').split(' ');
  return parts.length >= 2 ? `${parts[0]} ${parts[1]}` : full;
}
