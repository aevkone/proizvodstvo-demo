// Демо-режим для презентации: весь сервер (src/app.js) работает в браузере на SQLite/WebAssembly.
// Данные хранятся в localStorage посетителя, у каждого — своя копия. Кнопка «Сбросить демо» возвращает исходные.
import initSqlJs from 'sql.js/dist/sql-wasm.js';
import { setSqlJs } from './shims/sqlite.js';
import { openDb } from '../src/db.js';
import { seed } from '../src/seed.js';
import { createApp } from '../src/app.js';
import { runNotifications } from '../src/notify.js';
import { today } from '../src/dates.js';

const KEY_DB = 'pz-demo-db-v2';
const KEY_COOKIES = 'pz-demo-cookies';
const KEY_DAY = 'pz-demo-day';

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* приватный режим — работаем в памяти */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
};

const toB64 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000)); return btoa(s); };
const fromB64 = (b) => Uint8Array.from(atob(b), (c) => c.charCodeAt(0));

export async function boot() {
  const SQL = await initSqlJs({ locateFile: (f) => new URL(f, import.meta.url).href });
  // Демо-данные строятся от сегодняшней даты; на новый день — свежие данные, чтобы картинка оставалась живой
  const saved = store.get(KEY_DAY) === today() ? store.get(KEY_DB) : null;
  setSqlJs(SQL, saved ? fromB64(saved) : null);
  const db = openDb(':memory:');
  if (!saved) {
    seed(db);
    await runNotifications(db, today());
    store.set(KEY_DAY, today());
    store.del(KEY_COOKIES);
  }
  const app = createApp(db, { autoNotify: true });
  let cookies = {};
  try { cookies = JSON.parse(store.get(KEY_COOKIES) || '{}'); } catch { cookies = {}; }
  const persist = () => store.set(KEY_DB, toB64(db.export ? db.export() : new Uint8Array()));
  if (!saved) persist();

  return {
    async request(method, path, body) {
      const r = await app.handle({ method, path, body, cookies });
      Object.assign(cookies, r.setCookies);
      for (const k of r.clearCookies) delete cookies[k];
      store.set(KEY_COOKIES, JSON.stringify(cookies));
      if (method !== 'GET') {
        // уведомления после изменений уходят асинхронно — сохраняем чуть позже
        setTimeout(persist, 300);
        persist();
      }
      return r;
    },
    reset() {
      store.del(KEY_DB);
      store.del(KEY_COOKIES);
      store.del(KEY_DAY);
    },
  };
}
