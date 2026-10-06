#!/usr/bin/env node
/** skill-intel-round-window.cjs — 测量轮窗口（00:30~02:30 +08:00）专属聚合 + ACTIVE 模板/编译状态。
 * 只读；显式列名；带时间窗；不取大列。
 */
'use strict';
const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const BACKEND = path.resolve(__dirname, '..', '..');
const dev = new DatabaseSync(path.join(BACKEND, 'prisma', 'dev.db'), { readOnly: true });
const sys = new DatabaseSync(path.join(BACKEND, 'prisma', 'system.db'), { readOnly: true });
dev.exec('PRAGMA busy_timeout=5000');
sys.exec('PRAGMA busy_timeout=5000');
const T0 = Date.parse('2026-10-06T00:30:00+08:00');
const T1 = Date.parse('2026-10-06T02:30:00+08:00');

function dump(t, rows) { console.log('\n===== ' + t + ' =====\n' + JSON.stringify(rows, null, 1)); }

dump('R1 测量轮 providerId 聚合',
  dev.prepare(`SELECT providerId, COUNT(*) n, SUM(success) ok, SUM(1-success) fail,
      CAST(ROUND(AVG(durationMs)) AS INT) avgMs, MAX(durationMs) maxMs,
      GROUP_CONCAT(DISTINCT model||'@'||routeSource) modelRoutes,
      SUM(promptTokens) pTok, SUM(completionTokens) cTok
    FROM agent_call_logs WHERE calledAt>=? AND calledAt<=? AND providerId IS NOT NULL
    GROUP BY providerId ORDER BY n DESC`).all(T0, T1));

dump('R2 测量轮 llm_execution_attempts 缓存/路由总览',
  dev.prepare(`SELECT providerId, routeSource, resolvedModel, COUNT(*) n, SUM(success) ok,
      SUM(CASE WHEN promptCacheHitTokens>0 THEN 1 ELSE 0 END) hitCalls,
      SUM(promptCacheHitTokens) hitTok, SUM(promptCacheMissTokens) missTok,
      CAST(ROUND(AVG(ttftMs)) AS INT) avgTtft, SUM(willRetry) retryN
    FROM llm_execution_attempts WHERE startedAt>=? AND startedAt<=?
    GROUP BY providerId, routeSource, resolvedModel ORDER BY providerId, n DESC`).all(T0, T1));

dump('R3 测量轮 llm 失败分类',
  dev.prepare(`SELECT providerId, errorCategory, errorCode, statusCode, COUNT(*) n,
      substr(GROUP_CONCAT(DISTINCT substr(COALESCE(errorMessage,''),1,100)),1,200) errSample
    FROM llm_execution_attempts WHERE startedAt>=? AND startedAt<=? AND success=0
    GROUP BY providerId, errorCategory, errorCode, statusCode`).all(T0, T1));

dump('R4 测量轮 prompt_call_logs 版本/失败',
  dev.prepare(`SELECT agentId, systemPromptVersion, systemPromptVariant, COUNT(*) n, SUM(success) ok,
      SUM(1-success) fail, GROUP_CONCAT(DISTINCT failureStage) failStages,
      COUNT(DISTINCT systemPromptHash) nHash
    FROM prompt_call_logs WHERE createdAt>=? AND createdAt<=?
    GROUP BY agentId, systemPromptVersion, systemPromptVariant ORDER BY agentId`).all(T0, T1));

dump('R5 测量轮 prompt_call_logs 失败明细',
  dev.prepare(`SELECT agentId, errorCode, failureStage, COUNT(*) n,
      substr(GROUP_CONCAT(DISTINCT substr(COALESCE(errorMessage,''),1,120)),1,240) errSample
    FROM prompt_call_logs WHERE createdAt>=? AND createdAt<=? AND success=0
    GROUP BY agentId, errorCode, failureStage`).all(T0, T1));

dump('R6 ACTIVE prompt 模板清单（system.db agent_prompts status=ACTIVE）',
  sys.prepare(`SELECT agentId, version, status, compileStatus,
      CASE WHEN compileError IS NOT NULL AND compileError!='' THEN substr(compileError,1,150) END compileErr,
      useCount, coreVersion, variant, trafficWeight, updatedAt
    FROM agent_prompts WHERE status='ACTIVE' ORDER BY agentId`).all());

dump('R7 编译失败/告警模板（compileStatus 非 OK）',
  sys.prepare(`SELECT agentId, version, compileStatus,
      CASE WHEN compileError IS NOT NULL AND compileError!='' THEN substr(compileError,1,150) END compileErr, updatedAt
    FROM agent_prompts WHERE compileStatus IS NOT NULL AND compileStatus NOT IN ('ok','OK','')
    ORDER BY agentId, version LIMIT 30`).all());

dump('R8 窗口内外教具skill零触发核查（窗口内全部 agentId 除 api-gateway/path-agent）',
  dev.prepare(`SELECT agentId, COUNT(*) n FROM agent_call_logs
    WHERE calledAt>=? AND calledAt<=? AND agentId NOT IN ('api-gateway','path-agent')
    GROUP BY agentId ORDER BY agentId`).all(T0, T1));

dev.close(); sys.close();
console.log('\nDONE');
