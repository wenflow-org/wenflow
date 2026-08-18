import { DatabaseSync } from 'node:sqlite';
const db = new DatabaseSync('D:/wenflow/wenflow/backend/prisma/dev.db', { readOnly: true });
const q = (s, ...a) => db.prepare(s).all(...a);
const trunc = (s, n = 160) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n) + '...' : t; };

console.log('===== 1. agent_call_logs 最近失败（含 error/errorCode/errorCategory）=====');
try {
  const rows = q(`SELECT agentId, errorCode, errorCategory, statusCode, attemptCount, maxAttempts, model, COUNT(*) c
    FROM agent_call_logs WHERE success = 0 GROUP BY agentId, errorCode, errorCategory ORDER BY c DESC LIMIT 25`);
  for (const r of rows) console.log(`agent=${r.agentId} code=${r.errorCode ?? '-'} cat=${r.errorCategory ?? '-'} http=${r.statusCode ?? '-'} attempt=${r.attemptCount}/${r.maxAttempts} model=${r.model ?? '-'} x${r.c}`);
} catch (e) { console.log('err:', e.message); }

console.log('\n===== 2. 每个 errorCode 的典型 errorMessage =====');
try {
  const rows = q(`SELECT errorCode, errorMessage, COUNT(*) c FROM (SELECT * FROM agent_call_logs WHERE success=0 ORDER BY rowid DESC LIMIT 3000) GROUP BY errorCode, errorMessage ORDER BY c DESC LIMIT 40`);
  for (const r of rows) console.log(`[${r.errorCode}] (${r.c}) ${trunc(r.errorMessage, 140)}`);
} catch (e) { console.log('err:', e.message); }

console.log('\n===== 3. 虚拟学习者相关 skill 的失败 + 成功占比（最近）=====');
try {
  const rows = q(`SELECT agentId, success, COUNT(*) c FROM agent_call_logs
    WHERE agentId LIKE '%virtual-learner%' OR agentId LIKE '%simulation%' OR agentId LIKE '%teaching%'
    GROUP BY agentId, success ORDER BY agentId, success DESC`);
  for (const r of rows) console.log(`${r.agentId} success=${r.success} x${r.c}`);
} catch (e) { console.log('err:', e.message); }

console.log('\n===== 4. virtual_sessions 状态分布 =====');
for (const r of q('SELECT status, COUNT(*) c FROM virtual_sessions GROUP BY status')) console.log(`${r.status} x${r.c}`);

console.log('\n===== 5. 最近失败 session 的 termination 原因 =====');
const vs = q(`SELECT id, status, currentStage, stageResults FROM virtual_sessions WHERE status IN ('failed','abandoned','timeout') ORDER BY rowid DESC LIMIT 15`);
for (const v of vs) {
  let sr = {}; try { sr = JSON.parse(v.stageResults || '{}'); } catch {}
  const t = sr.termination || {};
  console.log(`- ${v.id.slice(0, 12)} [${v.status}/${v.currentStage}] reason=${t.reason ?? '-'}`);
}

console.log('\n===== 6. 最近 24h 失败按 errorCode 汇总 =====');
for (const r of q(`SELECT errorCode, COUNT(*) c FROM llm_execution_attempts WHERE success=0 AND createdAt > (unixepoch('now')*1000 - 86400000) GROUP BY errorCode ORDER BY c DESC`))
  console.log(`${r.errorCode} x${r.c}`);

db.close();