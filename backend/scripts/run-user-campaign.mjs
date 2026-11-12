#!/usr/bin/env node
/**
 * 无人化多用户跑数编排器（campaign runner）
 *
 * 复用 `src/scripts/simulate-learner-e2e.ts` 作为单用户 harness：每个 case 一个可丢弃
 * 虚拟学习者 + 会话级模拟时钟 + 逐日上课。本脚本只做三件事：
 *   1. 按并发度拉起 N 个 harness 子进程（互不共享会话/租约）；
 *   2. 逐 case 落 `harness.log` / `state.json` / `result.json`，支持断点续跑；
 *   3. 汇总 `summary.json`（完成/失败/持续运行、findings 聚类、耗时）。
 *
 * 产物目录（gitignored）：`backend/.runtime/campaigns/<campaign>/<caseId>/`
 *
 * 用法：
 *   node scripts/run-user-campaign.mjs --cases=src/scripts/campaigns/2026-11-13-20-users.json
 *   node scripts/run-user-campaign.mjs --cases=... --only=u01,u04 --days=1 --concurrency=4
 *   node scripts/run-user-campaign.mjs --cases=... --concurrency=5        # 全量
 *
 * 说明：
 * - 始终传 `--keep`：保留虚拟学习者与会话供采集/复盘；批次结束后用清理脚本统一删。
 * - harness 自己会从 `state.json` 续跑；result.json 退出码为 0 的 case 默认跳过。
 * - 需要后端已在运行（默认 http://127.0.0.1:3001）。
 */
import { spawn } from 'node:child_process'
import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { createInterface } from 'node:readline'

const backendRoot = resolve(import.meta.dirname, '..')
const tsNodeBin = join(backendRoot, 'node_modules', 'ts-node', 'dist', 'bin.js')
const harnessScript = join(backendRoot, 'src', 'scripts', 'simulate-learner-e2e.ts')

function arg(name, fallback = '') {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : fallback
}
function flag(name) {
  return process.argv.includes(`--${name}`)
}

const casesPath = resolve(backendRoot, arg('cases', 'src/scripts/campaigns/2026-11-13-20-users.json'))
const concurrency = Math.max(1, Number(arg('concurrency', '5')) || 5)
const daysOverride = arg('days') ? Number(arg('days')) : null
const only = new Set(arg('only').split(',').map((s) => s.trim()).filter(Boolean))
const force = flag('force')
const baseUrl = arg('base-url', 'http://127.0.0.1:3001').replace(/\/+$/, '')
const runRoot = resolve(backendRoot, arg('run-dir', join('.runtime', 'campaigns', new Date().toISOString().slice(0, 10))))

const spec = JSON.parse(readFileSync(casesPath, 'utf8'))
if (!Array.isArray(spec.cases) || spec.cases.length === 0) {
  console.error('[campaign] 用例集为空')
  process.exit(2)
}

/** 读 backend/.env（只取 KEY=VALUE，忽略注释/引号），用于自动化登录。 */
function readEnvFile(path) {
  const out = {}
  try {
    for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/)
      if (!match) continue
      out[match[1]] = match[2].replace(/^["']|["']$/g, '')
    }
  } catch { /* 没有 .env 就只靠进程环境 */ }
  return out
}

const envFile = readEnvFile(join(backendRoot, '.env'))
const adminName = process.env.E2E_ADMIN_NAME || envFile.INIT_ADMIN_NAME || 'admin'
const adminPassword = process.env.E2E_ADMIN_PASSWORD || envFile.INIT_ADMIN_PASSWORD || ''
let sharedCookie = null

/**
 * 预登录一次，后续所有 harness 复用同一个 Cookie。
 * 原因：管理员登录按 ip+User-Agent 收掉兄弟会话；每个 case 各自登录会互相踢下线。
 */
async function ensureAdminCookie() {
  if (sharedCookie) return sharedCookie
  if (!adminPassword) {
    throw new Error('缺少管理员密码：请设置 E2E_ADMIN_PASSWORD，或在 backend/.env 配 INIT_ADMIN_PASSWORD')
  }
  const response = await fetch(`${baseUrl}/api/admin-auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5173' },
    body: JSON.stringify({ name: adminName, password: adminPassword, remember: true })
  })
  const cookieHeader = response.headers.get('set-cookie') || ''
  sharedCookie = cookieHeader.split(';')[0] || null
  if (!response.ok || !sharedCookie) {
    const text = await response.text().catch(() => '')
    throw new Error(`预登录失败（http=${response.status}）：${text.slice(0, 200)}`)
  }
  return sharedCookie
}

const selected = spec.cases
  .map((c, index) => ({ ...c, index }))
  .filter((c) => only.size === 0 || only.has(c.id))
if (selected.length === 0) {
  console.error(`[campaign] --only 未匹配任何用例：${[...only].join(',')}`)
  process.exit(2)
}

mkdirSync(runRoot, { recursive: true })
const state = {
  campaign: spec.campaign,
  startedAt: new Date().toISOString(),
  backend: baseUrl,
  casesPath,
  concurrency,
  daysOverride: daysOverride ?? spec.daysOverride ?? null,
  results: {}
}

function caseDir(id) {
  return join(runRoot, id)
}

function readJson(path, fallback) {
  try { return JSON.parse(readFileSync(path, 'utf8')) } catch { return fallback }
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}

function summarize() {
  const rows = Object.values(state.results)
  const counts = { total: selected.length, pending: 0, running: 0, completed: 0, failed: 0, skipped: 0 }
  const findings = {}
  for (const c of selected) {
    const row = state.results[c.id]
    if (!row) { counts.pending += 1; continue }
    counts[row.status] = (counts[row.status] || 0) + 1
    for (const f of row.findings || []) {
      findings[f.code] = (findings[f.code] || 0) + 1
    }
  }
  state.counts = counts
  state.findings = findings
  state.updatedAt = new Date().toISOString()
  writeJson(join(runRoot, 'summary.json'), state)
}

function buildArgs(caseSpec) {
  const days = daysOverride ?? caseSpec.days ?? 7
  const baseDaysAgo = (spec.baseDaysAgo ?? 30) + caseSpec.index * 3
  const dir = caseDir(caseSpec.id)
  const args = [
    tsNodeBin,
    '--transpile-only',
    harnessScript,
    `--base-url=${baseUrl}`,
    `--name=${caseSpec.learnerName || `[sim20] ${caseSpec.id}`}`,
    `--goal=${caseSpec.goal}`,
    `--days=${days}`,
    `--base-days-ago=${baseDaysAgo}`,
    `--expect=${caseSpec.expect || 'path'}`,
    // 4-5 阶段路径的「core → 逐阶段设计 → KC 映射 → 落库」实测可达 20-30 分钟；
    // 默认 30 分钟太贴近边界，批量跑数统一放宽到 60 分钟，避免把「慢但正常」误判为未就绪。
    `--ready-timeout-ms=3600000`,
    `--keep`,
    `--state=${join(dir, 'state.json')}`,
    `--profile-role=${caseSpec.story?.role || '跑数学习者'}`,
    `--profile-scenario=${caseSpec.story?.scenario || '无人化多用户压力测试'}`,
    `--story-title=${caseSpec.learnerName || caseSpec.id}`,
    `--story-opening=${caseSpec.story?.opening || caseSpec.goal}`,
    `--story-problem=${caseSpec.story?.problem || ''}`,
    `--story-trigger=${caseSpec.story?.trigger || ''}`
  ]
  if ((caseSpec.persona || 'realistic') === 'realistic') args.push('--realistic-persona')
  return { args, dir, days }
}

function runCase(caseSpec) {
  const { args, dir, days } = buildArgs(caseSpec)
  const id = caseSpec.id
  const resultPath = join(dir, 'result.json')
  const prior = readJson(resultPath, null)

  if (!force && prior && prior.exitCode === 0) {
    state.results[id] = { ...prior, status: 'skipped', skippedReason: 'already-completed' }
    summarize()
    console.log(`[campaign] ${id} 已完成，跳过（--force 可重跑）`)
    return Promise.resolve()
  }

  mkdirSync(dir, { recursive: true })
  const logPath = join(dir, 'harness.log')
  const logStream = createWriteStream(logPath, { flags: 'a' })
  const startedAt = new Date()
  const attempt = (prior?.attempt || 0) + 1
  state.results[id] = {
    id,
    domain: caseSpec.domain,
    learnerName: caseSpec.learnerName,
    status: 'running',
    attempt,
    days,
    startedAt: startedAt.toISOString(),
    logPath
  }
  summarize()
  console.log(`[campaign] ▶ ${id} 启动（第 ${attempt} 次，days=${days}，并发=${concurrency}）`)

  return new Promise((resolvePromise) => {
    const child = spawn(process.execPath, args, {
      cwd: backendRoot,
      env: {
        ...process.env,
        VIRTUAL_LAB_BASE_URL: baseUrl,
        ...(sharedCookie ? { E2E_ADMIN_COOKIE: sharedCookie } : {})
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    })

    const pipe = (stream) => {
      const rl = createInterface({ input: stream })
      rl.on('line', (line) => {
        logStream.write(`${line}\n`)
      })
    }
    pipe(child.stdout)
    pipe(child.stderr)

    const killTimer = setTimeout(() => {
      console.error(`[campaign] ⚠ ${id} 超时（12h），终止`)
      child.kill()
    }, 12 * 3600_000)

    child.on('error', (error) => {
      logStream.write(`[runner] spawn error: ${error.message}\n`)
    })

    child.on('exit', (code, signal) => {
      clearTimeout(killTimer)
      logStream.end()
      const finishedAt = new Date()
      const stateFile = readJson(join(dir, 'state.json'), null)
      const findings = Array.isArray(stateFile?.findings) ? stateFile.findings : []
      const row = {
        id,
        domain: caseSpec.domain,
        learnerName: caseSpec.learnerName,
        status: code === 0 ? 'completed' : 'failed',
        attempt,
        days,
        startedAt: startedAt.toISOString(),
        finishedAt: finishedAt.toISOString(),
        durationSec: Math.round((finishedAt - startedAt) / 1000),
        exitCode: code,
        signal: signal || null,
        sessionId: stateFile?.sessionId || null,
        profileId: stateFile?.profileId || null,
        round: stateFile?.round ?? 0,
        findings,
        logPath
      }
      writeJson(resultPath, row)
      state.results[id] = row
      summarize()
      console.log(`[campaign] ${code === 0 ? '✔' : '✘'} ${id} 结束 code=${code} 用时=${Math.round(row.durationSec / 60)}min round=${row.round} findings=${findings.map((f) => f.code).join(',') || '无'}`)
      resolvePromise()
    })
  })
}

async function main() {
  await ensureAdminCookie()
  state.adminName = adminName
  console.log(`[campaign] 管理员预登录完成（${adminName}）；用例=${selected.length} 并发=${concurrency} 产物=${runRoot}`)
  const queue = [...selected]
  const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    while (queue.length > 0) {
      const next = queue.shift()
      if (!next) return
      try {
        await runCase(next)
      } catch (error) {
        console.error(`[campaign] ${next.id} 编排异常：${error?.message || error}`)
      }
    }
  })
  await Promise.all(workers)
  summarize()
  const c = state.counts || {}
  console.log(`[campaign] 收尾：completed=${c.completed || 0} failed=${c.failed || 0} skipped=${c.skipped || 0} findings=${JSON.stringify(state.findings || {})}`)
  console.log(`[campaign] 汇总：${join(runRoot, 'summary.json')}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
