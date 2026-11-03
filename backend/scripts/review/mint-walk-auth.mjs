#!/usr/bin/env node
/**
 * 走查取态脚本（评审用，只读工具）：
 * 为指定用户签发一枚长效 user access token，写成 agent-browser 的 storage state（auth.json），
 * 供"真人流程走查"的浏览器会话直接登录。令牌只写入文件，**绝不打印**。
 *
 * 用法（cwd = 仓库根）：
 *   node backend/scripts/review/mint-walk-auth.mjs [--user <userId>] [--out <auth.json>] [--days 14]
 *
 * 只读：不动数据库，不改任何用户数据；如需换账号，只改 --user。
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = resolve(process.cwd());
const BACKEND = resolve(ROOT, 'backend');

// 手动加载 backend/.env（脚本不依赖 dotenv 的 cwd 行为）
function loadEnv() {
  const p = resolve(BACKEND, '.env');
  if (!existsSync(p)) throw new Error(`缺少 ${p}`);
  const txt = readFileSync(p, 'utf8');
  for (const line of txt.split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!(m[1] in process.env)) process.env[m[1]] = v;
  }
}

function argOf(flag, dflt) {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
}

loadEnv();

const userId = argOf('--user', 'user_be0ac1c4-2bc7-4d2c-b110-97189330bac2');
const days = Number(argOf('--days', '14'));
const out = resolve(argOf('--out', resolve(process.env.TEMP || '/tmp', 'wenflow-walk', 'auth.json')));

const jwt = require(resolve(BACKEND, 'node_modules/jsonwebtoken'));
const secret = process.env.JWT_SECRET;
if (!secret) throw new Error('backend/.env 缺 JWT_SECRET');

// 读该用户的 tokenVersion（改密/重置会递增；对不上就验不过）——只读查询
const { PrismaClient } = require(resolve(BACKEND, 'node_modules/@prisma/client'));
const prisma = new PrismaClient();
const user = await prisma.users.findUnique({ where: { id: userId } });
if (!user) { await prisma.$disconnect(); throw new Error(`找不到用户 ${userId}`); }
const tokenVersion = Number(user.tokenVersion ?? 0);
await prisma.$disconnect();

const token = jwt.sign(
  { userId, name: user.name ?? undefined, tokenVersion, purpose: 'access', type: 'user' },
  secret,
  { algorithm: 'HS256', expiresIn: `${days}d`, issuer: 'wenflow', audience: 'wenflow:user' },
);

const expMs = Date.now() + days * 24 * 60 * 60 * 1000;
const state = {
  cookies: [
    {
      name: 'wenflow_token', value: token, domain: '127.0.0.1', path: '/',
      httpOnly: true, secure: false, sameSite: 'Strict', expires: Math.floor(expMs / 1000),
    },
  ],
  origins: [{ origin: 'http://127.0.0.1:5173', localStorage: [] }],
};

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(state, null, 2), 'utf8');

// 只打印可安全公开的信息
console.log(`[mint-walk-auth] 账号=${user.email ?? userId} tokenVersion=${tokenVersion}`);
console.log(`[mint-walk-auth] 令牌长度=${token.length} 到期=${new Date(expMs).toISOString()}`);
console.log(`[mint-walk-auth] 已写入 ${out}`);

// 顺带做端到端预检：前端可达 + 用这枚 cookie 能读到该账号的学习路径
const backend = process.env.WALK_API || 'http://127.0.0.1:3001';
const frontend = process.env.WALK_WEB || 'http://127.0.0.1:5173';
async function ping(url, opts) {
  try {
    const r = await fetch(url, opts);
    return { ok: r.status >= 200 && r.status < 400, status: r.status };
  } catch (e) {
    return { ok: false, status: 0, err: String(e && e.message ? e.message : e) };
  }
}
const web = await ping(frontend + '/');
const api = await ping(backend + '/api/learning/paths', { headers: { Cookie: `wenflow_token=${token}` } });
console.log(`[walk-env] 前端 ${frontend} -> ${web.ok ? 'OK' : 'FAIL'} (${web.status})`);
console.log(`[walk-env] 后端 ${backend}/api/learning/paths -> ${api.ok ? 'OK' : 'FAIL'} (${api.status})`);
if (!web.ok || !api.ok) {
  console.log('[walk-env] 预检未通过：后端/前端未就绪或登录态无效');
  process.exit(2);
}
