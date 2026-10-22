// Минимальная замена Express для демо-режима: тот же src/app.js выполняется прямо в браузере.

function compile(path) {
  if (path === '*') return { re: /^.*$/, keys: [] };
  const keys = [];
  const re = new RegExp('^' + path.replace(/\/:([a-zA-Z_]+)/g, (_, k) => { keys.push(k); return '/([^/]+)'; }) + '$');
  return { re, keys };
}

export default function express() {
  const stack = [];
  const add = (method, path, fns) => {
    if (typeof path === 'function') { fns = [path, ...fns]; path = null; }
    for (const fn of fns) stack.push({ method, path, prefix: method === 'USE' ? path : null, m: path && method !== 'USE' ? compile(path) : null, fn });
  };
  const app = {
    disable() {},
    use(path, ...fns) { add('USE', path, fns); },
    get(path, ...fns) { add('GET', path, fns); },
    post(path, ...fns) { add('POST', path, fns); },
    put(path, ...fns) { add('PUT', path, fns); },
    patch(path, ...fns) { add('PATCH', path, fns); },
    delete(path, ...fns) { add('DELETE', path, fns); },
    listen() { return { close() {} }; },

    // Выполнить запрос: { method, path, body, cookies } → { status, body, type, cookies }
    handle({ method, path, body, cookies }) {
      return new Promise((resolve) => {
        const out = { status: 200, body: undefined, type: 'json', setCookies: {}, clearCookies: [] };
        let done = false;
        const finish = () => { if (!done) { done = true; resolve(out); } };
        const req = { method, path, url: path, body, cookies: { ...cookies }, params: {} };
        const res = {
          status(s) { out.status = s; return res; },
          json(v) { out.body = v; out.type = 'json'; finish(); return res; },
          send(v) { out.body = v; out.type = out.type === 'json' && typeof v === 'string' ? 'text' : out.type; finish(); return res; },
          type(t) { out.type = t; return res; },
          cookie(k, v) { out.setCookies[k] = v; return res; },
          clearCookie(k) { out.clearCookies.push(k); return res; },
          sendFile() { out.status = 404; out.body = { error: 'Не найдено' }; finish(); },
        };
        let i = 0;
        const next = (err) => {
          if (done) return;
          while (i < stack.length) {
            const l = stack[i++];
            const isErrHandler = l.fn.length === 4;
            if (err ? !isErrHandler : isErrHandler) continue;
            if (l.method === 'USE') {
              if (l.prefix && !(path === l.prefix || path.startsWith(l.prefix + '/'))) continue;
            } else {
              if (l.method !== method) continue;
              const mm = path.match(l.m.re);
              if (!mm) continue;
              req.params = Object.fromEntries(l.m.keys.map((k, j) => [k, decodeURIComponent(mm[j + 1])]));
            }
            try {
              const r = err ? l.fn(err, req, res, next) : l.fn(req, res, next);
              if (r && typeof r.catch === 'function') r.catch(next);
            } catch (e) {
              return next(e);
            }
            return;
          }
          if (err) { console.error(err); out.status = 500; out.body = { error: 'Внутренняя ошибка' }; }
          else { out.status = 404; out.body = { error: 'Не найдено' }; }
          finish();
        };
        next();
      });
    },
  };
  return app;
}

express.json = () => (_req, _res, next) => next();
express.static = () => (_req, _res, next) => next();
