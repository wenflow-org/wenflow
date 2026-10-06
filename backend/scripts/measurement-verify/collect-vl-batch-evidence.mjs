#!/usr/bin/env node
/** collect-vl-batch-evidence.mjs — 测量验证第一轮 VL 批量对比组·DB 取证。
 * 逐 VL：userId/sessionId、teaching_sessions（wrapup/knowledgeState 分布/时长）、
 * teaching_session_messages 计数（侧表）、learner_evidence 清单。
 * 纪律：node:sqlite 只读 + busy_timeout；全部显式列名（messages 大列禁选）；输出落 out/vl-batch-db-evidence.json。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..', '..');
const OUT = path.join(HERE, 'out', 'vl-batch-db-evidence.json');

const db = new DatabaseSync(path.join(ROOT, 'backend', 'prisma', 'dev.db'), { readOnly: true });
db.exec('PRAGMA busy_timeout=5000');

const profiles = db.prepare(
  `SELECT p.id AS profileId, p.userId, p.tags, p.notes, u.name AS userName, u.email
   FROM virtual_learner_profiles p JOIN users u ON u.id = p.userId
   WHERE p.tags LIKE '%vl-r1b-%' ORDER BY p.createdAt`
).all();

const result = { collectedAt: new Date().toISOString(), vls: [] };
for (const prof of profiles) {
  const tier = /vl-r1b-0\d-(strong|weak|mid)/.exec(String(prof.tags || ''))?.[1] || 'unknown';
  const sessions = db.prepare(
    `SELECT id, status, currentStage, learningPathId, completedTasks, totalTasks, createdAt, updatedAt, completedAt
     FROM virtual_sessions WHERE virtualProfileId = ? ORDER BY createdAt`
  ).all(prof.profileId);

  const teaching = db.prepare(
    `SELECT id, status, subject, topic, taskType, mode, duration, startTime, endTime,
            wrapup, knowledgeState
     FROM teaching_sessions WHERE userId = ? ORDER BY startTime`
  ).all(prof.userId);
  const teachingShaped = teaching.map((t) => {
    let wrapupStatus = null, wrapupEmpty = true, topicSummaryEmpty = true, wrapupParsed = null;
    if (t.wrapup) {
      try {
        wrapupParsed = JSON.parse(t.wrapup);
        wrapupStatus = wrapupParsed.status ?? null;
        wrapupEmpty = false;
        topicSummaryEmpty = !String(wrapupParsed.summary?.topicSummary || '').trim();
      } catch { wrapupStatus = 'PARSE_FAIL'; }
    }
    let ks = null;
    try { ks = t.knowledgeState ? JSON.parse(t.knowledgeState) : null; } catch { ks = 'PARSE_FAIL'; }
    const ksDist = Array.isArray(ks)
      ? {
          items: ks.length,
          byStatus: ks.reduce((acc, k) => { const s = String(k.status || 'unknown'); acc[s] = (acc[s] || 0) + 1; return acc; }, {}),
          avgProgress: ks.length ? Math.round(ks.reduce((a, k) => a + (Number(k.progress) || 0), 0) / ks.length) : null,
          itemsDetail: ks.map((k) => ({ name: k.name, status: k.status, progress: k.progress })),
        }
      : ks;
    return {
      teachingSessionId: t.id, status: t.status, subject: t.subject, topic: t.topic,
      taskType: t.taskType, mode: t.mode, duration: t.duration, startTime: t.startTime, endTime: t.endTime,
      wrapupColumnEmpty: t.wrapup === null || t.wrapup === '',
      wrapupStatus, topicSummaryEmpty,
      knowledgeState: ksDist,
    };
  });

  const messages = db.prepare(
    `SELECT ts.id AS teachingSessionId, COUNT(m.id) AS n
     FROM teaching_sessions ts LEFT JOIN teaching_session_messages m ON m.sessionId = ts.id
     WHERE ts.userId = ? GROUP BY ts.id ORDER BY ts.startTime`
  ).all(prof.userId);

  const evidence = db.prepare(
    `SELECT id, evidenceType, eventId, evidenceKey, sessionId, taskId, confidence, occurredAt
     FROM learner_evidence WHERE userId = ? ORDER BY occurredAt`
  ).all(prof.userId);
  const evidenceByType = evidence.reduce((acc, e) => { const k = String(e.evidenceType || 'null'); acc[k] = (acc[k] || 0) + 1; return acc; }, {});

  result.vls.push({
    profileTag: (String(prof.tags || '').split(',').map((s) => s.trim().replace(/^"|"$/g, '')).find((x) => x.startsWith('vl-r1b-'))) || prof.userName,
    tier, profileId: prof.profileId, userId: prof.userId, userName: prof.userName,
    sessions,
    teaching: teachingShaped,
    messageCounts: messages,
    evidenceTotal: evidence.length,
    evidenceByType,
    evidenceList: evidence,
  });
}
db.close();
fs.writeFileSync(OUT, JSON.stringify(result, null, 1));
console.log(JSON.stringify(result.vls.map((v) => ({
  profileTag: v.profileTag, tier: v.tier, userId: v.userId,
  sessions: v.sessions.length,
  teaching: v.teaching.map((t) => ({ id: t.teachingSessionId.slice(-12), status: t.status, duration: t.duration, wrapupEmpty: t.wrapupColumnEmpty, wrapupStatus: t.wrapupStatus, topicSummaryEmpty: t.topicSummaryEmpty, ks: t.knowledgeState?.byStatus, avgProgress: t.knowledgeState?.avgProgress, items: t.knowledgeState?.items })),
  messages: v.messageCounts.map((m) => m.n),
  evidenceTotal: v.evidenceTotal, evidenceByType: v.evidenceByType,
})), null, 1));
console.log(`\nfull evidence -> ${OUT}`);
