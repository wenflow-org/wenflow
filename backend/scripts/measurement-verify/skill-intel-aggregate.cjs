#!/usr/bin/env node
/** skill-intel-aggregate.cjs — 技能盘点员专用只读聚合（2026-10-06 夜间实测语料）。
 * 纪律：readOnly 打开；显式列名；全部查询带 calledAt/createdAt 时间窗或 sessionId/userId 过滤；
 * 禁 SELECT *（input/output/attemptTrace 等大列一律不取）。
 */
'use strict';
const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');

const BACKEND = path.resolve(__dirname, '..', '..');
const DEV_DB = path.join(BACKEND, 'prisma', 'dev.db');
const SYS_DB = path.join(BACKEND, 'prisma', 'system.db');

// 时间窗：2026-10-05 18:00 ~ 2026-10-06 04:00 (+08:00)，覆盖今晚全部实跑
const T0 = Date.parse('2026-10-05T18:00:00+08:00');
const T1 = Date.parse('2026-10-06T04:00:00+08:00');

const SESSIONS = [
  // GUI-1
  'teaching_user_c93a688c-56aa-4253-a24a-a162550186ce_51e8f0df-da4a-4647-a702-fd80bbb33983',
  // S1..S4
  'teaching_user_68c94c29-95f8-4f4d-876f-eb8b1aa67eca_a438786c-f859-401e-8e11-d2f4db9b2d49',
  'teaching_user_dbb62604-d3d5-4da1-a733-3688d96fce4b_fee1b341-a11c-47d0-b784-43171227ca01',
  'teaching_user_7d2c6046-887a-4900-a4df-af9061b63bf2_30a25984-6623-4165-94f8-581866a40f84',
  'teaching_user_6c042205-50c3-4177-b640-fd4d606a3fba_27f1e68f-d298-4d29-af07-a93afdf746dd',
  // VL-1（无 teaching_ 前缀）
  '6131973e-72d6-4f23-819f-fb3a896dfe9d',
  // VL-B1..B5
  'teaching_0b27bb9e-afed-4a7a-9991-1dd404b6c4b5_ccee4b32-60a4-49cb-867c-d098edb64e63',
  'teaching_802c1a8a-423f-4e9c-aa15-68035cecede2_16e1515c-3994-49a5-b0a9-57ffadfcabde',
  'teaching_7a3f3955-6f4e-4dbb-9f00-d92969cd019c_89e6e0d5-6950-493c-97c0-67a52519e31d',
  'teaching_b78b4b66-dd38-4a7b-ab0f-23284c7b3847_d9ca93b6-5289-41c9-882f-728cd1b2489b',
  'teaching_7099f596-8962-4ada-a10f-6dcc6c2d4578_95d31f21-9a97-4755-bcc2-611ae03f3640',
];

const USERS = [
  'user_c93a688c-56aa-4253-a24a-a162550186ce',
  'user_68c94c29-95f8-4f4d-876f-eb8b1aa67eca',
  'user_dbb62604-d3d5-4da1-a733-3688d96fce4b',
  'user_7d2c6046-887a-4900-a4df-af9061b63bf2',
  'user_6c042205-50c3-4177-b640-fd4d606a3fba',
  'ee52b287-29b4-4d0b-9995-303f13322f8c',
  '0b27bb9e-afed-4a7a-9991-1dd404b6c4b5',
  '802c1a8a-423f-4e9c-aa15-68035cecede2',
  '7a3f3955-6f4e-4dbb-9f00-d92969cd019c',
  'b78b4b66-dd38-4a7b-ab0f-23284c7b3847',
  '7099f596-8962-4ada-a10f-6dcc6c2d4578',
];

const dev = new DatabaseSync(DEV_DB, { readOnly: true });
dev.exec('PRAGMA busy_timeout=5000');
const sys = new DatabaseSync(SYS_DB, { readOnly: true });
sys.exec('PRAGMA busy_timeout=5000');

function dump(title, rows) {
  console.log('\n===== ' + title + ' =====');
  console.log(JSON.stringify(rows, null, 1));
}

// ---- agent_call_logs（telemetry 大表，全部带 calledAt 窗） ----
dump('Q0 窗口内总行数/agentId/executionLayer 分布',
  dev.prepare(`SELECT agentId, executionLayer, COUNT(*) n FROM agent_call_logs WHERE calledAt>=? AND calledAt<=? GROUP BY agentId, executionLayer`).all(T0, T1));

dump('Q1 十一 sessionId × providerId 聚合（调用数/成功/失败/耗时/模型）',
  dev.prepare(`SELECT sessionId, providerId, COUNT(*) n, SUM(success) ok, SUM(1-success) fail,
      CAST(ROUND(AVG(durationMs)) AS INT) avgMs, MAX(durationMs) maxMs,
      GROUP_CONCAT(DISTINCT model) models, GROUP_CONCAT(DISTINCT routeSource) routes,
      SUM(promptTokens) pTok, SUM(completionTokens) cTok, SUM(attemptCount) attempts
    FROM agent_call_logs WHERE calledAt>=? AND calledAt<=? AND sessionId IN (${SESSIONS.map(() => '?').join(',')})
    GROUP BY sessionId, providerId ORDER BY sessionId, providerId`).all(T0, T1, ...SESSIONS));

dump('Q2 十一 userId × providerId 聚合（sessionId 覆盖缺口交叉验证）',
  dev.prepare(`SELECT userId, providerId, COUNT(*) n, SUM(success) ok,
      COUNT(DISTINCT sessionId) nSessions,
      SUM(CASE WHEN sessionId IS NULL OR sessionId='' THEN 1 ELSE 0 END) nNoSessionId
    FROM agent_call_logs WHERE calledAt>=? AND calledAt<=? AND userId IN (${USERS.map(() => '?').join(',')})
    GROUP BY userId, providerId ORDER BY userId, providerId`).all(T0, T1, ...USERS));

dump('Q3 今晚全量按 providerId 聚合（触发名单主证据）',
  dev.prepare(`SELECT providerId, COUNT(*) n, SUM(success) ok, SUM(1-success) fail,
      CAST(ROUND(AVG(durationMs)) AS INT) avgMs, MAX(durationMs) maxMs,
      GROUP_CONCAT(DISTINCT model) models, GROUP_CONCAT(DISTINCT routeSource) routes,
      SUM(promptTokens) pTok, SUM(completionTokens) cTok,
      CAST(ROUND(AVG(attemptCount)*100) AS INT)/100.0 avgAttempts
    FROM agent_call_logs WHERE calledAt>=? AND calledAt<=? GROUP BY providerId ORDER BY n DESC`).all(T0, T1));

dump('Q3b 今晚全量按 providerId×routeSource×model 细分（路由证据）',
  dev.prepare(`SELECT providerId, routeSource, model, providerType, COUNT(*) n, SUM(success) ok
    FROM agent_call_logs WHERE calledAt>=? AND calledAt<=? GROUP BY providerId, routeSource, model, providerType ORDER BY providerId, n DESC`).all(T0, T1));

dump('Q4 失败明细分类（providerId × errorCategory × errorCode × statusCode）',
  dev.prepare(`SELECT providerId, success, errorCategory, errorCode, statusCode, COUNT(*) n,
      GROUP_CONCAT(DISTINCT substr(COALESCE(error,''),1,120)) errSample
    FROM agent_call_logs WHERE calledAt>=? AND calledAt<=? AND (success=0 OR error IS NOT NULL)
    GROUP BY providerId, success, errorCategory, errorCode, statusCode ORDER BY n DESC`).all(T0, T1));

dump('Q5 窗口内 sessionId 为空的行（归因缺口）',
  dev.prepare(`SELECT providerId, COUNT(*) n FROM agent_call_logs
    WHERE calledAt>=? AND calledAt<=? AND (sessionId IS NULL OR sessionId='')
    GROUP BY providerId ORDER BY n DESC`).all(T0, T1));

// ---- prompt_call_logs ----
dump('P1 prompt_call_logs 按 agentId×版本×variant 聚合',
  dev.prepare(`SELECT agentId, systemPromptVersion, systemPromptVariant, COUNT(*) n, SUM(success) ok,
      SUM(1-success) fail, CAST(ROUND(AVG(durationMs)) AS INT) avgMs,
      SUM(promptAttemptCount) sumPromptAttempts, SUM(llmRequestCount) sumLlmRequests,
      GROUP_CONCAT(DISTINCT failureStage) failStages
    FROM prompt_call_logs WHERE createdAt>=? AND createdAt<=?
    GROUP BY agentId, systemPromptVersion, systemPromptVariant ORDER BY agentId, n DESC`).all(T0, T1));

dump('P2 prompt_call_logs 失败分类',
  dev.prepare(`SELECT agentId, errorCode, failureStage, COUNT(*) n,
      GROUP_CONCAT(DISTINCT substr(COALESCE(errorMessage,''),1,140)) errSample
    FROM prompt_call_logs WHERE createdAt>=? AND createdAt<=? AND (success=0 OR failureStage IS NOT NULL)
    GROUP BY agentId, errorCode, failureStage ORDER BY n DESC`).all(T0, T1));

dump('P3 prompt_call_logs systemPromptHash 去重（版本漂移检查）',
  dev.prepare(`SELECT agentId, systemPromptVersion, COUNT(DISTINCT systemPromptHash) nHash,
      GROUP_CONCAT(DISTINCT substr(systemPromptHash,1,12)) hashes
    FROM prompt_call_logs WHERE createdAt>=? AND createdAt<=?
    GROUP BY agentId, systemPromptVersion ORDER BY agentId`).all(T0, T1));

// ---- llm_execution_attempts ----
dump('L1 llm_execution_attempts 路由/模型/缓存总览',
  dev.prepare(`SELECT providerId, providerType, routeSource, requestedModel, resolvedModel, endpointHost,
      COUNT(*) n, SUM(success) ok,
      SUM(CASE WHEN promptCacheHitTokens>0 THEN 1 ELSE 0 END) cacheHitCalls,
      SUM(promptCacheHitTokens) hitTok, SUM(promptCacheMissTokens) missTok,
      CAST(ROUND(AVG(ttftMs)) AS INT) avgTtft, SUM(CASE WHEN willRetry=1 THEN 1 ELSE 0 END) willRetryN
    FROM llm_execution_attempts WHERE startedAt>=? AND startedAt<=?
    GROUP BY providerId, providerType, routeSource, requestedModel, resolvedModel, endpointHost
    ORDER BY providerId, n DESC`).all(T0, T1));

dump('L2 llm_execution_attempts 失败分类',
  dev.prepare(`SELECT providerId, errorCategory, errorCode, statusCode, retryable, COUNT(*) n,
      GROUP_CONCAT(DISTINCT substr(COALESCE(errorMessage,''),1,140)) errSample
    FROM llm_execution_attempts WHERE startedAt>=? AND startedAt<=? AND success=0
    GROUP BY providerId, errorCategory, errorCode, statusCode, retryable ORDER BY n DESC`).all(T0, T1));

dump('L3 llm_execution_attempts 重试链（promptAttemptNo × transportAttemptNo）',
  dev.prepare(`SELECT providerId, promptAttemptNo, transportAttemptNo, COUNT(*) n,
      SUM(CASE WHEN success=1 THEN 1 ELSE 0 END) ok
    FROM llm_execution_attempts WHERE startedAt>=? AND startedAt<=?
    GROUP BY providerId, promptAttemptNo, transportAttemptNo ORDER BY providerId, promptAttemptNo, transportAttemptNo`).all(T0, T1));

// ---- system.db：prompt 模板清单 + 路由配置 ----
dump('A1 agent_prompts 全清单（版本/状态/编译/使用量）',
  sys.prepare(`SELECT agentId, version, status, compileStatus,
      CASE WHEN compileError IS NOT NULL AND compileError!='' THEN substr(compileError,1,120) END compileErr,
      useCount, CAST(avgLatency AS INT) avgLatencyMs, successRate, coreVersion, variant, trafficWeight, updatedAt
    FROM agent_prompts ORDER BY agentId, version`).all());

dump('A2 skill_registrations 现役注册',
  sys.prepare(`SELECT skillId, status FROM skill_registrations ORDER BY skillId`).all());

const smcCols = sys.prepare(`PRAGMA table_info(skill_model_configs)`).all().map((c) => c.name);
dump('A3 skill_model_configs 列名', smcCols);
if (smcCols.includes('skillId')) {
  const sel = ['skillId', 'status'].filter((c) => smcCols.includes(c));
  if (smcCols.includes('model')) sel.push('model');
  if (smcCols.includes('routingScope')) sel.push('routingScope');
  dump('A3 skill_model_configs 路由真源',
    sys.prepare(`SELECT ${sel.join(',')} FROM skill_model_configs ORDER BY skillId`).all());
}

dev.close();
sys.close();
console.log('\nDONE window=' + new Date(T0).toISOString() + ' ~ ' + new Date(T1).toISOString());
