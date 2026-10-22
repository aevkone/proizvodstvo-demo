import { api, busy } from '../lib.js';

const DEMO = [
  ['ceo', 'ген. директор'],
  ['prod', 'дир. производства'],
  ['tech', 'гл. технолог'],
  ['sales', 'коммерческий отдел'],
];

// Иллюстрация доски на экране входа — условные заказы, не данные системы
const SAMPLE = [
  ['2Д', 'Вырубной штамп', 'overdue', 'Просрочка 2 дня', [5, 3, 5, 3, 3, 3, 4], 2],
  ['3Д', 'Пуансон', 'attention', 'Срок сегодня', [3, 4, 3, 3, 1], 3],
  ['1Д', 'Вставка пресс-формы', 'ok', 'В срок', [7, 5, 5, 4, 3, 5, 4, 3], 5],
];

export function renderLogin(el, onDone) {
  el.innerHTML = `
    <div class="login">
      <div class="login-art" aria-hidden="true">
        <div style="display:flex;gap:10px;align-items:center"><span class="brand-mark"><i></i></span><b style="color:#fff">Контроль производства</b></div>
        <div>
          <h2>Где деталь, в сроке ли и когда переход — на одной доске</h2>
          <p>Маршрут каждого заказа с планом и фактом по этапам, обязательный комментарий при отклонении, уведомления на почту и расчёт стоимости для ТКП.</p>
        </div>
        <div class="login-board">
          ${SAMPLE.map(([code, title, st, label, durs, done]) => `
            <div class="card is-${st}">
              <div class="head"><span class="code-tag">${code}</span><span class="badge ${st}">${label}</span></div>
              <div class="title">${title}</div>
              <div class="route">${durs.map((d, i) => `<i class="${i < done ? 'done' : i === done ? (st === 'overdue' ? 'overdue' : st === 'attention' ? 'cur attention' : 'cur') : ''}" style="flex:${d}"></i>`).join('')}</div>
            </div>`).join('')}
        </div>
      </div>
      <div class="login-pane">
        <form id="f" autocomplete="on" novalidate>
          <div>
            <h1>Вход в систему</h1>
            <div class="muted" style="margin-top:6px">Логин и пароль выдаёт директор производства</div>
          </div>
          <div class="field"><label for="login">Логин</label><input class="input" id="login" name="username" autocomplete="username" autocapitalize="none" spellcheck="false" required autofocus></div>
          <div class="field"><label for="password">Пароль</label><input class="input" id="password" name="password" type="password" autocomplete="current-password" required></div>
          <div class="err-text" id="err" role="alert"></div>
          <button class="btn primary" type="submit" style="height:42px">Войти</button>
          <div class="demo">
            Демо-доступ, пароль <b class="mono">demo123</b>. Выберите роль:
            <div class="demo-logins">${DEMO.map(([l, r]) => `<button type="button" data-login="${l}">${l}<span>${r}</span></button>`).join('')}</div>
          </div>
        </form>
      </div>
    </div>`;
  const f = el.querySelector('#f');
  const err = el.querySelector('#err');
  const submit = async () => {
    const btn = f.querySelector('[type=submit]');
    if (!f.login.value.trim() || !f.password.value) { err.textContent = 'Введите логин и пароль'; (f.login.value.trim() ? f.password : f.login).focus(); return; }
    busy(btn, true);
    err.textContent = '';
    try {
      await api('/login', { method: 'POST', body: { login: f.login.value, password: f.password.value } });
      await onDone();
    } catch (e) {
      err.textContent = e.message;
      busy(btn, false);
      f.password.select();
    }
  };
  f.onsubmit = (ev) => { ev.preventDefault(); submit(); };
  el.querySelectorAll('[data-login]').forEach((b) => (b.onclick = () => {
    f.login.value = b.dataset.login;
    f.password.value = 'demo123';
    submit();
  }));
}
