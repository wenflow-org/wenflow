#!/usr/bin/env node
/**
 * 幽灵课守卫回放（#69，只读）
 *
 * 用「正常收束理由 + 结构信号」重放历史会话：学生回合 < 2 且时长 < 60s 的已完结会话
 * 视为幽灵课（40 秒内只说了两句话就点完成）。守卫在 endSession 里做的事是「不写正式轨」，
 * 这个脚本只告诉你哪些历史会话会被拦、以及它们当时写了什么，不做任何修改。
 *
 * 用法：
 *   node backend/scripts/ghost-session-replay.cjs
 *   node backend/scripts/ghost-session-replay.cjs --limit 50
 */
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const args = process.argv.slice(2);
const limitArg = args.indexOf('--limit');
const limit = limitArg >= 0 ? Number(args[limitArg + 1]) || 50 : 50;

const dbPath = path.resolve(__dirname, '..', 'prisma', 'dev.db');
const db = new DatabaseSync(dbPath, { readOnly: true });

const GHOST_MAX_SECONDS = 60;
const GHOST_MAX_USER_TURNS = 2;

function userTurnsOf(sessionId, messagesColumn) {
  // 新会话：消息在侧表（payload JSON）；旧会话：messages 列直接有数组
  let parsed = [];
  if (messagesColumn) {
    try {
      const value = JSON.parse(messagesColumn);
      if (Array.isArray(value)) parsed = value;
    } catch { /* 旧列损坏时按侧表读 */ }
  }
  if (parsed.length === 0) {
    const rows = db.prepare('SELECT payload FROM teaching_session_messages WHERE sessionId = ?').all(sessionId);
    parsed = rows.map((row) => {
      try { return JSON.parse(row.payload); } catch { return null; }
    }).filter(Boolean);
  }
  return {
    total: parsed.length,
    user: parsed.filter((m) => m && m.role === 'user' && !m.checkpoint).length,
  };
}

const sessions = db.prepare(`
  SELECT id, userId, status, startTime, endTime, messages, wrapup, teachingState
  FROM teaching_sessions
  WHERE status IN ('completed', 'finalization_failed')
  ORDER BY startTime DESC
`).all();

const candidates = [];
for (const session of sessions) {
  if (!session.startTime || !session.endTime) continue;
  const durationSeconds = (Number(session.endTime) - Number(session.startTime)) / 1000;
  if (!Number.isFinite(durationSeconds) || durationSeconds < 0) continue;
  if (durationSeconds >= GHOST_MAX_SECONDS) continue;
  const turns = userTurnsOf(session.id, session.messages);
  if (turns.user >= GHOST_MAX_USER_TURNS) continue;

  const metrics = db.prepare('SELECT COUNT(*) AS c FROM learning_metrics WHERE sourceKey LIKE ?')
    .get(`%${session.id}%`).c;
  const evidence = db.prepare('SELECT COUNT(*) AS c FROM learner_evidence WHERE sessionId = ?')
    .get(session.id).c;
  candidates.push({
    id: session.id,
    userId: session.userId,
    status: session.status,
    seconds: Math.round(durationSeconds * 10) / 10,
    messages: turns.total,
    userTurns: turns.user,
    hasWrapup: session.wrapup != null,
    formalTrack: { learningMetrics: metrics, learnerEvidence: evidence },
  });
}

console.log(`[ghost-session-replay] 已完结会话 ${sessions.length} 条；判据 userTurns<${GHOST_MAX_USER_TURNS} 且 duration<${GHOST_MAX_SECONDS}s`);
console.log(`[ghost-session-replay] 命中 ${candidates.length} 条（新守卫会拦截其正式轨写入）\n`);
for (const row of candidates.slice(0, limit)) {
  console.log(JSON.stringify(row));
}
if (candidates.length > limit) console.log(`... 其余 ${candidates.length - limit} 条省略（--limit 调整）`);
