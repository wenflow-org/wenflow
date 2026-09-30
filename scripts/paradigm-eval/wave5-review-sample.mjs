#!/usr/bin/env node
/**
 * 评审样本抽取：把指定人设的 path 全量结构 + 人设上下文 + 补课审计拼成 markdown，
 * 供评审子代理逐条读（机械统计之外的语义评审）。
 * 用法：node wave5-review-sample.mjs --ids=a,b,c --out=review-batch1.md [--mode=supplement|school]
 */
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const arg = (n, d) => { const h = process.argv.find((a) => a.startsWith(`--${n}=`)); return h ? h.split('=').slice(1).join('=') : d; };
const jp = (s) => { try { return s ? JSON.parse(s) : null; } catch { return null; } };

const ids = arg('ids', '').split(',').map((s) => s.trim()).filter(Boolean);
if (!ids.length) { console.error('no ids'); process.exit(1); }

const corpus = ['scripts/paradigm-eval/real-goals-cases.json', 'scripts/paradigm-eval/golden-personas.json', 'scripts/paradigm-eval/teaching-quality-cases.json']
  .map((f) => jp(fs.readFileSync(path.join(ROOT, f), 'utf8')))
  .flatMap((d) => d?.cases || d?.personas || []);
const byId = new Map(corpus.map((c) => [c.personaId, c]));

const db = new DatabaseSync(`file:${path.join(ROOT, 'backend/prisma/dev.db')}?mode=ro`, { readOnly: true });
const out = [];

for (const id of ids) {
  const p = db.prepare(`SELECT p.id, p.createdAt, p.estimatedHours, p.aiPromptTemplate FROM learning_paths p
    JOIN users u ON p.userId = u.id WHERE u.name = ? ORDER BY p.createdAt DESC LIMIT 1`).get('pe-' + id);
  if (!p) { out.push(`## ${id}\n（无路径）\n`); continue; }
  const t = jp(p.aiPromptTemplate) || {};
  const h = t?.normalizedInput?.normalizedInput?.planningHints || t?.normalizedInput?.planningHints || {};
  const persona = byId.get(id) || {};
  const ms = db.prepare('SELECT id, stageNumber, title, goal, estimatedHours, description FROM milestones WHERE learningPathId=? ORDER BY stageNumber').all(p.id);
  out.push(`## ${id}（${persona.domain || '未知域'}｜intent=${persona.intentType || '?'}）`);
  out.push(`**学习者原话**：${persona.opening || '（缺）'}`);
  if ((persona.followUps || []).length) out.push(`**补充口径**：${persona.followUps.join(' / ')}`);
  out.push(`**自述预算**：${persona.budget ? `${persona.budget.expectedHours}h / 每天${persona.budget.dailyMinutes}分钟 / ${persona.budget.horizonDays}天（${persona.budget.horizon}）` : '（缺）'}`);
  if (persona.schoolAnchor) {
    out.push(`**教材锚**：${persona.schoolAnchor.textbook}｜考试范围：${persona.schoolAnchor.examScope}｜节奏：${persona.schoolAnchor.pace}`);
  }
  out.push(`**预算锚链**：target=${h.targetTotalHours}h 每阶段锚=${h.targetHoursPerMilestone}h 阶段数=${h.targetMilestones} 每阶段课数锚=${h.targetSubtasksPerStage} 单课分钟档=${JSON.stringify(h.subtaskMinutesRange)}｜守恒：${JSON.stringify(t?._generation?.budgetConservation || null)}`);
  out.push('');
  for (const m of ms) {
    const tasks = db.prepare('SELECT title, taskType, estimatedMinutes, "order" FROM subtasks WHERE milestoneId=? ORDER BY "order"').all(m.id);
    const sup = t?.stageDesigns?.[`stage-${m.stageNumber}`]?.supplement;
    out.push(`### 阶段${m.stageNumber}：${m.title}（${m.estimatedHours}h / ${tasks.length}课）${sup ? `　⚠补课审计：要 ${sup.requested}、首轮 ${sup.initial}、新增 ${sup.added}、丢弃近重复 ${sup.dropped}、终 ${sup.final}` : ''}`);
    if (m.goal) out.push(`阶段目标：${m.goal}`);
    tasks.forEach((t2, i) => out.push(`${i + 1}. [${t2.taskType}|${t2.estimatedMinutes}min] ${t2.title}`));
    out.push('');
  }
  out.push('---');
}

fs.mkdirSync(path.join(HERE, 'results'), { recursive: true });
const outPath = path.join(HERE, arg('out', 'results/review-batch.md'));
fs.writeFileSync(outPath, out.join('\n') + '\n');
console.log('written', outPath, out.length, 'lines');
