// 深挖：虚拟会话 termination / schema 失败分布 / caller abort 来源
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const db = new DatabaseSync(path.resolve(__dirname, '..', 'backend', 'prisma', 'dev.db'), { readOnly: true });
const q = (s, ...a) => db.prepare(s).all(...a);
const trunc = (s, n = 220) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n) + '…' : t; };

console.log('===== A. virtual_sessions stageResults 里的终止/错误 =====');
const vs = q('SELECT id, status, currentStage, stageResults FROM virtual_sessions WHERE status = \'failed\' OR status = \'abandoned\'');
for (const v of vs) {
  let sr = {};
  try { sr = JSON.parse(v.stageResults || '{}'); } catch {}
  const t = sr.termination || {};
  const bb = sr.blackbox || {};
  const lastAction = Array.isArray(bb.publicTrace) && bb.publicTrace.length ? bb.publicTrace[bb.publicTrace.length - 1] : null;
  const errMsg = lastAction?.observation?.lastActionResult?.visibleMessage || lastAction?.observation?.lastActionResult?.error || '';
  console.log(`- ${v.id.slice(0, 14)} [${v.status}/${v.currentStage}] termination=${trunc(JSON.stringify(t), 120)}`);
  if (errMsg) console.log(`    lastError: ${trunc(errMsg, 200)}`);
}

console.log('\n===== B. INVALID_RESPONSE_SCHEMA 分布（按模型/来源）=====');
const schema = q(`SELECT requestedModel, sourceEntry, promptCallId IS NOT NULL AS hasPrompt, COUNT(*) c
  FROM llm_execution_attempts WHERE errorCode = 'INVALID_RESPONSE_SCHEMA'
  GROUP BY requestedModel, sourceEntry, hasPrompt ORDER BY c DESC LIMIT 12`);
for (const r of schema) console.log(`model=${r.requestedModel ?? '-'} src=${r.sourceEntry ?? '-'} hasPrompt=${r.hasPrompt} × ${r.c}`);

console.log('\n===== C. CALLER_ABORTED 分布（按模型/来源）=====');
const abort = q(`SELECT requestedModel, sourceEntry, COUNT(*) c FROM llm_execution_attempts
  WHERE errorCode = 'CALLER_ABORTED' GROUP BY requestedModel, sourceEntry ORDER BY c DESC LIMIT 12`);
for (const r of abort) console.log(`model=${r.requestedModel ?? '-'} src=${r.sourceEntry ?? '-'} × ${r.c}`);

console.log('\n===== D. RATE_LIMITED / QUOTA / AUTH 分布 =====');
const misc = q(`SELECT errorCode, statusCode, COUNT(*) c FROM llm_execution_attempts
  WHERE errorCode IN ('RATE_LIMITED','QUOTA_EXHAUSTED','AUTH_INVALID') GROUP BY errorCode, statusCode ORDER BY c DESC`);
for (const r of misc) console.log(`${r.errorCode} http=${r.statusCode} × ${r.c}`);

console.log('\n===== E. agent_call_logs 列与最近失败 =====');
const acCols = q('PRAGMA table_info(agent_call_logs)').map(c => c.name);
console.log('cols:', acCols.join(', '));
try {
  const rows = q(`SELECT * FROM agent_call_logs WHERE success = 0 ORDER BY rowid DESC LIMIT 10`);
  for (const r of rows) console.log(trunc(JSON.stringify(r), 250));
} catch (e) { console.log('query err:', e.message); }

console.log('\n===== F. 最近 24h 的失败时间线（llm_execution_attempts）=====');
const recent = q(`SELECT datetime(createdAt/1000, 'unixepoch', 'localtime') t, errorCode, COUNT(*) c
  FROM llm_execution_attempts WHERE success = 0 AND createdAt > (unixepoch('now')*1000 - 86400000)
  GROUP BY t, errorCode ORDER BY t DESC LIMIT 30`);
for (const r of recent) console.log(`${r.t} ${r.errorCode} × ${r.c}`);

db.close();
