#!/usr/bin/env node
/**
 * 导出课程表：里程碑 → 课次 → 状态/评分 + 跨天 + 资料引用
 * 用法: node scripts/school-demo/export-course.mjs <pathId> [outFile]
 */
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DB = path.join(ROOT, 'backend', 'prisma', 'dev.db');
const pathId = process.argv[2];
const outFile = process.argv[3] || path.join(ROOT, 'data', 'newfeatures-test-2026-09-22', `course-${pathId}.md`);
if (!pathId) { console.error('usage: export-course.mjs <pathId>'); process.exit(2); }

const db = new DatabaseSync(DB);
const q = (s) => db.prepare(s).all();

const p = q(`select id,title,name,description,subject,estimatedHours,totalMilestones,aiPromptTemplate from learning_paths where id='${pathId}'`)[0];
if (!p) { console.error('path not found'); process.exit(1); }
const tpl = JSON.parse(p.aiPromptTemplate || '{}');
const framed = tpl.sceneFraming?.normalizedInput || {};
const materials = framed.resources?.materials || [];
const byTask = tpl.materialRefs?.byTask || {};
const kc = tpl.kcAnnotation || {};

const ms = q(`select id,stageNumber,title,description,goal,estimatedHours,status,coreConceptName from milestones where learningPathId='${pathId}' order by stageNumber`);

let totalTasks = 0, doneTasks = 0;
const lines = [];
lines.push(`# 课程表：${p.title}`);
lines.push('');
lines.push(`- pathId: \`${p.id}\``);
lines.push(`- subject: ${p.subject || '-'}`);
lines.push(`- 估时: ${p.estimatedHours}h ｜ 阶段数: ${p.totalMilestones} ｜ 课次总数: ${ms.reduce((a, m) => a + q(`select count(*) c from subtasks where milestoneId='${m.id}'`)[0].c, 0)}`);
lines.push(`- 资料包: ${materials.length}（附件 ${materials.filter(m => m.pack?.materialId).length} ｜ 联网 ${materials.filter(m => m.pack && !m.pack.materialId).length}）`);
lines.push(`- kcAnnotation: nodes=${kc.kcGraph?.nodes?.length || 0} edges=${kc.kcGraph?.edges?.length || 0}`);
lines.push('');
lines.push('## 资料清单');
materials.forEach((m, i) => {
  lines.push(`- 包${i + 1}｜${m.pack?.title || '-'}｜${m.pack?.materialId ? '附件' : '联网'}｜章节 ${m.pack?.sections?.length || 0}｜要点 ${m.pack?.keyPoints?.length || 0}｜status ${m.status}${m.pack?.sourceUrl ? '｜' + m.pack.sourceUrl : ''}`);
});
lines.push('');
for (const m of ms) {
  const ss = q(`select id,title,description,taskType,estimatedMinutes,status,rating,cognitiveLevel from subtasks where milestoneId='${m.id}' order by "order"`);
  const cs = ss.filter(s => s.status === 'completed').length;
  lines.push(`## 阶段${m.stageNumber}《${m.title}》 ${cs}/${ss.length} ｜ ${m.estimatedHours}h ｜ ${m.status || '-'}`);
  lines.push(`概念: ${m.coreConceptName || '-'}`);
  lines.push(`目标: ${(m.goal || '').replace(/\n/g, ' ').slice(0, 200)}`);
  lines.push('');
  lines.push('| # | 课次（任务） | 类型 | 时长 | 认知 | 状态 | 评分 | 资料引用 |');
  lines.push('|---|---|---|---|---|---|---|---|');
  ss.forEach((s, i) => {
    const refs = byTask[s.id] || [];
    const refTxt = refs.map(r => `「${(r.quote || '').slice(0, 24)}…」`).join(' ') || '-';
    lines.push(`| ${i + 1} | ${s.title} | ${s.taskType || '-'} | ${s.estimatedMinutes || '-'}min | ${s.cognitiveLevel || '-'} | ${s.status} | ${s.rating ?? '-'} | ${refTxt} |`);
    totalTasks++; if (s.status === 'completed') doneTasks++;
  });
  lines.push('');
}
lines.push(`## 汇总`);
lines.push(`- 课次完成: **${doneTasks}/${totalTasks}**`);
lines.push(`- 阶段完成: ${ms.filter(m => m.status === 'completed').length}/${ms.length}`);

fs.writeFileSync(outFile, lines.join('\n'));
console.log('已导出:', outFile);
console.log(`课次: ${doneTasks}/${totalTasks} ｜ 阶段: ${ms.filter(m => m.status === 'completed').length}/${ms.length}`);
