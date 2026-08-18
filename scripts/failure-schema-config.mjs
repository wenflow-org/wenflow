import { DatabaseSync } from 'node:sqlite';

const devDb = new DatabaseSync('D:/wenflow/wenflow/backend/prisma/dev.db', { readOnly: true });
const sysDb = new DatabaseSync('D:/wenflow/wenflow/backend/prisma/system.db', { readOnly: true });
const q = (db, s) => db.prepare(s).all();

console.log('=== platform_api_configs defaultMaxTokens ===');
try {
  for (const r of q(sysDb, 'SELECT id, defaultModel, defaultMaxTokens, defaultTemperature FROM platform_api_configs')) console.log(JSON.stringify(r));
} catch (e) { console.log('err:', e.message); }

console.log('\n=== INVALID_RESPONSE_SCHEMA finishReason 分布 ===');
for (const r of q(devDb, `SELECT finishReason, completionTokens, promptTokens, sourceEntry, COUNT(*) c FROM llm_execution_attempts WHERE errorCode='INVALID_RESPONSE_SCHEMA' GROUP BY finishReason, completionTokens, promptTokens, sourceEntry ORDER BY c DESC LIMIT 20`))
  console.log(`finish=${r.finishReason} completion=${r.completionTokens} prompt=${r.promptTokens} src=${r.sourceEntry} x${r.c}`);

console.log('\n=== finishReason=length 的 promptCallId 来源 ===');
try {
  for (const r of q(devDb, `SELECT promptCallId, sourceEntry, requestedModel, finishReason, completionTokens, promptTokens, COUNT(*) c FROM llm_execution_attempts WHERE errorCode='INVALID_RESPONSE_SCHEMA' AND finishReason='length' AND promptCallId IS NOT NULL GROUP BY promptCallId ORDER BY c DESC LIMIT 15`))
    console.log(`pc=${(r.promptCallId||'').slice(0,20)} src=${r.sourceEntry} model=${r.requestedModel} finish=${r.finishReason} completion=${r.completionTokens} prompt=${r.promptTokens} x${r.c}`);
} catch (e) { console.log('err:', e.message); }

console.log('\n=== 所有 finishReason=length 的 metadata（取最近几条）===');
try {
  for (const r of q(devDb, `SELECT id, promptCallId, sourceEntry, requestedModel, finishReason, completionTokens, promptTokens, totalTokens, errorMessage FROM llm_execution_attempts WHERE errorCode='INVALID_RESPONSE_SCHEMA' AND finishReason='length' AND sourceEntry!='system-canary' LIMIT 10`))
    console.log(`id=${r.id} pc=${r.promptCallId} src=${r.sourceEntry} model=${r.requestedModel} finish=${r.finishReason} completion=${r.completionTokens} prompt=${r.promptTokens} total=${r.totalTokens} msg=${(r.errorMessage||'').slice(0,120)}`);
} catch (e) { console.log('err:', e.message); }

console.log('\n=== 最近 20 条 INVALID_RESPONSE_SCHEMA（非 canary）的 errorMessage 片段 ===');
try {
  for (const r of q(devDb, `SELECT errorMessage, sourceEntry, finishReason, completionTokens, requestedModel FROM llm_execution_attempts WHERE errorCode='INVALID_RESPONSE_SCHEMA' AND sourceEntry != 'system-canary' ORDER BY rowid DESC LIMIT 20`))
    console.log(`src=${r.sourceEntry} finish=${r.finishReason} completion=${r.completionTokens} model=${r.requestedModel} :: ${(r.errorMessage||'').slice(0,150)}`);
} catch (e) { console.log('err:', e.message); }

console.log('\n=== skill_model_configs 数据 ===');
for (const r of q(sysDb, `SELECT skillId, model, maxTokens, temperature, enabled FROM skill_model_configs WHERE skillId LIKE '%virtual%' OR skillId LIKE '%teaching%' OR skillId LIKE '%goal-dialogue%'`))
  console.log(`skill=${r.skillId} model=${r.model} maxTokens=${r.maxTokens} temp=${r.temperature} enabled=${r.enabled}`);

devDb.close();
sysDb.close();