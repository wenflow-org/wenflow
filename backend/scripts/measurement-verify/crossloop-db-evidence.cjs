#!/usr/bin/env node
/** crossloop-db-evidence.cjs — 第二轮跨课取证·只读 DB 证据提取器。
 * 纪律：node:sqlite readOnly + busy_timeout=5000；显式列名（禁 SELECT *）；外部输入全部 ? 绑定。
 * 输出：stdout JSON（每节独立），供 verdict 引用原文。
 */
'use strict';
const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..', '..');
const DB = path.join(ROOT, 'prisma', 'dev.db');

const db = new DatabaseSync(DB, { readOnly: true });
db.exec('PRAGMA busy_timeout=5000');

// UTF-8 落盘 tee（Windows 管道会按 GBK 解码导致乱码，证据文件必须由脚本直写）
const fs = require('node:fs');
const OUT_PATH = path.join(__dirname, 'out', `crossloop-${(process.argv[2] || 'seq')}.json`);
const LINES = [];
const origLog = console.log.bind(console);
console.log = (...a) => { const s = a.map(x => typeof x === 'string' ? x : JSON.stringify(x, null, 1)).join(' '); LINES.push(s); origLog(...a); };
process.on('exit', () => { try { fs.writeFileSync(OUT_PATH, LINES.join('\n'), 'utf8'); } catch {} });

const SEQ_USER = 'user_1447d5a2-8ff8-47f1-a0e8-cc67d741223d';
const PCL = {
  a1Open: 'pcl_26336914-981e-41c0-97fd-c7c3e7f669ac',
  a2Open: 'pcl_08198a37-4304-4462-80b3-30327b969357',
  a2Turn1: 'pcl_704c24dc-f42f-495e-8028-e05ae598b62d',
  a3OpenOk: 'pcl_27441eed-eeaa-471f-ad37-3c41eb915cfd',
  a3OpenFail: 'pcl_04e3118c-4948-4c95-abb5-ccee18f2d4fc',
  a3Turn1: 'pcl_37380b67-1675-41b0-9986-629289bef0b0',
  a1Wrap: 'pcl_b085c76a-1e08-4b44-abb0-02d03b95e427',
  a2Wrap: 'pcl_5a639b0e-7252-4e68-b75e-17271c3332cb',
  a3Wrap: 'pcl_22f485ad-6959-4d9c-9a37-15b182277b1d',
};

function sectionsAround(text, needles, radius = 420) {
  const out = {};
  for (const needle of needles) {
    const idx = text.indexOf(needle);
    out[needle] = idx === -1 ? null : text.slice(Math.max(0, idx - 40), idx + radius);
  }
  return out;
}

function step(name, fn) {
  try {
    console.log(`\n===== ${name} =====`);
    const v = fn();
    console.log(typeof v === 'string' ? v : JSON.stringify(v, null, 1));
  } catch (e) {
    console.log(`ERROR: ${e.message}`);
  }
}

const mode = process.argv[2] || 'seq';

if (mode === 'seq') {
  step('S1.a2-opening-payload-head', () => {
    const r = db.prepare('SELECT id, agentId, createdAt, length(userPayload) AS upLen, success FROM prompt_call_logs WHERE id=?').get(PCL.a2Open);
    const p = db.prepare('SELECT userPayload FROM prompt_call_logs WHERE id=?').get(PCL.a2Open).userPayload;
    return { row: r, head: p.slice(0, 2600) };
  });

  step('S2.a2-opening-sections', () => {
    const p = db.prepare('SELECT userPayload FROM prompt_call_logs WHERE id=?').get(PCL.a2Open).userPayload;
    return sectionsAround(p, ['lastLessonRecap', 'memoryWarmup', 'priorMisconceptions', 'temporalGap', 'successBand', 'misconception']);
  });

  step('S3.a2-turn1-sections', () => {
    const p = db.prepare('SELECT userPayload FROM prompt_call_logs WHERE id=?').get(PCL.a2Turn1).userPayload;
    return sectionsAround(p, ['lastLessonRecap', 'memoryWarmup', 'priorMisconceptions', 'temporalGap', 'successBand'], 500);
  });

  step('S4.a2-turn1-recap-full', () => {
    const p = db.prepare('SELECT userPayload FROM prompt_call_logs WHERE id=?').get(PCL.a2Turn1).userPayload;
    const i = p.indexOf('lastLessonRecap');
    return i === -1 ? 'NOT FOUND' : p.slice(i, i + 1400);
  });

  step('S5.a2-turn1-priorMisconceptions-full', () => {
    const p = db.prepare('SELECT userPayload FROM prompt_call_logs WHERE id=?').get(PCL.a2Turn1).userPayload;
    const i = p.indexOf('priorMisconceptions');
    return i === -1 ? 'NOT FOUND' : p.slice(i, i + 1200);
  });

  step('S6.a3-turn1-sections', () => {
    const p = db.prepare('SELECT userPayload FROM prompt_call_logs WHERE id=?').get(PCL.a3Turn1).userPayload;
    return sectionsAround(p, ['lastLessonRecap', 'memoryWarmup', 'priorMisconceptions', 'temporalGap', 'successBand', 'mode'], 420);
  });

  step('S7.learning-metrics-seq-user', () => {
    return db.prepare('SELECT metricType, lss, ktl, lf, lsb, sourceKey, recordedAt FROM learning_metrics WHERE userId=? ORDER BY recordedAt').all(SEQ_USER);
  });

  step('S8.misconception-ledger-seq-user', () => {
    return db.prepare("SELECT id, conceptKey, substr(hypothesis,1,80) AS hypothesis80, confidence, status, occurrenceCount, firstSeenAt, lastSeenAt, lastSessionId FROM misconception_ledger WHERE userId=? ORDER BY firstSeenAt").all(SEQ_USER);
  });

  step('S9.memory-traces-seq-user', () => {
    return db.prepare('SELECT conceptKey, masteryScore, stability, fsrsStability, fsrsDifficulty, fsrsReps, fsrsLapses, dueAt, lastSeenAt, ktMasteryEma, extractionCount, updatedAt FROM memory_traces WHERE userId=? ORDER BY conceptKey').all(SEQ_USER);
  });

  step('S10.learner-evidence-seq-user', () => {
    return db.prepare("SELECT evidenceType, substr(evidenceKey,1,60) AS evidenceKey60, sessionId, occurredAt, substr(payload,1,220) AS payload220 FROM learner_evidence WHERE userId=? ORDER BY occurredAt").all(SEQ_USER);
  });

  step('S11.teaching-sessions-seq-user', () => {
    return db.prepare("SELECT id, mode, status, startTime, endTime, substr(knowledgeState,1,900) AS knowledgeState900 FROM teaching_sessions WHERE userId=? ORDER BY startTime").all(SEQ_USER);
  });

  step('S12.a1-wrapup-stateUpdate', () => {
    const w = db.prepare('SELECT wrapup FROM teaching_sessions WHERE id=?').get('teaching_user_1447d5a2-8ff8-47f1-a0e8-cc67d741223d_c646b45d-0ba9-4881-853a-ee556f2372d5');
    if (!w || !w.wrapup) return 'wrapup NULL';
    const j = JSON.parse(w.wrapup);
    const keys = Object.keys(j);
    const su = j.stateUpdate ?? j.learningMetricsUpdate ?? null;
    return { wrapupKeys: keys, stateUpdate: su };
  });

  step('S13.a2-wrapup-stateUpdate', () => {
    const w = db.prepare('SELECT wrapup FROM teaching_sessions WHERE id=?').get('teaching_user_1447d5a2-8ff8-47f1-a0e8-cc67d741223d_2b33f54d-5a9e-44b1-9d5d-4316ec655e60');
    if (!w || !w.wrapup) return 'wrapup NULL';
    const j = JSON.parse(w.wrapup);
    const su = j.stateUpdate ?? null;
    return { stateUpdate: su };
  });

  step('S14.a3-wrapup-stateUpdate-and-mode', () => {
    const w = db.prepare('SELECT wrapup, mode, status FROM teaching_sessions WHERE id=?').get('teaching_user_1447d5a2-8ff8-47f1-a0e8-cc67d741223d_62ec1f40-6117-49c8-b34e-502cecb16be5');
    if (!w) return 'session NOT FOUND';
    const j = w.wrapup ? JSON.parse(w.wrapup) : null;
    return { mode: w.mode, status: w.status, stateUpdate: j ? j.stateUpdate : null };
  });

  step('S15.domain-event-outbox-seq-user', () => {
    return db.prepare("SELECT eventType, status, occurredAt, substr(aggregateId,1,40) AS aggregateId40 FROM domain_event_outbox WHERE userId=? ORDER BY occurredAt").all(SEQ_USER);
  });

  step('S16.priorMisconception-occurrence-scan', () => {
    const scan = (id) => {
      const p = db.prepare('SELECT userPayload FROM prompt_call_logs WHERE id=?').get(id).userPayload;
      const occ = [];
      let i = -1;
      while ((i = p.indexOf('priorMisconceptions', i + 1)) !== -1) {
        occ.push(p.slice(Math.max(0, i - 10), i + 160).replace(/\s+/g, ' '));
      }
      return {
        countPriorMisconceptions: occ.length,
        occurrences: occ,
        hasConcept1: p.includes('concept-1'),
        hasConcept2: p.includes('concept-2'),
        hasLedgerTextAllPlantCells: p.includes('以为植物所有部位都能进行光合作用'),
        hasLedgerTextChloroplastInAll: p.includes('凡是植物细胞'),
        countMemoryWarmup: (p.match(/memoryWarmup/g) || []).length,
        countLastLessonRecap: (p.match(/lastLessonRecap/g) || []).length,
        hasReviewPlan: p.includes('reviewPlan'),
      };
    };
    return { a2Turn1: scan(PCL.a2Turn1), a3Turn1: scan(PCL.a3Turn1), a2Open: scan(PCL.a2Open) };
  });

  step('S17.a3-turn1-taskDifficulty-evidence', () => {
    const p = db.prepare('SELECT userPayload FROM prompt_call_logs WHERE id=?').get(PCL.a3Turn1).userPayload;
    const i = p.indexOf('"taskDifficulty"');
    return i === -1 ? 'NOT FOUND' : p.slice(i, i + 700);
  });

  step('S18.a3-open-ok-payload', () => {
    const r = db.prepare('SELECT id, agentId, createdAt, success, length(userPayload) AS upLen FROM prompt_call_logs WHERE id=?').get(PCL.a3OpenOk);
    const p = db.prepare('SELECT userPayload FROM prompt_call_logs WHERE id=?').get(PCL.a3OpenOk);
    return { row: r, head: p ? p.userPayload.slice(0, 1800) : null };
  });
}

if (mode === 'adv') {
  const VLS = {
    'VL-1': 'ee52b287-29b4-4d0b-9995-303f13322f8c',
    'VL-B1': '0b27bb9e-afed-4a7a-9991-1dd404b6c4b5',
    'VL-B2': '802c1a8a-423f-4e9c-aa15-68035cecede2',
    'VL-B3': '7a3f3955-6f4e-4dbb-9f00-d92969cd019c',
    'VL-B4': 'b78b4b66-dd38-4a7b-ab0f-23284c7b3847',
    'VL-B5': '7099f596-8962-4ada-a10f-6dcc6c2d4578',
  };

  step('A1.vl-review-completed-evidence-count', () => {
    const rows = {};
    for (const [k, u] of Object.entries(VLS)) {
      rows[k] = db.prepare("SELECT COUNT(*) AS n FROM learner_evidence WHERE userId=? AND evidenceType='review:completed'").get(u).n;
    }
    return rows;
  });

  step('A2.domain-event-outbox-vl-users', () => {
    const rows = {};
    for (const [k, u] of Object.entries(VLS)) {
      rows[k] = db.prepare('SELECT eventType, COUNT(*) AS n FROM domain_event_outbox WHERE userId=? GROUP BY eventType').all(u);
    }
    return rows;
  });

  step('A3.vl-memory-traces-fsrs-nonnull', () => {
    const rows = {};
    for (const [k, u] of Object.entries(VLS)) {
      rows[k] = db.prepare('SELECT COUNT(*) AS total, SUM(CASE WHEN fsrsStability IS NOT NULL THEN 1 ELSE 0 END) AS fsrsNonNull, SUM(CASE WHEN dueAt IS NOT NULL THEN 1 ELSE 0 END) AS dueAtSet FROM memory_traces WHERE userId=?').get(u);
    }
    return rows;
  });

  step('A4.vl-warmup-due-resample', () => {
    // B1 的两个温故点：dueAt 与 lastSeenAt 现值（对照 ad-summary「复注」异常）
    return db.prepare("SELECT userId, conceptKey, masteryScore, stability, fsrsStability, fsrsReps, dueAt, lastSeenAt, extractionCount, updatedAt FROM memory_traces WHERE userId IN (?,?) AND conceptKey IN ('解释过夜玻璃罩蜡烛熄灭','解释两过程的并行相反关系','读出箭头的进出物质','确认VCU与BMS通讯正常') ORDER BY userId, conceptKey").all(VLS['VL-B1'], VLS['VL-1']);
  });

  step('A5.vl-teaching-sessions-3day', () => {
    const rows = [];
    for (const [k, u] of Object.entries(VLS)) {
      const s = db.prepare("SELECT id, mode, status, startTime, endTime, substr(knowledgeState,1,240) AS ks240 FROM teaching_sessions WHERE userId=? AND createdAt >= ? ORDER BY startTime").all(u, 1791228800000); // >= 2026-10-05T00:00Z 窗
      rows.push({ vl: k, sessions: s });
    }
    return rows;
  });

  step('A6.vl-warmup-artifacts-teachingState', () => {
    // 找 day2-end 之后开的会话（如 B1 d1fda105）里 memoryWarmup 结构段
    const out = [];
    for (const [k, u] of Object.entries(VLS)) {
      const ss = db.prepare("SELECT id, startTime FROM teaching_sessions WHERE userId=? AND startTime >= ? ORDER BY startTime").all(u, 1791230000000);
      for (const s of ss) {
        const t = db.prepare('SELECT teachingState FROM teaching_sessions WHERE id=?').get(s.id);
        if (!t || !t.teachingState) continue;
        let ts;
        try { ts = JSON.parse(t.teachingState); } catch { continue; }
        const mw = ts?.sessionArtifacts?.memoryWarmup ?? ts?.memoryWarmup ?? null;
        if (mw) out.push({ vl: k, sessionId: s.id.slice(0, 26), memoryWarmup: mw });
      }
    }
    return out;
  });

  step('A7.vl-lesson-completed-outbox-detail', () => {
    return db.prepare("SELECT userId, eventType, status, substr(aggregateId,1,50) AS agg50, occurredAt, processedAt FROM domain_event_outbox WHERE userId IN (?,?,?,?,?,?) ORDER BY occurredAt").all(
      VLS['VL-1'], VLS['VL-B1'], VLS['VL-B2'], VLS['VL-B3'], VLS['VL-B4'], VLS['VL-B5']
    );
  });
}

db.close();
