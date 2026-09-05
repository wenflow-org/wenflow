import { DatabaseSync } from 'node:sqlite';
const db = new DatabaseSync('D:/wenflow/wenflow/backend/prisma/dev.db');
const q = (s, ...a) => db.prepare(s).run(...a);

const sid = '79d55fd6-186f-4fa8-8700-68afa5634359';
const now = Date.now();
q('UPDATE virtual_sessions SET status = ?, updatedAt = ? WHERE id = ?', 'abandoned', now, sid);
console.log('session terminated:', sid);
q('DELETE FROM virtual_experiment_leases WHERE sessionId = ?', sid);
console.log('lease cleaned');

for (const r of db.prepare('SELECT id, status, currentStage FROM virtual_sessions WHERE id = ?').all(sid))
  console.log('verify:', JSON.stringify(r));
db.close();