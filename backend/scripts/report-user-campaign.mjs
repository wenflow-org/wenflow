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
import { dirname, join, resolve } from 'node:path'

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
  const findingCodes = new Set((result.findings || []).map((f) => f.code))
  // 口径：max-days 是「路径比模拟日长」而非产品失败；goal 未收敛单列
  const outcome = result.exitCode === 0
    ? 'completed'
    : findingCodes.has('goal-ended-without-path')
      ? 'goal-failed'
      : findingCodes.has('max-days-reached')
        ? 'incomplete'
        : 'failed'
  const row = {
    id: result.id,
    domain: result.domain || caseSpec.domain,
    learnerName: result.learnerName,
    status: result.status,
    outcome,
    exitCode: result.exitCode,
    durationMin: Math.round((result.durationSec || 0) / 60),
    round: result.round,
    findings: result.findings || [],
    tags: caseSpec.tags || [],
    goal: null,
    path: null,
    teaching: null,
    materials: null
  }
  const sessionId = result.sessionId
  if (!sessionId) { rows.push(row); continue }

  const vs = await prisma.virtual_sessions.findUnique({ where: { id: sessionId } })
  if (!vs) { row.missingSession = true; rows.push(row); continue }

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
      // 只抓「把结论写进标题」的强信号；带「为什么/如何/怎么」的标题多是任务提问，
      // 不是剧透（首版把「一次汇报里挨三种打断——为什么不是A」误判成剧透）。
      const spoilerHits = lessons.filter((l) => /(答案是|真相是|原来是|竟然是|其实是|结论是|原理是|一招|秒懂)/.test(l.title)).map((l) => l.title)
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
  row.teaching = {
    sessions: sessions.length,
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

  // 材料：material-collector 调用按 sessionId / userId / pathId 归因
  // （批量跑数里 LLM 调用上下文是 admin，sessionId 才是虚拟会话的可靠锚点）
  const materialWhere = {
    agentId: 'skill:material-collector',
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

  rows.push(row)
}

// 汇总
const count = rows.length
const completed = rows.filter((r) => r.outcome === 'completed').length
const goalFailed = rows.filter((r) => r.outcome === 'goal-failed').length
const incomplete = rows.filter((r) => r.outcome === 'incomplete').length
const failed = rows.filter((r) => r.outcome === 'failed').length
const paths = rows.filter((r) => r.path)
const aggregates = {
  cases: count,
  completed,
  incomplete,
  goalFailed,
  failed,
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
md.push(`- 用例：${aggregates.cases}（完成 ${completed} / 未跑完 ${incomplete} / goal 未收敛 ${goalFailed} / 失败 ${failed}）`)
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
md.push('| case | 状态 | 用时 | 阶段 | 课次 | 预估 | 目标消息 | 课堂消息 | 材料调用 | findings |')
md.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |')
for (const r of rows) {
  md.push(`| ${r.id} | ${r.outcome}${r.exitCode ? `(${r.exitCode})` : ''} | ${r.durationMin}min | ${r.path?.stageCount ?? '—'} | ${r.path?.lessonCount ?? '—'} | ${r.path?.estimatedHours ?? '—'}h | ${r.goal?.turns ?? '—'} | ${r.teaching?.messageCount ?? '—'} | ${r.materials?.collectorCalls ?? 0} | ${(r.findings || []).map((f) => f.code).join('<br>') || '—'} |`)
}
md.push('')
for (const r of rows) {
  md.push(`### ${r.id}｜${r.learnerName || ''}`)
  md.push('')
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
