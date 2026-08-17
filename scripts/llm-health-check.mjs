// 查最近 goal-conversation / 模拟器 LLM 调用情况
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const db = new DatabaseSync(path.resolve(__dirname, '..', 'backend', 'prisma', 'dev.db'), { readOnly: true });
const q = (s, ...a) => db.prepare(s).all(...a);

console.log('=== 最近 30 分钟 LLM 尝试（按成功/失败）===');
const now = Date.now();
const rows = q(`SELECT success, errorCode, COUNT(*) c FROM llm_execution_attempts WHERE createdAt > ? GROUP BY success, errorCode ORDER BY c DESC`, now - 30 * 60 * 1000);
for (const r of rows) console.log(`success=${r.success} code=${r.errorCode ?? '-'} × ${r.c}`);

console.log('\n=== 最近 agent_call_logs（goal/模拟相关）===');
const calls = q(`SELECT agentId, success, durationMs, errorCode, calledAt FROM agent_call_logs WHERE calledAt > ? ORDER BY calledAt DESC LIMIT 12`, now - 30 * 60 * 1000);
for (const c of calls) console.log(`${new Date(c.calledAt).toISOString().slice(11, 19)} | ${c.agentId} | ok=${c.success} | ${c.durationMs}ms | ${c.errorCode ?? ''}`);

console.log('\n=== 最近 30 分钟失败错误信息样例 ===');
const errs = q(`SELECT errorMessage FROM llm_execution_attempts WHERE success = 0 AND createdAt > ? ORDER BY createdAt DESC LIMIT 5`, now - 30 * 60 * 1000);
for (const e of errs) console.log(String(e.errorMessage || '').slice(0, 200));

db.close();
