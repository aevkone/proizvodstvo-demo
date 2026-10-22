// Уведомления о просрочках и ключевых событиях.
// Канал по умолчанию — e-mail (SMTP из .env). Без SMTP письма складываются в папку outbox/ (.eml + .html).
// Дополнительно: Telegram-группа, если заданы TELEGRAM_BOT_TOKEN и TELEGRAM_CHAT_ID.
import nodemailer from 'nodemailer';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { diffDays, ru } from './dates.js';
import { plural } from './status.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Собирает события на дату today. Каждое событие отправляется получателю один раз (dedup_key).
export function collectEvents(db, today) {
  const projects = db.prepare(`SELECT p.*, c.name AS client_name FROM projects p LEFT JOIN clients c ON c.id = p.client_id
    WHERE p.approval_status NOT IN ('done','cancelled')`).all();
  const stagesQ = db.prepare(`SELECT s.*, u.name AS responsible_name FROM project_stages s
    LEFT JOIN users u ON u.id = s.responsible_id WHERE s.project_id = ? ORDER BY s.pos`);
  const events = [];
  for (const p of projects) {
    const name = `${p.code}. ${p.client_name || 'Без клиента'} — ${p.title}`;
    const stages = stagesQ.all(p.id);
    stages.forEach((s, i) => {
      if (!s.fact_date) {
        const late = diffDays(today, s.plan_date);
        if (late > 0) {
          events.push({ kind: 'overdue', key: `overdue:${s.id}:${s.plan_date}`, project: p, projectName: name, stage: s, days: late,
            subject: `Просрочка этапа — проект «${name}»`,
            lines: [`Этап «${s.name}» просрочен на ${plural(late, 'день', 'дня', 'дней')} (план ${ru(s.plan_date)}).`] });
        } else if (late === 0) {
          events.push({ kind: 'due_today', key: `due:${s.id}:${s.plan_date}`, project: p, projectName: name, stage: s,
            subject: `Срок этапа сегодня — проект «${name}»`,
            lines: [`Сегодня плановый срок этапа «${s.name}».`] });
        }
      } else if (diffDays(today, s.fact_date) <= 1 && diffDays(today, s.fact_date) >= 0) {
        // Переход на следующий этап — сообщаем ответственному за следующий этап
        const next = stages[i + 1];
        if (next && !next.fact_date) {
          events.push({ kind: 'transition', key: `next:${s.id}:${s.fact_date}`, project: p, projectName: name, stage: next,
            subject: `Переход на следующий этап — проект «${name}»`,
            lines: [`Этап «${s.name}» выполнен ${ru(s.fact_date)}.`, `Следующий этап: «${next.name}», плановый срок ${ru(next.plan_date)}.`] });
        }
      }
    });
    if (p.due_date && diffDays(today, p.due_date) > 0 && stages.some((s) => !s.fact_date)) {
      const late = diffDays(today, p.due_date);
      events.push({ kind: 'project_overdue', key: `pdue:${p.id}:${p.due_date}`, project: p, projectName: name, stage: null,
        subject: `Срок сдачи клиенту просрочен — проект «${name}»`,
        lines: [`Срок сдачи клиенту (${ru(p.due_date)}) просрочен на ${plural(late, 'день', 'дня', 'дней')}.`] });
    }
  }
  return events;
}

// Получатели: ответственный за этап (или проект) + руководители (ген.директор, директор производства)
function recipientsFor(db, ev) {
  const ids = new Set();
  const respId = ev.stage?.responsible_id || ev.project.responsible_id;
  if (respId) ids.add(respId);
  for (const u of db.prepare(`SELECT id FROM users WHERE active = 1 AND role IN ('ceo','prod_director')`).all()) ids.add(u.id);
  const q = db.prepare('SELECT id, name, email FROM users WHERE id = ? AND active = 1');
  return [...ids].map((id) => q.get(id)).filter((u) => u && u.email);
}

export function renderEmail(ev, appUrl) {
  const resp = ev.stage?.responsible_name;
  const comment = ev.stage?.comment;
  const url = `${appUrl.replace(/\/$/, '')}/#/projects/${ev.project.id}`;
  const color = ev.kind === 'overdue' || ev.kind === 'project_overdue' ? '#f6dfe0' : ev.kind === 'due_today' ? '#fbf0cc' : '#e9f2e6';
  const border = ev.kind === 'overdue' || ev.kind === 'project_overdue' ? '#e0a9ac' : ev.kind === 'due_today' ? '#e8cf7c' : '#b9d4ae';
  const textLines = [...ev.lines];
  if (resp) textLines.push(`Ответственный: ${resp}.`);
  if (comment && ev.kind !== 'transition') textLines.push(`Комментарий ответственного: ${comment}`);
  const text = `${textLines.join('\n')}\n\nОткрыть проект: ${url}`;
  const html = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>${esc(ev.subject)}</title></head>
<body style="margin:0;background:#f6f6f4;font-family:Segoe UI,Roboto,Arial,sans-serif;color:#1b1b1a">
<div style="max-width:640px;margin:24px auto;background:#fff;border:1px solid #dcdcd7;border-radius:12px;overflow:hidden">
  <div style="background:#f2f2ef;padding:16px 24px;border-bottom:1px solid #dcdcd7;font-weight:700">Система контроля производства</div>
  <div style="padding:24px">
    <h2 style="font-size:18px;margin:0 0 18px">${esc(ev.subject)}</h2>
    ${textLines.map((l) => `<p style="margin:0 0 12px;color:#45453f;line-height:1.5">${esc(l)}</p>`).join('')}
    <a href="${esc(url)}" style="display:inline-block;margin-top:10px;padding:12px 22px;background:${color};border:1px solid ${border};border-radius:8px;color:#1b1b1a;font-weight:700;text-decoration:none">Открыть проект в системе</a>
  </div>
</div></body></html>`;
  return { text, html };
}

let transport = null;
function getTransport() {
  if (transport) return transport;
  if (process.env.SMTP_HOST) {
    transport = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 465),
      secure: (process.env.SMTP_SECURE || 'true') === 'true',
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
    });
    transport.mode = 'smtp';
  } else {
    transport = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: 'unix' });
    transport.mode = 'outbox';
  }
  return transport;
}

async function sendTelegram(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN, chat = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chat) return;
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: chat, text }),
  });
}

// Проверяет события и рассылает новые. Возвращает число отправленных писем.
export async function runNotifications(db, today, opts = {}) {
  const appUrl = opts.appUrl || process.env.APP_URL || `http://localhost:${process.env.PORT || 3000}`;
  const outbox = opts.outbox || process.env.OUTBOX_DIR || 'outbox';
  const from = process.env.MAIL_FROM || 'Система контроля производства <notifications@example.test>';
  const exists = db.prepare('SELECT 1 FROM notifications_log WHERE dedup_key = ? AND recipient = ?');
  const log = db.prepare(`INSERT INTO notifications_log (dedup_key, kind, project_id, stage_id, recipient, subject, channel, status, error, body_html)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const t = getTransport();
  let sent = 0;
  for (const ev of collectEvents(db, today)) {
    const { text, html } = renderEmail(ev, appUrl);
    const recips = recipientsFor(db, ev).filter((u) => !exists.get(ev.key, u.email));
    if (!recips.length) continue;
    for (const u of recips) {
      let status = 'sent', error = null;
      try {
        const info = await t.sendMail({ from, to: `${u.name} <${u.email}>`, subject: ev.subject, text, html });
        if (t.mode === 'outbox') {
          mkdirSync(outbox, { recursive: true });
          const base = join(outbox, `${today}_${ev.key.replace(/[:]/g, '-')}_${u.email.replace(/[^a-z0-9.@-]/gi, '_')}`);
          writeFileSync(base + '.eml', info.message);
          writeFileSync(base + '.html', html);
          status = 'outbox';
        }
        sent++;
      } catch (e) {
        status = 'error';
        error = String(e.message || e);
      }
      log.run(ev.key, ev.kind, ev.project.id, ev.stage?.id || null, u.email, ev.subject, 'email', status, error, html);
    }
    try {
      await sendTelegram(`${ev.subject}\n${text}`);
    } catch (e) {
      console.error('Telegram:', e.message);
    }
  }
  return sent;
}

export function startScheduler(db, todayFn, minutes = Number(process.env.NOTIFY_INTERVAL_MIN || 15)) {
  const tick = () => runNotifications(db, todayFn()).then((n) => n && console.log(`Уведомления: отправлено ${n}`)).catch((e) => console.error('Уведомления:', e));
  tick();
  return setInterval(tick, minutes * 60 * 1000);
}
