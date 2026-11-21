#!/usr/bin/env node
/**
 * Campaign 终态 / 阶段范围 / 功能证据（CJS 纯函数，run 与 report 共用）。
 *
 * 与 backend/src/virtual-lab/run-outcome.ts 同一口径（枚举与 expectedTerminal 映射一致），
 * 但保持零依赖，供 `node scripts/*.mjs` 直接复用：
 * - run 侧不再用 exitCode 粗暴二分，而是落 canonical `outcome`；
 * - report 侧直接读同一 `outcome`，不再各自猜 `goal-failed/stopped/incomplete`；
 * - 每次尝试写入 `attempts[]`，重跑不覆盖历史；
 * - 功能证据与效果分完全解耦：低分不影响证据保存，效果纳入只看覆盖/数据/配置。
 */

'use strict'

const RUN_STAGES = ['goal', 'path', 'teaching', 'completion', 'review']
const OBSERVED_STAGES = ['goal', 'path', 'teaching', 'completed', 'error']
const RUN_OUTCOMES = [
  'completed',
  'expected-no-path',
  'learner-ended',
  'observation-exhausted',
  'retry-exhausted',
  'interrupted',
  'failed'
]
const EXPECTED_TERMINALS = ['completed', 'no-path', 'learner-ended', 'observation-exhausted', 'any']

function normalizeStageScopeName(value) {
  const raw = String(value == null ? '' : value).trim().toLowerCase()
  if (!raw) return null
  if (raw === 'goal') return 'goal'
  if (raw === 'path') return 'path'
  if (raw === 'teaching' || raw === 'classroom' || raw === 'lesson') return 'teaching'
  if (raw === 'completed' || raw === 'completion' || raw === 'settlement' || raw === 'mastery') return 'completion'
  if (raw === 'review' || raw === 'retention' || raw === 'due-review') return 'review'
  return null
}

/** 案例声明 → 显式阶段范围（默认值与 TS 侧一致：no-path 只声明 goal）。 */
function normalizeStageScope(input = {}) {
  const expectedTerminal = EXPECTED_TERMINALS.includes(input.expectedTerminal)
    ? input.expectedTerminal
    : (input.expectNoPath ? 'no-path' : 'completed')
  const declared = Array.isArray(input.stages)
    ? input.stages.map(normalizeStageScopeName).filter(Boolean)
    : []
  const deduped = [...new Set(declared)]
  const fallback = input.expectNoPath
    ? ['goal']
    : ['goal', 'path', 'teaching', 'completion']
  const days = Number(input.observationDays)
  return {
    expectedTerminal,
    stages: deduped.length ? deduped : fallback,
    observationDays: Number.isFinite(days) && days >= 0 ? Math.floor(days) : null
  }
}

function expectedTerminalMatches(expected, actual) {
  switch (expected) {
    case 'completed': return actual === 'completed'
    case 'no-path': return actual === 'expected-no-path' || actual === 'learner-ended'
    case 'learner-ended': return actual === 'learner-ended' || actual === 'expected-no-path'
    case 'observation-exhausted': return actual === 'observation-exhausted'
    case 'any': return actual !== 'failed' && actual !== 'retry-exhausted' && actual !== 'interrupted'
    default: return false
  }
}

function findingCodes(findings) {
  return new Set((Array.isArray(findings) ? findings : [])
    .map((item) => String(item && item.code ? item.code : ''))
    .filter(Boolean))
}

/**
 * 统一终态分类。`stateOutcome`（simulate-learner-e2e 已落盘）优先；
 * 旧结果没有该字段时按 findings/exitCode/round 回退，保证历史报告可重算。
 */
function classifyCampaignOutcome(input = {}) {
  if (RUN_OUTCOMES.includes(input.stateOutcome)) return input.stateOutcome
  if (input.interrupted) return 'interrupted'

  const codes = findingCodes(input.findings)
  if (codes.has('interrupted') || codes.has('runner-interrupted')) return 'interrupted'
  if (codes.has('retry-exhausted')) return 'retry-exhausted'

  const reachedCap = input.result === 'exhausted'
    || codes.has('max-days-reached')
    || (input.result == null && Number.isFinite(input.round) && Number.isFinite(input.maxDays)
      && input.maxDays > 0 && input.round >= input.maxDays)
  if (reachedCap) return 'observation-exhausted'

  if (codes.has('goal-ended-without-path')) {
    if (input.expectNoPath) return 'expected-no-path'
    return input.goalOutcome === 'learner-left' ? 'learner-ended' : 'failed'
  }

  if (input.result === 'completed') {
    if (input.goalOutcome === 'no-path' || input.goalOutcome === 'learner-left') {
      return input.expectNoPath ? 'expected-no-path' : 'learner-ended'
    }
    return 'completed'
  }

  if (input.goalOutcome === 'no-path' || input.goalOutcome === 'learner-left') {
    if (input.expectNoPath) return 'expected-no-path'
    return input.goalOutcome === 'learner-left' ? 'learner-ended' : 'failed'
  }

  return 'failed'
}

/** 旧 result.json 没有 attempts[] 时，至少把当前 attempt 作为历史保留。 */
function legacyAttempt(prior) {
  if (!prior || !prior.attempt) return []
  return [{
    attempt: prior.attempt,
    startedAt: prior.startedAt || null,
    finishedAt: prior.finishedAt || null,
    outcome: prior.outcome || (prior.exitCode === 0 ? 'completed' : 'failed'),
    round: prior.round || 0,
    maxDays: prior.days || null,
    sessionId: prior.sessionId || null,
    findings: Array.isArray(prior.findings) ? prior.findings : []
  }]
}

/** 追加重跑历史：新尝试不覆盖旧尝试。 */
function appendAttempt(prior, attempt) {
  const priorAttempts = Array.isArray(prior && prior.attempts)
    ? prior.attempts
    : legacyAttempt(prior)
  return priorAttempts.concat([attempt])
}

function deriveStagesReached(input = {}) {
  const stages = new Set(['goal'])
  if (input.goalOutcome === 'advanced' || (input.round || 0) > 0
    || ['path', 'teaching', 'completed'].includes(input.finalStage)) {
    stages.add('path')
  }
  if ((input.round || 0) > 0 || ['teaching', 'completed'].includes(input.finalStage)) {
    stages.add('teaching')
  }
  if (!input.expectNoPath && (input.outcome === 'completed' || input.result === 'completed')) {
    stages.add('completion')
  }
  return [...stages]
}

/**
 * 功能证据：声明 / 实际 / 确定性检查。**不读取任何效果分**。
 * 未覆盖阶段留空并给出 missing 原因，不排除样本。
 */
function buildFunctionalEvidence(input = {}) {
  const scope = normalizeStageScope({
    expectedTerminal: input.scope && input.scope.expectedTerminal,
    stages: input.scope && input.scope.stages,
    observationDays: input.scope && input.scope.observationDays
  })
  const reached = new Set((Array.isArray(input.stagesReached) ? input.stagesReached : [])
    .map(normalizeStageScopeName).filter(Boolean))
  const declared = new Set(scope.stages)
  const stageData = input.stageData || {}
  const findings = Array.isArray(input.findings) ? input.findings : []
  const terminal = input.outcome
  const versionValid = Number(input.stateVersion) === 1
  const dataComplete = input.dataComplete === false ? false : input.dataComplete === true ? true : null

  const stages = RUN_STAGES
    .filter((stage) => declared.has(stage) || reached.has(stage))
    .map((stage) => {
      const isDeclared = declared.has(stage)
      const isReached = reached.has(stage)
      const data = isDeclared && stageData[stage] !== undefined ? (stageData[stage] ?? null) : null
      const missing = []
      if (isDeclared && !isReached) missing.push('stage-not-observed')
      if (isDeclared && data === false) missing.push('stage-data-missing')
      return {
        stage,
        declared: isDeclared,
        reached: isReached,
        dataComplete: data,
        terminalValid: isDeclared ? expectedTerminalMatches(scope.expectedTerminal, terminal) : null,
        missing
      }
    })

  const uncovered = stages.filter((item) => item.declared && !item.reached).map((item) => item.stage)
  const platformFailure = terminal === 'failed' || terminal === 'retry-exhausted'
  return {
    declared: scope,
    actual: {
      terminal,
      stagesReached: [...reached],
      rounds: Number.isFinite(input.rounds) ? Math.max(0, Math.floor(input.rounds)) : 0,
      maxDays: Number.isFinite(input.maxDays) ? Math.max(0, Math.floor(input.maxDays)) : null,
      sessionStatus: input.sessionStatus || null,
      currentStage: input.currentStage || null
    },
    stages,
    checks: [
      {
        code: 'state-version-valid',
        ok: versionValid,
        detail: versionValid ? 'RunState.version=1' : `unexpected RunState.version=${input.stateVersion == null ? 'null' : input.stateVersion}`
      },
      {
        code: 'declared-terminal-reached',
        ok: expectedTerminalMatches(scope.expectedTerminal, terminal),
        detail: `expected=${scope.expectedTerminal} actual=${terminal}`
      },
      {
        code: 'stage-scope-covered',
        ok: uncovered.length === 0,
        detail: uncovered.length ? `uncovered=${uncovered.join(',')}` : `covered=${scope.stages.join(',')}`
      },
      { code: 'terminal-not-interrupted', ok: terminal !== 'interrupted', detail: terminal },
      { code: 'no-platform-failure', ok: !platformFailure, detail: platformFailure ? terminal : 'ok' },
      { code: 'data-complete', ok: dataComplete !== false, detail: dataComplete === false ? 'required run data missing' : 'ok' },
      ...scope.stages.map((stage) => ({
        code: `stage:${stage}:coverage`,
        ok: reached.has(stage),
        detail: reached.has(stage) ? 'observed' : 'stage-not-observed'
      }))
    ],
    scoreIndependent: true,
    // 仅供诊断；不参与任何通过/排除判断
    findingCodes: [...findingCodes(findings)]
  }
}

/** 汇总计数（pending/running 由 runner 维护）。 */
function summarizeOutcomes(rows) {
  const counts = { completed: 0, 'expected-no-path': 0, 'learner-ended': 0, 'observation-exhausted': 0, 'retry-exhausted': 0, interrupted: 0, failed: 0 }
  for (const row of Array.isArray(rows) ? rows : []) {
    const outcome = RUN_OUTCOMES.includes(row && row.outcome) ? row.outcome : 'failed'
    counts[outcome] += 1
  }
  return counts
}

module.exports = {
  RUN_STAGES,
  OBSERVED_STAGES,
  RUN_OUTCOMES,
  EXPECTED_TERMINALS,
  normalizeStageScope,
  normalizeStageScopeName,
  expectedTerminalMatches,
  classifyCampaignOutcome,
  buildFunctionalEvidence,
  appendAttempt,
  deriveStagesReached,
  summarizeOutcomes
}
