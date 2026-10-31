/**
 * 回放去重门：拿库里真实的会话消息走一遍 shouldEmitTeachingFigure，
 * 看「当时真发出去的图」里有多少会被新规则拦下——用真数据验证，不靠构造用例。
 */
import sqlite3 from 'sqlite3';
import { shouldEmitTeachingFigure } from '../src/services/ai-teaching/teaching-visual.service';

const db = new sqlite3.Database('prisma/dev.db', sqlite3.OPEN_READONLY);
const sessionId = process.argv[2];
db.all('select payload from teaching_session_messages where sessionId=? order by id', [sessionId], (err, rows: any[]) => {
  if (err) { console.error(err.message); process.exit(1); }
  const messages = rows.map((r) => JSON.parse(r.payload));
  let kept = 0;
  let dropped = 0;
  const before: any[] = [];
  for (const message of messages) {
    const figures = Array.isArray(message.figures) ? message.figures : [];
    for (const figure of figures) {
      const ok = shouldEmitTeachingFigure(before as any, figure);
      const labels = (figure?.spec?.bins || []).map((b: any) => b?.label).join(' / ') || figure?.spec?.left?.head || '';
      console.log(`${ok ? 'KEEP  ' : 'DROP  '} ${figure?.kind} | ${labels}`);
      ok ? (kept += 1) : (dropped += 1);
    }
    before.push(message);
  }
  console.log(`--- kept ${kept} / dropped ${dropped}`);
  db.close();
});
