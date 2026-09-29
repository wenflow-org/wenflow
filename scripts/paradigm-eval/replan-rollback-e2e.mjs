#!/usr/bin/env node
/**
 * 重排快照/回退真机 E2E（R8 选项 B）：
 *  ① 重排前记录路径状态（阶段元数据 + 任务清单）
 *  ② 执行重排（fromStageNumber）→ 校验快照已落 aiPromptTemplate.replanSnapshots
 *  ③ 校验重排确实改了任务（快照前 vs 快照后不同）
 *  ④ 调回退 → 校验任务集与阶段元数据与 ① 一致
 *  ⑤ 二次回退应报「没有可回退的路径调整记录」
 * 用法：node replan-rollback-e2e.mjs --user=pe-rw-wild-09 --path=lp_xxx [--from=2]
 */
import { DatabaseSync } from 'node:sqlite';

const arg = (n, d) => { const h = process.argv.find((a) => a.startsWith(`--${n}=`)); return h ? h.split('=').slice(1).join('=') : d; };
const BASE = arg('base', 'http://127.0.0.1:3001');
const PASSWORD = 'ParadigmEval2026';
const DB = 'file:D:/wenflow/wenflow/backend/prisma/dev.db?mode=ro';
const userName = arg('user', 'pe-rw-wild-09');
const pathId = arg('path', '');
const fromStage = Number(arg('from', '2'));
if (!pathId) { console.error('need --path'); process.exit(1); }

const db = new DatabaseSync(DB, { readOnly: true });
const log = (m) => console.log(`[${new Date().toTimeString().slice(0, 8)}] ${m}`);

function readPathState() {
  const p = db.prepare('SELECT id, title, estimatedHours, aiPromptTemplate FROM learning_paths WHERE id=?').get(pathId);
  const ms = db.prepare('SELECT id, stageNumber, title, description, goal, estimatedHours, status, coreConceptId, coreConceptName FROM milestones WHERE learningPathId=? ORDER BY stageNumber').all(pathId);
  const tasks = db.prepare('SELECT s.id, s.milestoneId, s.title, s.estimatedMinutes, s."order", s.status FROM subtasks s JOIN milestones m ON s.milestoneId=m.id WHERE m.learningPathId=? ORDER BY m.stageNumber, s."order"').all(pathId);
  let snapshots = [];
  try { snapshots = JSON.parse(p.aiPromptTemplate || '{}').replanSnapshots || []; } catch { /* ignore */ }
  return { path: p, milestones: ms, tasks, snapshots };
}

let cookie = '';
async function api(method, urlPath, body) {
  const headers = { Cookie: cookie, Origin: 'http://localhost:5173' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(BASE + urlPath, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(600000) });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 200) }; }
  return { status: res.status, json };
}

const login = async () => {
  const r = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5173' }, body: JSON.stringify({ name: userName, password: PASSWORD, remember: true }) });
  const j = await r.json();
  if (!j.success) throw new Error('login failed');
  cookie = (r.headers.get('set-cookie') || '').split(';')[0];
};

await login();
log(`登录 ${userName}`);

// ① 重排前状态
const before = readPathState();
const beforeTaskIds = before.tasks.map((t) => t.id).sort();
log(`重排前：${before.milestones.length} 阶段 / ${before.tasks.length} 任务 / ${before.path.estimatedHours}h / 既有快照 ${before.snapshots.length}`);

// ② 执行重排
const rp = await api('POST', `/api/learning/paths/${pathId}/replan`, {
  triggerSource: 'api', mode: 'overwrite', requireConfirmation: false, fromStageNumber: fromStage,
  reason: 'E2E：验证快照与回退',
});
log(`重排请求：status=${rp.status} → ${JSON.stringify(rp.json?.data?.status || rp.json?.error || '').slice(0, 120)}`);
if (!rp.json?.success) { console.error('重排失败，终止'); process.exit(2); }

// ③ 等生成完成
let ready = false;
for (let i = 0; i < 40; i++) {
  await new Promise((r) => setTimeout(r, 10000));
  const g = await api('GET', `/api/learning/paths/${pathId}/generation-status`);
  const lc = g.json?.data?.lifecycle || '';
  if (lc === 'ready') { ready = true; break; }
  if (String(lc).includes('failed')) { console.error('生成失败: ' + lc); process.exit(3); }
}
if (!ready) { console.error('等待生成超时'); process.exit(3); }
log('重排生成完成');

const after = readPathState();
const afterTaskIds = after.tasks.map((t) => t.id).sort();
const changed = JSON.stringify(beforeTaskIds) !== JSON.stringify(afterTaskIds);
log(`重排后：${after.milestones.length} 阶段 / ${after.tasks.length} 任务 / ${after.path.estimatedHours}h / 快照 ${after.snapshots.length} 条`);
log(`任务集变化: ${changed ? '是（重排生效）' : '否（任务 id 未变，需人工确认）'}`);
if (after.snapshots.length !== before.snapshots.length + 1) {
  console.error(`快照未按预期 +1（before=${before.snapshots.length} after=${after.snapshots.length}）`);
  process.exit(4);
}
const snap = after.snapshots[0];
log(`快照 id=${snap.id} 覆盖阶段 ${JSON.stringify(snap.stageNumbers)} 任务数 ${snap.priorTaskIds.length}`);

// ④ 回退
const rb = await api('POST', `/api/learning/paths/${pathId}/replan-rollback`, {});
log(`回退：status=${rb.status} → ${JSON.stringify(rb.json?.data || rb.json?.error).slice(0, 220)}`);
if (!rb.json?.success) { console.error('回退失败'); process.exit(5); }

const restored = readPathState();
const restoredTaskIds = restored.tasks.map((t) => t.id).sort();
const tasksMatch = JSON.stringify(restoredTaskIds) === JSON.stringify(beforeTaskIds);
const msMatch = JSON.stringify(restored.milestones.map((m) => [m.stageNumber, m.title, m.estimatedHours, m.goal]))
  === JSON.stringify(before.milestones.map((m) => [m.stageNumber, m.title, m.estimatedHours, m.goal]));
log(`回退后：${restored.milestones.length} 阶段 / ${restored.tasks.length} 任务 / ${restored.path.estimatedHours}h / 快照 ${restored.snapshots.length} 条`);
log(`任务集还原一致: ${tasksMatch ? 'PASS' : 'FAIL'}`);
log(`阶段元数据还原一致: ${msMatch ? 'PASS' : 'FAIL'}`);
if (!tasksMatch || !msMatch) {
  console.error('还原不一致：');
  console.error('  before tasks:', beforeTaskIds.join(','));
  console.error('  after  tasks:', restoredTaskIds.join(','));
  process.exit(6);
}

// ⑤ 二次回退应无快照
const rb2 = await api('POST', `/api/learning/paths/${pathId}/replan-rollback`, {});
log(`二次回退：status=${rb2.status} code=${rb2.json?.error?.code || '-'} msg=${rb2.json?.error?.message || '-'}`);
const secondOk = rb2.status === 409 && rb2.json?.error?.code === 'PATH_ROLLBACK_NO_SNAPSHOT';
log(`二次回退正确拒绝: ${secondOk ? 'PASS' : 'FAIL'}`);

console.log('\n=== E2E 结论 ===');
console.log(`快照落库: PASS（+1 条，覆盖 ${JSON.stringify(snap.stageNumbers)}）`);
console.log(`重排生效: ${changed ? 'PASS' : 'WARN'}`);
console.log(`回退还原: ${tasksMatch && msMatch ? 'PASS' : 'FAIL'}`);
console.log(`快照出栈: ${restored.snapshots.length === before.snapshots.length ? 'PASS' : 'FAIL'}`);
console.log(`二次回退拒绝: ${secondOk ? 'PASS' : 'FAIL'}`);
process.exit(tasksMatch && msMatch && secondOk ? 0 : 7);
