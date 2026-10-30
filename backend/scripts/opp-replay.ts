/** 回放：拿库里真实消息跑一遍 buildVisualOpportunity，确认本轮会不会给配图时机。 */
import sqlite3 from 'sqlite3';
import { buildVisualOpportunity } from '../src/services/ai-teaching/teaching-visual.service';

const db = new sqlite3.Database('prisma/dev.db', sqlite3.OPEN_READONLY);
const sid = process.argv[2];
const taskHint = process.argv[3] || null;
db.all('select payload from teaching_session_messages where sessionId=? order by id', [sid], (err, rows: any[]) => {
  if (err) { console.error(err.message); process.exit(1); }
  const messages = rows.map((r) => JSON.parse(r.payload));
  for (let n = 1; n <= messages.length; n += 1) {
    const slice = messages.slice(0, n);
    const opp = buildVisualOpportunity(slice as any, taskHint);
    const last = slice[slice.length - 1];
    const figs = (last.figures || []).length;
    console.log(`${String(n).padStart(2)} ${last.role.padEnd(9)} figs=${figs} -> ${opp ? opp.reason : 'null'}`);
  }
  db.close();
});
