/* 临时排查脚本（走查用，不入库）：核对前端 UI 触发的伴学调用落库载荷 */
import sqlite3 from 'sqlite3';
import path from 'path';

const db = new sqlite3.Database(path.join(__dirname, '..', 'prisma', 'dev.db'));

const rows: any[] = [];
db.serialize(() => {
  db.all(
    `SELECT id, agentId, success, errorCode, promptAttemptCount, llmRequestCount, durationMs, model,
            createdAt, userPayload, normalizedOutput
       FROM prompt_call_logs
      WHERE agentId LIKE '%peer%'
      ORDER BY createdAt DESC
      LIMIT 3`,
    (err, res) => {
      if (err) { console.error('ERR', err.message); process.exit(1); }
      rows.push(...(res as any[]));
    },
  );
});

db.close(() => {
  for (const r of rows) {
    console.log('='.repeat(70));
    console.log(`agentId=${r.agentId} success=${r.success} errorCode=${r.errorCode ?? '-'} attempts=${r.promptAttemptCount} llmCalls=${r.llmRequestCount} ${r.durationMs}ms model=${r.model ?? '-'} at=${r.createdAt}`);
    const p = String(r.userPayload || '');
    console.log('载荷含【本轮认知负荷】:', p.includes('本轮认知负荷'), '| 【本轮情绪】:', p.includes('本轮情绪'));
    const m = p.match(/"loadIndex"[^,}]*/);
    const e = p.match(/"emotionalState"[^,}]*/);
    console.log('  loadIndex 片段:', m ? m[0] : '(未找到)');
    console.log('  emotionalState 片段:', e ? e[0] : '(未找到)');
    try {
      const out = JSON.parse(String(r.normalizedOutput || '{}'));
      console.log('  输出 message 长度:', String(out.message || '').length, '| followUpQuestions:', JSON.stringify(out.followUpQuestions));
    } catch { console.log('  输出解析失败:', String(r.normalizedOutput || '').slice(0, 120)); }
  }
  console.log('='.repeat(70));
  console.log('行数:', rows.length);
});
