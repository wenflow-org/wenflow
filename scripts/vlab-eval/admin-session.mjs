// fleet 共享 admin cookie（adminAuth 单会话互踢：各自持 cookie 会互相踢成死锁，
// 2026-10-03 18:55 实锤）。协议：cookie 落 .tmp-batch/admin-cookie.txt；
// 401 时先看文件是否被别人刷新，有就认领，没有才自己登录并写文件。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const FILE = path.join(ROOT, '.tmp-batch/admin-cookie.txt')
let memCookie = ''
export async function adminLoginOnce(BASE, envGet) {
  const res = await fetch(BASE + '/api/admin-auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5173' },
    body: JSON.stringify({ name: envGet('INIT_ADMIN_NAME'), password: envGet('INIT_ADMIN_PASSWORD'), remember: true })
  })
  const c = (res.headers.get('set-cookie') || '').split(';')[0]
  if (c) { memCookie = c; try { fs.writeFileSync(FILE, c) } catch {} }
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
