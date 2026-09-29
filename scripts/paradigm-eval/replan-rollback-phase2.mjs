#!/usr/bin/env node
/** 回退半程 E2E：校验回退后数据一致 + 二次回退拒绝。配合 replan-rollback-e2e.mjs 使用。 */
import { DatabaseSync } from 'node:sqlite';

const arg = (n, d) => { const h = process.argv.find((a) => a.startsWith(`--${n}=`)); return h ? h.split('=').slice(1).join('=') : d; };
const BASE = arg('base', 'http://127.0.0.1:3010');
const userName = arg('user', 'pe-rw-wild-09');
const pathId = arg('path', '');
if (!pathId) { console.error('need --path'); process.exit(1); }

const db = new DatabaseSync('file:D:/wenflow/wenflow/backend/prisma/dev.db?mode=ro', { readOnly: true });
const log = (m) => console.log(`[${new Date().toTimeString().slice(0, 8)}] ${m}`);

function readPathState() {
  const p = db.prepare('SELECT id, estimatedHours, aiPromptTemplate FROM learning_paths WHERE id=?').get(pathId);
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
  const res = await fetch(BASE + urlPath, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}
const login = async () => {
  const r = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5173' }, body: JSON.stringify({ name: userName, password: 'ParadigmEval2026', remember: true }) });
  cookie = (r.headers.get('set-cookie') || '').split(';')[0];
};

await login();
// 快照列表接口
const list = await api('GET', `/api/learning/paths/${pathId}/replan-snapshots`);
log(`快照列表接口：status=${list.status} count=${(list.json?.data || []).length}`);
if (list.status !== 200) { console.error('快照列表接口失败'); process.exit(1); }

const before = readPathState();
log(`回退前：${before.tasks.length} 任务 / ${before.path.estimatedHours}h / 快照 ${before.snapshots.length} 条`);
// 当前各阶段任务分钟（对比用）
const stageSig = (st) => st.milestones.map((m) => `${m.stageNumber}:${m.title}:${m.estimatedHours}`).join('|');
log('回退前阶段签名: ' + stageSig(before).slice(0, 160));

// 回退（不带 snapshotId = 最新一条）
const rb = await api('POST', `/api/learning/paths/${pathId}/replan-rollback`, {});
log(`回退：status=${rb.status} → ${JSON.stringify(rb.json?.data || rb.json?.error).slice(0, 260)}`);
if (!rb.json?.success) { console.error('回退失败'); process.exit(2); }

const after = readPathState();
const taskMatch = JSON.stringify(after.tasks.map((t) => [t.id, t.title, t.estimatedMinutes, t.status]).sort())
  === JSON.stringify(before.milestones ? before.tasks.map((t) => [t.id, t.title, t.estimatedMinutes, t.status]).sort() : []);
// 快照里的「回退前」基准才是重排前状态——用快照比对（before 状态是重排后）
const snap = (before.snapshots || [])[0];
let snapshotRestoredMatch = null;
if (snap) {
  const snapTaskSig = snap.milestones.flatMap((m) => m.subtasks.map((t) => [t.id, t.title, t.estimatedMinutes])).sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  const nowTaskSig = after.tasks.filter((t) => snap.priorTaskIds.includes(t.id)).map((t) => [t.id, t.title, t.estimatedMinutes]).sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  snapshotRestoredMatch = JSON.stringify(snapTaskSig) === JSON.stringify(nowTaskSig)
    && snap.priorTaskIds.length === after.tasks.filter((t) => snap.priorTaskIds.includes(t.id)).length;
}
log(`回退后：${after.tasks.length} 任务 / ${after.path.estimatedHours}h / 快照 ${after.snapshots.length} 条（应 -1）`);
log(`快照内容还原一致: ${snapshotRestoredMatch === true ? 'PASS' : 'FAIL'}`);
log(`快照出栈 -1: ${after.snapshots.length === before.snapshots.length - 1 ? 'PASS' : 'FAIL'}`);

// 二次回退：还有一条旧快照（[2,3,4]），应成功或按语义回退；连退两次后应拒绝
const rb2 = await api('POST', `/api/learning/paths/${pathId}/replan-rollback`, {});
log(`二次回退：status=${rb2.status} → ${JSON.stringify(rb2.json?.data?.status || rb2.json?.error || '').slice(0, 120)}`);
const rb3 = await api('POST', `/api/learning/paths/${pathId}/replan-rollback`, {});
log(`三次回退（应拒绝）：status=${rb3.status} code=${rb3.json?.error?.code || '-'}`);
const rejectOk = rb3.status === 409 && rb3.json?.error?.code === 'PATH_ROLLBACK_NO_SNAPSHOT';
log(`空快照正确拒绝: ${rejectOk ? 'PASS' : 'FAIL'}`);

console.log('\n=== 回退半程结论 ===');
console.log(`列表接口: ${list.status === 200 ? 'PASS' : 'FAIL'}`);
console.log(`回退执行: ${rb.json?.success ? 'PASS' : 'FAIL'}`);
console.log(`快照内容还原: ${snapshotRestoredMatch === true ? 'PASS' : 'FAIL'}`);
console.log(`快照出栈: ${after.snapshots.length === before.snapshots.length - 1 ? 'PASS' : 'FAIL'}`);
console.log(`空快照拒绝: ${rejectOk ? 'PASS' : 'FAIL'}`);
process.exit(snapshotRestoredMatch && after.snapshots.length === before.snapshots.length - 1 && rejectOk ? 0 : 3);
