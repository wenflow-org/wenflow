#!/usr/bin/env node
/**
 * 20 用户战役结果采集器（只读，不花模型额度）
 *
 * 读 campaign 目录里的 `result.json` + `state.json`，按 sessionId 从 Prisma 拉：
 *   goal 会话轮次 / 学习路径阶段与课次 / 课堂会话与消息 / 材料收集调用 / 开局文本。
 * 输出 `report.json` 与 `report.md`，供人工复盘与两批对比。
 *
 * 用法：
 *   node scripts/report-user-campaign.mjs --run-dir=.runtime/campaigns/pilot-2026-11-13
 *   node scripts/report-user-campaign.mjs --run-dir=... --cases=src/scripts/campaigns/2026-11-13-20-users.json
 */
import { createRequire } from 'node:module'
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, join, resolve } from 'node:path'
import campaignOutcomes from './campaign-outcomes.cjs'

const {
  normalizeStageScope,
  classifyCampaignOutcome,
  buildFunctionalEvidence,
  deriveStagesReached,
  expectedTerminalMatches,
  summarizeOutcomes
} = campaignOutcomes

const require = createRequire(import.meta.url)
const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

const backendRoot = resolve(import.meta.dirname, '..')
function arg(name, fallback = '') {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : fallback
}
const runRoot = resolve(backendRoot, arg('run-dir', join('.runtime', 'campaigns', new Date().toISOString().slice(0, 10))))
const casesPath = resolve(backendRoot, arg('cases', 'src/scripts/campaigns/2026-11-13-20-users.json'))

function readJson(path, fallback) {
  try { return JSON.parse(readFileSync(path, 'utf8')) } catch { return fallback }
}
function safeParse(value, fallback = []) {
  if (typeof value !== 'string') return fallback
  try { return JSON.parse(value) } catch { return fallback }
}
function clip(text, n = 180) {
  const value = String(text || '').replace(/\s+/g, ' ').trim()
  return value.length > n ? `${value.slice(0, n)}…` : value
}
function countBy(items, keyFn) {
  const out = {}
  for (const item of items) {
    const key = keyFn(item) || 'unknown'
    out[key] = (out[key] || 0) + 1
  }
  return out
}

const spec = readJson(casesPath, { cases: [] })
const caseById = new Map((spec.cases || []).map((c) => [c.id, c]))

const resultFiles = []
function walk(dir, depth = 0) {
  if (depth > 2 || !existsSync(dir)) return
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) walk(full, depth + 1)
    else if (entry.name === 'result.json') resultFiles.push(full)
  }
}
walk(runRoot)

const rows = []
for (const file of resultFiles.sort()) {
  const result = readJson(file, null)
  if (!result) continue
  const caseSpec = caseById.get(result.id) || {}
  const expectNoPath = (caseSpec.expect || result.expect || 'path') === 'no-path'
  const outcome = result.outcome || classifyCampaignOutcome({
    result: result.exitCode === 0 ? 'completed' : (result.signal ? 'failed' : 'failed'),
    expectNoPath,
    findings: result.findings || [],
    round: result.round || 0,
    maxDays: result.days,
    interrupted: !!result.signal || result.exitCode === null || result.exitCode === undefined
  })
  const stageScope = normalizeStageScope({
    expectNoPath,
    expectedTerminal: caseSpec.expectedTerminal || result.stageScope?.expectedTerminal || null,
    stages: Array.isArray(caseSpec.stages)
      ? caseSpec.stages
      : (caseSpec.observe?.stages || result.stageScope?.stages || null),
    observationDays: result.days ?? caseSpec.days
  })
  const priorAttempts = Array.isArray(result.attempts)
    ? result.attempts
    : result.attempt ? [{
      attempt: result.attempt,
      startedAt: result.startedAt || null,
      finishedAt: result.finishedAt || null,
      outcome,
      exitCode: result.exitCode,
      durationSec: result.durationSec || 0,
      round: result.round || 0,
      maxDays: result.days || null,
      sessionId: result.sessionId || null,
      findings: result.findings || []
    }] : []
  const row = {
    id: result.id,
    domain: result.domain || caseSpec.domain,
    learnerName: result.learnerName,
    status: result.status,
    outcome,
    exitCode: result.exitCode,
    attempt: result.attempt || priorAttempts.length || 1,
    attempts: priorAttempts,
    stageScope,
    durationMin: Math.round((result.durationSec || 0) / 60),
    round: result.round,
    findings: result.findings || [],
    tags: caseSpec.tags || [],
    goal: null,
    path: null,
    teaching: null,
    materials: null,
    stageCoverage: { goal: false, path: false, teaching: false, completed: false, error: false },
    stagesReached: [],
    functional: null,
    effect: null,
    config: null,
    configFingerprint: null,
    missingSession: false
  }
  const sessionId = result.sessionId
  if (!sessionId) {
    row.functional = result.functional || buildFunctionalEvidence({
      scope: stageScope,
      outcome,
      stagesReached: deriveStagesReached({ outcome, round: result.round || 0, expectNoPath }),
      rounds: result.round || 0,
      maxDays: result.days,
      findings: result.findings || [],
      stateVersion: result.version,
      dataComplete: false
    })
    rows.push(row)
    continue
  }

  const vs = await prisma.virtual_sessions.findUnique({ where: { id: sessionId } })
  if (!vs) {
    row.missingSession = true
    row.functional = result.functional || buildFunctionalEvidence({
      scope: stageScope,
      outcome,
      stagesReached: deriveStagesReached({ outcome, round: result.round || 0, expectNoPath }),
      rounds: result.round || 0,
      maxDays: result.days,
      findings: result.findings || [],
      stateVersion: result.version,
      dataComplete: false
    })
    rows.push(row)
    continue
  }

  // 配置一致性：模型与提示词版本必须随每次观测落档；配置变了不能复用旧报告结论。
  const stageResults = safeParse(vs.stageResults, {})
  const snapshot = stageResults?.experimentSnapshot || {}
  const simulators = snapshot?.simulators || {}
  const config = {
    capturedAt: snapshot?.capturedAt || null,
    frictionBudget: snapshot?.frictionBudget || null,
    goal: {
      promptVersion: simulators?.goal?.promptVersion ?? null,
      promptFingerprint: simulators?.goal?.promptFingerprint ?? null,
      model: simulators?.goal?.route?.model ?? null,
      providerId: simulators?.goal?.route?.providerId ?? null
    },
    teaching: {
      promptVersion: simulators?.teaching?.promptVersion ?? null,
      promptFingerprint: simulators?.teaching?.promptFingerprint ?? null,
      model: simulators?.teaching?.route?.model ?? null,
      providerId: simulators?.teaching?.route?.providerId ?? null
    }
  }
  const promptRows = await prisma.prompt_call_logs.findMany({
    where: {
      userId: vs.userId,
      success: true,
      agentId: { in: ['skill:goal-conversation', 'skill:path-planning', 'skill:path-task-design', 'skill:teaching-turn', 'skill:teaching-wrapup', 'skill:teaching-retention-probe'] },
      ...(vs.createdAt ? { createdAt: { gte: vs.createdAt } } : {}),
    },
    select: { agentId: true, systemPromptVersion: true, systemPromptHash: true, systemPromptVariant: true, providerId: true, model: true },
  })
  const actualBySkill = new Map()
  for (const item of promptRows) {
    const versions = actualBySkill.get(item.agentId) || new Set()
    versions.add(JSON.stringify({ version: item.systemPromptVersion, hash: item.systemPromptHash, variant: item.systemPromptVariant, provider: item.providerId, model: item.model }))
    actualBySkill.set(item.agentId, versions)
  }
  const actual = Object.fromEntries([...actualBySkill].sort(([a], [b]) => a.localeCompare(b))
    .map(([skill, versions]) => [skill, [...versions].sort().map((version) => JSON.parse(version))]))
  row.config = { ...config, actual }
  const { capturedAt, ...configIdentity } = config
  row.configFingerprint = Object.keys(actual).length
    ? createHash('sha256').update(JSON.stringify(actual)).digest('hex').slice(0, 16)
    : capturedAt ? createHash('sha256').update(JSON.stringify(configIdentity)).digest('hex').slice(0, 16) : null

  // Goal 会话
  if (vs.goalConversationId) {
    const goal = await prisma.goal_conversations.findUnique({ where: { id: vs.goalConversationId } })
    if (goal) {
      const messages = safeParse(goal.messages, [])
      const assistant = messages.filter((m) => m.role === 'ai')
      const user = messages.filter((m) => m.role === 'user')
      row.goal = {
        status: goal.status,
        stage: goal.stage,
        learningPathId: goal.learningPathId,
        turns: messages.length,
        userTurns: user.length,
        assistantTurns: assistant.length,
        firstOpening: clip(user[0]?.content, 160),
        lastAssistant: clip(assistant[assistant.length - 1]?.content, 220),
        collectedKeys: Object.keys(safeParse(goal.collectedData, {}))
      }
    }
  }

  // 路径
  if (vs.learningPathId) {
    const path = await prisma.learning_paths.findUnique({
      where: { id: vs.learningPathId },
      include: { milestones: { orderBy: { stageNumber: 'asc' }, include: { subtasks: { orderBy: { order: 'asc' } } } } }
    })
    if (path) {
      const stages = path.milestones.map((m) => ({
        stage: m.stageNumber,
        title: m.title,
        goal: clip(m.goal, 120),
        estimatedHours: m.estimatedHours,
        lessons: m.subtasks.map((t) => ({ id: t.id, title: t.title, minutes: t.estimatedMinutes, status: t.status, type: t.taskType }))
      }))
      const lessons = stages.flatMap((s) => s.lessons)
      const totalMinutes = lessons.reduce((sum, l) => sum + (l.minutes || 0), 0)
      // 只抓「把结论写进标题」的强信号；带「为什么/如何/怎么/结论是什么」的标题多是任务提问，
      // 不是剧透（u07「……结论是什么」被首版误判）。
      const spoilerHits = lessons.filter((l) => /(答案是|真相是|原来是|竟然是|其实是|原理是|一招|秒懂)/.test(l.title)).map((l) => l.title)
      const collapseHits = stages.filter((s) => s.lessons.length <= 1).map((s) => s.title)
      row.path = {
        id: path.id,
        title: path.title,
        subject: path.subject,
        estimatedHours: path.estimatedHours,
        stageCount: stages.length,
        lessonCount: lessons.length,
        totalMinutes,
        avgLessonsPerStage: stages.length ? +(lessons.length / stages.length).toFixed(1) : 0,
        oneLessonRisk: lessons.length <= 2,
        overLong: stages.length > 6 || lessons.length > 18,
        stageCollapseHits: collapseHits,
        titleSpoilerHits: spoilerHits,
        stages
      }
    }
  }

  // 课堂
  const sessions = await prisma.teaching_sessions.findMany({
    where: { userId: vs.userId, ...(vs.learningPathId ? { learningPathId: vs.learningPathId } : {}) },
    orderBy: { startTime: 'asc' }
  })
  const sessionIds = sessions.map((s) => s.id)
  const reviewSessionIds = sessions.filter((session) => session.mode === 'review' && session.status === 'completed').map((session) => session.id)
  const reviewOperations = reviewSessionIds.length ? await prisma.session_finalization_operations.findMany({
    where: { sessionId: { in: reviewSessionIds }, action: 'complete_review', status: 'completed' },
    distinct: ['sessionId'],
    select: { sessionId: true },
  }) : []
  row.review = reviewOperations.length ? { settledSessions: reviewOperations.length, sessionIds: reviewOperations.map((item) => item.sessionId) } : null
  const messages = sessionIds.length
    ? await prisma.teaching_session_messages.findMany({
      where: { sessionId: { in: sessionIds } },
      orderBy: { id: 'asc' },
      take: 5000,
      select: { sessionId: true, payload: true }
    })
    : []
  const parsed = messages.map((m) => ({ sessionId: m.sessionId, ...safeParse(m.payload, {}) }))
  const firstBySession = new Map()
  for (const m of parsed) {
    if (!firstBySession.has(m.sessionId)) firstBySession.set(m.sessionId, m)
  }
  const openings = sessions.map((s) => {
    const first = firstBySession.get(s.id)
    return {
      sessionId: s.id,
      status: s.status,
      topic: s.topic,
      messages: parsed.filter((m) => m.sessionId === s.id).length,
      opening: clip(first?.content, 220)
    }
  })
  const honestyHits = openings.filter((o) => /你大概见过|你肯定遇到过|大家都碰到过/.test(o.opening)).map((o) => o.sessionId)
  const emptySessions = openings.filter((o) => o.messages === 0).length
  const boardMessages = parsed.filter((m) => m.analysis?.board || m.analysis?.figure || m.analysis?.visual)
  const truncatedFrames = parsed.filter((m) => JSON.stringify(m.analysis?.board || m.analysis?.figure || '').includes('truncatedFrames')).length
  const settledWithWrapup = sessions.filter((session) => session.status === 'completed' && !!session.wrapup).length
  row.teaching = {
    sessions: sessions.length,
    settledWithWrapup,
    statusCount: countBy(sessions, (s) => s.status),
    messageCount: parsed.length,
    userMessages: parsed.filter((m) => m.role === 'user').length,
    assistantMessages: parsed.filter((m) => m.role === 'assistant').length,
    avgMessagesPerSession: sessions.length ? +(parsed.length / sessions.length).toFixed(1) : 0,
    emptySessions,
    openingHonestyHits: honestyHits,
    boardMessages: boardMessages.length,
    truncatedFrameMessages: truncatedFrames,
    openings: openings.slice(0, 4)
  }

  // 材料：path-material-collect 调用按 sessionId / userId / pathId 归因
  // （批量跑数里 LLM 调用上下文是 admin，sessionId 才是虚拟会话的可靠锚点）
  const materialWhere = {
    agentId: 'skill:path-material-collect',
    OR: [
      { sessionId },
      { userId: vs.userId },
      ...(vs.learningPathId ? [{ pathId: vs.learningPathId }] : [])
    ]
  }
  const [materialCalls, materialSuccess] = await Promise.all([
    prisma.prompt_call_logs.count({ where: materialWhere }),
    prisma.prompt_call_logs.count({ where: { ...materialWhere, success: true } })
  ])
  row.materials = {
    tagged: (caseSpec.tags || []).includes('materials'),
    collectorCalls: materialCalls,
    collectorSuccess: materialSuccess
  }

  // 阶段覆盖：只认实际观测到的事实；未覆盖阶段留空（false），不按失败排除。
  const reachedSet = new Set(deriveStagesReached({
    outcome,
    round: result.round || 0,
    finalStage: vs.currentStage || '',
    expectNoPath
  }))
  if (row.goal) reachedSet.add('goal')
  if (row.path) reachedSet.add('path')
  if ((row.teaching?.sessions || 0) > 0) reachedSet.add('teaching')
  if (outcome === 'completed') reachedSet.add('completion')
  if (row.review) reachedSet.add('review')
  row.stagesReached = [...reachedSet]
  row.stageCoverage = {
    goal: !!row.goal,
    path: !!row.path,
    teaching: (row.teaching?.sessions || 0) > 0,
    completed: outcome === 'completed' || outcome === 'expected-no-path',
    error: false
  }

  const stageRequired = {
    goal: !!row.goal && row.goal.turns > 0,
    path: !!row.path && row.path.stageCount > 0 && row.path.lessonCount > 0
      && Number.isFinite(row.path.estimatedHours),
    teaching: (row.teaching?.messageCount || 0) > 0 && (row.teaching?.assistantMessages || 0) > 0,
    completion: outcome === 'completed' && (row.teaching?.settledWithWrapup || 0) > 0,
    review: !!row.review
  }
  const stageEvidence = {
    goal: row.goal ? { status: row.goal.status, turns: row.goal.turns, learningPathId: row.goal.learningPathId } : null,
    path: row.path ? { pathId: row.path.id, stageCount: row.path.stageCount, lessonCount: row.path.lessonCount } : null,
    teaching: row.teaching ? { sessions: row.teaching.sessions, messageCount: row.teaching.messageCount } : null,
    completion: outcome === 'completed' ? { sessionId, status: vs.status } : null,
    review: row.review
  }

  row.functional = result.functional || buildFunctionalEvidence({
    scope: stageScope,
    outcome,
    stagesReached: row.stagesReached,
    rounds: result.round || 0,
    maxDays: result.days,
    sessionStatus: vs.status,
    currentStage: vs.currentStage,
    findings: result.findings || [],
    stateVersion: result.version ?? 1,
    dataComplete: true,
    stageData: stageRequired
  })

  // 效果纳入：只看终态/覆盖/必要指标/证据引用/配置一致性；**不看分数高低**。
  const terminalOk = expectedTerminalMatches(stageScope.expectedTerminal, outcome)
  const skillsByStage = {
    goal: ['skill:goal-conversation'],
    path: ['skill:path-planning', 'skill:path-task-design'],
    teaching: ['skill:teaching-turn'],
    completion: ['skill:teaching-wrapup'],
    review: ['skill:teaching-retention-probe'],
  }
  const stageConfigReady = (stage) => skillsByStage[stage].every((skill) => {
    const versions = actual[skill] || []
    return versions.length === 1 && !!versions[0].hash && !!versions[0].provider && !!versions[0].model
  })
  const configConsistent = stageScope.stages.every(stageConfigReady)
  const degraded = (row.teaching?.emptySessions || 0) > 0
    || (row.functional?.checks || []).some((check) => check.code === 'data-complete' && !check.ok)
  row.effect = {
    eligible: false,
    scoreUsedForEligibility: false,
    terminalOk,
    configConsistent,
    degraded,
    stages: stageScope.stages.map((stage) => {
      const covered = reachedSet.has(stage)
      const metricsOk = stageRequired[stage] !== false
      const missing = []
      if (!covered) missing.push('stage-not-observed')
      if (!metricsOk) missing.push('required-metrics-missing')
      if (!stageConfigReady(stage)) missing.push('config-inconsistent')
      if (!terminalOk) missing.push('declared-terminal-not-reached')
      if (degraded && ['teaching', 'completion', 'review'].includes(stage)) missing.push('stage-data-degraded')
      if (stage === 'teaching' && !settledWithWrapup) missing.push('teaching-wrapup-missing')
      return {
        stage,
        eligible: missing.length === 0,
        covered,
        metricsOk,
        evidence: stageEvidence[stage],
        missing
      }
    })
  }
  row.effect.eligible = row.effect.stages.every((stage) => stage.eligible)
  row.effect.missing = row.effect.stages
    .filter((stage) => !stage.eligible)
    .map((stage) => ({ stage: stage.stage, missing: stage.missing }))

  rows.push(row)
}

// 汇总（所有 case 均保留；分类只反映终态，不按分数高低过滤）
const count = rows.length
const outcomes = summarizeOutcomes(rows)
const incomplete = outcomes['observation-exhausted'] + outcomes['learner-ended']
const paths = rows.filter((r) => r.path)
const effectEligibleRows = rows.filter((r) => r.effect?.eligible)
const effectByStage = Object.fromEntries(['goal', 'path', 'teaching', 'completion', 'review'].map((stage) => {
  const scoped = rows.filter((row) => row.stageScope?.stages?.includes(stage))
  const usable = scoped.filter((row) => row.effect?.stages?.some((item) => item.stage === stage && item.eligible))
  return [stage, { declared: scoped.length, eligible: usable.length, caseIds: usable.map((row) => row.id) }]
}))
const stageCoverageCounts = rows.reduce((acc, row) => {
  for (const stage of ['goal', 'path', 'teaching', 'completed', 'error']) {
    if (row.stageCoverage?.[stage]) acc[stage] = (acc[stage] || 0) + 1
  }
  return acc
}, {})
const aggregates = {
  cases: count,
  outcomes,
  completed: outcomes.completed,
  incomplete,
  learnerEnded: outcomes['learner-ended'],
  observationExhausted: outcomes['observation-exhausted'],
  retryExhausted: outcomes['retry-exhausted'],
  interrupted: outcomes.interrupted,
  failed: outcomes.failed,
  expectedNoPath: outcomes['expected-no-path'],
  attempts: rows.reduce((sum, row) => sum + (row.attempts?.length || 0), 0),
  stageCoverageCounts,
  effectEligibleCases: effectEligibleRows.map((r) => r.id),
  effectEligibleCount: effectEligibleRows.length,
  effectByStage,
  effectIneligible: rows
    .filter((r) => !r.effect?.eligible)
    .map((r) => ({ id: r.id, missing: r.effect?.missing || [] })),
  configFingerprints: [...new Set(rows.map((r) => r.configFingerprint).filter(Boolean))],
  pathsGenerated: paths.length,
  avgStages: paths.length ? +(paths.reduce((s, r) => s + r.path.stageCount, 0) / paths.length).toFixed(1) : 0,
  avgLessons: paths.length ? +(paths.reduce((s, r) => s + r.path.lessonCount, 0) / paths.length).toFixed(1) : 0,
  avgHours: paths.length ? +(paths.reduce((s, r) => s + (r.path.estimatedHours || 0), 0) / paths.length).toFixed(1) : 0,
  oneLessonRisk: rows.filter((r) => r.path?.oneLessonRisk).map((r) => r.id),
  overLong: rows.filter((r) => r.path?.overLong).map((r) => r.id),
  materialsTaggedWithoutCalls: rows.filter((r) => r.materials?.tagged && !r.materials.collectorCalls).map((r) => r.id),
  teachingFailures: rows.filter((r) => (r.teaching?.statusCount?.failed || 0) > 0 || (r.teaching?.emptySessions || 0) > 0).map((r) => r.id),
  openingHonestyHits: rows.filter((r) => (r.teaching?.openingHonestyHits || []).length > 0).map((r) => r.id),
  titleSpoilerHits: rows.filter((r) => (r.path?.titleSpoilerHits || []).length > 0).map((r) => r.id),
  stageCollapseHits: rows.filter((r) => (r.path?.stageCollapseHits || []).length > 0).map((r) => r.id),
  findingCounts: rows.flatMap((r) => r.findings).reduce((acc, f) => {
    acc[f.code] = (acc[f.code] || 0) + 1
    return acc
  }, {})
}

const report = { runRoot, generatedAt: new Date().toISOString(), aggregates, rows }
writeFileSync(join(runRoot, 'report.json'), `${JSON.stringify(report, null, 2)}\n`)

const md = []
md.push(`# 20 用户战役报告（${runRoot.split(/[\\/]/).pop()}）`)
md.push('')
md.push(`生成时间：${report.generatedAt}`)
md.push('')
md.push('## 汇总')
md.push('')
md.push(`- 用例：${aggregates.cases}（completed ${outcomes.completed} / expected-no-path ${outcomes['expected-no-path']} / learner-ended ${outcomes['learner-ended']} / observation-exhausted ${outcomes['observation-exhausted']} / retry-exhausted ${outcomes['retry-exhausted']} / interrupted ${outcomes.interrupted} / failed ${outcomes.failed}）`)
md.push(`- 尝试次数：${aggregates.attempts}；阶段覆盖：${JSON.stringify(stageCoverageCounts)}`)
md.push(`- 效果纳入：${aggregates.effectEligibleCount}/${aggregates.cases}（仅按终态/覆盖/指标/证据/配置，不看分数）`)
md.push(`- 各阶段有效样本：${Object.entries(effectByStage).map(([stage, items]) => `${stage} ${items.eligible}/${items.declared}`).join('；')}`)
md.push(`- 配置指纹：${aggregates.configFingerprints.join(', ') || '无（旧数据缺少实验快照）'}`)
md.push(`- 生成路径：${aggregates.pathsGenerated}`)
md.push(`- 平均阶段数：${aggregates.avgStages}｜平均课次：${aggregates.avgLessons}｜平均预估时长：${aggregates.avgHours}h`)
md.push(`- 一节课风险：${aggregates.oneLessonRisk.join(', ') || '无'}`)
md.push(`- 路径虚胖：${aggregates.overLong.join(', ') || '无'}`)
md.push(`- 材料目标未触发采集：${aggregates.materialsTaggedWithoutCalls.join(', ') || '无'}`)
md.push(`- 课堂失败/空会话：${aggregates.teachingFailures.join(', ') || '无'}`)
md.push(`- 开场假定经历：${aggregates.openingHonestyHits.join(', ') || '无'}`)
md.push(`- 标题疑似剧透：${aggregates.titleSpoilerHits.join(', ') || '无'}`)
md.push(`- 阶段内只剩 1 课：${aggregates.stageCollapseHits.join(', ') || '无'}`)
md.push(`- findings：${JSON.stringify(aggregates.findingCounts)}`)
md.push('')
md.push('## 逐 case')
md.push('')
md.push('| case | 终态 | 覆盖 | 效果纳入 | 尝试 | 用时 | 阶段 | 课次 | 预估 | 目标消息 | 课堂消息 | 材料调用 | findings |')
md.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |')
for (const r of rows) {
  const covered = ['goal', 'path', 'teaching', 'completed'].filter((stage) => r.stageCoverage?.[stage]).join(',') || '—'
  md.push(`| ${r.id} | ${r.outcome}${r.exitCode ? `(${r.exitCode})` : ''} | ${covered} | ${r.effect?.eligible ? '✓' : '—'} | ${r.attempts?.length || 0} | ${r.durationMin}min | ${r.path?.stageCount ?? '—'} | ${r.path?.lessonCount ?? '—'} | ${r.path?.estimatedHours ?? '—'}h | ${r.goal?.turns ?? '—'} | ${r.teaching?.messageCount ?? '—'} | ${r.materials?.collectorCalls ?? 0} | ${(r.findings || []).map((f) => f.code).join('<br>') || '—'} |`)
}
md.push('')
for (const r of rows) {
  md.push(`### ${r.id}｜${r.learnerName || ''}`)
  md.push('')
  md.push(`- 终态：${r.outcome}；覆盖：${r.stagesReached?.join(',') || '—'}；效果纳入：${r.effect?.eligible ? '是' : '否'}`)
  if (r.effect?.missing?.length) {
    md.push(`- 未纳入原因：${r.effect.missing.map((item) => `${item.stage}(${item.missing.join('/')})`).join('；')}`)
  }
  if (r.attempts?.length) {
    md.push(`- 尝试：${r.attempts.map((a) => `#${a.attempt}:${a.outcome}`).join('，')}`)
  }
  if (r.config) {
    md.push(`- 配置：模型 ${r.config.teaching?.model || r.config.goal?.model || '—'}；`
      + `goal prompt ${r.config.goal?.promptVersion || '—'}；teaching prompt ${r.config.teaching?.promptVersion || '—'}`
      + `（指纹 ${r.configFingerprint || '—'}）`)
  }
  if (r.functional) {
    const failedChecks = (r.functional.checks || []).filter((check) => !check.ok)
    md.push(`- 功能检查：${failedChecks.length ? failedChecks.map((check) => `${check.code}=${check.detail}`).join('；') : '全部通过'}`)
  }
  if (r.goal) {
    md.push(`- Goal：${r.goal.status}/${r.goal.stage}，${r.goal.turns} 条（user ${r.goal.userTurns}）`)
    md.push(`- 首条诉求：${r.goal.firstOpening || '—'}`)
    md.push(`- 末条导师：${r.goal.lastAssistant || '—'}`)
  }
  if (r.path) {
    md.push(`- 路径：《${r.path.title}》${r.path.stageCount} 阶段 / ${r.path.lessonCount} 课 / ${r.path.estimatedHours}h`)
    for (const s of r.path.stages) {
      md.push(`  - 阶段 ${s.stage}：${s.title}（${s.lessons.length} 课）`)
      for (const l of s.lessons) md.push(`    - ${l.title}（${l.minutes}min）`)
    }
    if (r.path.titleSpoilerHits.length) md.push(`- ⚠ 标题疑似剧透：${r.path.titleSpoilerHits.join('；')}`)
    if (r.path.stageCollapseHits.length) md.push(`- ⚠ 阶段内只剩 1 课：${r.path.stageCollapseHits.join('；')}`)
  }
  if (r.teaching) {
    md.push(`- 课堂：${r.teaching.sessions} 节（${JSON.stringify(r.teaching.statusCount)}），消息 ${r.teaching.messageCount}，平均 ${r.teaching.avgMessagesPerSession}/节，板书消息 ${r.teaching.boardMessages}，截断 ${r.teaching.truncatedFrameMessages}`)
    for (const o of r.teaching.openings) {
      md.push(`  - [${o.status}] ${o.topic || ''}｜${o.messages} 条｜开场：${o.opening || '—'}`)
    }
  }
  if (r.materials) md.push(`- 材料：tag=${r.materials.tagged}，collector 调用 ${r.materials.collectorCalls}（成功 ${r.materials.collectorSuccess}）`)
  if (r.findings?.length) {
    md.push('- Findings：')
    for (const f of r.findings) md.push(`  - ${f.code}: ${f.detail}`)
  }
  md.push('')
}
writeFileSync(join(runRoot, 'report.md'), `${md.join('\n')}\n`)
console.log(`[report] 写入 ${join(runRoot, 'report.md')}（${rows.length} case）`)
await prisma.$disconnect()
