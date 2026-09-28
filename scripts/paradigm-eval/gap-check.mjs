#!/usr/bin/env node
/** 抽验指定用户 path-planning 调用的 raw/normalized 对比与缺口声明 */
import { DatabaseSync } from 'node:sqlite';

const db = new DatabaseSync('file:D:/wenflow/wenflow/backend/prisma/dev.db?mode=ro', { readOnly: true });
const users = process.argv.slice(2);
const clean = (t) => String(t || '').replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim();
for (const u of users) {
  const r = db.prepare(`SELECT rawModelOutput, normalizedOutput FROM prompt_call_logs
    WHERE userId IN (SELECT id FROM users WHERE name=?) AND agentId='skill:path-planning'
    ORDER BY createdAt DESC LIMIT 1`).get('pe-' + u);
  if (!r) { console.log(u, 'NO CALL'); continue; }
  const raw = JSON.parse(clean(r.rawModelOutput));
  let norm = null;
  try { norm = JSON.parse(clean(r.normalizedOutput)); } catch { /* normalized 非 JSON 时跳过 */ }
  console.log('=== ' + u);
  console.log('  raw  sum:', raw.milestones.reduce((a, m) => a + (m.estimatedHours || 0), 0), 'per:', raw.milestones.map((m) => m.estimatedHours).join('/'));
  if (norm) {
    console.log('  norm sum:', norm.milestones.reduce((a, m) => a + (m.estimatedHours || 0), 0), 'per:', norm.milestones.map((m) => m.estimatedHours).join('/'));
    console.log('  norm estimatedHours:', norm.estimatedHours, '| 容量说明 in norm:', /容量说明/.test(JSON.stringify(norm)));
  }
  console.log('  容量说明 in raw:', /容量说明/.test(r.rawModelOutput));
}
