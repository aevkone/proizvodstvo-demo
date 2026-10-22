import { openDb } from './db.js';
import { seed, isEmpty } from './seed.js';
import { createApp } from './app.js';
import { startScheduler } from './notify.js';
import { hashPassword } from './auth.js';
import { today } from './dates.js';

const db = openDb();
if (isEmpty(db)) {
  if (process.env.SEED_DEMO === '1') {
    seed(db);
    console.log('База пуста — загружены демо-данные (пароль demo123). Не используйте их в рабочей системе.');
  } else if (process.env.ADMIN_LOGIN && process.env.ADMIN_PASSWORD) {
    if (process.env.ADMIN_PASSWORD.length < 8) { console.error('ADMIN_PASSWORD — не короче 8 символов'); process.exit(1); }
    db.prepare("INSERT INTO users (login, name, email, role, pass_hash) VALUES (?, ?, ?, 'prod_director', ?)")
      .run(process.env.ADMIN_LOGIN.toLowerCase(), process.env.ADMIN_NAME || 'Администратор', process.env.ADMIN_EMAIL || null, hashPassword(process.env.ADMIN_PASSWORD));
    console.log(`Создан первый пользователь ${process.env.ADMIN_LOGIN} (директор производства). Остальных добавьте в «Справочники → Пользователи».`);
  } else {
    console.error('База пуста. Задайте ADMIN_LOGIN и ADMIN_PASSWORD в .env для первого входа или SEED_DEMO=1 для демо-данных (npm run demo).');
    process.exit(1);
  }
}

const app = createApp(db, { autoNotify: true });
const port = Number(process.env.PORT || 3000);
app.listen(port, () => {
  console.log(`Система контроля производства: http://localhost:${port}`);
  console.log(process.env.SMTP_HOST ? `Почта: SMTP ${process.env.SMTP_HOST}` : 'Почта: SMTP не настроен — письма сохраняются в папку outbox/');
  startScheduler(db, today);
});
