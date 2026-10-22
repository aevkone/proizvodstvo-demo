// Резервная копия базы без остановки сервера: npm run backup → backups/app-YYYYMMDD-HHMM.db
import { mkdirSync } from 'node:fs';
import { openDb } from './db.js';

const d = new Date();
const p2 = (n) => String(n).padStart(2, '0');
const name = `backups/app-${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}.db`;
mkdirSync('backups', { recursive: true });
const db = openDb(process.env.DB_FILE || 'data/app.db');
db.exec(`VACUUM INTO '${name}'`);
console.log('Резервная копия:', name);
