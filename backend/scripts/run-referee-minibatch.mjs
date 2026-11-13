#!/usr/bin/env node
/**
 * Referee 小批量病历单跑数器（Mini-Batch Auto-Tuning · Step 1）
 *
 * 只做一件事：用黑盒会话把 case 跑穿，拿到 referee 结构化病历单（findings.code/severity/evidenceIds）。
 * **本轮绝不改任何 YAML / 提示词 / 业务代码**——先把跨样本证据攒出来。
 *
 * 为什么必须是黑盒会话：
 *   `blackbox-runner.referee()` 硬门禁 `experiment.mode === 'blackbox-api'` 且会话终态；
 *   前 20 例用的 assisted 会话没有 publicTrace，裁判无法出报告。这里复用平台正式链路：
 *   建学习者（手写故事）→ start-blackbox-session → autopilot(target=final)
 *   → 终态 → POST /api/admin/session-audits/sessions/:id/evaluations。
 *
 * 用法：
 *   node scripts/run-referee-minibatch.mjs --cases=u01,u04,u07 --concurrency=2
 *   node scripts/run-referee-minibatch.mjs --only=u17 --timeout-min=120
 *   node scripts/run-referee-minibatch.mjs --resume          # 复用已有 state/result
 *
 * 产物：backend/.runtime/referee-minibatch/<batch>/
 *   <caseId>/state.json   会话/阶段/autopilot 时间线
 *   <caseId>/result.json  referee + actor 报告（原样）
 *   summary.json / report.md  跨 case 聚类（只统计 ≥2 次或 critical）
 */
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const require = createRequire(import.meta.url)
const backendRoot = resolve(import.meta.dirname, '..')

function arg(name, fallback = '') {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : fallback
}
function flag(name) {
  return process.argv.includes(`--${name}`)
}
function readJson(path, fallback) {
  try { return JSON.parse(readFileSync(path, 'utf8')) } catch { return fallback }
}
function writeJson(path, value) {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}
function log(caseId, line) {
  console.log(`[${new Date().toISOString()}]${caseId ? `[${caseId}]` : ''} ${line}`)
}

// ---- 环境 ----
const baseUrl = arg('base-url', process.env.E2E_BASE_URL || 'http://localhost:3001').replace(/\/$/, '')
const ORIGIN = process.env.E2E_ORIGIN || 'http://localhost:5173'
const adminName = arg('admin-name', process.env.E2E_ADMIN_NAME || 'admin')
const adminPassword = arg('admin-password', process.env.E2E_ADMIN_PASSWORD || process.env.INIT_ADMIN_PASSWORD || 'ChangeMe_2026_Admin')
const concurrency = Math.max(1, Number(arg('concurrency', '2')) || 2)
const timeoutMin = Math.max(5, Number(arg('timeout-min', '120')) || 120)
const pollMs = Math.max(5_000, Number(arg('poll-sec', '30')) * 1000 || 30_000)
const maxTurns = Math.max(1, Number(arg('max-turns', '24')) || 24)
/**
 * 每例采样任务数上限（0=跑完整条路径）。
 *
 * Step 1 的目标是「跨样本诊断」而不是完成率：3 并发下单课 20-30 轮、每轮双模型调用，
 * 14 课的 case 会跑 6-7 小时。采样 4 课足以让裁判判断 Goal/Path/Teaching 风格与边界，
 * 采样后以 abandoned 收口（referee 允许 abandoned 终态），并在结果里显式标注 sampledTasks。
 */
const maxTasks = Math.max(0, Number(arg('max-tasks', '0')) || 0)
const frictionBudget = arg('friction-budget', 'normal')
const resume = flag('resume')
const keepAlive = flag('keep')
const batch = arg('batch', `minibatch-${new Date().toISOString().slice(0, 10)}`)
const runRoot = resolve(backendRoot, arg('run-dir', join('.runtime', 'referee-minibatch', batch)))

const casesPath = resolve(backendRoot, arg('cases-file', join('src', 'scripts', 'campaigns', '2026-11-13-20-users.json')))
const spec = readJson(casesPath, { cases: [] })
const allCases = Array.isArray(spec.cases) ? spec.cases : []

// 默认 7 例异构 mini-batch：法律/财务/论文阅读/长文写作/纯概念/模糊目标/高时效
const DEFAULT_IDS = ['u01-labor-contract', 'u04-financial-statements', 'u07-paper-abstract', 'u13-keynote-speech', 'u17-http-cache-concurrency', 'u19-vague-communication', 'u20-econ-news']
function resolveIds(raw) {
  if (!raw) return DEFAULT_IDS.filter((id) => allCases.some((c) => c.id === id))
  return String(raw).split(',').map((s) => s.trim()).filter(Boolean).map((token) => {
    const exact = allCases.find((c) => c.id === token)
    if (exact) return exact.id
    const prefix = allCases.find((c) => c.id.startsWith(token) || c.id.includes(token))
    return prefix ? prefix.id : token
  })
}
const caseIds = resolveIds(arg('cases', flag('pilot') ? 'u17-http-cache-concurrency' : ''))
const cases = caseIds.map((id) => allCases.find((c) => c.id === id)).filter(Boolean)
if (!cases.length) {
  console.error(`没有匹配到 case（cases=${caseIds.join(',')}）`)
  process.exit(1)
}

// ---- HTTP ----
let cookie = ''
async function login() {
  const response = await fetch(`${baseUrl}/api/admin-auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
    body: JSON.stringify({ name: adminName, password: adminPassword, remember: true }),
  })
  const setCookie = response.headers.getSetCookie?.().join('; ') || response.headers.get('set-cookie') || ''
  cookie = setCookie.split(';')[0] || ''
  if (!response.ok || !cookie) {
    throw new Error(`管理员登录失败 http=${response.status} ${(await response.text().catch(() => '')).slice(0, 200)}`)
  }
  log(null, `已登录 ${baseUrl}（admin=${adminName}）`)
}
async function api(method, path, body, timeoutMs = 60_000, extraHeaders = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Origin: ORIGIN, ...(cookie ? { Cookie: cookie } : {}), ...extraHeaders },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(timeoutMs),
  })
  let parsed = null
  try { parsed = await response.json() } catch { parsed = null }
  return { status: response.status, body: parsed }
}
const dataOf = (body) => body?.data && typeof body.data === 'object' ? body.data : null

function storyFor(c) {
  return {
    id: `story_${c.id}`,
    title: `${c.id}｜${c.domain || ''}`,
    sourceType: 'goal',
    outline: [c.story?.role, c.story?.scenario].filter(Boolean).join('｜'),
    visibleOpening: c.story?.opening || c.goal,
    triggerEvent: c.story?.trigger || '',
    goalSeed: {
      surfaceGoal: c.goal,
      realProblem: c.story?.problem || '',
    },
    pressurePoints: [c.story?.problem, c.story?.scenario].filter(Boolean),
    behaviorHooks: [c.story?.trigger].filter(Boolean),
  }
}

// ---- 单 case ----
async function abandon(c, state, reason, tag = 'abandon') {
  // 采样/超时收口时 autopilot 可能还在一次长 LLM 调用里；abandon 会被会话租约挡回 409。
  // 同一个 Idempotency-Key 重试，既避开重复副作用，也给在途 step 留出收尾时间。
  //
  // 黑盒写操作还要求乐观并发令牌 X-Expected-Trace-Count（当前 publicTrace.length）。
  // 缺它会 400「缺少合法的预期轨迹序号」；autopilot 在途时序号会变，所以每次重试都重读。
  const key = `minibatch-${c.id}-${tag}`
  let response = null
  for (let attempt = 1; attempt <= 8; attempt += 1) {
    let expectedTraceCount = 0
    try {
      const detail = dataOf((await api('GET', `/api/admin/virtual-learners/sessions/${state.sessionId}`, undefined, 120_000)).body)
      // 会话详情里的 stageResults 可能是对象（API 已解析）也可能是字符串（Prisma 原样）；两种都认。
      const raw = detail?.stageResults
      const stage = typeof raw === 'string' ? JSON.parse(raw || '{}') : (raw && typeof raw === 'object' ? raw : {})
      expectedTraceCount = Array.isArray(stage?.blackbox?.publicTrace) ? stage.blackbox.publicTrace.length : 0
    } catch { expectedTraceCount = 0 }
    response = await api('POST', `/api/admin/virtual-learners/sessions/${state.sessionId}/blackbox-action`, {
      type: 'abandon',
      reason,
      expectedTraceCount,
    }, 180_000, {
      'Idempotency-Key': key,
      'X-Expected-Trace-Count': String(expectedTraceCount),
    })
    if (response.status === 200) break
    log(c.id, `abandon 第 ${attempt} 次 http=${response.status} ${JSON.stringify(response.body?.error ?? response.body).slice(0, 160)}`)
    await new Promise((r) => setTimeout(r, 10_000))
  }
  log(c.id, `abandon 最终 http=${response?.status}`)
  return response
}

async function waitForTerminal(c, state) {
  const startedAt = Date.now()
  const timeoutMs = timeoutMin * 60_000
  let lastStatus = ''
  let lastAutopilot = ''
  let restarts = 0
  while (Date.now() - startedAt < timeoutMs) {
    const detail = await api('GET', `/api/admin/virtual-learners/sessions/${state.sessionId}`, undefined, 120_000)
    if (detail.status !== 200) {
      log(c.id, `会话查询失败 http=${detail.status}，继续等`)
    }
    const session = dataOf(detail.body)
    const auto = await api('GET', `/api/admin/virtual-learners/sessions/${state.sessionId}/autopilot`, undefined, 120_000)
    const autopilot = dataOf(auto.body)
    const status = String(session?.status || 'unknown')
    const autoStatus = String(autopilot?.status || 'unknown')
    if (`${status}/${autoStatus}` !== `${lastStatus}/${lastAutopilot}`) {
      log(c.id, `status=${status} stage=${session?.currentStage || '?'} autopilot=${autoStatus} elapsed=${Math.round((Date.now() - startedAt) / 60000)}min`)
      lastStatus = status
      lastAutopilot = autoStatus
    }
    state.timeline.push({ at: new Date().toISOString(), status, stage: session?.currentStage || null, autopilot: autoStatus, steps: autopilot?.steps ?? null, lastError: autopilot?.lastError ?? null })
    if (['completed', 'failed', 'abandoned'].includes(status)) {
      return { terminal: true, status, session, autopilot }
    }
    // 采样上限：只跑到 N 个任务就收口（referee 允许 abandoned 终态）。
    // totalTasks <= maxTasks 时让它自然跑完，不制造无谓的 abandoned。
    const doneTasks = Number(session?.completedTasks) || 0
    const totalTasks = Number(session?.totalTasks) || 0
    if (maxTasks > 0 && doneTasks >= maxTasks && totalTasks > maxTasks) {
      log(c.id, `已采样 ${doneTasks}/${totalTasks} 课，按 --max-tasks=${maxTasks} 收口`)
      await api('POST', `/api/admin/virtual-learners/sessions/${state.sessionId}/autopilot/stop`, {})
      await new Promise((r) => setTimeout(r, 15_000))
      await abandon(c, state, '先学到这儿，回头再继续', 'sampled')
      const after = dataOf((await api('GET', `/api/admin/virtual-learners/sessions/${state.sessionId}`)).body)
      return {
        terminal: ['completed', 'failed', 'abandoned'].includes(String(after?.status)),
        status: String(after?.status || status),
        session: after,
        autopilot,
        sampledTasks: doneTasks,
      }
    }
    if (['completed', 'failed', 'incomplete', 'stopped'].includes(autoStatus)) {
      // autopilot 已收口但会话还没落终态：先给状态机 60s 写完，再决定重启还是 abandon。
      await new Promise((r) => setTimeout(r, 60_000))
      const fresh = dataOf((await api('GET', `/api/admin/virtual-learners/sessions/${state.sessionId}`)).body)
      const freshStatus = String(fresh?.status || 'unknown')
      if (['completed', 'failed', 'abandoned'].includes(freshStatus)) {
        return { terminal: true, status: freshStatus, session: fresh, autopilot }
      }
      // autopilot 退出但会话还活着：可恢复（路径生成超时/上游瞬时失败）→ 重启续跑。
      // 2026-11-13 实证：Path 生成实测 13 分钟，旧 10 分钟等待门会误杀 autopilot。
      if (restarts < 3 && !['completed'].includes(autoStatus)) {
        restarts += 1
        log(c.id, `autopilot=${autoStatus}（${autopilot?.lastError || 'no error'}），第 ${restarts} 次重启续跑`)
        const restarted = await api('POST', `/api/admin/virtual-learners/sessions/${state.sessionId}/autopilot/start`, {
          target: 'final',
          maxTurns,
        }, 120_000)
        log(c.id, `autopilot 重启 http=${restarted.status}`)
        if (restarted.status === 200) continue
      }
      log(c.id, `autopilot=${autoStatus} 且重启无效，发送 abandon 收口`)
      await abandon(c, state, '我先停一下，回头再继续', 'abandon')
      const after = dataOf((await api('GET', `/api/admin/virtual-learners/sessions/${state.sessionId}`)).body)
      return { terminal: ['completed', 'failed', 'abandoned'].includes(String(after?.status)), status: String(after?.status || freshStatus), session: after, autopilot }
    }
    await new Promise((r) => setTimeout(r, pollMs))
  }

  log(c.id, `超时 ${timeoutMin}min：先 stop autopilot，再 abandon 收口以取得裁判资格`)
  await api('POST', `/api/admin/virtual-learners/sessions/${state.sessionId}/autopilot/stop`, {})
  await new Promise((r) => setTimeout(r, 15_000))
  await abandon(c, state, '我先停一下，回头再继续', 'timeout')
  const after = dataOf((await api('GET', `/api/admin/virtual-learners/sessions/${state.sessionId}`)).body)
  return { terminal: ['completed', 'failed', 'abandoned'].includes(String(after?.status)), status: String(after?.status || 'unknown'), session: after, autopilot: null, timedOut: true }
}

async function runCase(c) {
  const dir = join(runRoot, c.id)
  const statePath = join(dir, 'state.json')
  const resultPath = join(dir, 'result.json')
  mkdirSync(dir, { recursive: true })

  let state = resume ? readJson(statePath, null) : null
  if (state?.referee?.report && existsSync(resultPath)) {
    log(c.id, '已有裁判报告，跳过（--resume）')
    return readJson(resultPath, null)
  }
  if (!state) {
    state = {
      caseId: c.id,
      domain: c.domain,
      goal: c.goal,
      learnerName: c.learnerName,
      createdAt: new Date().toISOString(),
      timeline: [],
    }
  }

  if (!state.profileId) {
    const created = await api('POST', '/api/admin/virtual-learners', {
      name: c.learnerName || `[referee] ${c.id}`,
      learningGoal: c.goal,
      knowledgeLevel: 'beginner',
      profile: {
        role: c.story?.role || '',
        scenario: c.story?.scenario || '',
        note: 'referee mini-batch 自动创建，跑完可删',
        storyPool: [storyFor(c)],
      },
      tags: ['referee-minibatch', 'disposable'],
      notes: 'auto-created by run-referee-minibatch.mjs',
    })
    const profile = dataOf(created.body)
    if (created.status !== 200 || !profile?.id) {
      throw new Error(`创建学习者失败 http=${created.status} ${JSON.stringify(created.body?.error ?? created.body).slice(0, 240)}`)
    }
    state.profileId = String(profile.id)
    state.userId = String(profile.userId || '')
    writeJson(statePath, state)
    log(c.id, `学习者已建 profile=${state.profileId} user=${state.userId}`)
  }

  if (!state.sessionId) {
    const started = await api('POST', `/api/admin/virtual-learners/${state.profileId}/start-blackbox-session`, {
      frictionBudget,
    }, 120_000)
    const session = dataOf(started.body)
    if (started.status !== 200 || !session?.id) {
      throw new Error(`start-blackbox-session 失败 http=${started.status} ${JSON.stringify(started.body?.error ?? started.body).slice(0, 240)}`)
    }
    state.sessionId = String(session.id)
    state.startedAt = new Date().toISOString()
    writeJson(statePath, state)
    log(c.id, `黑盒会话已建 session=${state.sessionId}`)
  }

  if (!state.autopilotStarted) {
    const auto = await api('POST', `/api/admin/virtual-learners/sessions/${state.sessionId}/autopilot/start`, {
      target: 'final',
      maxTurns,
    }, 120_000)
    if (auto.status !== 200) {
      throw new Error(`autopilot/start 失败 http=${auto.status} ${JSON.stringify(auto.body?.error ?? auto.body).slice(0, 240)}`)
    }
    state.autopilotStarted = true
    state.autopilotStartResponse = dataOf(auto.body)
    writeJson(statePath, state)
    log(c.id, `autopilot 已启动 ${JSON.stringify(dataOf(auto.body))}`)
  }

  const outcome = await waitForTerminal(c, state)
  state.outcome = { terminal: outcome.terminal, status: outcome.status, timedOut: outcome.timedOut === true, sampledTasks: outcome.sampledTasks ?? null, endedAt: new Date().toISOString() }
  state.autopilotState = outcome.autopilot
  writeJson(statePath, state)

  const result = {
    id: c.id,
    caseId: c.id,
    domain: c.domain,
    learnerName: c.learnerName,
    goal: c.goal,
    profileId: state.profileId,
    userId: state.userId,
    sessionId: state.sessionId,
    outcome: state.outcome,
    referee: null,
    actorAudit: null,
    error: null,
  }

  if (!outcome.terminal) {
    result.error = '会话未落终态，无法出裁判报告'
    writeJson(resultPath, result)
    return result
  }

  log(c.id, '会话终态，调用 referee（可能耗时数分钟）…')
  const evaluated = await api('POST', `/api/admin/session-audits/sessions/${state.sessionId}/evaluations`, {}, 30 * 60_000)
  if (evaluated.status !== 200) {
    result.error = `evaluations http=${evaluated.status} ${JSON.stringify(evaluated.body?.error ?? evaluated.body).slice(0, 400)}`
    log(c.id, result.error)
  } else {
    const data = dataOf(evaluated.body)
    result.referee = data?.platform || null
    result.actorAudit = data?.actor || null
    const report = result.referee?.report
    const findings = Array.isArray(report?.findings) ? report.findings : []
    log(c.id, `裁判完成 verdict=${report?.verdict || '?'} findings=${findings.length} [${findings.map((f) => f.code).join(', ')}]`)
  }
  writeJson(resultPath, result)
  return result
}

// ---- 补救收口：把已采样但 abandon 失败的会话补成终态，再出裁判报告 ----
async function finalizeCase(c) {
  const dir = join(runRoot, c.id)
  const statePath = join(dir, 'state.json')
  const resultPath = join(dir, 'result.json')
  const state = readJson(statePath, null)
  if (!state?.sessionId) throw new Error('没有可收口的会话（state.json 缺 sessionId）')
  const existing = readJson(resultPath, null)
  if (existing?.referee?.report) {
    log(c.id, '已有裁判报告，跳过')
    return existing
  }

  let session = dataOf((await api('GET', `/api/admin/virtual-learners/sessions/${state.sessionId}`, undefined, 120_000)).body)
  if (!['completed', 'failed', 'abandoned'].includes(String(session?.status))) {
    log(c.id, `当前 ${session?.status}，先 stop autopilot 再 abandon 收口`)
    await api('POST', `/api/admin/virtual-learners/sessions/${state.sessionId}/autopilot/stop`, {})
    await new Promise((r) => setTimeout(r, 15_000))
    await abandon(c, state, '先停在这里，回头再继续', 'finalize')
    session = dataOf((await api('GET', `/api/admin/virtual-learners/sessions/${state.sessionId}`, undefined, 120_000)).body)
  }

  const result = {
    id: c.id,
    caseId: c.id,
    domain: c.domain,
    learnerName: c.learnerName,
    goal: c.goal,
    profileId: state.profileId,
    userId: state.userId,
    sessionId: state.sessionId,
    outcome: { terminal: ['completed', 'failed', 'abandoned'].includes(String(session?.status)), status: String(session?.status || 'unknown'), sampledTasks: state.outcome?.sampledTasks ?? null, finalized: true, endedAt: new Date().toISOString() },
    referee: existing?.referee || null,
    actorAudit: existing?.actorAudit || null,
    error: null,
  }
  if (!result.outcome.terminal) {
    result.error = `收口失败：会话仍 ${session?.status}`
    writeJson(resultPath, result)
    return result
  }
  log(c.id, '会话终态，补出裁判报告…')
  const evaluated = await api('POST', `/api/admin/session-audits/sessions/${state.sessionId}/evaluations`, {}, 30 * 60_000)
  if (evaluated.status !== 200) {
    result.error = `evaluations http=${evaluated.status} ${JSON.stringify(evaluated.body?.error ?? evaluated.body).slice(0, 400)}`
  } else {
    const data = dataOf(evaluated.body)
    result.referee = data?.platform || null
    result.actorAudit = data?.actor || null
  }
  writeJson(resultPath, result)
  return result
}

// ---- 运行时证据（裁判看不到的后端日志）----
// 2026-11-13 试点实证：黑盒每个教学回合的 epistemic-grounding 都因路由冻结校验失败而降级，
// 裁判输入里只会体现为「学习者认知信号缺失」，不会点名根因。这里按 sessionId 从后端日志
// 计数，作为运行时证据与裁判病历单并列存档（不改任何规则）。
function grepCount(pattern, file) {
  try {
    const out = execFileSync('grep', ['-c', pattern, file], { encoding: 'utf8' }).trim()
    return Number(out) || 0
  } catch (error) {
    // grep -c 无匹配时退出码 1，stdout 仍是 "0"
    const stdout = String(error?.stdout || '').trim()
    return Number(stdout) || 0
  }
}
function scanRuntimeEvidence(results) {
  const logFile = arg('backend-log', join(backendRoot, 'logs', 'backend-3001.log'))
  if (!existsSync(logFile)) return
  for (const r of results) {
    if (!r.sessionId) continue
    r.runtime = {
      epistemicGroundingDegraded: grepCount(`认知判决失败.*${r.sessionId}`, logFile),
      llmExecutionFailures: grepCount(`execution failed.*${r.sessionId}`, logFile),
      autopilotPathWaitTimeout: grepCount(`Path 生成等待超时.*${r.sessionId}`, logFile),
    }
  }
}

// ---- 病历单 code 归一化 ----
// 2026-11-13 实证：裁判提示词要求「稳定机器码」，但同一现象在不同 case 会输出
// path_generation_latency / PATH_GENERATION_STALL_LONG / path_generation_stall /
// path_generation_exceeds_promise 等变体，按原文聚类会把 7/7 的共性问题拆成 7 个单例。
// 这里做确定性别名归一（只用于跨样本归因，不修改裁判输出）。
function canonicalFindingCode(code) {
  const c = String(code || '').trim().toUpperCase().replace(/[\s-]+/g, '_')
  if (/ABANDON.*MID|RUN_ABANDONED_MIDTASKS/.test(c)) return 'SAMPLING_ABANDONED_MID_TASK'
  if (/TERMINAL.*(FAILURE|FAILED)|RUN_TERMINAL_FAILURE/.test(c)) return 'CONTROL_TERMINAL_FAILURE'
  if (/PATH.*(GENERATION|STALL|LATENCY|PROMISE)/.test(c)) return 'PATH_GENERATION_LATENCY'
  if (/CONTROL.*STAGE.*(MISMATCH|GOAL_COMPLETED)/.test(c)) return 'CONTROL_STAGE_MISMATCH_GOAL_COMPLETED'
  if (/ARTIFACT_REFERENCE|UNVERIFIABLE_BOARD|BOARD.*UNVERIFIABLE|TEACHING_REFERENCES/.test(c)) return 'TEACHING_BOARD_UNVERIFIABLE'
  if (/TRACE.*(TRUNC|COVERAGE)/.test(c)) return 'TRACE_TRUNCATED'
  if (/SESSION_SUPERSEDED/.test(c)) return 'SESSION_SUPERSEDED'
  if (/METRIC.*(DEGRADED|INCOMPLETE|NO_METRICS)|SECOND_SESSION_NO_METRICS|DATA_METRICS/.test(c)) return 'METRICS_INCOMPLETE'
  if (/CONTROL.*TASK.*COMPLETION.*LAG/.test(c)) return 'CONTROL_TASK_COMPLETION_LAG'
  if (/GOAL_SCOPE_DRIFT/.test(c)) return 'GOAL_SCOPE_DRIFT'
  if (/INTERNAL_NOTATION/.test(c)) return 'TEACHING_NOTATION_LEAK'
  if (/INTERNAL_TOKEN/.test(c)) return 'INTERNAL_TOKEN_LEAK'
  if (/SESSION_NEVER_TERMINATES/.test(c)) return 'SESSION_NEVER_TERMINATES'
  if (/TOPIC_DRIFT/.test(c)) return 'TASK_TOPIC_DRIFT'
  if (/GOAL_ACCEPTS_LEARNER_DELEGATION/.test(c)) return 'GOAL_ACCEPTS_LEARNER_DELEGATION'
  return c
}

// ---- 并发执行 ----
async function main() {
  mkdirSync(runRoot, { recursive: true })
  await login()
  log(null, `mini-batch: ${cases.map((c) => c.id).join(', ')}｜concurrency=${concurrency}｜timeout=${timeoutMin}min｜maxTurns=${maxTurns}｜root=${runRoot}`)

  const results = []
  if (flag('finalize')) {
    log(null, 'finalize 模式：只补收口与裁判报告，不推进新任务')
    for (const c of cases) {
      try {
        results.push(await finalizeCase(c))
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        log(c.id, `收口失败：${message}`)
        const existing = readJson(join(runRoot, c.id, 'result.json'), null)
        results.push(existing || { id: c.id, caseId: c.id, goal: c.goal, error: message, referee: null })
      }
    }
  } else {
    let cursor = 0
    async function worker(index) {
      while (cursor < cases.length) {
        const c = cases[cursor++]
        try {
          results.push(await runCase(c))
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          log(c.id, `失败：${message}`)
          const dir = join(runRoot, c.id)
          const state = readJson(join(dir, 'state.json'), { caseId: c.id })
          writeJson(join(dir, 'state.json'), { ...state, lastError: message })
          results.push({ caseId: c.id, goal: c.goal, error: message, referee: null })
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(concurrency, cases.length) }, (_, i) => worker(i)))
  }
  scanRuntimeEvidence(results)

  // ---- 聚类：只报 ≥2 次或 critical ----
  const byCode = new Map()
  for (const r of results) {
    const findings = Array.isArray(r.referee?.report?.findings) ? r.referee.report.findings : []
    for (const f of findings) {
      const severity = String(f?.severity || 'unknown')
      // info 是裁判的正面记录/观察，不进入待修列表（否则「Meno 闸通过 ×2」会被误判成病灶）。
      if (severity === 'info') continue
      const rawCode = String(f?.code || 'UNKNOWN')
      const code = canonicalFindingCode(rawCode)
      const entry = byCode.get(code) || { code, rawCodes: [], count: 0, cases: [], severities: {}, titles: [], details: [], evidenceIds: [] }
      entry.rawCodes.push(rawCode)
      entry.cases.push(r.caseId)
      entry.severities[severity] = (entry.severities[severity] || 0) + 1
      if (f?.title) entry.titles.push(String(f.title).slice(0, 200))
      if (f?.detail) entry.details.push(String(f.detail).slice(0, 300))
      if (Array.isArray(f?.evidenceIds)) entry.evidenceIds.push(...f.evidenceIds.slice(0, 5))
      byCode.set(code, entry)
    }
  }
  const clusters = [...byCode.values()]
    .map((e) => {
      const cases = [...new Set(e.cases)]
      return { ...e, cases, count: cases.length, rawCodes: [...new Set(e.rawCodes)], evidenceIds: [...new Set(e.evidenceIds)].slice(0, 20) }
    })
    .sort((a, b) => b.count - a.count || a.code.localeCompare(b.code))
  // 采样/收口造成的伪问题：本轮 --max-tasks 主动 abandon 必然缺 wrapup/末课，
  // 不能当平台缺陷进入修复清单（结果里保留原始 finding 以便追溯）。
  const SAMPLING_ARTIFACTS = new Set(['SAMPLING_ABANDONED_MID_TASK', 'METRICS_INCOMPLETE'])
  const actionable = clusters.filter((e) => !SAMPLING_ARTIFACTS.has(e.code) && (e.count >= 2 || Object.keys(e.severities).includes('critical')))

  const summary = {
    batch,
    generatedAt: new Date().toISOString(),
    runRoot,
    cases: results.map((r) => ({
      caseId: r.caseId,
      domain: r.domain,
      sessionId: r.sessionId,
      outcome: r.outcome || null,
      verdict: r.referee?.report?.verdict || null,
      scores: r.referee?.report?.scores || null,
      findingCodes: (r.referee?.report?.findings || []).map((f) => f.code),
      runtime: r.runtime || null,
      error: r.error || null,
    })),
    clusters,
    actionable,
    note: '本轮只产出病历单，不修改任何 YAML/提示词；跨样本归因与补丁留到下一轮。',
  }
  writeJson(join(runRoot, 'summary.json'), summary)

  const md = []
  md.push(`# Referee Mini-Batch 病历单（${batch}）`)
  md.push('')
  md.push(`生成：${summary.generatedAt}`)
  md.push('')
  md.push('## Case 结果')
  md.push('')
  md.push('| case | 领域 | 终态 | verdict | findings | 错误 |')
  md.push('| --- | --- | --- | --- | --- | --- |')
  for (const c of summary.cases) {
    md.push(`| ${c.caseId} | ${c.domain || ''} | ${c.outcome?.status || '—'} | ${c.verdict || '—'} | ${c.findingCodes.join('<br>') || '—'} | ${c.error || '—'} |`)
  }
  md.push('')
  md.push('## 运行时证据（裁判输入之外的确定性事实）')
  md.push('')
  md.push('| case | session | epistemic 降级 | LLM 执行失败 | Path 等待超时 |')
  md.push('| --- | --- | --- | --- | --- |')
  for (const c of summary.cases) {
    const r = c.runtime || {}
    md.push(`| ${c.caseId} | ${c.sessionId || '—'} | ${r.epistemicGroundingDegraded ?? '—'} | ${r.llmExecutionFailures ?? '—'} | ${r.autopilotPathWaitTimeout ?? '—'} |`)
  }
  md.push('')
  md.push('## 跨样本聚类（只列 ≥2 次或 critical）')
  md.push('')
  if (!actionable.length) md.push('（无：所有 finding 都是单样本，按规则先视为噪音，不进入修复）')
  for (const e of actionable) {
    md.push(`### ${e.code} × ${e.count}（${e.cases.join(', ')}）`)
    md.push(`- severity：${JSON.stringify(e.severities)}`)
    if (e.titles[0]) md.push(`- 代表标题：${e.titles[0]}`)
    if (e.details[0]) md.push(`- 代表 detail：${e.details[0]}`)
    if (e.evidenceIds.length) md.push(`- evidenceIds：${e.evidenceIds.join(', ')}`)
    md.push('')
  }
  md.push('## 全部 finding（含单样本噪音，仅存档）')
  md.push('')
  for (const e of clusters) md.push(`- ${e.code} × ${e.count}｜${e.cases.join(', ')}｜${JSON.stringify(e.severities)}`)
  writeFileSync(join(runRoot, 'report.md'), `${md.join('\n')}\n`)

  log(null, `完成：${results.length} case，actionable ${actionable.length} 类 → ${join(runRoot, 'report.md')}`)
  if (!keepAlive) log(null, '学习者与黑盒会话保留在 state.json（清理请用 cleanup 脚本按 profileId 删除）')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
