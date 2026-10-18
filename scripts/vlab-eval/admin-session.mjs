// fleet 共享 admin cookie（adminAuth 单会话互踢：各自持 cookie 会互相踢成死锁，
// 2026-10-03 18:55 实锤）。协议：cookie 落系统临时目录（仓库外），绝不写进工作树；
// 401 时先看文件是否被别人刷新，有就认领，没有才自己登录并写文件。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
// 凭据不落仓库：历史放在 .tmp-batch/ 导致 JWT 随工作树被拷贝/打包（2026-10-17 安全整改）。
const COOKIE_DIR = process.env.WENFLOW_COOKIE_DIR || path.join(os.tmpdir(), 'wenflow-eval-cookies')
const FILE = path.join(COOKIE_DIR, 'admin-cookie.txt')
let memCookie = ''

/** 原子写共享 cookie（截断-写会被并发进程读到半截；目录缺失静默吞掉会让跨进程共享失效）。 */
function writeSharedCookie(c) {
  try {
    fs.mkdirSync(COOKIE_DIR, { recursive: true, mode: 0o700 })
    const tmp = `${FILE}.${process.pid}.tmp`
    fs.writeFileSync(tmp, c, { mode: 0o600 })
    fs.renameSync(tmp, FILE)
  } catch { /* 落盘失败不阻断（内存 cookie 仍可用） */ }
}

export async function adminLoginOnce(BASE, envGet) {
  const res = await fetch(BASE + '/api/admin-auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5173' },
    body: JSON.stringify({ name: envGet('INIT_ADMIN_NAME'), password: envGet('INIT_ADMIN_PASSWORD'), remember: true })
  })
  const c = (res.headers.get('set-cookie') || '').split(';')[0]
  // 登录失败必须抛出：旧实现返回 '' 让调用方带着空 cookie 继续 → 全链 401 却「看起来在跑」（审 2026-10-12）
  if (!res.ok || !c) {
    throw new Error(`admin 登录失败：HTTP ${res.status}${c ? '' : '（无 set-cookie）'}`)
  }
  memCookie = c
  writeSharedCookie(c)
  return c
}
export async function getAdminCookie(BASE, envGet) {
  if (memCookie) return memCookie
  try { const c = fs.readFileSync(FILE, 'utf8').trim(); if (c) { memCookie = c; return c } } catch {}
  return adminLoginOnce(BASE, envGet)
}
// 401/403 时调用：文件里有更新的 cookie 就认领；否则自己重登
export async function refreshAdminCookie(BASE, envGet, stale) {
  try {
    const c = fs.readFileSync(FILE, 'utf8').trim()
    if (c && c !== stale) { memCookie = c; return c }
  } catch {}
  return adminLoginOnce(BASE, envGet)
}
