// 重建 ad-day1 的 traceDelta：pre=R1 盘点快照（ad-inventory.cjs 2026-10-05T20:05Z 实测，
// 逐字抄自其输出），post=当前 DB（day1 已完成、day2 未启动的窗口内运行）。
// 背景：ad-driver 首跑被停（VL-B1 记录被弱化覆盖），且 normalizeTs 数字字段有 bug。
// 用法：node ad-fix-day1-delta.cjs
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const OUT = path.join(__dirname, 'out');

// R1 盘点（2026-10-05T20:05Z，ad-inventory.cjs 原文输出，只留数值可比字段）
const PRE = {
  'VL-1': {
    '解释通讯正常是读数据前提': { masteryScore: 0.35, stability: 'developing', lastSeenAt: '2026-10-05T16:43:18.382Z', extractionCount: 1, dueAt: '2026-10-07T01:00:00.000Z', ktMasteryEma: null },
    '确认VCU与BMS通讯正常': { masteryScore: 0.2, stability: 'unknown', lastSeenAt: '2026-10-05T16:43:18.375Z', extractionCount: 1, dueAt: '2026-10-07T01:00:00.000Z', ktMasteryEma: null },
    '按模块来源分类故障码': { masteryScore: 0.9, stability: 'stable', lastSeenAt: '2026-10-05T16:42:14.494Z', extractionCount: 6, dueAt: '2026-10-07T01:00:00.000Z', ktMasteryEma: 0.5876 },
    '区分状态码与通讯码': { masteryScore: 0.9, stability: 'stable', lastSeenAt: '2026-10-05T16:42:14.479Z', extractionCount: 6, dueAt: '2026-10-07T01:00:00.000Z', ktMasteryEma: 0.6079200000000002 },
    '故障码按来源归属分流为子系统状态码与通讯码': { masteryScore: 0.3, stability: 'unknown', lastSeenAt: null, extractionCount: 0, dueAt: null, ktMasteryEma: 0.9 },
    'concept-1': { masteryScore: 0.3, stability: 'unknown', lastSeenAt: null, extractionCount: 0, dueAt: null, ktMasteryEma: 0.3 },
  },
  'VL-B1': {
    '解释两过程的并行相反关系': { masteryScore: 0.35, stability: 'developing', lastSeenAt: '2026-10-05T17:25:17.742Z', extractionCount: 1, dueAt: '2026-10-07T01:00:00.000Z', ktMasteryEma: 0.4 },
    '解释过夜玻璃罩蜡烛熄灭': { masteryScore: 0.35, stability: 'developing', lastSeenAt: '2026-10-05T17:25:17.747Z', extractionCount: 6, dueAt: '2026-10-07T01:00:00.000Z', ktMasteryEma: 0.6244000000000001 },
    '封闭空间内氧气收支的累积与耗尽趋势': { masteryScore: 0.3, stability: 'unknown', lastSeenAt: null, extractionCount: 0, dueAt: null, ktMasteryEma: 0.6 },
    '区分直接现象与推测': { masteryScore: 0.3, stability: 'unknown', lastSeenAt: null, extractionCount: 0, dueAt: null, ktMasteryEma: 0.95 },
    '区分可见现象与推断': { masteryScore: 0.3, stability: 'unknown', lastSeenAt: null, extractionCount: 0, dueAt: null, ktMasteryEma: 0.85 },
  },
  'VL-B2': {
    '识别两过程气体方向': { masteryScore: 0.35, stability: 'developing', lastSeenAt: '2026-10-05T17:24:14.863Z', extractionCount: 1, dueAt: '2026-10-07T01:00:00.000Z', ktMasteryEma: null },
    '区分两过程原料产物': { masteryScore: 0.35, stability: 'developing', lastSeenAt: '2026-10-05T17:24:14.860Z', extractionCount: 1, dueAt: '2026-10-07T01:00:00.000Z', ktMasteryEma: null },
    '光合与呼吸气体方向辨析': { masteryScore: 0.9, stability: 'stable', lastSeenAt: '2026-10-05T17:23:43.072Z', extractionCount: 6, dueAt: '2026-10-07T01:00:00.000Z', ktMasteryEma: 0.6156 },
    '光合作用原料与产物的边界': { masteryScore: 0.9, stability: 'stable', lastSeenAt: '2026-10-05T17:23:43.049Z', extractionCount: 6, dueAt: '2026-10-07T01:00:00.000Z', ktMasteryEma: 0.6988639999999999 },
    '拆分系统的输入输出': { masteryScore: 0.9, stability: 'stable', lastSeenAt: '2026-10-05T17:23:43.022Z', extractionCount: 7, dueAt: '2026-10-07T01:00:00.000Z', ktMasteryEma: 0.34 },
  },
  'VL-B3': {
    '读出箭头的进出物质': { masteryScore: 0.35, stability: 'developing', lastSeenAt: '2026-10-05T17:05:35.947Z', extractionCount: 1, dueAt: '2026-10-07T01:00:00.000Z', ktMasteryEma: null },
    '原料与产物的方向性对应': { masteryScore: 0.3, stability: 'unknown', lastSeenAt: null, extractionCount: 0, dueAt: null, ktMasteryEma: 0.5 },
    '指认细胞图中的叶绿体': { masteryScore: 0.9, stability: 'stable', lastSeenAt: '2026-10-05T17:04:09.881Z', extractionCount: 8, dueAt: '2026-10-07T01:00:00.000Z', ktMasteryEma: 0.6599392000000001 },
  },
  'VL-B4': {
    '标注物质进出方向': { masteryScore: 0.35, stability: 'developing', lastSeenAt: '2026-10-05T17:10:51.527Z', extractionCount: 10, dueAt: '2026-10-07T01:00:00.000Z', ktMasteryEma: 0.5587136 },
    '识别反应物与产物': { masteryScore: 0.9, stability: 'stable', lastSeenAt: '2026-10-05T17:09:27.824Z', extractionCount: 9, dueAt: '2026-10-07T01:00:00.000Z', ktMasteryEma: 0.67140288 },
    '物质进出方向与箭头两侧的固定对应': { masteryScore: 0.3, stability: 'unknown', lastSeenAt: null, extractionCount: 0, dueAt: null, ktMasteryEma: 0.9 },
  },
  'VL-B5': {
    '辨别光合总量与净吸收量': { masteryScore: 0.2, stability: 'unknown', lastSeenAt: '2026-10-05T17:14:45.578Z', extractionCount: 1, dueAt: '2026-10-07T01:00:00.000Z', ktMasteryEma: null },
    '识别净光合的差值含义': { masteryScore: 0.35, stability: 'developing', lastSeenAt: '2026-10-05T17:14:45.572Z', extractionCount: 10, dueAt: '2026-10-07T01:00:00.000Z', ktMasteryEma: 0.5950400000000001 },
    '光合呼吸并排对照': { masteryScore: 0.85, stability: 'stable', lastSeenAt: '2026-10-05T17:13:51.510Z', extractionCount: 6, dueAt: '2026-10-07T01:00:00.000Z', ktMasteryEma: 0.6898240000000001 },
    '光合呼吸场所与条件': { masteryScore: 0.85, stability: 'stable', lastSeenAt: '2026-10-05T17:13:51.481Z', extractionCount: 7, dueAt: '2026-10-07T01:00:00.000Z', ktMasteryEma: 0.7360960000000002 },
  },
};
const USER = {
  'VL-1': 'ee52b287-29b4-4d0b-9995-303f13322f8c',
  'VL-B1': '0b27bb9e-afed-4a7a-9991-1dd404b6c4b5',
  'VL-B2': '802c1a8a-423f-4e9c-aa15-68035cecede2',
  'VL-B3': '7a3f3955-6f4e-4dbb-9f00-d92969cd019c',
  'VL-B4': 'b78b4b66-dd38-4a7b-ab0f-23284c7b3847',
  'VL-B5': '7099f596-8962-4ada-a10f-6dcc6c2d4578',
};
const FIELDS = ['masteryScore', 'stability', 'lastSeenAt', 'extractionCount', 'dueAt', 'fsrsStability', 'fsrsDifficulty', 'fsrsReps', 'fsrsLapses', 'ktMasteryEma'];

const db = new DatabaseSync(path.resolve(__dirname, '..', '..', 'prisma', 'dev.db'), { readOnly: true });
db.exec('PRAGMA busy_timeout = 5000');

const dayFile = path.join(OUT, 'ad-day1.json');
const day = JSON.parse(fs.readFileSync(dayFile, 'utf8'));
let touched = 0;
for (const vl of day.vls) {
  const pre = PRE[vl.vlKey] || {};
  const post = db.prepare('SELECT conceptKey, masteryScore, stability, lastSeenAt, extractionCount, dueAt, fsrsStability, fsrsDifficulty, fsrsReps, fsrsLapses, ktMasteryEma FROM memory_traces WHERE userId = ?').all(USER[vl.vlKey]);
  const changes = [];
  for (const row of post) {
    const before = pre[row.conceptKey];
    if (!before) { changes.push({ conceptKey: row.conceptKey, kind: 'new', after: row }); continue; }
    const diff = {};
    for (const f of FIELDS) {
      const a = before[f] ?? null, b = row[f] ?? null;
      if (String(a) !== String(b)) diff[f] = { before: a, after: b };
    }
    if (Object.keys(diff).length) changes.push({ conceptKey: row.conceptKey, kind: 'changed', diff });
  }
  vl.traceDelta = changes;
  vl.traceDeltaSource = 'recomputed post-day1 vs R1 inventory snapshot 2026-10-05T20:05Z (ad-fix-day1-delta.cjs)';
  touched += 1;
  console.log(`${vl.vlKey}: delta ${changes.length} 行`);
}
day.rebuiltNote = 'traceDelta 由 ad-fix-day1-delta.cjs 重建（首跑被停+normalizeTs 数字字段 bug）；post 取自 day1 完成、day2 未启动窗口';
fs.writeFileSync(dayFile, JSON.stringify(day, null, 1));
console.log(`rebuilt ${touched} VL records → ${dayFile}`);
db.close();
