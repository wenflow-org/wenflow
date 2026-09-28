#!/usr/bin/env node
/**
 * 真实案例波次的守恒指标抽取（配对 A/B）：
 * 每条 rw-* 路径 →
 *   model（配对基线）= agent_call_logs 里 path-planning 的**原始**模型输出（守恒执行前）
 *   persisted（终态）= learning_paths / milestones（守恒执行后）
 *   hints（预算锚）  = aiPromptTemplate.normalizedInput.planningHints
 * 产出 results/real-metrics.jsonl：{ id, target, modelH, persistedH, shrinkModel, shrinkPersisted,
 *   stages, lessons, perStage, avgMin, maxMin, equalSplit, gapDeclared, capacity }
 */
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const db = new DatabaseSync(`file:${path.join(ROOT, 'backend/prisma/dev.db')}?mode=ro`, { readOnly: true });

const idsFiles = process.argv.slice(2).filter((a) => a.startsWith('--ids=')).map((a) => a.split('=').slice(1).join('='));
const ids = new Set();
for (const f of idsFiles) {
  for (const line of fs.readFileSync(path.join(HERE, f), 'utf8').split(/\r?\n/)) {
    const id = line.trim().replace(/^pe-/, '');
    if (id) { ids.add(id); ids.add('pe-' + id); }
  }
}

const rows = db.prepare(`
  SELECT p.id AS pathId, p.name, p.title, p.description, p.estimatedHours AS pH, p.createdAt AS pCreated,
         u.name AS userName, u.id AS userId, p.aiPromptTemplate
  FROM learning_paths p JOIN users u ON p.userId = u.id
  WHERE u.name LIKE 'pe-rw-%'
  ORDER BY p.createdAt
`).all();

const out = [];
for (const p of rows) {
  if (ids.size && !ids.has(p.userName)) continue;
  const ms = db.prepare('SELECT id, stageNumber, estimatedHours FROM milestones WHERE learningPathId=? ORDER BY stageNumber').all(p.pathId);
  if (!ms.length) continue;
  const counts = ms.map((m) => db.prepare('SELECT COUNT(*) c FROM subtasks WHERE milestoneId=?').get(m.id).c);
  const mins = db.prepare('SELECT s.estimatedMinutes AS em FROM subtasks s JOIN milestones m ON s.milestoneId=m.id WHERE m.learningPathId=?').all(p.pathId).map((r) => r.em);
  const persistedH = +(mins.reduce((a, b) => a + b, 0) / 60).toFixed(1);

  let hints = {};
  try {
    const tpl = JSON.parse(p.aiPromptTemplate);
    const ni = tpl.normalizedInput || {};
    hints = ni.planningHints && Object.keys(ni.planningHints).length ? ni.planningHints : (ni.normalizedInput && ni.normalizedInput.planningHints) || {};
  } catch { /* 无模板 */ }
  const target = Number(hints.targetTotalHours) || null;
  const capacity = (ms.length)
    * ((Number(hints.subtasksPerStageRange?.[1]) || 8) * (Number(hints.subtaskMinutesRange?.[1]) || 60)) / 60;

  // 配对 A/B：prompt_call_logs 按 userId 连（rw-* 新账号只有一次 path-planning 调用；
  // pathId 列在调用时点为 null，不能做 join 键）
  // rawModelOutput = 模型原始（守恒前）；normalizedOutput = 守恒执行后
  let modelH = null;
  let enforcedH = null;
  let modelStageH = null;
  const call = db.prepare(`
    SELECT rawModelOutput, normalizedOutput FROM prompt_call_logs
    WHERE agentId = 'skill:path-planning' AND userId = ? AND success = 1
    ORDER BY createdAt DESC LIMIT 1
  `).get(p.userId);
  const parseHours = (text) => {
    if (!text) return null;
    try {
      const cleaned = String(text).replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim();
      const data = JSON.parse(cleaned);
      if (!Array.isArray(data.milestones)) return null;
      return {
        sum: +data.milestones.reduce((a, m) => a + (Number(m.estimatedHours) || 0), 0).toFixed(1),
        per: data.milestones.map((m) => Number(m.estimatedHours) || 0).join('/'),
      };
    } catch { return null; }
  };
  if (call) {
    const raw = parseHours(call.rawModelOutput);
    const norm = parseHours(call.normalizedOutput);
    modelH = raw?.sum ?? null;
    modelStageH = raw?.per ?? null;
    enforcedH = norm?.sum ?? null;
  }

  const avgMin = mins.length ? Math.round(mins.reduce((a, b) => a + b, 0) / mins.length) : 0;
  out.push({
    id: p.userName,
    title: (p.title || p.name || '').slice(0, 20),
    target,
    capacity: Math.round(capacity),
    modelH,
    enforcedH,
    persistedH,
    shrinkModel: modelH && target ? +((modelH / target).toFixed(2)) : null,
    shrinkEnforced: enforcedH && target ? +((enforcedH / target).toFixed(2)) : null,
    shrinkPersisted: persistedH && target ? +((persistedH / target).toFixed(2)) : null,
    stages: ms.length,
    lessons: counts.reduce((a, b) => a + b, 0),
    perStage: counts.join('/'),
    equalSplit: new Set(counts).size === 1 && counts.length >= 3,
    avgMin,
    maxMin: mins.length ? Math.max(...mins) : 0,
    gapDeclared: /容量说明/.test(p.description || '') || /容量说明/.test(p.title || ''),
    stageHp: ms.map((m) => m.estimatedHours).join('/'),
    modelStageH,
  });
}
db.close();
const outFile = path.join(RESULTS_DIR(), `real-metrics-${Date.now()}.jsonl`);
function RESULTS_DIR() { return path.join(HERE, 'results'); }
fs.writeFileSync(outFile, out.map((r) => JSON.stringify(r)).join('\n') + '\n');
console.log('paths:', out.length, '→', outFile);
for (const r of out) {
  console.log([r.id, `target=${r.target ?? '?'}`, `model=${r.modelH ?? '?'}`, `persist=${r.persistedH}`, `shrinkP=${r.shrinkPersisted ?? '?'}`, `${r.lessons}课`, `per=${r.perStage}`, `min=${r.avgMin}/${r.maxMin}`, r.equalSplit ? 'EQ' : '', r.gapDeclared ? 'GAP' : ''].join(' | '));
}
