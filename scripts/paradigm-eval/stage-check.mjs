#!/usr/bin/env node
/** stage-desinger 下发 vs 实际生成 对账：targetSubtasksForStage 请求了多少、实际生成多少 */
import { DatabaseSync } from 'node:sqlite';

const db = new DatabaseSync('file:D:/wenflow/wenflow/backend/prisma/dev.db?mode=ro', { readOnly: true });
const user = process.argv[2];
const rows = db.prepare(`
  SELECT c.createdAt, c.rawModelOutput, c.normalizedOutput
  FROM prompt_call_logs c
  JOIN users u ON c.userId = u.id
  WHERE u.name = ? AND c.agentId = 'skill:stage-designer' AND c.success = 1
  ORDER BY c.createdAt
`).all(user);
const countTasks = (t) => {
  if (!t) return null;
  try {
    const d = JSON.parse(String(t).replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim());
    return Array.isArray(d.subtasks) ? d.subtasks.length : null;
  } catch { return null; }
};
for (const r of rows) {
  const rawN = countTasks(r.rawModelOutput);
  const normN = countTasks(r.normalizedOutput);
  console.log(new Date(r.createdAt).toTimeString().slice(0, 8), 'raw tasks:', rawN, 'norm tasks:', normN);
}
// 每个 milestone 的 subtask 数 + 小时
const path = db.prepare('SELECT p.id FROM learning_paths p JOIN users u ON p.userId=u.id WHERE u.name=? ORDER BY p.createdAt DESC LIMIT 1').get(user);
if (path) {
  const ms = db.prepare('SELECT stageNumber, estimatedHours, (SELECT COUNT(*) FROM subtasks s WHERE s.milestoneId=m.id) c FROM milestones m WHERE learningPathId=? ORDER BY stageNumber').all(path.id);
  console.log('milestones:', ms.map((m) => `S${m.stageNumber}:${m.estimatedHours}h/${m.c}课`).join(' '));
}
// 每次调用 userPayload 里请求的任务数与分钟档
const ups = db.prepare(`SELECT c.createdAt, c.userPayload FROM prompt_call_logs c JOIN users u ON c.userId=u.id
  WHERE u.name=? AND c.agentId='skill:stage-designer' AND c.success=1 ORDER BY c.createdAt`).all(user);
for (const u of ups) {
  const t = String(u.userPayload);
  const want = t.match(/任务数[^0-9]{0,12}(\d+)/) || t.match(/targetSubtasksForStage[^0-9]{0,6}(\d+)/);
  const minRange = t.match(/单课分钟[^0-9]{0,20}(\d+)\s*[-~—]\s*(\d+)/) || t.match(/分钟[^0-9]{0,10}(\d+)\s*[-~—]\s*(\d+)/);
  const hours = t.match(/阶段学时[^0-9]{0,8}(\d+(?:\.\d+)?)/);
  console.log(' ', new Date(u.createdAt).toTimeString().slice(0, 8),
    'want:', want ? want[1] : '?', '| 档:', minRange ? minRange[1] + '-' + minRange[2] : '?', '| 阶段学时:', hours ? hours[1] : '?');
}
