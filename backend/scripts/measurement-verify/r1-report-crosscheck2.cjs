#!/usr/bin/env node
/**
 * ROUND1 报告二轮口径钉死（只读，报告撰写人用）——回应独立读者对账质疑：
 *   a) prediction_records「今晚 23 条（评审）vs 13 行（趋势）vs 11 课各 1 条」三说并存
 *   b) teaching-turn「prompt_call_logs v66 n=112 + v67 n=60 = 172」vs「agent_call_logs 182 呼」
 *      以及「配置 A/B 50/50」vs「观测 65/35」
 * 纪律：readOnly + busy_timeout=5000，显式列名（PRAGMA 发现），参数绑定，不写库不改码。
 */
const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const DB_PATH = path.join(__dirname, '..', '..', 'prisma', 'dev.db');
const W = 1791158400000; // 2026-10-05T00:00:00Z
const db = new DatabaseSync(DB_PATH, { readOnly: true });
db.exec('PRAGMA busy_timeout=5000');
const cols = (t) => db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
const pick = (list, cands) => cands.find((c) => list.includes(c));
const out = {};

// a) prediction_records
const pc = cols('prediction_records');
out.prediction_records_columns = pc;
const pTime = pick(pc, ['createdAt', 'created_at', 'recordedAt', 'predictedAt']);
const pUser = pick(pc, ['userId', 'user_id']);
const pTone = pick(pc, ['predictedTone', 'predicted_tone', 'tone']);
const pOutcome = pick(pc, ['outcome']);
const pSess = pick(pc, ['sessionId', 'session_id']);
out.prediction = {
  total: db.prepare('SELECT COUNT(*) AS n FROM prediction_records').get().n,
  inWindow: db.prepare(`SELECT COUNT(*) AS n FROM prediction_records WHERE ${pTime} >= ?`).get(W).n,
  inWindowByToneOutcome: db
    .prepare(`SELECT ${pTone} AS tone, ${pOutcome} AS outcome, COUNT(*) AS n FROM prediction_records WHERE ${pTime} >= ? GROUP BY tone, outcome ORDER BY n DESC`)
    .all(W),
  inWindowRows: db
    .prepare(`SELECT substr(${pUser},1,20) AS u, ${pTone} AS tone, ${pOutcome} AS outcome, (${pSess} IS NULL) AS sessNull, datetime(${pTime}/1000,'unixepoch') AS atUTC FROM prediction_records WHERE ${pTime} >= ? ORDER BY ${pTime}`)
    .all(W),
};

// b) teaching-turn 双表对账（同一窗口：>= 2026-10-05T00:00Z）
const qc = cols('prompt_call_logs');
out.prompt_call_logs_columns = qc;
const qTime = pick(qc, ['calledAt', 'createdAt', 'created_at']);
const qSkill = pick(qc, ['agentId']);
const qVer = pick(qc, ['systemPromptVersion', 'version', 'promptVersion']);
const qVar = pick(qc, ['systemPromptVariant']);
const qRoute = pick(qc, ['model', 'resolvedModel']);
out.teachingTurn = {
  promptCallLogsVersionColumnsUsed: { qSkill, qVer, qVar, qTime, qRoute },
  byVersion: db
    .prepare(`SELECT ${qSkill} AS skill, ${qVer} AS ver, ${qVar} AS variant, ${qRoute} AS model, COUNT(*) AS n FROM prompt_call_logs WHERE ${qSkill} LIKE '%teaching-turn%' AND ${qTime} >= ? GROUP BY skill, ver, variant, model ORDER BY n DESC`)
    .all(W),
};
const ac = cols('agent_call_logs');
out.agent_call_logs_columns = ac;
const aTime = pick(ac, ['calledAt', 'createdAt', 'created_at']);
const aSkill = pick(ac, ['providerId', 'skillId', 'skill']);
const aModel = pick(ac, ['resolvedModel', 'model']);
const aRoute = pick(ac, ['routeSource', 'route']);
out.teachingTurn.agentCallLogsByModel = db
  .prepare(`SELECT ${aSkill} AS skill, ${aRoute} AS route, ${aModel} AS model, COUNT(*) AS n FROM agent_call_logs WHERE ${aSkill} LIKE '%teaching-turn%' AND ${aTime} >= ? GROUP BY skill, route, model ORDER BY n DESC`)
  .all(W);

console.log(JSON.stringify(out, null, 2));
