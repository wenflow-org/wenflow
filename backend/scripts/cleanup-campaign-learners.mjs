#!/usr/bin/env node
/**
 * 战役结束后清理可丢弃虚拟学习者（默认按 result.json 里的 profileId 删）。
 *
 * 跑数期间**不要**运行：删除会级联清掉会话/路径/课堂消息，报告就没了。
 *
 * 用法：
 *   node scripts/cleanup-campaign-learners.mjs --run-dir=.runtime/campaigns/2026-11-13 --dry-run
 *   node scripts/cleanup-campaign-learners.mjs --run-dir=.runtime/campaigns/2026-11-13
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

const backendRoot = resolve(import.meta.dirname, '..')
function arg(name, fallback = '') {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : fallback
}
const runRoot = resolve(backendRoot, arg('run-dir', join('.runtime', 'campaigns', new Date().toISOString().slice(0, 10))))
const baseUrl = arg('base-url', 'http://127.0.0.1:3001').replace(/\/+$/, '')
const dryRun = process.argv.includes('--dry-run')

function readJson(path, fallback) {
  try { return JSON.parse(readFileSync(path, 'utf8')) } catch { return fallback }
}
function readEnvFile(path) {
  const out = {}
  try {
    for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/)
      if (!match) continue
      out[match[1]] = match[2].replace(/^["']|["']$/g, '')
    }
  } catch { /* ignore */ }
  return out
}

const envFile = readEnvFile(join(backendRoot, '.env'))
const adminName = process.env.E2E_ADMIN_NAME || envFile.INIT_ADMIN_NAME || 'admin'
const adminPassword = process.env.E2E_ADMIN_PASSWORD || envFile.INIT_ADMIN_PASSWORD || ''

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

const targets = []
for (const file of resultFiles) {
  const result = readJson(file, null)
  if (!result?.profileId) continue
  if (targets.some((t) => t.profileId === result.profileId)) continue
  targets.push({ id: result.id, profileId: result.profileId, learnerName: result.learnerName })
}

console.log(`[cleanup] ${targets.length} 个可丢弃学习者${dryRun ? '（dry-run）' : ''}`)
for (const t of targets) console.log(`  - ${t.id} ${t.learnerName || ''} ${t.profileId}`)

if (dryRun) {
  writeFileSync(join(runRoot, 'cleanup-plan.json'), `${JSON.stringify(targets, null, 2)}\n`)
  process.exit(0)
}

if (!adminPassword) {
  console.error('[cleanup] 缺少管理员密码（E2E_ADMIN_PASSWORD 或 backend/.env INIT_ADMIN_PASSWORD）')
  process.exit(2)
}
const login = await fetch(`${baseUrl}/api/admin-auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5173' },
  body: JSON.stringify({ name: adminName, password: adminPassword, remember: true })
})
const cookie = (login.headers.get('set-cookie') || '').split(';')[0]
if (!login.ok || !cookie) {
  console.error(`[cleanup] 登录失败 http=${login.status}`)
  process.exit(2)
}

const results = []
for (const t of targets) {
  const response = await fetch(`${baseUrl}/api/admin/virtual-learners/${t.profileId}`, {
    method: 'DELETE',
    headers: { Origin: 'http://localhost:5173', Cookie: cookie }
  })
  const ok = response.ok
  console.log(`[cleanup] ${ok ? '✔' : '✘'} ${t.id} http=${response.status}`)
  results.push({ ...t, httpStatus: response.status, ok })
}
writeFileSync(join(runRoot, 'cleanup.json'), `${JSON.stringify(results, null, 2)}\n`)
const failed = results.filter((r) => !r.ok).length
console.log(`[cleanup] 完成：成功 ${results.length - failed} / 失败 ${failed}`)
process.exitCode = failed > 0 ? 1 : 0
