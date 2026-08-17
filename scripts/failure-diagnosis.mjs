// 全量失败原因分布调查：path_generation_runs / llm_execution_attempts / agent_call_logs / virtual_sessions / teaching_sessions
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const db = new DatabaseSync(path.resolve(__dirname, '..', 'backend', 'prisma', 'dev.db'), { readOnly: true });
const q = (s, ...a) => db.prepare(s).all(...a);
const trunc = (s, n = 200) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n) + '…' : t; };

console.log('===== 1. path_generation_runs 失败分布 =====');
const pg = q('SELECT phase, status, errorCode, errorMessage, COUNT(*) c FROM path_generation_runs GROUP BY phase, status, errorCode, errorMessage ORDER BY c DESC LIMIT 25');
for (const r of pg) console.log(`[${r.phase}/${r.status}] ${r.errorCode ?? '-'} × ${r.c} | ${trunc(r.errorMessage, 130)}`);

console.log('\n===== 2. llm_execution_attempts 错误分布（最近 5000 条）=====');
const cols = q('PRAGMA table_info(llm_execution_attempts)').map(c => c.name);
console.log('cols:', cols.join(', '));
try {
  const err = q(`SELECT errorCategory, errorCode, statusCode, COUNT(*) c FROM (SELECT * FROM llm_execution_attempts ORDER BY rowid DESC LIMIT 5000) GROUP BY errorCategory, errorCode, statusCode ORDER BY c DESC LIMIT 20`);
  for (const r of err) console.log(`cat=${r.errorCategory ?? '-'} code=${r.errorCode ?? '-'} http=${r.statusCode ?? '-'} × ${r.c}`);
} catch (e) { console.log('err:', e.message); }

console.log('\n===== 3. agent_call_logs 状态分布 =====');
try {
  const ac = q(`SELECT status, COUNT(*) c FROM agent_call_logs GROUP BY status ORDER BY c DESC`);
  for (const r of ac) console.log(`${r.status} × ${r.c}`);
} catch (e) { console.log('err:', e.message); }

console.log('\n===== 4. virtual_sessions 失败原因（stageResults.logs / termination）=====');
const vs = q('SELECT id, status, currentStage, logs FROM virtual_sessions WHERE status = \'failed\'');
console.log('failed sessions:', vs.length);
for (const v of vs) {
  let logs = [];
  try { logs = JSON.parse(v.logs || '[]'); } catch {}
  const lastErr = [...logs].reverse().find(l => l && (l.error || l.level === 'error' || String(l.message || '').match(/fail|error|超时|失败/i)));
  console.log(`- ${v.id.slice(0, 14)} [${v.currentStage}] ${lastErr ? trunc(JSON.stringify(lastErr), 180) : '(无错误日志)'}`);
}

console.log('\n===== 5. teaching_sessions 失败/timeout 原因线索 =====');
const ts = q(`SELECT status, COUNT(*) c FROM teaching_sessions GROUP BY status`);
for (const r of ts) console.log(`${r.status} × ${r.c}`);
// 检查最近失败/超时会话是否有关键错误信息
const recent = q(`SELECT id, status, topic, updatedAt FROM teaching_sessions WHERE status IN ('timeout','failed') ORDER BY updatedAt DESC LIMIT 8`);
for (const r of recent) console.log(`  - ${r.id.slice(0, 16)} ${r.status} ${trunc(r.topic, 50)}`);

console.log('\n===== 6. goal_conversations 异常（无内容/超短）=====');
const g = q(`SELECT stage, length(messages) L, COUNT(*) c FROM goal_conversations GROUP BY stage, L ORDER BY c DESC LIMIT 15`);
for (const r of g) console.log(`stage=${r.stage} msgsLen=${r.L} × ${r.c}`);

db.close();
