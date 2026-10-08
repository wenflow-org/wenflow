#!/usr/bin/env node
/**
 * WenFlow 测量闭环 v0 · 只读小样本探针（measurement-probe）
 *
 * 目的（本轮硬约束下的最小接入原型）：
 *   在零 LLM、零网络、DB 只读的前提下，从既有归档数据重建「单维度=每个知识点（KC）掌握」
 *   的闭环 v0：基线 → 证据 → 规则推断（显式留痕于本探针输出） → (假想)决策 → 后来核查。
 *
 * 数据口径（全部复用既有表，不新建表、不写库）：
 *   单元 = 一节已完结教学会话 × 该会话 taskId → subtasks.conceptId（canonical KC）。
 *   - 证据：learner_evidence.evidenceType='checkpoint:result'（judgedBy=code 为独立仪器；
 *     model-reference 仅记录、不计入独立判据）；
 *   - 基线：teaching_sessions.teachingState.sessionArtifacts.initialKnowledgeState（逐子点 status/progress）；
 *   - 课后状态：teaching_sessions.knowledgeState / wrapup.summary.knowledgeItems（模型源，仅作辅助）；
 *   - 误解：misconception_ledger（按 userId+conceptId，lastSessionId/时间窗挂到课次）；
 *   - 记忆：memory_traces（userId+conceptId，辅助上下文，不作独立判据）；
 *   - 「后来」：同 userId+conceptId 且状态 IN ('completed','timeout') 的最近后续会话，
 *     其代码裁决检查点（经自身 subtask → conceptId 归因）作核查仪器。
 *
 * v0 推断规则（确定性，无模型；每单元输出一档）：
 *   1. 取每个 checkpointId 的**最后一次**作答（重答取终值）。
 *   2. 无任何 judgedBy='code' 的最终作答 → insufficient_evidence；
 *      有 → 若最终作答全部通过且在课无活跃误解（suspected/confirmed）→ likely_mastered；
 *      否则（存在未通过，或在课有活跃误解）→ likely_not_mastered。
 *   3. 对照：likely_mastered ↔ later_mastered（一致）/ later_not_mastered（高估=假阳性）；
 *      likely_not_mastered ↔ later_not_mastered（一致）/ later_mastered（低估=假阴性）；
 *      任一侧无独立仪器 → not_comparable。
 *
 * 纪律：只读打开（OPEN_READONLY）+ busy_timeout；不改任何系统文件（本探针只写自己的 --out 目录）；
 *       零 LLM、零网络；假想决策只打印、不执行。
 *
 * 用法：
 *   node backend/scripts/measurement-probe/probe.mjs [--sample N] [--chains K] [--out DIR] [--db PATH]
 *   --sample  N  抽样会话单元数（默认 20，硬上限 50）
 *   --chains  K  完整链路样例条数（默认 2，上限 2）
 *   --out     DIR 输出目录（默认 <本目录>/out）
 *   --db      PATH 只读打开的 SQLite（默认 backend/prisma/dev.db）
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';

const require = createRequire(import.meta.url);
const sqlite3 = require('sqlite3');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const DEFAULT_DB = path.join(REPO_ROOT, 'backend', 'prisma', 'dev.db');
const MAX_SAMPLE = 50;
const MAX_CHAINS = 2;

const HYPOTHETICAL_DECISION = {
  likely_mastered: '假想：推进下一任务；为该 KC 排程延迟锚题复测（间隔 ≥7 天）。',
  likely_not_mastered: '假想：下一课难度降档 / 插入该 KC 复习；写入结构化复核队列；不升级难度。',
  insufficient_evidence: '假想：补发一次独立检查点（不改难度、不改路径）。',
  unresolved_no_later: '（无后来数据，无决策对照）',
};

// ---------------------------------------------------------------- args / io

function parseArgs(argv) {
  const a = { sample: 20, chains: 2, out: null, db: null };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--sample') a.sample = parseInt(argv[++i], 10);
    else if (k === '--chains') a.chains = parseInt(argv[++i], 10);
    else if (k === '--out') a.out = argv[++i];
    else if (k === '--db') a.db = argv[++i];
    else if (k === '--help' || k === '-h') { printHelp(); process.exit(0); }
    else { console.error(`未知参数：${k}（--help 查看用法）`); process.exit(2); }
  }
  if (!Number.isFinite(a.sample) || a.sample < 1) a.sample = 20;
  a.sample = Math.min(a.sample, MAX_SAMPLE);
  if (!Number.isFinite(a.chains) || a.chains < 0) a.chains = 2;
  a.chains = Math.min(a.chains, MAX_CHAINS);
  return a;
}

function printHelp() {
  console.log(`用法: node backend/scripts/measurement-probe/probe.mjs [--sample N] [--chains K] [--out DIR] [--db PATH]
  --sample N   抽样会话单元数（默认 20，上限 ${MAX_SAMPLE}）
  --chains K   完整链路样例条数（默认 2，上限 ${MAX_CHAINS}）
  --out DIR    输出目录（默认 <本目录>/out）
  --db PATH    只读 SQLite 路径（默认 backend/prisma/dev.db）`);
}

function parseJson(s, fallback) { try { return JSON.parse(s); } catch { return fallback; } }
const iso = (ms) => (Number.isFinite(ms) ? new Date(ms).toISOString() : null);
const short = (s) => (typeof s === 'string' ? (s.length > 14 ? `${s.slice(0, 8)}…${s.slice(-4)}` : s) : String(s));
const trunc = (s, n) => (typeof s === 'string' ? (s.length > n ? `${s.slice(0, n)}…` : s) : s);
const hoursBetween = (a, b) => Math.round(((b - a) / 3600000) * 100) / 100;

function openDb(file) {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(file, sqlite3.OPEN_READONLY, (err) => (err ? reject(err) : resolve(db)));
  });
}
const all = (db, sql, params = []) => new Promise((res, rej) => db.all(sql, params, (e, r) => (e ? rej(e) : res(r))));
const get = (db, sql, params = []) => new Promise((res, rej) => db.get(sql, params, (e, r) => (e ? rej(e) : res(r))));
const run = (db, sql) => new Promise((res, rej) => db.run(sql, (e) => (e ? rej(e) : res(e))));

function gitCommit() {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
  } catch { return null; }
}

// ---------------------------------------------------------------- selection

const FILTERS = {
  session: "teaching_sessions.status='completed' 且 endTime 非空且 < snapshot",
  kc: 'taskId → subtasks.conceptId 非空（canonical KC）',
  evidence: "EXISTS learner_evidence(sessionId, evidenceType='checkpoint:result')",
  later: "EXISTS 同 userId+conceptId 且 status IN ('completed','timeout') 且 startTime > endTime 的后续会话",
};

const CANDIDATE_SQL = `
SELECT s.id AS sessionId, s.userId, s.taskId, s.learningPathId, s.startTime, s.endTime,
       st.conceptId AS conceptId, c.canonicalLabel AS conceptLabel
FROM teaching_sessions s
JOIN subtasks st ON st.id = s.taskId
LEFT JOIN concepts c ON c.id = st.conceptId
WHERE s.status = 'completed'
  AND s.endTime IS NOT NULL AND s.endTime < ?
  AND st.conceptId IS NOT NULL
  AND EXISTS (SELECT 1 FROM learner_evidence e
              WHERE e.sessionId = s.id AND e.evidenceType = 'checkpoint:result')
  AND EXISTS (SELECT 1 FROM teaching_sessions s2 JOIN subtasks st2 ON st2.id = s2.taskId
              WHERE s2.userId = s.userId AND st2.conceptId = st.conceptId
                AND s2.status IN ('completed','timeout') AND s2.id <> s.id
                AND s2.startTime > s.endTime)
ORDER BY s.endTime ASC`;

/** 按 endTime 升序等距抽取（确定性；n >= 行数时全取） */
function pickEqualInterval(rows, n) {
  if (rows.length <= n) return rows.map((_, i) => i);
  const picked = new Set();
  for (let i = 0; i < n; i++) {
    let idx = Math.round((i * (rows.length - 1)) / (n - 1));
    while (picked.has(idx) && idx + 1 < rows.length) idx++;
    picked.add(idx);
  }
  return [...picked].sort((a, b) => a - b);
}

// ---------------------------------------------------------------- helpers

function matchConceptEntry(entries, label) {
  if (!Array.isArray(entries) || entries.length === 0) return { entry: null, how: 'empty' };
  if (!label) return { entry: null, how: 'no-label' };
  const norm = (x) => String(x ?? '').trim();
  const exact = entries.find((e) => norm(e && e.name) === norm(label));
  if (exact) return { entry: exact, how: 'name-exact' };
  const sub = entries.find((e) => {
    const n = norm(e && e.name);
    return n && (n.includes(norm(label)) || norm(label).includes(n));
  });
  if (sub) return { entry: sub, how: 'name-substring' };
  if (entries.length === 1) return { entry: entries[0], how: 'single-entry-fallback' };
  return { entry: null, how: 'unmatched' };
}

/** 每个 checkpointId 取最后一次作答（输入按 occurredAt,id 升序） */
function lastAttemptsByCheckpoint(parsedRows) {
  const byId = new Map();
  for (const r of parsedRows) {
    const p = r.parsed || {};
    const id = p.checkpointId || r.id;
    byId.set(id, {
      checkpointId: id,
      type: p.type,
      passed: !!p.passed,
      judgedBy: p.judgedBy === 'code' ? 'code' : 'model-reference',
      detail: p.detail ?? null,
      selectedOptionIds: p.selectedOptionIds ?? null,
      occurredAt: r.occurredAt,
    });
  }
  return [...byId.values()];
}

function inferV0(cpParsedRows, misInSession) {
  const last = lastAttemptsByCheckpoint(cpParsedRows);
  const code = last.filter((a) => a.judgedBy === 'code');
  const model = last.filter((a) => a.judgedBy !== 'code');
  const passed = code.filter((a) => a.passed).length;
  const failed = code.length - passed;
  const activeMis = misInSession.filter((m) => m.status !== 'addressed');
  let label; let reason;
  if (code.length === 0) {
    label = 'insufficient_evidence';
    reason = model.length > 0
      ? `仅有 model-reference 检查点（${model.length} 个），非独立仪器`
      : '无检查点证据';
  } else if (failed === 0 && activeMis.length === 0) {
    label = 'likely_mastered';
    reason = `代码裁决检查点最终作答全部通过（${passed}/${code.length}）且在课无活跃误解`;
  } else if (failed > 0) {
    label = 'likely_not_mastered';
    reason = `代码裁决检查点存在最终未通过（${failed}/${code.length}）`;
  } else {
    label = 'likely_not_mastered';
    reason = `在课存在活跃误解 ${activeMis.length} 条`;
  }
  return {
    label,
    reason,
    trace: {
      codeLast: code.length, codePassed: passed, codeFailed: failed,
      modelLast: model.length,
      activeMisInSession: activeMis.length,
    },
  };
}

function laterOutcomeFromEvidence(laterCpParsedRows) {
  const last = lastAttemptsByCheckpoint(laterCpParsedRows);
  const code = last.filter((a) => a.judgedBy === 'code');
  if (code.length === 0) return { label: 'unresolved_no_instrument', trace: { codeLast: 0 } };
  const failed = code.filter((a) => !a.passed).length;
  return {
    label: failed === 0 ? 'later_mastered' : 'later_not_mastered',
    trace: { codeLast: code.length, codePassed: code.length - failed, codeFailed: failed },
  };
}

function verdictOf(inferredLabel, laterLabel) {
  if (inferredLabel === 'insufficient_evidence' || laterLabel === 'unresolved_no_instrument') return 'not_comparable';
  if (inferredLabel === 'likely_mastered') {
    return laterLabel === 'later_mastered' ? 'consistent' : 'overestimate';
  }
  return laterLabel === 'later_not_mastered' ? 'consistent' : 'underestimate';
}

async function parseEvidenceRows(rows) {
  return rows.map((r) => ({ ...r, parsed: parseJson(r.payload, null) || {} }));
}

async function loadSessionEvidence(db, sessionId) {
  const rows = await all(
    db,
    `SELECT id, evidenceKey, evidenceType, payload, confidence, occurredAt
     FROM learner_evidence WHERE sessionId = ? ORDER BY occurredAt, id`,
    [sessionId],
  );
  const parsed = await parseEvidenceRows(rows);
  const byType = {};
  for (const r of parsed) byType[r.evidenceType] = (byType[r.evidenceType] || 0) + 1;
  return { rows: parsed, byType };
}

async function loadCheckpointTimeline(db, sessionId) {
  const rows = await all(
    db,
    `SELECT id, payload, occurredAt FROM learner_evidence
     WHERE sessionId = ? AND evidenceType = 'checkpoint:result' ORDER BY occurredAt, id`,
    [sessionId],
  );
  const parsed = await parseEvidenceRows(rows);
  const attemptsByCp = new Map();
  for (const r of parsed) {
    const id = r.parsed.checkpointId || r.id;
    attemptsByCp.set(id, (attemptsByCp.get(id) || 0) + 1);
  }
  return { parsed, attemptsByCp };
}

function parseMessages(session, sideRows) {
  let msgSource = 'sideTable';
  let msgs = sideRows;
  if (sideRows.length === 0 && session && session.messages) {
    const legacy = parseJson(session.messages, null);
    if (Array.isArray(legacy) && legacy.length > 0) {
      msgSource = 'legacyColumn';
      msgs = legacy.map((m, i) => ({ id: `legacy-${i}`, payload: JSON.stringify(m) }));
    } else msgSource = 'none';
  }
  if (msgs.length === 0) msgSource = sideRows.length > 0 ? 'sideTable' : 'none';
  let userMsgs = 0; let assistantMsgs = 0; let assistantWithAnalysis = 0;
  let checkpointFlaggedUsers = 0;
  const snippets = [];
  for (const m of msgs) {
    const p = parseJson(m.payload, null);
    if (!p) continue;
    if (p.role === 'user') {
      userMsgs++;
      if (p.checkpoint === true) checkpointFlaggedUsers++;
      const text = String(p.content || '').replace(/\s+/g, ' ').trim();
      if (text) snippets.push({ id: m.id, checkpoint: p.checkpoint === true, at: p.timestamp || null, text: trunc(text, 160) });
    } else if (p.role === 'assistant') {
      assistantMsgs++;
      if (p.analysis) assistantWithAnalysis++;
    }
  }
  const studentSnippets = snippets.length <= 4
    ? snippets
    : [snippets[0], snippets[1], snippets[snippets.length - 2], snippets[snippets.length - 1]];
  return { msgSource, msgCount: msgs.length, userMsgs, assistantMsgs, assistantWithAnalysis, checkpointFlaggedUsers, studentSnippets };
}

// ---------------------------------------------------------------- per unit

async function collectUnit(db, u) {
  const session = await get(
    db,
    `SELECT id,userId,taskId,learningPathId,startTime,endTime,status,knowledgeState,teachingState,wrapup,messages
     FROM teaching_sessions WHERE id = ?`,
    [u.sessionId],
  );
  const sideRows = await all(db, `SELECT id,payload FROM teaching_session_messages WHERE sessionId = ? ORDER BY id`, [u.sessionId]);
  const messages = parseMessages(session, sideRows);

  const ev = await loadSessionEvidence(db, u.sessionId);
  const cp = await loadCheckpointTimeline(db, u.sessionId);
  const cpLast = lastAttemptsByCheckpoint(cp.parsed);
  const cpLastCode = cpLast.filter((a) => a.judgedBy === 'code');
  const cpLastModel = cpLast.filter((a) => a.judgedBy !== 'code');
  const cpTypes = {};
  for (const a of cpLast) cpTypes[a.type || 'unknown'] = (cpTypes[a.type || 'unknown'] || 0) + 1;
  const checkpointPayloadKeys = [...new Set(cp.parsed.flatMap((r) => Object.keys(r.parsed)))];
  const hasConceptKeyInPayload = cp.parsed.some((r) => 'conceptKey' in r.parsed);
  const hasAnswerTextInPayload = cp.parsed.some((r) => 'answerText' in r.parsed);
  const shortAnswerRows = cp.parsed.filter((r) => r.parsed.type === 'short_answer').length;

  const anchorRows = ev.rows.filter((r) => r.evidenceType === 'anchor:result');
  const anchorConceptKeys = [...new Set(anchorRows.map((r) => r.parsed.conceptKey).filter(Boolean))];

  const ksEntries = parseJson(session.knowledgeState, []) || [];
  const ksMatch = matchConceptEntry(ksEntries, u.conceptLabel);
  const ksStatusCounts = {};
  for (const e of ksEntries) ksStatusCounts[e.status] = (ksStatusCounts[e.status] || 0) + 1;

  const tsObj = parseJson(session.teachingState, {}) || {};
  const artifacts = tsObj.sessionArtifacts || {};
  const initialKS = Array.isArray(artifacts.initialKnowledgeState) ? artifacts.initialKnowledgeState : [];
  const baselineMatch = matchConceptEntry(initialKS, u.conceptLabel);
  const ktEstimate = (tsObj.learnerStateContext && tsObj.learnerStateContext.ktEstimate) || null;
  const ktConcepts = (ktEstimate && Array.isArray(ktEstimate.conceptMastery)) ? ktEstimate.conceptMastery : [];
  const ktMatch = ktConcepts.find((x) => x.conceptKey === u.conceptLabel)
    || (ksMatch.entry ? ktConcepts.find((x) => x.conceptKey === ksMatch.entry.name) : null)
    || (ktConcepts.length === 1 ? ktConcepts[0] : null);
  const checkpointHistory = Array.isArray(tsObj.checkpointHistory) ? tsObj.checkpointHistory : [];

  const wu = session.wrapup ? parseJson(session.wrapup, null) : null;
  const wuItems = (wu && wu.summary && Array.isArray(wu.summary.knowledgeItems)) ? wu.summary.knowledgeItems : [];
  const wuMatch = matchConceptEntry(wuItems, u.conceptLabel);

  const mis = await all(
    db,
    `SELECT id,conceptKey,conceptId,status,occurrenceCount,firstSeenAt,lastSeenAt,lastSessionId,hypothesis
     FROM misconception_ledger WHERE userId = ? AND (conceptId = ? OR conceptKey = ?)
     ORDER BY lastSeenAt`,
    [u.userId, u.conceptId || '', u.conceptLabel || ''],
  );
  const misInSession = mis.filter((m) => m.lastSessionId === u.sessionId
    || (m.firstSeenAt >= u.startTime && m.firstSeenAt <= u.endTime)
    || (m.lastSeenAt >= u.startTime && m.lastSeenAt <= u.endTime));

  let mt = await get(
    db,
    `SELECT conceptKey,conceptId,masteryScore,stability,ktMasteryEma,extractionCount,lastSeenAt,source,dueAt,fsrsStability
     FROM memory_traces WHERE userId = ? AND conceptId = ?`,
    [u.userId, u.conceptId],
  );
  let mtMatchBy = mt ? 'conceptId' : null;
  if (!mt && u.conceptLabel) {
    mt = await get(
      db,
      `SELECT conceptKey,conceptId,masteryScore,stability,ktMasteryEma,extractionCount,lastSeenAt,source,dueAt,fsrsStability
       FROM memory_traces WHERE userId = ? AND conceptKey = ?`,
      [u.userId, u.conceptLabel],
    );
    if (mt) mtMatchBy = 'conceptKey';
  }

  // ---- 后来（最近一节同 KC 终态会话）
  const later = await get(
    db,
    `SELECT s2.id,s2.status,s2.startTime,s2.endTime,s2.knowledgeState,s2.wrapup
     FROM teaching_sessions s2 JOIN subtasks st2 ON st2.id = s2.taskId
     WHERE s2.userId = ? AND st2.conceptId = ? AND s2.status IN ('completed','timeout')
       AND s2.id <> ? AND s2.startTime > ?
     ORDER BY s2.startTime ASC LIMIT 1`,
    [u.userId, u.conceptId, u.sessionId, u.endTime],
  );
  const laterTotal = await get(
    db,
    `SELECT count(*) AS n FROM teaching_sessions s2 JOIN subtasks st2 ON st2.id = s2.taskId
     WHERE s2.userId = ? AND st2.conceptId = ? AND s2.status IN ('completed','timeout')
       AND s2.id <> ? AND s2.startTime > ?`,
    [u.userId, u.conceptId, u.sessionId, u.endTime],
  );
  let laterInfo = null;
  if (later) {
    const laterCp = await loadCheckpointTimeline(db, later.id);
    const outcome = laterOutcomeFromEvidence(laterCp.parsed);
    const laterKs = parseJson(later.knowledgeState, []) || [];
    const laterKsStatus = {};
    for (const e of laterKs) laterKsStatus[e.status] = (laterKsStatus[e.status] || 0) + 1;
    const laterWu = later.wrapup ? parseJson(later.wrapup, null) : null;
    laterInfo = {
      sessionId: later.id,
      status: later.status,
      startTime: later.startTime,
      endTime: later.endTime,
      gapHours: hoursBetween(u.endTime, later.startTime),
      codeCheckpoints: laterCp.parsed.length,
      outcome: outcome.label,
      outcomeTrace: outcome.trace,
      ksEntryCount: laterKs.length,
      ksStatusCounts: laterKsStatus,
      ksMatched: matchConceptEntry(laterKs, u.conceptLabel).how,
      wrapupStatus: laterWu ? laterWu.status : null,
      wrapupAvgUnderstanding: laterWu && laterWu.evidence ? (laterWu.evidence.avgUnderstanding ?? null) : null,
      totalLaterTerminalSessions: laterTotal ? laterTotal.n : 0,
    };
  }

  const inference = inferV0(cp.parsed, misInSession);
  const laterLabel = laterInfo ? laterInfo.outcome : 'no_later';
  const verdict = laterInfo ? verdictOf(inference.label, laterLabel) : 'not_comparable';

  return {
    sessionId: u.sessionId,
    userId: u.userId,
    learningPathId: u.learningPathId,
    conceptId: u.conceptId,
    conceptLabel: u.conceptLabel,
    startTime: u.startTime,
    endTime: u.endTime,
    messages,
    checkpoint: {
      evidenceRows: cp.parsed.length,
      distinctCheckpoints: cp.attemptsByCp.size,
      maxAttempts: cp.attemptsByCp.size ? Math.max(...cp.attemptsByCp.values()) : 0,
      lastAttempts: cpLast.length,
      lastCode: cpLastCode.length,
      lastModel: cpLastModel.length,
      lastCodePassed: cpLastCode.filter((a) => a.passed).length,
      types: cpTypes,
      payloadKeysUnion: checkpointPayloadKeys,
      hasConceptKeyInPayload,
      hasAnswerTextInPayload,
      shortAnswerRows,
      timeline: cp.parsed.slice(-6).map((r) => ({
        checkpointId: r.parsed.checkpointId,
        type: r.parsed.type,
        passed: r.parsed.passed,
        judgedBy: r.parsed.judgedBy,
        detail: trunc(r.parsed.detail, 160),
        selectedOptionIds: r.parsed.selectedOptionIds ?? null,
        occurredAt: r.occurredAt,
      })),
      historyCount: checkpointHistory.length,
    },
    evidenceByType: ev.byType,
    anchor: { rows: anchorRows.length, conceptKeys: anchorConceptKeys },
    baseline: {
      count: initialKS.length,
      matchedHow: baselineMatch.how,
      matched: baselineMatch.entry ? { name: baselineMatch.entry.name, status: baselineMatch.entry.status, progress: baselineMatch.entry.progress } : null,
    },
    knowledgeState: {
      count: ksEntries.length,
      statusCounts: ksStatusCounts,
      matchedHow: ksMatch.how,
      matched: ksMatch.entry ? { name: ksMatch.entry.name, status: ksMatch.entry.status, progress: ksMatch.entry.progress } : null,
    },
    ktEstimate: {
      matchedConceptKey: ktMatch ? ktMatch.conceptKey : null,
      mastery: ktMatch ? ktMatch.mastery : null,
      evidence: ktMatch ? trunc(ktMatch.evidence, 200) : null,
      currentTaskDifficulty: ktEstimate ? ktEstimate.currentTaskDifficulty : null,
      recommendation: ktEstimate ? ktEstimate.recommendation : null,
      conceptCount: ktConcepts.length,
    },
    wrapup: wu ? {
      status: wu.status,
      sources: wu.sources ?? null,
      itemCount: wuItems.length,
      matchedHow: wuMatch.how,
      matched: wuMatch.entry ? { name: wuMatch.entry.name, status: wuMatch.entry.status, progress: wuMatch.entry.progress, evidence: trunc(wuMatch.entry.evidence, 200) } : null,
      avgUnderstanding: wu.evidence ? (wu.evidence.avgUnderstanding ?? null) : null,
      turnCount: wu.evidence ? (wu.evidence.turnCount ?? null) : null,
    } : null,
    misconceptions: {
      linkedTotal: mis.length,
      inSession: misInSession.length,
      inSessionActive: misInSession.filter((m) => m.status !== 'addressed').length,
      inSessionDetails: misInSession.slice(0, 3).map((m) => ({ status: m.status, hypothesis: trunc(m.hypothesis, 120), occurrenceCount: m.occurrenceCount })),
    },
    memoryTrace: mt ? {
      matchBy: mtMatchBy,
      masteryScore: mt.masteryScore,
      stability: mt.stability,
      ktMasteryEma: mt.ktMasteryEma,
      extractionCount: mt.extractionCount,
      source: mt.source,
      lastSeenAt: mt.lastSeenAt,
      touchedAfterSession: mt.lastSeenAt != null && mt.lastSeenAt > u.endTime,
    } : null,
    later: laterInfo,
    inference,
    verdict,
  };
}

// ---------------------------------------------------------------- summary

function summarizeCoverage(units) {
  const n = units.length;
  const inc = (pred) => units.filter(pred).length;
  const sum = (fn) => units.reduce((acc, u) => acc + fn(u), 0);
  const evidenceTypeTotals = {};
  for (const u of units) {
    for (const [t, c] of Object.entries(u.evidenceByType)) evidenceTypeTotals[t] = (evidenceTypeTotals[t] || 0) + c;
  }
  return {
    units: n,
    studentMessagesMissing: inc((u) => u.messages.userMsgs === 0),
    messagesFromLegacyColumn: inc((u) => u.messages.msgSource === 'legacyColumn'),
    checkpointEvidenceRows: sum((u) => u.checkpoint.evidenceRows),
    checkpointDistinct: sum((u) => u.checkpoint.distinctCheckpoints),
    checkpointRetried: sum((u) => (u.checkpoint.maxAttempts > 1 ? 1 : 0)),
    checkpointPayloadHasConceptKey: inc((u) => u.checkpoint.hasConceptKeyInPayload),
    checkpointPayloadHasAnswerText: inc((u) => u.checkpoint.hasAnswerTextInPayload),
    shortAnswerEvidenceRows: sum((u) => u.checkpoint.shortAnswerRows),
    noCodeCheckpoint: inc((u) => u.checkpoint.lastCode === 0),
    modelReferenceOnly: inc((u) => u.checkpoint.lastCode === 0 && u.checkpoint.lastModel > 0),
    baselineEmpty: inc((u) => u.baseline.count === 0),
    baselineMatched: inc((u) => u.baseline.matchedHow === 'name-exact' || u.baseline.matchedHow === 'name-substring'),
    ksMatched: inc((u) => u.knowledgeState.matchedHow === 'name-exact' || u.knowledgeState.matchedHow === 'name-substring'),
    wrapupItemMatched: inc((u) => u.wrapup && (u.wrapup.matchedHow === 'name-exact' || u.wrapup.matchedHow === 'name-substring')),
    wrapupItemsEmpty: inc((u) => u.wrapup && u.wrapup.itemCount === 0),
    anchorUnits: inc((u) => u.anchor.rows > 0),
    misconceptionLinkedUnits: inc((u) => u.misconceptions.linkedTotal > 0),
    misconceptionActiveInSession: inc((u) => u.misconceptions.inSessionActive > 0),
    memoryTracePresent: inc((u) => !!u.memoryTrace),
    laterPresent: inc((u) => !!u.later),
    laterCodeResolved: inc((u) => u.later && u.later.outcome !== 'unresolved_no_instrument'),
    evidenceTypeTotals,
  };
}

function buildConsistency(units) {
  const rows = units.map((u) => ({
    sessionId: u.sessionId,
    user: short(u.userId),
    conceptLabel: u.conceptLabel,
    endTime: iso(u.endTime),
    inferred: u.inference.label,
    inferredTrace: u.inference.trace,
    laterSession: u.later ? u.later.sessionId : null,
    laterGapHours: u.later ? u.later.gapHours : null,
    later: u.later ? u.later.outcome : 'no_later',
    laterTrace: u.later ? u.later.outcomeTrace : null,
    verdict: u.verdict,
  }));
  const matrix = {};
  for (const r of rows) {
    const key = `${r.inferred} × ${r.later}`;
    matrix[key] = (matrix[key] || 0) + 1;
  }
  const counts = { consistent: 0, overestimate: 0, underestimate: 0, not_comparable: 0 };
  for (const r of rows) counts[r.verdict] = (counts[r.verdict] || 0) + 1;
  return {
    rows,
    matrix,
    counts,
    mismatches: rows.filter((r) => r.verdict === 'overestimate' || r.verdict === 'underestimate'),
  };
}

// ---------------------------------------------------------------- chains

function buildChainMd(u, idx) {
  const L = [];
  const p = (s = '') => L.push(s);
  p(`## 链路样例 #${idx} — ${u.conceptLabel || '(无 canonical label)'}`);
  p();
  p(`**[0] 单元**：会话 \`${u.sessionId}\`；学员 \`${u.userId}\`；路径 \`${u.learningPathId || '-'}\`；canonical KC \`${u.conceptId}\`。`);
  p();
  p(`**[1] 基线（T0）**：课次 ${iso(u.startTime)} → ${iso(u.endTime)}。`);
  p(`- 课前快照 \`initialKnowledgeState\`：${u.baseline.count} 条；匹配（${u.baseline.matchedHow}）：${u.baseline.matched ? `「${u.baseline.matched.name}」status=${u.baseline.matched.status} progress=${u.baseline.matched.progress}` : '无'}。`);
  p();
  p(`**[2] 证据（学生输入=证据）**：`);
  p(`- 消息：学员 ${u.messages.userMsgs} 条 / 教师 ${u.messages.assistantMsgs} 条（${u.messages.msgSource}）；教师带 analysis ${u.messages.assistantWithAnalysis} 条。`);
  p(`- 检查点证据：${u.checkpoint.evidenceRows} 行 / ${u.checkpoint.distinctCheckpoints} 题（重答最多 ${u.checkpoint.maxAttempts} 次；judgedBy=code ${u.checkpoint.lastCode} / model-reference ${u.checkpoint.lastModel}）。`);
  for (const t of u.checkpoint.timeline) {
    p(`  - [${iso(t.occurredAt)}] ${t.checkpointId} ${t.type} passed=${t.passed} judgedBy=${t.judgedBy}${t.detail ? ` — ${t.detail}` : ''}`);
  }
  if (u.misconceptions.inSession > 0) {
    p(`- 在课误解 ${u.misconceptions.inSession} 条（活跃 ${u.misconceptions.inSessionActive}）：${u.misconceptions.inSessionDetails.map((m) => `[${m.status}] ${m.hypothesis}`).join('；')}`);
  } else {
    p(`- 在课误解：0 条（该 KC 历史台账共 ${u.misconceptions.linkedTotal} 条）。`);
  }
  const student = u.messages.studentSnippets.filter((s) => !s.checkpoint)[0];
  const answer = u.messages.studentSnippets.find((s) => s.checkpoint);
  if (student) p(`- 学生原话样本：${student.text}`);
  if (answer) p(`- 作答合成消息样本：${answer.text}`);
  p();
  p(`**[3] 推断 v0（规则，显式留痕）**：\`${u.inference.label}\` — ${u.inference.reason}`);
  p(`- trace：code 最终作答 ${u.inference.trace.codeLast}（通过 ${u.inference.trace.codePassed} / 未通过 ${u.inference.trace.codeFailed}）；model-reference 最终 ${u.inference.trace.modelLast}；在课活跃误解 ${u.inference.trace.activeMisInSession}。`);
  p(`- 辅助（不作判据）：课后 knowledgeState ${u.knowledgeState.count} 条 [${JSON.stringify(u.knowledgeState.statusCounts)}]；ktEstimate ${u.ktEstimate.matchedConceptKey ? `mastery=${u.ktEstimate.mastery}` : '无匹配'}；memory_trace ${u.memoryTrace ? `mastery=${u.memoryTrace.masteryScore} stability=${u.memoryTrace.stability} ktEma=${u.memoryTrace.ktMasteryEma}` : '缺'}。`);
  p();
  p(`**[4] 假想决策（本轮不执行，仅演示消费口径）**：${HYPOTHETICAL_DECISION[u.inference.label] || '-'}`);
  p();
  p(`**[5] 后来核查**：`);
  if (u.later) {
    p(`- 最近后续终态会话 \`${u.later.sessionId}\`（${u.later.status}），间隔 ${u.later.gapHours} 小时；该 KC 后续终态会话共 ${u.later.totalLaterTerminalSessions} 节。`);
    p(`- 后续独立仪器（code 检查点）：${u.later.codeCheckpoints} 行 → 判定 \`${u.later.outcome}\`（通过 ${u.later.outcomeTrace.codePassed ?? 0} / 未通过 ${u.later.outcomeTrace.codeFailed ?? 0}）。`);
    p(`- 辅助：后续 knowledgeState ${u.later.ksEntryCount} 条 [${JSON.stringify(u.later.ksStatusCounts)}]（按 canonical 名匹配：${u.later.ksMatched}）；wrapup=${u.later.wrapupStatus ?? '无'} avgUnderstanding=${u.later.wrapupAvgUnderstanding ?? '-'}。`);
  } else {
    p('- 无后续终态同 KC 会话。');
  }
  p();
  p(`**[6] 判读**：${u.verdict}（推断 ${u.inference.label} × 后来 ${u.later ? u.later.outcome : 'no_later'}）。`);
  p();
  return L.join('\n');
}

function pickChains(units, k) {
  if (k <= 0) return [];
  const resolved = units.filter((u) => u.verdict === 'consistent' || u.verdict === 'overestimate' || u.verdict === 'underestimate');
  const consistent = resolved.filter((u) => u.verdict === 'consistent');
  const mismatch = resolved.filter((u) => u.verdict === 'overestimate' || u.verdict === 'underestimate');
  const picked = [];
  if (consistent[0]) picked.push(consistent[0]);
  if (mismatch[0]) picked.push(mismatch[0]);
  for (const u of [...consistent, ...mismatch, ...resolved, ...units]) {
    if (picked.length >= k) break;
    if (!picked.includes(u)) picked.push(u);
  }
  return picked.slice(0, k);
}

// ---------------------------------------------------------------- main

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const dbPath = args.db ? path.resolve(args.db) : DEFAULT_DB;
  if (!fs.existsSync(dbPath)) throw new Error(`DB 文件不存在：${dbPath}`);
  const snapshotMs = Date.now();
  const t0 = Date.now();

  const db = await openDb(dbPath);
  try {
    await run(db, 'PRAGMA busy_timeout = 30000');
    await run(db, 'PRAGMA query_only = ON');
    db.configure('busyTimeout', 30000);
    const ver = await get(db, 'SELECT sqlite_version() AS v');

    const candidates = await all(db, CANDIDATE_SQL, [snapshotMs]);
    const pickedIdx = pickEqualInterval(candidates, args.sample);
    const picked = pickedIdx.map((i) => candidates[i]);

    const census = (await get(db, `
      SELECT
        (SELECT count(*) FROM teaching_sessions WHERE status='completed' AND endTime IS NOT NULL) AS completedAll,
        (SELECT count(*) FROM teaching_sessions s JOIN subtasks st ON st.id=s.taskId
          WHERE s.status='completed' AND st.conceptId IS NOT NULL) AS completedWithConcept,
        (SELECT count(*) FROM teaching_sessions s WHERE s.status='completed' AND s.endTime IS NOT NULL
          AND EXISTS (SELECT 1 FROM learner_evidence e WHERE e.sessionId=s.id AND e.evidenceType='checkpoint:result')) AS completedWithCpEvidence,
        (SELECT count(*) FROM teaching_sessions s WHERE s.status='completed' AND s.endTime IS NOT NULL
          AND EXISTS (SELECT 1 FROM learner_evidence e WHERE e.sessionId=s.id AND e.evidenceType='anchor:result')) AS completedWithAnchor,
        (SELECT count(*) FROM teaching_sessions WHERE status='completed' AND teachingState IS NOT NULL
          AND json_valid(teachingState) AND json_array_length(teachingState,'$.sessionArtifacts.initialKnowledgeState')>0) AS completedWithBaseline,
        (SELECT count(*) FROM learner_evidence WHERE evidenceType='checkpoint:result') AS cpEvidenceAll,
        (SELECT count(*) FROM learner_evidence WHERE evidenceType='anchor:result') AS anchorEvidenceAll
    `));

    const units = [];
    for (const u of picked) units.push(await collectUnit(db, u));

    const coverage = { perUnit: units.map((u) => ({
      sessionId: u.sessionId,
      conceptLabel: u.conceptLabel,
      endTime: iso(u.endTime),
      userMsgs: u.messages.userMsgs,
      msgSource: u.messages.msgSource,
      cpRows: u.checkpoint.evidenceRows,
      cpDistinct: u.checkpoint.distinctCheckpoints,
      cpLastCode: u.checkpoint.lastCode,
      cpLastCodePassed: u.checkpoint.lastCodePassed,
      cpPayloadHasConceptKey: u.checkpoint.hasConceptKeyInPayload,
      baselineCount: u.baseline.count,
      baselineMatchedHow: u.baseline.matchedHow,
      ksMatchedHow: u.knowledgeState.matchedHow,
      wrapupItemMatchedHow: u.wrapup ? u.wrapup.matchedHow : null,
      anchorRows: u.anchor.rows,
      misInSession: u.misconceptions.inSession,
      memoryTrace: !!u.memoryTrace,
      later: !!u.later,
      laterOutcome: u.later ? u.later.outcome : null,
      inferred: u.inference.label,
      verdict: u.verdict,
    })), summary: summarizeCoverage(units) };

    const consistency = buildConsistency(units);
    const chains = pickChains(units, args.chains).map((u, i) => ({
      sessionId: u.sessionId, verdict: u.verdict,
      markdown: buildChainMd(u, i + 1),
    }));

    const result = {
      meta: {
        probe: 'measurement-probe/v0',
        generatedAt: new Date().toISOString(),
        snapshotMs,
        snapshotIso: iso(snapshotMs),
        dbPath,
        dbSqliteVersion: ver ? ver.v : null,
        gitCommit: gitCommit(),
        node: process.version,
        readOnly: true,
        noNetwork: true,
        noLlm: true,
        sampleRequested: args.sample,
        sampleSize: picked.length,
        candidateCount: candidates.length,
        selectionRule: '过滤后按 endTime 升序等距抽样（确定性）',
        filters: FILTERS,
        v0Rule: '每个 checkpointId 取最终作答；code 最终全部通过且在课无活跃误解 → likely_mastered；code 有未通过或在课有活跃误解 → likely_not_mastered；无 code 最终作答 → insufficient_evidence',
        laterRule: '同 userId+conceptId 的最近后续 completed/timeout 会话；其 code 检查点最终作答全过 → later_mastered，否则 later_not_mastered；无 code 检查点 → unresolved_no_instrument',
      },
      census,
      selection: {
        candidateCount: candidates.length,
        sampleRequested: args.sample,
        sampleSize: picked.length,
        picked: picked.map((u) => ({ sessionId: u.sessionId, endTime: iso(u.endTime), conceptLabel: u.conceptLabel })),
      },
      coverage,
      consistency,
      chains,
      units,
      discipline: [
        'DB 以 sqlite3 OPEN_READONLY + busy_timeout=30000 + query_only=ON 打开，全程零写库。',
        '零 LLM、零网络请求；假想决策仅打印，不做任何系统动作。',
        'dev.db 是活库：所有计数为 snapshotMs 时刻值，复现请以同一过滤与快照口径比对。',
        '本探针只新建 backend/scripts/measurement-probe/ 下的文件；未修改任何既有文件。',
      ],
    };

    const outDir = args.out ? path.resolve(args.out) : path.join(__dirname, 'out');
    fs.mkdirSync(outDir, { recursive: true });
    const jsonPath = path.join(outDir, 'result.json');
    fs.writeFileSync(jsonPath, JSON.stringify(result, null, 2), 'utf8');
    const chainsPath = path.join(outDir, 'chains.md');
    fs.writeFileSync(chainsPath, chains.map((c) => c.markdown).join('\n---\n\n'), 'utf8');

    const cs = coverage.summary;
    const ct = consistency.counts;
    console.log(`[measurement-probe v0] snapshot=${result.meta.snapshotIso} sqlite=${result.meta.dbSqliteVersion} commit=${result.meta.gitCommit || '-'} db=${dbPath}`);
    console.log(`[选择] 候选 ${candidates.length} 单元（completed ∩ canonical KC ∩ 检查点证据 ∩ 有后续终态同 KC）→ 等距抽样 ${picked.length}`);
    console.log(`[覆盖] 学生消息缺位 ${cs.studentMessagesMissing}；基线空 ${cs.baselineEmpty}；KS 名匹配 ${cs.ksMatched}/${cs.units}；检查点 payload 带 conceptKey ${cs.checkpointPayloadHasConceptKey}（应 0）；short_answer 行 ${cs.shortAnswerEvidenceRows}；无 code 检查点 ${cs.noCodeCheckpoint}；anchor 单元 ${cs.anchorUnits}；memory_trace 单元 ${cs.memoryTracePresent}`);
    console.log(`[对照] consistent=${ct.consistent} overestimate=${ct.overestimate} underestimate=${ct.underestimate} not_comparable=${ct.not_comparable}`);
    console.log(`[链样例] ${chains.length} 条 → ${chainsPath}`);
    console.log(`[输出] ${jsonPath}（耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s）`);
  } finally {
    await new Promise((res) => db.close(() => res()));
  }
}

main().catch((e) => {
  console.error('[measurement-probe] 失败：', e && e.stack ? e.stack : e);
  process.exit(1);
});
