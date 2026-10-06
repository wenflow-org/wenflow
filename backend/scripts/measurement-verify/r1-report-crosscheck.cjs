#!/usr/bin/env node
/**
 * ROUND1 报告口径交叉核对（只读，报告撰写人用）
 * 目的：钉死外部评审 challenge④ 指出的三处跨材料口径分歧 + 各采纳课 wrapup 字节数：
 *   a) checkpoint:attempt 全表行数与时间归属（「今晚净增 6 行/全表 12 行系 H1 昨日新增」vs「12 行全部落在今晚窗口」）
 *   b) learning_metrics metricType='session_load' 今晚窗口行数（趋势组记 11 行 vs 评审窗口 16 行）
 *   c) task:difficulty:adjustment 归属（「5 个 API/GUI 单课用户 0 行」vs 评审「user_607385bb 有 1 行」）
 *   d) 11 采纳课 wrapup 字节数（S4 两材料分别记 9641 与 5369）
 * 纪律：node:sqlite DatabaseSync readOnly + busy_timeout=5000，显式列名，参数绑定，
 *       不读 teaching_sessions.messages 大列，不写库、不改码、无 git 操作。
 */
const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');

const DB_PATH = path.join(__dirname, '..', '..', 'prisma', 'dev.db');
// 2026-10-05T00:00:00Z（今晚自然日起点，ms）
const WINDOW_START = 1791158400000;

const db = new DatabaseSync(DB_PATH, { readOnly: true });
db.exec('PRAGMA busy_timeout=5000');

const cols = (table) => db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
const pick = (list, candidates) => candidates.find((c) => list.includes(c));

const evCols = cols('learner_evidence');
const evType = pick(evCols, ['evidenceType', 'evidence_type']);
const evTime = pick(evCols, ['occurredAt', 'occurred_at', 'createdAt', 'created_at']);
const evUser = pick(evCols, ['userId', 'user_id']);
const evSession = pick(evCols, ['sessionId', 'session_id']);

const lmCols = cols('learning_metrics');
const lmType = pick(lmCols, ['metricType', 'metric_type']);
const lmTime = pick(lmCols, ['recordedAt', 'createdAt', 'created_at', 'calculatedAt', 'occurredAt', 'occurred_at']);

const out = { windowStart: WINDOW_START, columnsUsed: { learner_evidence: { evType, evTime, evUser, evSession }, learning_metrics: { lmType, lmTime } } };

// d) 11 采纳课 wrapup 字节数与状态（LENGTH 按字符，JSON 全 ASCII 等价字节；显式列名，不取 messages）
const sessions = [
  ['GUI-1', 'teaching_user_c93a688c-56aa-4253-a24a-a162550186ce_51e8f0df-da4a-4647-a702-fd80bbb33983'],
  ['S1-pass', 'teaching_user_68c94c29-95f8-4f4d-876f-eb8b1aa67eca_a438786c-f859-401e-8e11-d2f4db9b2d49'],
  ['S2-skip', 'teaching_user_dbb62604-d3d5-4da1-a733-3688d96fce4b_fee1b341-a11c-47d0-b784-43171227ca01'],
  ['S3-cap', 'teaching_user_7d2c6046-887a-4900-a4df-af9061b63bf2_30a25984-6623-4165-94f8-581866a40f84'],
  ['S4-unresolved', 'teaching_user_6c042205-50c3-4177-b640-fd4d606a3fba_27f1e68f-d298-4d29-af07-a93afdf746dd'],
  ['VL-1', 'teaching_ee52b287-29b4-4d0b-9995-303f13322f8c_63099202-f10f-4252-9816-434b253625fa'],
  ['VL-B1', 'teaching_0b27bb9e-afed-4a7a-9991-1dd404b6c4b5_ccee4b32-60a4-49cb-867c-d098edb64e63'],
  ['VL-B2', 'teaching_802c1a8a-423f-4e9c-aa15-68035cecede2_16e1515c-3994-49a5-b0a9-57ffadfcabde'],
  ['VL-B3', 'teaching_7a3f3955-6f4e-4dbb-9f00-d92969cd019c_89e6e0d5-6950-493c-97c0-67a52519e31d'],
  ['VL-B4', 'teaching_b78b4b66-dd38-4a7b-ab0f-23284c7b3847_d9ca93b6-5289-41c9-882f-728cd1b2489b'],
  ['VL-B5', 'teaching_7099f596-8962-4ada-a10f-6dcc6c2d4578_95d31f21-9a97-4755-bcc2-611ae03f3640'],
];
out.wrapupPerAdoptedSession = sessions.map(([label, id]) => {
  const r = db
    .prepare('SELECT id, status, LENGTH(wrapup) AS wrapupLen FROM teaching_sessions WHERE id = ?')
    .get(id);
  let wrapupStatus = null;
  if (r && r.wrapupLen != null) {
    const raw = db.prepare('SELECT wrapup AS w FROM teaching_sessions WHERE id = ?').get(id).w;
    try { wrapupStatus = JSON.parse(raw).status ?? null; } catch { wrapupStatus = 'PARSE_FAIL'; }
  }
  return { label, found: !!r, sessionStatus: r?.status ?? null, wrapupLen: r?.wrapupLen ?? null, wrapupStatus };
});

// a) checkpoint:attempt 全表 + 时间归属 + 按 outcome 分布 + 会话归属（采纳 vs 弃跑）
const attemptTotal = db.prepare(`SELECT COUNT(*) AS n FROM learner_evidence WHERE ${evType} = 'checkpoint:attempt'`).get().n;
const attemptInWindow = db.prepare(`SELECT COUNT(*) AS n FROM learner_evidence WHERE ${evType} = 'checkpoint:attempt' AND ${evTime} >= ?`).get(WINDOW_START).n;
const attemptByOutcome = db
  .prepare(`SELECT json_extract(payload, '$.outcome') AS outcome, COUNT(*) AS n FROM learner_evidence WHERE ${evType} = 'checkpoint:attempt' GROUP BY outcome ORDER BY n DESC`)
  .all();
const attemptBySession = db
  .prepare(`SELECT substr(${evSession}, 1, 60) AS sess, json_extract(payload, '$.outcome') AS outcome, datetime(${evTime} / 1000, 'unixepoch') AS atUTC FROM learner_evidence WHERE ${evType} = 'checkpoint:attempt' ORDER BY ${evTime}`)
  .all();
out.checkpointAttempt = { total: attemptTotal, inWindowSinceOct5: attemptInWindow, byOutcome: attemptByOutcome, bySession: attemptBySession };

// b) session_load 行数：全表 vs 今晚窗口
const slTotal = db.prepare(`SELECT COUNT(*) AS n FROM learning_metrics WHERE ${lmType} = 'session_load'`).get().n;
const slInWindow = db.prepare(`SELECT COUNT(*) AS n FROM learning_metrics WHERE ${lmType} = 'session_load' AND ${lmTime} >= ?`).get(WINDOW_START).n;
const slByUser = db
  .prepare(`SELECT substr(userId, 1, 24) AS u, COUNT(*) AS n FROM learning_metrics WHERE ${lmType} = 'session_load' AND ${lmTime} >= ? GROUP BY u ORDER BY n DESC`)
  .all(WINDOW_START);
out.sessionLoad = { total: slTotal, inWindowSinceOct5: slInWindow, inWindowByUser: slByUser, note: '行数随窗口/账号范围变化：11=11 采纳课各 1 行；更大值含弃跑与 autopilot 续课会话' };

// c) task:difficulty:adjustment 归属：5 个单课采纳用户 vs S1 弃跑账号 user_607385bb
const adopted5 = [
  'user_c93a688c-56aa-4253-a24a-a162550186ce',
  'user_68c94c29-95f8-4f4d-876f-eb8b1aa67eca',
  'user_dbb62604-d3d5-4da1-a733-3688d96fce4b',
  'user_7d2c6046-887a-4900-a4df-af9061b63bf2',
  'user_6c042205-50c3-4177-b640-fd4d606a3fba',
];
const daAdopted = db
  .prepare(`SELECT substr(${evUser}, 1, 24) AS u, COUNT(*) AS n FROM learner_evidence WHERE ${evType} = 'task:difficulty:adjustment' AND ${evUser} IN (?, ?, ?, ?, ?) GROUP BY u`)
  .all(...adopted5);
const daAbandoned = db
  .prepare(`SELECT substr(${evUser}, 1, 24) AS u, COUNT(*) AS n FROM learner_evidence WHERE ${evType} = 'task:difficulty:adjustment' AND ${evUser} LIKE ? GROUP BY u`)
  .all('user_607385bb%');
out.taskDifficultyAdjustment = { adoptedSingleCourseUsers: daAdopted, user_607385bb_prefix_match: daAbandoned };

console.log(JSON.stringify(out, null, 2));
