#!/usr/bin/env node
/** vl-forensics.mjs — VL 单课课后取证（只读）。用法：node vl-forensics.mjs <sessionId> <userId>
 * 铁律 5：node:sqlite readOnly + busy_timeout；显式列名、? 参数绑定；messages 大列不取，
 * 消息走 teaching_session_messages 侧表（payload 内含 role/content）。
 */
import { DatabaseSync } from 'node:sqlite';

const [sessionId, userId] = process.argv.slice(2);
if (!sessionId || !userId) {
  console.error('usage: node vl-forensics.mjs <sessionId> <userId>');
  process.exit(1);
}
const db = new DatabaseSync('backend/prisma/dev.db', { readOnly: true });
db.exec('PRAGMA busy_timeout=5000');
const out = {};

// 1) teaching_sessions 终态（显式列，禁 SELECT *）
out.session = db.prepare(
  'SELECT id, userId, taskId, learningPathId, milestoneId, subject, topic, taskType, mode, status, knowledgeState, teachingState, startTime, endTime, duration, revision FROM teaching_sessions WHERE id = ?'
).get(sessionId) || null;

// knowledgeState 概览（名称+状态）
if (out.session?.knowledgeState) {
  try {
    const ks = JSON.parse(out.session.knowledgeState);
    out.knowledgeStateOverview = Array.isArray(ks)
      ? ks.map((p) => ({ name: p.name, status: p.status, progress: p.progress }))
      : typeof ks === 'object' ? Object.keys(ks) : String(ks).slice(0, 200);
  } catch (e) { out.knowledgeStateOverview = `parse-error: ${e.message}`; }
}

// 2) wrapup JSON 全解析（endSummary 历史疑点主口径）
if (out.session?.status && out.session !== null) {
  const wrow = db.prepare('SELECT wrapup FROM teaching_sessions WHERE id = ?').get(sessionId);
  if (wrow?.wrapup) {
    let w = null;
    try { w = JSON.parse(wrow.wrapup); } catch (e) { out.wrapupParseError = e.message; }
    if (w) {
      out.wrapupTopLevelKeys = Object.keys(w);
      out.wrapupHasEndSummaryKey = Object.prototype.hasOwnProperty.call(w, 'endSummary');
      out.wrapupSummary = w.summary ? {
        topicSummary: w.summary.topicSummary ?? null,
        topicSummaryLen: String(w.summary.topicSummary ?? '').length,
        knowledgeSummary: String(w.summary.knowledgeSummary ?? '').slice(0, 160),
        practiceAdvice: String(w.summary.practiceAdvice ?? '').slice(0, 160),
        learningEvaluation: String(w.summary.learningEvaluation ?? '').slice(0, 160),
        keyTakeawaysCount: Array.isArray(w.summary.keyTakeaways) ? w.summary.keyTakeaways.length : null,
        actionPlanCount: Array.isArray(w.summary.actionPlan) ? w.summary.actionPlan.length : null,
        knowledgeItemsCount: Array.isArray(w.summary.knowledgeItems) ? w.summary.knowledgeItems.length : null,
        summaryVersion: w.summary.summaryVersion ?? null,
      } : null;
      out.wrapupSources = {
        summarySource: w.summarySource ?? null,
        evaluationSource: w.evaluationSource ?? null,
      };
      out.wrapupDuration = w.duration ?? null;
      out.wrapupEvaluation = w.evaluation ? {
        sessionLss: w.evaluation.sessionLss, sessionKtl: w.evaluation.sessionKtl, sessionLf: w.evaluation.sessionLf,
        evaluationSource: w.evaluation.evaluationSource ?? null,
      } : null;
      out.wrapupProgress = w.progress ?? null;
      out.wrapupBytes = wrow.wrapup.length;
    }
  } else {
    out.wrapupColumn = null;
  }
}

// 3) learner_evidence 清单（本会话）
out.evidenceRows = db.prepare(
  'SELECT id, evidenceType, eventId, evidenceKey, taskId, confidence, occurredAt, LENGTH(payload) payloadBytes FROM learner_evidence WHERE sessionId = ? ORDER BY occurredAt'
).all(sessionId);

// checkpoint:result 详情（judgedBy/正确性与受控错误一致性）
out.checkpointResults = db.prepare(
  "SELECT eventId, payload, confidence, occurredAt FROM learner_evidence WHERE sessionId = ? AND evidenceType = 'checkpoint:result' ORDER BY occurredAt"
).all(sessionId).map((r) => {
  try {
    const p = JSON.parse(r.payload);
    return {
      eventId: r.eventId,
      judgedBy: p.judgedBy ?? null,
      passed: p.passed ?? p.correct ?? null,
      confidence: r.confidence,
      attempts: p.attempts ?? null,
      conceptKeys: p.conceptKeys ?? p.conceptKey ?? null,
      selectedOptionIds: Array.isArray(p.selectedOptionIds) ? p.selectedOptionIds.length : (p.selectedOptionIds ?? null),
      occurredAt: r.occurredAt,
    };
  } catch { return { eventId: r.eventId, parseError: true, confidence: r.confidence }; }
});

// checkpoint:attempt（H1 未作答终局留痕）
out.checkpointAttempts = db.prepare(
  "SELECT eventId, payload, confidence, occurredAt FROM learner_evidence WHERE sessionId = ? AND evidenceType = 'checkpoint:attempt' ORDER BY occurredAt"
).all(sessionId).map((r) => {
  try { return { eventId: r.eventId, ...JSON.parse(r.payload), confidence: r.confidence, occurredAt: r.occurredAt }; }
  catch { return { eventId: r.eventId, parseError: true }; }
});

// anchor:result（锚题探针）
out.anchorResults = db.prepare(
  "SELECT eventId, payload, confidence, occurredAt FROM learner_evidence WHERE sessionId = ? AND evidenceType = 'anchor:result' ORDER BY occurredAt"
).all(sessionId).map((r) => {
  try { const p = JSON.parse(r.payload); return { eventId: r.eventId, passed: p.passed ?? null, anchorKind: p.anchorKind ?? null, confidence: r.confidence, occurredAt: r.occurredAt }; }
  catch { return { eventId: r.eventId, parseError: true }; }
});

// 本 VL 全量证据类型分布（含跨会话/事件投影）
out.evidenceTypeDistForUser = db.prepare(
  'SELECT evidenceType, COUNT(*) n FROM learner_evidence WHERE userId = ? GROUP BY evidenceType ORDER BY n DESC'
).all(userId);

// 4) 消息侧表统计（role/content 在 payload JSON 内）
const msgs = db.prepare(
  'SELECT payload FROM teaching_session_messages WHERE sessionId = ? ORDER BY createdAt'
).all(sessionId);
let roleCount = { assistant: 0, user: 0, other: 0 };
let lastTeacher = '';
let lastStudent = '';
for (const m of msgs) {
  try {
    const p = JSON.parse(m.payload);
    const role = p.role || p.messageRole || 'other';
    roleCount[role] = (roleCount[role] || 0) + 1;
    const content = String(p.content || p.text || '');
    if (role === 'assistant' && content) lastTeacher = content;
    if (role === 'user' && content) lastStudent = content;
  } catch { roleCount.other++; }
}
out.messageStats = { total: msgs.length, roleCount, lastTeacherTail: lastTeacher.slice(-200), lastStudentTail: lastStudent.slice(-160) };

// 5) agent_call_logs 路由证据（学生侧技能走了哪个池）
out.routes = db.prepare(
  "SELECT agentId, routeSource, providerId, model, COUNT(*) n, SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) ok, MAX(calledAt) latest FROM agent_call_logs WHERE userId = ? AND calledAt >= (SELECT MIN(startTime) FROM teaching_sessions WHERE id = ?) GROUP BY agentId, routeSource, providerId, model ORDER BY n DESC LIMIT 20"
).all(userId, sessionId);

console.log(JSON.stringify(out, null, 1));
db.close();
