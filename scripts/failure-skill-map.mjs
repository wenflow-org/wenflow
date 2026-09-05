// 确认 UPSTREAM_503 / schema 失败对应到具体 skill
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const db = new DatabaseSync(path.resolve(__dirname, '..', 'backend', 'prisma', 'dev.db'), { readOnly: true });
const q = (s, ...a) => db.prepare(s).all(...a);

console.log('===== UPSTREAM_503 按来源/模型 =====');
const r1 = q(`SELECT sourceEntry, requestedModel, COUNT(*) c FROM llm_execution_attempts
  WHERE errorCode='UPSTREAM_503' GROUP BY sourceEntry, requestedModel ORDER BY c DESC LIMIT 10`);
for (const r of r1) console.log(`src=${r.sourceEntry ?? '-'} model=${r.requestedModel ?? '-'} × ${r.c}`);

console.log('\n===== 业务侧 INVALID_RESPONSE_SCHEMA → 对应 skill（join agent_call_logs）=====');
const r2 = q(`SELECT a.agentId, COUNT(*) c FROM llm_execution_attempts l
  JOIN agent_call_logs a ON a.promptCallId = l.promptCallId
  WHERE l.errorCode='INVALID_RESPONSE_SCHEMA' AND l.sourceEntry != 'system-canary'
  GROUP BY a.agentId ORDER BY c DESC LIMIT 15`);
for (const r of r2) console.log(`${r.agentId} × ${r.c}`);

console.log('\n===== 业务侧失败总体按 skill（非 canary，最近 30 天）=====');
const r3 = q(`SELECT a.agentId, l.errorCode, COUNT(*) c FROM llm_execution_attempts l
  JOIN agent_call_logs a ON a.promptCallId = l.promptCallId
  WHERE l.success = 0 AND l.sourceEntry != 'system-canary'
    AND l.createdAt > (unixepoch('now')*1000 - 30*86400000)
  GROUP BY a.agentId, l.errorCode ORDER BY c DESC LIMIT 20`);
for (const r of r3) console.log(`${r.agentId} | ${r.errorCode} × ${r.c}`);

console.log('\n===== 上游 503 时间分布（最近 7 天按天）=====');
const r4 = q(`SELECT date(createdAt/1000,'unixepoch','localtime') d, COUNT(*) c FROM llm_execution_attempts
  WHERE errorCode='UPSTREAM_503' GROUP BY d ORDER BY d DESC LIMIT 10`);
for (const r of r4) console.log(`${r.d} × ${r.c}`);

db.close();
