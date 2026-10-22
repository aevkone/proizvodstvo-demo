// Справочники: клиенты, виды работ и ставки, материалы, маршруты, пользователи
import { requirePerm, hashPassword, ROLES } from './auth.js';
import { tx } from './db.js';

const str = (v) => String(v ?? '').trim();
const nonNeg = (v) => Number.isFinite(Number(v)) && Number(v) >= 0;

// Простые таблицы: [поля, проверка, запрос «где используется»]
const SIMPLE = {
  clients: {
    fields: ['name', 'contact', 'email', 'phone'],
    check: (b) => (!str(b.name) ? 'Укажите название клиента' : null),
    used: 'SELECT (SELECT COUNT(*) FROM projects WHERE client_id = ?) + (SELECT COUNT(*) FROM estimates WHERE client_id = ?) AS n',
    usedMsg: 'Клиент используется в проектах или расчётах',
  },
  work_types: {
    fields: ['name', 'rate'],
    check: (b) => (!str(b.name) ? 'Укажите вид работ' : !nonNeg(b.rate) ? 'Ставка должна быть неотрицательным числом' : null),
  },
  materials: {
    fields: ['name', 'unit', 'price'],
    check: (b) => (!str(b.name) ? 'Укажите материал' : !str(b.unit) ? 'Укажите единицу' : !nonNeg(b.price) ? 'Цена должна быть неотрицательным числом' : null),
  },
};

export function registerRefs(app, db) {
  const edit = requirePerm('refs.edit');

  for (const [table, cfg] of Object.entries(SIMPLE)) {
    const vals = (b) => cfg.fields.map((f) => (['rate', 'price'].includes(f) ? Number(b[f]) : str(b[f]) || null));
    app.post(`/api/${table}`, edit, (req, res) => {
      const err = cfg.check(req.body || {});
      if (err) return res.status(400).json({ error: err });
      const r = db.prepare(`INSERT INTO ${table} (${cfg.fields.join(', ')}) VALUES (${cfg.fields.map(() => '?').join(', ')})`).run(...vals(req.body));
      res.status(201).json(db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(r.lastInsertRowid));
    });
    app.put(`/api/${table}/:id`, edit, (req, res) => {
      const err = cfg.check(req.body || {});
      if (err) return res.status(400).json({ error: err });
      const r = db.prepare(`UPDATE ${table} SET ${cfg.fields.map((f) => `${f} = ?`).join(', ')} WHERE id = ?`).run(...vals(req.body), Number(req.params.id));
      if (!r.changes) return res.status(404).json({ error: 'Запись не найдена' });
      res.json(db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(Number(req.params.id)));
    });
    app.delete(`/api/${table}/:id`, edit, (req, res) => {
      const id = Number(req.params.id);
      if (cfg.used && db.prepare(cfg.used).get(id, id).n > 0) return res.status(409).json({ error: cfg.usedMsg });
      db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(id);
      res.json({ ok: true });
    });
  }

  // --- Маршруты (шаблоны этапов) ---
  const checkStages = (stages) => {
    if (!Array.isArray(stages) || !stages.length) return 'В маршруте должен быть хотя бы один этап';
    for (const s of stages) {
      if (!str(s.name)) return 'У каждого этапа должно быть название';
      if (!(Number.isInteger(Number(s.duration_days)) && Number(s.duration_days) >= 0)) return `Этап «${s.name}»: длительность — целое число дней`;
    }
    return null;
  };
  const saveStages = (id, stages) => {
    db.prepare('DELETE FROM route_template_stages WHERE template_id = ?').run(id);
    const ins = db.prepare('INSERT INTO route_template_stages (template_id, pos, name, duration_days, is_test) VALUES (?, ?, ?, ?, ?)');
    stages.forEach((s, i) => ins.run(id, i + 1, str(s.name), Number(s.duration_days), s.is_test ? 1 : 0));
  };
  const loadTpl = (id) => {
    const t = db.prepare('SELECT * FROM route_templates WHERE id = ?').get(id);
    return t && { ...t, stages: db.prepare('SELECT * FROM route_template_stages WHERE template_id = ? ORDER BY pos').all(id) };
  };

  app.post('/api/templates', edit, (req, res) => {
    const b = req.body || {};
    if (!str(b.name)) return res.status(400).json({ error: 'Укажите название маршрута' });
    const err = checkStages(b.stages);
    if (err) return res.status(400).json({ error: err });
    const id = tx(db, () => {
      const id = Number(db.prepare('INSERT INTO route_templates (name, description) VALUES (?, ?)').run(str(b.name), str(b.description) || null).lastInsertRowid);
      saveStages(id, b.stages);
      return id;
    });
    res.status(201).json(loadTpl(id));
  });

  // Изменение маршрута не меняет уже созданные проекты — у них свои этапы
  app.put('/api/templates/:id', edit, (req, res) => {
    const id = Number(req.params.id);
    const b = req.body || {};
    if (!loadTpl(id)) return res.status(404).json({ error: 'Маршрут не найден' });
    if (!str(b.name)) return res.status(400).json({ error: 'Укажите название маршрута' });
    const err = checkStages(b.stages);
    if (err) return res.status(400).json({ error: err });
    tx(db, () => {
      db.prepare('UPDATE route_templates SET name = ?, description = ? WHERE id = ?').run(str(b.name), str(b.description) || null, id);
      saveStages(id, b.stages);
    });
    res.json(loadTpl(id));
  });

  app.delete('/api/templates/:id', edit, (req, res) => {
    const id = Number(req.params.id);
    if (db.prepare('SELECT COUNT(*) AS n FROM projects WHERE template_id = ?').get(id).n) return res.status(409).json({ error: 'По маршруту уже созданы проекты — удалить нельзя' });
    db.prepare('DELETE FROM route_templates WHERE id = ?').run(id);
    res.json({ ok: true });
  });

  // --- Пользователи ---
  const userEdit = requirePerm('users.edit');
  const pub = (id) => db.prepare('SELECT id, login, name, email, role, active FROM users WHERE id = ?').get(id);

  app.post('/api/users', userEdit, (req, res) => {
    const b = req.body || {};
    const login = str(b.login).toLowerCase();
    if (!login || !str(b.name)) return res.status(400).json({ error: 'Укажите логин и ФИО' });
    if (!ROLES[b.role]) return res.status(400).json({ error: 'Неизвестная роль' });
    if (String(b.password || '').length < 6) return res.status(400).json({ error: 'Пароль — не короче 6 символов' });
    if (db.prepare('SELECT 1 FROM users WHERE login = ?').get(login)) return res.status(409).json({ error: 'Такой логин уже есть' });
    const r = db.prepare('INSERT INTO users (login, name, email, role, pass_hash) VALUES (?, ?, ?, ?, ?)').run(login, str(b.name), str(b.email) || null, b.role, hashPassword(String(b.password)));
    res.status(201).json(pub(r.lastInsertRowid));
  });

  app.put('/api/users/:id', userEdit, (req, res) => {
    const id = Number(req.params.id);
    const u = pub(id);
    if (!u) return res.status(404).json({ error: 'Пользователь не найден' });
    const b = req.body || {};
    if (!str(b.name)) return res.status(400).json({ error: 'Укажите ФИО' });
    if (!ROLES[b.role]) return res.status(400).json({ error: 'Неизвестная роль' });
    const active = b.active === undefined ? u.active : b.active ? 1 : 0;
    if (id === req.user.id && (!active || b.role !== u.role)) return res.status(400).json({ error: 'Нельзя отключить себя или сменить себе роль' });
    if (b.password && String(b.password).length < 6) return res.status(400).json({ error: 'Пароль — не короче 6 символов' });
    db.prepare('UPDATE users SET name = ?, email = ?, role = ?, active = ? WHERE id = ?').run(str(b.name), str(b.email) || null, b.role, active, id);
    if (b.password) {
      db.prepare('UPDATE users SET pass_hash = ? WHERE id = ?').run(hashPassword(String(b.password)), id);
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
    }
    if (!active) db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
    res.json(pub(id));
  });
}
