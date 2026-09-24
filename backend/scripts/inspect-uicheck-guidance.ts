/* 临时排查脚本（走查用，不入库）：核对前端触发的 adaptive-guidance-copy 调用 */
import sqlite3 from 'sqlite3';
import path from 'path';

const db = new sqlite3.Database(path.join(__dirname, '..', 'prisma', 'dev.db'));

db.serialize(() => {
  db.all(
    `SELECT id, agentId, success, errorCode, errorMessage, failureStage, promptAttemptCount, durationMs, model, createdAt
       FROM prompt_call_logs
      WHERE agentId LIKE '%adaptive-guidance%'
      ORDER BY createdAt DESC
      LIMIT 5`,
    (err, res) => {
      if (err) { console.error('ERR', err.message); process.exit(1); }
      for (const r of res as any[]) {
        console.log(`${r.createdAt} success=${r.success} err=${r.errorCode ?? '-'} stage=${r.failureStage ?? '-'} attempts=${r.promptAttemptCount} ${r.durationMs}ms model=${r.model ?? '-'} msg=${String(r.errorMessage ?? '').slice(0, 80)}`);
      }
      console.log('行数:', (res as any[]).length);
    },
  );
});
db.close();
