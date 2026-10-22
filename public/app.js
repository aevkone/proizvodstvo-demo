import { state, api, esc, toast } from './lib.js';
import { icon } from './icons.js';
import { renderLogin } from './views/login.js';
import { renderProjects } from './views/projects.js';
import { renderProject } from './views/project.js';
import { renderNewProject } from './views/newproject.js';
import { renderCalcList, renderCalc, renderQuote } from './views/calc.js';
import { renderNotifications } from './views/notifications.js';
import { renderRefs } from './views/refs.js';
import { renderReports } from './views/reports.js';
import { startTour, isTourActive } from './tour.js';

window.startTour = startTour;

const NAV = [
  ['#/projects', 'Проекты', 'board'],
  ['#/calc', 'Калькулятор', 'calc'],
  ['#/reports', 'Отчёты', 'chart'],
  ['#/refs', 'Справочники', 'book'],
  ['#/notifications', 'Уведомления', 'bell'],
];

// [шаблон, загрузчик экрана, заголовок вкладки]
const ROUTES = [
  [/^#\/projects\/(\d+)$/, (m, el) => renderProject(el, Number(m[1])), 'Проект'],
  [/^#\/projects$/, (_m, el) => renderProjects(el), 'Проекты'],
  [/^#\/new$/, (_m, el) => renderNewProject(el), 'Новый проект'],
  [/^#\/calc$/, (_m, el) => renderCalcList(el), 'Калькулятор'],
  [/^#\/notifications$/, (_m, el) => renderNotifications(el), 'Уведомления'],
  [/^#\/refs$/, (_m, el) => renderRefs(el), 'Справочники'],
  [/^#\/reports$/, (_m, el) => renderReports(el), 'Отчёты'],
  [/^#\/calc\/new(?:\?project=(\d+))?$/, (m, el) => renderCalc(el, null, m[1] ? Number(m[1]) : null), 'Новый расчёт'],
  [/^#\/calc\/(\d+)\/quote$/, (m, el) => renderQuote(el, Number(m[1])), 'ТКП'],
  [/^#\/calc\/(\d+)$/, (m, el) => renderCalc(el, Number(m[1])), 'Расчёт'],
];

const app = document.getElementById('app');

async function loadSession() {
  try {
    state.me = await api('/me');
    state.refs = await api('/refs');
  } catch {
    state.me = null;
  }
}

export async function reloadRefs() {
  state.refs = await api('/refs');
}

function isActive(href, hash) {
  return hash.startsWith(href) || (href === '#/projects' && hash === '#/new');
}

function shell() {
  const hash = location.hash || '#/projects';
  const me = state.me;
  app.innerHTML = `
    <a class="skip-link" href="#view" id="skip">К содержимому</a>
    <div class="layout">
      <aside class="side">
        <a class="brand" href="#/projects" aria-label="На доску проектов">
          <span class="brand-mark"><i></i></span>
          <div><b>Контроль производства</b><small>Диспетчерская доска</small></div>
        </a>
        <nav class="nav" aria-label="Разделы">
          ${NAV.map(([href, label, ic]) => `<a href="${href}" class="${isActive(href, hash) ? 'active' : ''}" ${isActive(href, hash) ? 'aria-current="page"' : ''} data-nav="${href.slice(2)}">${icon(ic)}<span class="lbl">${label}</span>${href === '#/projects' ? '<span class="count" id="navcount" hidden></span>' : ''}</a>`).join('')}
        </nav>
        <div class="me">
          <b>${esc(me.name)}</b>
          <span class="role">${esc(me.role_label)}</span>
          <div class="me-actions">
            <button class="linkbtn" id="tourbtn" title="Экскурсия по интерфейсу">${icon('help', 15)}<span class="lbl">Экскурсия</span></button>
            <button class="linkbtn" id="logout" title="Выйти">${icon('logout', 15)}<span class="lbl">Выйти</span></button>
          </div>
          ${window.__demo ? '<div class="demo-note">Демо-стенд: данные вымышленные и хранятся только в вашем браузере.<br><button class="linkbtn" id="demoreset">Сбросить демо-данные</button></div>' : ''}
        </div>
      </aside>
      <main class="main" id="view" tabindex="-1"></main>
    </div>`;
  document.getElementById('logout').onclick = async () => {
    await api('/logout', { method: 'POST' });
    state.me = null;
    location.hash = '#/login';
  };
  document.getElementById('tourbtn').onclick = () => window.startTour?.(true);
  document.getElementById('skip').onclick = (e) => { e.preventDefault(); document.getElementById('view').focus(); };
  document.getElementById('demoreset')?.addEventListener('click', () => {
    if (!confirm('Вернуть демо-данные к исходным? Ваши изменения пропадут.')) return;
    window.__demo.reset();
    location.hash = '#/login';
    location.reload();
  });
  // счётчик просрочек на пункте «Проекты»
  api('/projects').then((ps) => {
    const n = ps.filter((p) => p.in_production && p.status.code === 'overdue').length;
    const el = document.getElementById('navcount');
    if (el && n) { el.textContent = n; el.hidden = false; el.title = `Проектов с просрочкой: ${n}`; }
  }).catch(() => {});
  return document.getElementById('view');
}

let routing = 0;
let lastHash = location.hash;
let reverting = false;
async function route() {
  const hash = location.hash || '#/projects';
  // несохранённые правки этапов: спрашиваем перед уходом со страницы
  if (reverting) { reverting = false; return; }
  if (window.__dirty && hash !== lastHash) {
    if (!confirm('Есть несохранённые изменения этапов. Уйти без сохранения?')) {
      reverting = true;
      location.hash = lastHash;
      return;
    }
    window.__dirty = false;
  }
  lastHash = hash;
  const ticket = ++routing;
  if (!state.me && hash !== '#/login') await loadSession();
  if (!state.me) {
    if (hash !== '#/login') { location.hash = '#/login'; return; }
    document.title = 'Вход — Контроль производства';
    return renderLogin(app, async () => {
      await loadSession();
      location.hash = '#/projects';
    });
  }
  if (hash === '#/login' || hash === '#/' || hash === '') { location.hash = '#/projects'; return; }
  const view = shell();
  for (const [re, fn, title] of ROUTES) {
    const m = hash.match(re);
    if (m) {
      document.title = `${title} — Контроль производства`;
      view.innerHTML = '<div class="loading-grid" aria-busy="true" aria-label="Загрузка"><div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div></div>';
      try {
        await fn(m, view);
      } catch (e) {
        if (ticket !== routing) return;
        view.innerHTML = `<div class="empty"><b>Не получилось открыть раздел</b>${esc(e.message)}<br><br><a class="btn" href="#/projects">К доске проектов</a></div>`;
        if (e.status !== 401) toast(e.message, true);
      }
      if (!isTourActive()) { window.scrollTo(0, 0); setTimeout(() => startTour(false), 400); }
      return;
    }
  }
  view.innerHTML = `<div class="empty"><b>Такой страницы нет</b><a href="#/projects">Вернуться к доске проектов</a></div>`;
}

window.addEventListener('hashchange', route);
route();
