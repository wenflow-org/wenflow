import { DatabaseSync } from 'node:sqlite';
const db = new DatabaseSync('D:/wenflow/wenflow/backend/prisma/dev.db', { readOnly: true });
const q = (s) => db.prepare(s).all();
for (const r of q('SELECT * FROM login_attempts ORDER BY rowid DESC LIMIT 8')) console.log(JSON.stringify(r).slice(0, 220));
db.close();