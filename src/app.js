import express from 'express';
import cookieParser from 'cookie-parser';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { authMiddleware, requireAuth, requirePerm, can, permsOf, verifyPassword, createSession, destroySession, ROLES } from './auth.js';
import { today as getToday, isDate } from './dates.js';
import { runNotifications } from './notify.js';
import { registerRefs } from './refs.js';
import { listEstimates, getEstimate, validateEstimate, saveEstimate } from './estimates.js';
import { APPROVAL, createProject, loadProject, listProjects, updateStages, addReworkCycle, deleteProject } from './projects.js';
import { getSetting } from './db.js';

// Настройки ТКП и реквизиты предприятия (справочник «Реквизиты и ТКП»)
export const SETTINGS_KEYS = ['company_name', 'company_address', 'company_inn', 'company_phone', 'company_email', 'company_signer', 'vat_pct', 'quote_valid_days', 'payment_terms'];
const SETTINGS_DEFAULTS = { vat_pct: '22', quote_valid_days: '30', payment_terms: '' };

// Ограничение перебора паролей: 5 неудачных попыток на логин+IP за 15 минут
const FAILS = new Map();
const FAIL_WINDOW = 15 * 60 * 1000;
function tooMany(key) {
  const now = Date.now();
  const list = (FAILS.get(key) || []).filter((t) => now - t < FAIL_WINDOW);
  FAILS.set(key, list);
  return list.length >= 5;
}

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');

export function createApp(db, opts = {}) {
  const app = express();
  const today = opts.today || getToday;
  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());
  app.use(authMiddleware(db));

  // --- Авторизация ---
  app.post('/api/login', (req, res) => {
    const { login, password } = req.body || {};
    const lg = String(login || '').trim().toLowerCase();
    const key = `${lg}|${req.ip || ''}`;
    if (tooMany(key)) return res.status(429).json({ error: 'Слишком много неудачных попыток. Попробуйте через 15 минут.' });
    const u = db.prepare('SELECT * FROM users WHERE login = ? AND active = 1').get(lg);
    if (!u || !verifyPassword(String(password || ''), u.pass_hash)) {
      FAILS.get(key).push(Date.now());
      return res.status(401).json({ error: 'Неверный логин или пароль' });
    }
    FAILS.delete(key);
    const token = createSession(db, u.id);
    const secure = process.env.NODE_ENV === 'production' || String(process.env.APP_URL || '').startsWith('https');
    res.cookie('sid', token, { httpOnly: true, sameSite: 'lax', secure, maxAge: 1000 * 60 * 60 * 24 * 14 });
    res.json({ ok: true });
  });

  app.post('/api/logout', (req, res) => {
    if (req.cookies?.sid) destroySession(db, req.cookies.sid);
    res.clearCookie('sid');
    res.json({ ok: true });
  });

  app.get('/api/me', requireAuth, (req, res) => {
    res.json({ ...req.user, role_label: ROLES[req.user.role], perms: permsOf(req.user.role), today: today(),
      mail_mode: process.env.SMTP_HOST ? 'smtp' : 'outbox', telegram: !!(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID) });
  });

  // --- Справочники (чтение) ---
  app.get('/api/refs', requireAuth, (_req, res) => {
    const templates = db.prepare('SELECT * FROM route_templates ORDER BY id').all();
    const tstages = db.prepare('SELECT * FROM route_template_stages ORDER BY template_id, pos').all();
    res.json({
      roles: ROLES,
      approval: APPROVAL,
      users: db.prepare('SELECT id, login, name, email, role, active FROM users ORDER BY id').all(),
      clients: db.prepare('SELECT * FROM clients ORDER BY name').all(),
      templates: templates.map((t) => ({ ...t, stages: tstages.filter((s) => s.template_id === t.id) })),
      work_types: db.prepare('SELECT * FROM work_types ORDER BY id').all(),
      materials: db.prepare('SELECT * FROM materials ORDER BY id').all(),
      settings: Object.fromEntries(SETTINGS_KEYS.map((k) => [k, getSetting(db, k, SETTINGS_DEFAULTS[k] ?? '')])),
    });
  });

  app.put('/api/settings', requirePerm('refs.edit'), (req, res) => {
    const b = req.body || {};
    if (b.vat_pct !== undefined && !(Number(b.vat_pct) >= 0 && Number(b.vat_pct) <= 50)) return res.status(400).json({ error: 'НДС — число от 0 до 50' });
    if (b.quote_valid_days !== undefined && !(Number.isInteger(Number(b.quote_valid_days)) && Number(b.quote_valid_days) > 0)) return res.status(400).json({ error: 'Срок действия ТКП — целое число дней' });
    const up = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
    for (const k of SETTINGS_KEYS) if (k in b) up.run(k, String(b[k] ?? '').trim());
    res.json(Object.fromEntries(SETTINGS_KEYS.map((k) => [k, getSetting(db, k, SETTINGS_DEFAULTS[k] ?? '')])));
  });

  // --- Проекты ---
  app.get('/api/projects', requireAuth, (_req, res) => {
    res.json(listProjects(db, today()));
  });

  app.get('/api/projects/:id', requireAuth, (req, res) => {
    const p = loadProject(db, Number(req.params.id), today());
    if (!p) return res.status(404).json({ error: 'Проект не найден' });
    res.json(p);
  });

  app.post('/api/projects', requirePerm('project.create'), (req, res) => {
    const b = req.body || {};
    const errs = [];
    if (!String(b.code || '').trim()) errs.push('номер заказа');
    if (!String(b.title || '').trim()) errs.push('изделие');
    if (!b.template_id) errs.push('тип маршрута');
    if (!isDate(b.start_date)) errs.push('дата старта');
    if (b.due_date && !isDate(b.due_date)) errs.push('срок сдачи');
    if (errs.length) return res.status(400).json({ error: 'Заполните: ' + errs.join(', ') });
    let clientId = b.client_id ? Number(b.client_id) : null;
    if (!clientId && String(b.client_name || '').trim()) {
      clientId = Number(db.prepare('INSERT INTO clients (name) VALUES (?)').run(String(b.client_name).trim()).lastInsertRowid);
    }
    const approval = can(req.user, 'project.approval') && APPROVAL[b.approval_status] ? b.approval_status : 'request';
    const id = createProject(db, {
      code: String(b.code).trim(), title: String(b.title).trim(), client_id: clientId, template_id: Number(b.template_id),
      responsible_id: b.responsible_id ? Number(b.responsible_id) : null, approval_status: approval,
      start_date: b.start_date, due_date: b.due_date || null, notes: b.notes || null,
    }, req.user.id);
    res.status(201).json(loadProject(db, id, today()));
  });

  app.patch('/api/projects/:id', requireAuth, (req, res) => {
    const id = Number(req.params.id);
    const p = db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
    if (!p) return res.status(404).json({ error: 'Проект не найден' });
    const b = req.body || {};
    const fields = {};
    if ('approval_status' in b) {
      if (!can(req.user, 'project.approval')) return res.status(403).json({ error: 'Статус согласования меняет коммерческий отдел или директор производства' });
      if (!APPROVAL[b.approval_status]) return res.status(400).json({ error: 'Неизвестный статус согласования' });
      fields.approval_status = b.approval_status;
    }
    const general = ['code', 'title', 'client_id', 'responsible_id', 'due_date', 'notes'].filter((k) => k in b);
    if (general.length) {
      if (!can(req.user, 'project.edit')) return res.status(403).json({ error: 'Недостаточно прав для изменения проекта' });
      if (b.due_date && !isDate(b.due_date)) return res.status(400).json({ error: 'Неверный срок сдачи' });
      for (const k of general) fields[k] = b[k] === '' ? null : b[k];
      if (fields.code !== undefined && !String(fields.code || '').trim()) return res.status(400).json({ error: 'Номер заказа обязателен' });
      if (fields.title !== undefined && !String(fields.title || '').trim()) return res.status(400).json({ error: 'Изделие обязательно' });
    }
    const keys = Object.keys(fields);
    if (keys.length) db.prepare(`UPDATE projects SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...keys.map((k) => fields[k]), id);
    res.json(loadProject(db, id, today()));
  });

  app.delete('/api/projects/:id', requirePerm('users.edit'), (req, res) => {
    try {
      deleteProject(db, Number(req.params.id));
    } catch (e) {
      return res.status(e.status || 500).json({ error: e.message });
    }
    res.json({ ok: true });
  });

  // Сохранение этапов: план/факт/комментарий/ответственный
  app.put('/api/projects/:id/stages', requireAuth, (req, res) => {
    const id = Number(req.params.id);
    const updates = Array.isArray(req.body?.stages) ? req.body.stages : [];
    for (const u of updates) {
      for (const k of ['plan_date', 'fact_date']) if (u[k] && !isDate(u[k])) return res.status(400).json({ error: 'Неверный формат даты' });
    }
    if (!can(req.user, 'stage.edit')) {
      // Ответственный за этап может отмечать факт и комментарий по своим этапам
      const own = db.prepare('SELECT responsible_id FROM project_stages WHERE id = ? AND project_id = ?');
      const allowed = updates.every((u) => own.get(u.id, id)?.responsible_id === req.user.id && u.plan_date === undefined && u.responsible_id === undefined && u.name === undefined);
      if (!allowed) return res.status(403).json({ error: 'Недостаточно прав для изменения этапов' });
    }
    try {
      updateStages(db, id, updates, req.user.id, today());
    } catch (e) {
      return res.status(e.status || 500).json({ error: e.message, details: e.details });
    }
    // переход на следующий этап / новые просрочки — уведомляем сразу, не дожидаясь планировщика
    if (opts.autoNotify) runNotifications(db, today()).catch((e) => console.error('Уведомления:', e));
    res.json(loadProject(db, id, today()));
  });

  app.post('/api/projects/:id/rework', requirePerm('stage.edit'), (req, res) => {
    const id = Number(req.params.id);
    try {
      addReworkCycle(db, id, { result: req.body?.result, userId: req.user.id });
    } catch (e) {
      return res.status(e.status || 400).json({ error: e.message });
    }
    res.json(loadProject(db, id, today()));
  });

  // --- Калькулятор стоимости ---
  app.get('/api/estimates', requireAuth, (_req, res) => res.json(listEstimates(db)));

  app.get('/api/estimates/:id', requireAuth, (req, res) => {
    const e = getEstimate(db, Number(req.params.id));
    if (!e) return res.status(404).json({ error: 'Расчёт не найден' });
    res.json(e);
  });

  app.post('/api/estimates', requirePerm('calc.edit'), (req, res) => {
    const err = validateEstimate(req.body || {});
    if (err) return res.status(400).json({ error: err });
    const id = saveEstimate(db, null, req.body, req.user.id);
    res.status(201).json(getEstimate(db, id));
  });

  app.put('/api/estimates/:id', requirePerm('calc.edit'), (req, res) => {
    const id = Number(req.params.id);
    if (!db.prepare('SELECT 1 FROM estimates WHERE id = ?').get(id)) return res.status(404).json({ error: 'Расчёт не найден' });
    const err = validateEstimate(req.body || {});
    if (err) return res.status(400).json({ error: err });
    saveEstimate(db, id, req.body, req.user.id);
    res.json(getEstimate(db, id));
  });

  app.delete('/api/estimates/:id', requirePerm('calc.edit'), (req, res) => {
    const e = db.prepare('SELECT project_id FROM estimates WHERE id = ?').get(Number(req.params.id));
    if (e?.project_id) return res.status(409).json({ error: 'Расчёт привязан к проекту — его нельзя удалить. Сделайте копию и правьте её.' });
    db.prepare('DELETE FROM estimates WHERE id = ?').run(Number(req.params.id));
    res.json({ ok: true });
  });

  registerRefs(app, db);

  // --- Уведомления ---
  app.get('/api/notifications', requireAuth, (_req, res) => {
    res.json(db.prepare(`SELECT n.id, n.kind, n.project_id, n.stage_id, n.recipient, n.subject, n.channel, n.status, n.error, n.created_at,
      p.code AS project_code FROM notifications_log n LEFT JOIN projects p ON p.id = n.project_id ORDER BY n.id DESC LIMIT 300`).all());
  });

  app.get('/api/notifications/:id/preview', requireAuth, (req, res) => {
    const n = db.prepare('SELECT body_html FROM notifications_log WHERE id = ?').get(Number(req.params.id));
    if (!n?.body_html) return res.status(404).send('Нет письма');
    res.type('html').send(n.body_html);
  });

  app.post('/api/notifications/run', requirePerm('notify.run'), async (_req, res, next) => {
    try {
      res.json({ sent: await runNotifications(db, today()) });
    } catch (e) {
      next(e);
    }
  });

  if (opts.extend) opts.extend(app, { today });

  app.use('/api', (_req, res) => res.status(404).json({ error: 'Не найдено' }));
  app.use(express.static(PUBLIC));
  app.get('*', (_req, res) => res.sendFile(join(PUBLIC, 'index.html')));

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    console.error(err);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  });
  return app;
}
