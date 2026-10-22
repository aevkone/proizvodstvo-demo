import { openDb } from './db.js';
import { seed, isEmpty } from './seed.js';
import { createApp } from './app.js';
import { startScheduler } from './notify.js';
import { today } from './dates.js';

const db = openDb();
if (isEmpty(db)) {
  seed(db);
  console.log('База пуста — загружены демо-данные (пароль demo123).');
}

const app = createApp(db, { autoNotify: true });
const port = Number(process.env.PORT || 3000);
app.listen(port, () => {
  console.log(`Система контроля производства: http://localhost:${port}`);
  console.log(process.env.SMTP_HOST ? `Почта: SMTP ${process.env.SMTP_HOST}` : 'Почта: SMTP не настроен — письма сохраняются в папку outbox/');
  startScheduler(db, today);
});
