// 过程重建员：只读取证 dump（GUI-1 与 VL-1 逐回合重建原料）
// 铁律遵守：node:sqlite readOnly + busy_timeout；显式列名，禁 SELECT *；
// teaching_sessions.messages 不读（大列已迁侧表），消息走 teaching_session_messages。
// 用法：node process-recon-dump.cjs <sessionId> <outName> [isoFrom] [isoTo]
const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');

const sessionId = process.argv[2];
const outName = process.argv[3] || sessionId.slice(0, 24);
const isoFrom = process.argv[4];
const isoTo = process.argv[5];

if (!sessionId) {
  console.error('usage: node process-recon-dump.cjs <sessionId> <outName> [isoFrom] [isoTo]');
  process.exit(1);
}

const db = new DatabaseSync('backend/prisma/dev.db', { readOnly: true });
db.exec('PRAGMA busy_timeout=5000');

const out = { sessionId, isoFrom: isoFrom || null, isoTo: isoTo || null };

// 1. 会话行（显式列，不含 messages）
out.session = db
  .prepare(
    `SELECT id, userId, taskId, learningPathId, milestoneId, subject, topic, taskType, mode,
            status, knowledgeState, teachingState, wrapup, advisory,
            startTime, endTime, duration, revision, createdAt, updatedAt
       FROM teaching_sessions WHERE id = ?`
  )
  .get(sessionId);

// 2. 侧表全量消息（按时间升序）
out.messages = db
  .prepare(
    `SELECT id, payload, createdAt FROM teaching_session_messages
      WHERE sessionId = ? ORDER BY createdAt ASC, id ASC`
  )
  .all(sessionId);

// 3. agent_call_logs（sessionId 归因列 + 时间窗可选）
let agentSql = `SELECT id, agentId, callerAgent, executionLayer, actorType, providerId, providerType,
       routeSource, model, success, statusCode, durationMs, promptTokens, completionTokens,
       tokensUsed, finishReason, attemptCount, maxAttempts, error, errorCode, errorCategory,
       promptCallId, traceId, calledAt, metadata
  FROM agent_call_logs WHERE sessionId = ?`;
const agentParams = [sessionId];
if (isoFrom) {
  agentSql += ' AND calledAt >= ?';
  agentParams.push(isoFrom);
}
if (isoTo) {
  agentSql += ' AND calledAt <= ?';
  agentParams.push(isoTo);
}
agentSql += ' ORDER BY calledAt ASC';
out.agentCalls = db.prepare(agentSql).all(...agentParams);

// 3b. 若 sessionId 归因缺行，按 userId+时间窗兜底查一次（只标记，不改主数据）
if (out.session && out.agentCalls.length === 0 && isoFrom) {
  out.agentCallsByUserWindow = db
    .prepare(
      `SELECT id, agentId, callerAgent, executionLayer, providerId, routeSource, model, success,
              durationMs, tokensUsed, calledAt, traceId
         FROM agent_call_logs
        WHERE userId = ? AND calledAt >= ? AND calledAt <= ?
        ORDER BY calledAt ASC`
    )
    .all(out.session.userId, isoFrom, isoTo);
}

// 4. prompt_call_logs（时间窗 + userId；无 sessionId 列）
if (out.session && isoFrom) {
  out.promptCalls = db
    .prepare(
      `SELECT id, agentId, model, success, durationMs, createdAt, traceId, parentExecutionId,
              systemPromptVersion, systemPromptVariant, promptAttemptCount, llmRequestCount,
              tokenUsage, errorCode, userPayload
         FROM prompt_call_logs
        WHERE userId = ? AND createdAt >= ? AND createdAt <= ?
        ORDER BY createdAt ASC`
    )
    .all(out.session.userId, isoFrom, isoTo);
}

// 5. learner_evidence（本会话）
out.evidence = db
  .prepare(
    `SELECT id, eventId, evidenceKey, evidenceType, payload, confidence, occurredAt, taskId, pathId
       FROM learner_evidence WHERE sessionId = ? ORDER BY occurredAt ASC`
  )
  .all(sessionId);

// 6. teachingState 关键子结构快照（checkpointHistory/pendingCheckpoint 摘要）
try {
  const ts = out.session && out.session.teachingState ? JSON.parse(out.session.teachingState) : null;
  if (ts) {
    out.teachingStateDigest = {
      topKeys: Object.keys(ts),
      pendingCheckpoint: ts.pendingCheckpoint
        ? {
            checkpointId: ts.pendingCheckpoint.checkpointId,
            type: ts.pendingCheckpoint.type,
            purpose: ts.pendingCheckpoint.purpose,
            allowSkip: ts.pendingCheckpoint.allowSkip,
            question: (ts.pendingCheckpoint.question || '').slice(0, 160),
            attempts: ts.pendingCheckpoint.attempts,
          }
        : null,
      checkpointHistory: ts.checkpointHistory || null,
      stage: ts.stage,
      stageHistoryTail: Array.isArray(ts.stageHistory) ? ts.stageHistory.slice(-6) : undefined,
      metrics: ts.metrics || undefined,
    };
  }
} catch (e) {
  out.teachingStateDigest = { parseError: String(e) };
}

const outDir = path.join(__dirname, 'out');
fs.mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, `recon-${outName}.json`);
fs.writeFileSync(outPath, JSON.stringify(out, null, 1), 'utf8');

// 摘要打到 stdout（不泄大列）
const brief = {
  outPath,
  session: out.session
    ? {
        id: out.session.id,
        status: out.session.status,
        mode: out.session.mode,
        taskType: out.session.taskType,
        subject: out.session.subject,
        topic: out.session.topic,
        startTime: out.session.startTime,
        endTime: out.session.endTime,
        duration: out.session.duration,
        revision: out.session.revision,
      }
    : null,
  msgCount: out.messages.length,
  agentCallCount: out.agentCalls.length,
  agentCallByUserWindow: out.agentCallsByUserWindow ? out.agentCallsByUserWindow.length : undefined,
  promptCallCount: out.promptCalls ? out.promptCalls.length : undefined,
  evidenceTypes: out.evidence.reduce((m, e) => ((m[e.evidenceType] = (m[e.evidenceType] || 0) + 1), m), {}),
};
console.log(JSON.stringify(brief, null, 1));
