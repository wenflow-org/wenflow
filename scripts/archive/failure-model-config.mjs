import { DatabaseSync } from 'node:sqlite';
const devDb = new DatabaseSync('D:/wenflow/wenflow/backend/prisma/dev.db', { readOnly: true });
const sysDb = new DatabaseSync('D:/wenflow/wenflow/backend/prisma/system.db', { readOnly: true });
const q = (db, s) => db.prepare(s).all();

console.log('=== agent_model_configs (system.db) 全部 ===');
for (const r of q(sysDb, 'SELECT id, agentId, tier, model, temperature, maxTokens, thinkingMode, reasoningEffort, enabled FROM agent_model_configs'))
  console.log(JSON.stringify(r));

console.log('\n=== skill_model_configs (system.db) 全部 ===');
for (const r of q(sysDb, 'SELECT id, skillId, tier, model, thinkingMode, reasoningEffort, temperature, maxTokens, requestTimeoutMs, enabled FROM skill_model_configs'))
  console.log(JSON.stringify(r));

console.log('\n=== platform_api_configs 全字段 ===');
for (const r of q(sysDb, 'SELECT * FROM platform_api_configs'))
  console.log(JSON.stringify(r));

console.log('\n=== INVALID_RESPONSE_SCHEMA 按 requestedModel 分布 ===');
for (const r of q(devDb, `SELECT requestedModel, COUNT(*) c FROM llm_execution_attempts WHERE errorCode='INVALID_RESPONSE_SCHEMA' GROUP BY requestedModel ORDER BY c DESC`))
  console.log(`${r.requestedModel} x${r.c}`);

console.log('\n=== 所有错误按 resolvedModel 分布（看 free 模型占比）===');
for (const r of q(devDb, `SELECT resolvedModel, COUNT(*) c, SUM(CASE WHEN success=0 THEN 1 ELSE 0 END) fails FROM llm_execution_attempts GROUP BY resolvedModel ORDER BY c DESC LIMIT 15`))
  console.log(`${r.resolvedModel} total=${r.c} fails=${r.fails}`);

devDb.close();
sysDb.close();