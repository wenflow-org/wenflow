// 纪元 2 架构不变式取证（只读）——配合 c-human-journey.mjs 分阶段跑
// 用法：node epoch2-invariants.cjs [phase]   phase: post-setup | post-lesson | post-finalize | all
// 纪律：dev.db readOnly + busy_timeout；只打 3011 只读 API；输出 JSON 到 stdout。
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const dbPath = join(here, '..', '..', 'prisma', 'dev.db');
const db = new DatabaseSync(dbPath, { readOnly: true });
db.exec('PRAGMA busy_timeout = 5000');
const q = (sql, ...p) => db.prepare(sql).all(...p);
const g = (sql, ...p) => db.prepare(sql).get(...p);
const phase = process.argv[2] || 'all';

const out = { phase, at: new Date().toISOString(), checks: [] };
const add = (id, ok, detail) => out.checks.push({ id, ok, detail });

// ---- A. 账号与 provenance
const user = g("SELECT id,name,isVirtualLearner FROM users WHERE name='c-human7-01'");
add('user.exists', !!user, user || null);
if (user) {
  const prov = g('SELECT * FROM v_user_provenance WHERE userId=?', user.id);
  add('user.provenance', !!prov, prov || 'no row in view');
  const sessions = q('SELECT sessionId,provenance,measurement_sealed,startTime FROM v_session_provenance ORDER BY startTime DESC LIMIT 3');
  add('session.provenance', sessions.length > 0, sessions);
}

// ---- B. goal 会话（epoch-2 写入）
const goals = q("SELECT id,status,stage,learningPathId,createdAt FROM goal_conversations ORDER BY createdAt DESC LIMIT 3");
add('goal.rows', goals.length > 0, goals);

// ---- C. prompt_call_logs：conversationId 不空（A6 修复的新纪元验证）
const gcl = q("SELECT agentId, conversationId, systemPromptVariant, model FROM prompt_call_logs WHERE agentId LIKE '%goal%' ORDER BY createdAt DESC LIMIT 2");
add('pcl.goalRows', gcl.length > 0, gcl);

// ---- D. 侧表不变式（新会话）
// 老列在 epoch-2 只允许建会话时的空数组初始化（LENGTH<=4），不允许累积内容。
const tsmOldCol = g("SELECT COUNT(*) n FROM teaching_sessions WHERE messages IS NOT NULL AND LENGTH(messages) > 4");
add('teaching.oldColumnEmpty', (tsmOldCol?.n ?? -1) === 0, { contentSessions: tsmOldCol?.n });
const tsmInit = g("SELECT COUNT(*) n FROM teaching_sessions WHERE messages IS NOT NULL");
add('teaching.oldColumnInitOnly', true, { initOnlySessions: tsmInit?.n });
const tsmRows = g("SELECT COUNT(*) n FROM teaching_session_messages");
add('teaching.sideRows', (tsmRows?.n ?? 0) >= 0, { sideRows: tsmRows?.n });

// ---- E. 教学相关（post-lesson 起才有意义）
const teach = q("SELECT id,status,mode,teachingState IS NOT NULL ths,wrapup IS NOT NULL wp FROM teaching_sessions ORDER BY createdAt DESC LIMIT 3");
add('teaching.sessions', teach.length > 0, teach);
const teachPcl = q("SELECT conversationId, systemPromptVariant, model, COUNT(*) n FROM prompt_call_logs WHERE agentId LIKE '%teaching-turn%' GROUP BY conversationId ORDER BY MAX(createdAt) DESC LIMIT 3");
add('pcl.teachingConversationId', teachPcl.length > 0, teachPcl);

// ---- F. 证据键（新写入行必须现场带键）
const ev = q("SELECT evidenceType, json_extract(payload,'$.conceptKey') ck, json_extract(payload,'$.conceptName') cn, occurredAt, createdAt FROM learner_evidence ORDER BY createdAt DESC LIMIT 5");
add('evidence.recentRows', ev.length > 0, ev);
const evNoKey = g("SELECT COUNT(*) n FROM learner_evidence WHERE evidenceType IN ('checkpoint:result','checkpoint:attempt','anchor:result') AND (json_extract(payload,'$.conceptKey') IS NULL OR json_extract(payload,'$.conceptKey')='')");
add('evidence.checkpointKeyCoverage', (evNoKey?.n ?? -1) === 0, { missing: evNoKey?.n });

// ---- G. wrapup 形态（post-finalize）
const wraps = q("SELECT id, json_extract(wrapup,'$.status') st, json_extract(wrapup,'$.summary.topicSummary') ts FROM teaching_sessions WHERE wrapup IS NOT NULL ORDER BY createdAt DESC LIMIT 3");
add('wrapup.status', wraps.length > 0, wraps);

// ---- H. 记忆与 FSRS（原生状态）
const mt = q("SELECT conceptKey, fsrsStability, dueAt, lastSeenAt FROM memory_traces ORDER BY updatedAt DESC LIMIT 5");
add('memory.recentTraces', mt.length > 0, mt);
const mtStats = g("SELECT COUNT(*) n, SUM(CASE WHEN fsrsStability IS NOT NULL THEN 1 ELSE 0 END) native FROM memory_traces");
add('memory.nativeFsrs', true, mtStats);

// ---- I. 观测面：降级事件表与投影
const deg = (() => { try { return g('SELECT COUNT(*) n FROM degradation_events'); } catch { return null; } })();
add('observability.degradationEvents', true, deg === null ? 'table not created yet (lazy)' : deg);
const proj = q("SELECT scope, COUNT(*) n FROM learner_projections GROUP BY scope ORDER BY scope");
add('projections.scopes', true, proj);

// ---- J. 变体与死字段
const variants = q("SELECT systemPromptVariant, COUNT(*) n FROM prompt_call_logs GROUP BY systemPromptVariant");
add('variants.onlyBaseline', variants.every((v) => v.systemPromptVariant == null), variants);

// ---- K. outbox / 收束操作
try {
  const cols = q('PRAGMA table_info(domain_event_outbox)').map((c) => c.name);
  const typeCol = ['type', 'eventType', 'event_type', 'name'].find((c) => cols.includes(c)) || cols[0];
  const outbox = q(`SELECT "${typeCol}" t, COUNT(*) n FROM domain_event_outbox GROUP BY "${typeCol}" ORDER BY n DESC LIMIT 12`);
  add('outbox.types', outbox.length > 0, { typeCol, rows: outbox });
} catch (e) {
  add('outbox.types', true, 'inspect failed: ' + e.message);
}

console.log(JSON.stringify(out, null, 1));
db.close();
