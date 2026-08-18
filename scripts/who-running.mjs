import { DatabaseSync } from 'node:sqlite';
const db = new DatabaseSync('D:/wenflow/wenflow/backend/prisma/dev.db', { readOnly: true });
const q = (s, ...a) => db.prepare(s).all(...a);

const now = Date.now();
console.log('当前时间:', new Date(now).toLocaleString('zh-CN', { hour12: false }));

console.log('\n=== 正在跑的会话，最新写入距现在多久 ===');
for (const r of q(`SELECT id, virtualProfileId, status, currentStage, completedTasks, totalTasks, updatedAt, createdAt FROM virtual_sessions WHERE status IN ('running','created') ORDER BY updatedAt DESC`)) {
  const agoMs = now - r.updatedAt;
  const agoMin = Math.floor(agoMs / 60000);
  console.log(`sid=${r.id?.slice(0,12)} vp=${r.virtualProfileId?.slice(0,8)} ${r.status} ${r.currentStage} ${r.completedTasks}/${r.totalTasks}  ${agoMin} 分钟前写入`);
}

console.log('\n=== batch_experiment_runs 完整状态 ===');
for (const r of q('SELECT learnerName, phase, status, completedTasks, totalTasks, stallCount, lastError, advanceCalled, learningStarted, updatedAt FROM batch_experiment_runs')) {
  const agoMin = Math.floor((now - r.updatedAt) / 60000);
  console.log(`run=${r.learnerName} phase=${r.phase} status=${r.status} tasks=${r.completedTasks}/${r.totalTasks} stall=${r.stallCount} learnStarted=${r.learningStarted} advance=${r.advanceCalled} err=${(r.lastError||'').slice(0,40)}  ${agoMin}分钟前`);
}

console.log('\n=== 最近 3 分钟内 agent_call_logs（确认是否真的持续活跃）===');
const threeMinAgo = now - 3 * 60 * 1000;
const recent = q(`SELECT agentId, success, errorCode, calledAt FROM agent_call_logs WHERE calledAt > ? ORDER BY rowid DESC LIMIT 30`, threeMinAgo);
console.log('最近3分钟 agent 调用数:', recent.length);
for (const r of recent) console.log(`  ${r.agentId?.replace('skill:','')} ${r.success?'OK':'FAIL'} ${r.errorCode||'-'} @ ${new Date(r.calledAt).toLocaleTimeString('zh-CN',{hour12:false})}`);

console.log('\n=== 最近 3 分钟内 llm_execution_attempts ===');
const llmRecent = q(`SELECT success, errorCode, errorCategory, finishReason, requestedModel, durationMs, createdAt FROM llm_execution_attempts WHERE createdAt > ? ORDER BY createdAt DESC LIMIT 30`, threeMinAgo);
console.log('最近3分钟 llm 调用数:', llmRecent.length);
for (const r of llmRecent) console.log(`  ${r.success?'OK':'FAIL'} ${r.errorCode||r.finishReason||'-'} ${r.requestedModel} ${r.durationMs}ms @ ${new Date(r.createdAt).toLocaleTimeString('zh-CN',{hour12:false})}`);

db.close();