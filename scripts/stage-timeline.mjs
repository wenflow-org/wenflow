import { DatabaseSync } from 'node:sqlite';
const db = new DatabaseSync('D:/wenflow/wenflow/backend/prisma/dev.db', { readOnly: true });
const q = (s, ...a) => db.prepare(s).all(...a);

const userId = 'c9e4f650-9933-4a69-b97f-8c6a5d9fb5d9';

console.log('=== 该虚拟账号每个 agent 的调用次数 ===');
for (const r of q(`SELECT agentId, success, COUNT(*) c, MIN(calledAt) first, MAX(calledAt) last FROM agent_call_logs WHERE userId = ? GROUP BY agentId, success ORDER BY first ASC`, userId))
  console.log(`${r.agentId?.replace('skill:','').padEnd(44)} ${r.success?'OK  ':'FAIL'} x${r.c}  ${new Date(r.first).toISOString()} ~ ${new Date(r.last).toISOString()}`);

console.log('\n=== virtual-learner-* 类 skill 的全局调用（看 userId 归属）===');
for (const r of q(`SELECT agentId, userId, success, COUNT(*) c, MIN(calledAt) first, MAX(calledAt) last FROM agent_call_logs WHERE agentId LIKE '%virtual-learner%' GROUP BY agentId, userId, success ORDER BY first ASC LIMIT 40`))
  console.log(`${r.agentId?.replace('skill:','').padEnd(48)} uid=${(r.userId||'(null)').slice(0,10).padEnd(10)} ${r.success?'OK':'FAIL'} x${r.c}  ${new Date(r.first).toISOString()}`);

console.log('\n=== persona/scenario designer 全局调用 ===');
for (const r of q(`SELECT agentId, userId, success, COUNT(*) c, MIN(calledAt) first, MAX(calledAt) last FROM agent_call_logs WHERE agentId LIKE '%persona%' OR agentId LIKE '%scenario%' GROUP BY agentId, userId, success ORDER BY first ASC LIMIT 20`))
  console.log(`${r.agentId?.replace('skill:','').padEnd(48)} uid=${(r.userId||'(null)').slice(0,10).padEnd(10)} ${r.success?'OK':'FAIL'} x${r.c}  ${new Date(r.first).toISOString()}`);

console.log('\n=== profile 创建/更新与第一个 goal 调用时间对比 ===');
const profile = q('SELECT id, userId, createdAt, updatedAt FROM virtual_learner_profiles WHERE userId = ?', userId)[0];
console.log(`profile created=${new Date(profile.createdAt).toISOString()} updated=${new Date(profile.updatedAt).toISOString()}`);

db.close();