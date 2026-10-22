import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

export const ROLES = {
  ceo: 'Генеральный директор',
  prod_director: 'Директор производства',
  chief_tech: 'Главный технолог',
  sales_head: 'Начальник коммерческого отдела',
  master: 'Мастер / исполнитель',
};

// Что может каждая роль (раздел 3.4 КП)
const PERMS = {
  ceo: [],
  prod_director: ['project.create', 'project.edit', 'project.approval', 'stage.edit', 'calc.edit', 'refs.edit', 'users.edit', 'notify.run'],
  chief_tech: ['project.create', 'project.edit', 'stage.edit', 'calc.edit', 'refs.edit', 'notify.run'],
  sales_head: ['project.create', 'project.approval', 'calc.edit'],
  // отмечает факт и пишет комментарий только по этапам, где он ответственный (проверка в PUT /stages)
  master: [],
};

export function can(user, perm) {
  return !!user && (PERMS[user.role] || []).includes(perm);
}

export function permsOf(role) {
  return PERMS[role] || [];
}

export function hashPassword(pw) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(pw, salt, 32).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(pw, stored) {
  const [salt, hash] = String(stored).split(':');
  if (!salt || !hash) return false;
  const a = Buffer.from(hash, 'hex');
  const b = scryptSync(pw, salt, 32);
  return a.length === b.length && timingSafeEqual(a, b);
}

const SESSION_TTL = 1000 * 60 * 60 * 24 * 14;

export function createSession(db, userId) {
  const token = randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').run(token, userId, Date.now() + SESSION_TTL);
  return token;
}

export function destroySession(db, token) {
  db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

export function authMiddleware(db) {
  const q = db.prepare(`SELECT u.id, u.login, u.name, u.email, u.role FROM sessions s
    JOIN users u ON u.id = s.user_id WHERE s.token = ? AND s.expires_at > ? AND u.active = 1`);
  return (req, _res, next) => {
    const token = req.cookies?.sid;
    req.user = token ? q.get(token, Date.now()) || null : null;
    next();
  };
}

export function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Нужно войти в систему' });
  next();
}

export function requirePerm(perm) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Нужно войти в систему' });
    if (!can(req.user, perm)) return res.status(403).json({ error: 'Недостаточно прав для этого действия' });
    next();
  };
}
