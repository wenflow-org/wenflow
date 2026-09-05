// 最近 60 分钟 LLM 失败分布 + 失败源
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const db = new DatabaseSync(path.resolve(__dirname, '..', 'backend', 'prisma', 'dev.db'), { readOnly: true });
const q = (s, ...a) => db.prepare(s).all(...a);

const now = Date.now();
console.log('=== 最近 60 分钟 LLM 尝试 ===');
const rows = q(`SELECT success, errorCode, errorCategory, COUNT(*) c FROM llm_execution_attempts WHERE createdAt > ? GROUP BY success, errorCode, errorCategory ORDER BY c DESC`, now - 3600 * 1000);
for (const r of rows) console.log(`success=${r.success} code=${r.errorCode ?? '-'} cat=${r.errorCategory ?? '-'} × ${r.c}`);

console.log('\n=== 最近 60 分钟失败消息样例 ===');
const errs = q(`SELECT errorMessage, durationMs, statusCode FROM llm_execution_attempts WHERE success = 0 AND createdAt > ? ORDER BY createdAt DESC LIMIT 6`, now - 3600 * 1000);
for (const e of errs) console.log(`dur=${e.durationMs}ms http=${e.statusCode ?? '-'} | ${String(e.errorMessage || '').slice(0, 140)}`);

console.log('\n=== 最近教学回合调用（agent_call_logs 的 teaching-turn）===');
const calls = q(`SELECT success, durationMs, errorCode, calledAt FROM agent_call_logs WHERE agentId='skill:teaching-turn' AND calledAt > ? ORDER BY calledAt DESC LIMIT 10`, now - 3600 * 1000);
for (const c of calls) console.log(`${new Date(c.calledAt).toISOString().slice(11, 19)} | ok=${c.success} | ${c.durationMs}ms | ${c.errorCode ?? ''}`);
db.close();
