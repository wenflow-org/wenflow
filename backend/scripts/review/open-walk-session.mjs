#!/usr/bin/env node
/**
 * 按指定账号打开一个浏览器会话（评审走查用，只读）：
 * 从 auth.json 读出该账号的登录态 → 在本会话里设置 cookie → 打开目标页 → 打印页面标题与账号确认。
 * 令牌只经进程环境传递，**不打印**，也不会出现在子代理的对话里。
 *
 * 用法（cwd = 仓库根）：
 *   node backend/scripts/review/open-walk-session.mjs --session walk-p1 --auth <auth.json> --url <url> [--wait 2500]
 */
import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

function argOf(flag, dflt) { const i = process.argv.indexOf(flag); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt; }

const session = argOf('--session', 'walk');
const authPath = resolve(argOf('--auth', resolve(process.env.TEMP || '/tmp', 'wenflow-walk', 'auth.json')));
const url = argOf('--url', 'http://127.0.0.1:5173/learning-paths');
const waitMs = Number(argOf('--wait', '2500'));
const WEB = argOf('--web', 'http://127.0.0.1:5173');
const API = argOf('--api', 'http://127.0.0.1:3001');

if (!existsSync(authPath)) throw new Error(`缺少登录态文件 ${authPath}，先跑 mint-walk-auth.mjs`);
const token = JSON.parse(readFileSync(authPath, 'utf8')).cookies[0].value;

// agent-browser 在 Windows 上是 .cmd 垫片，需要 shell 才能解析；逐个候选尝试
const CANDIDATES = [process.env.WALK_AB, 'agent-browser', 'agent-browser.cmd'].filter(Boolean);
function ab(args) {
  let lastErr = '';
  for (const bin of CANDIDATES) {
    const r = spawnSync(bin, args, { encoding: 'utf8', shell: process.platform === 'win32' });
    if (r.status === 0) return r.stdout.trim();
    lastErr = (r.stderr || r.stdout || r.error?.message || '').slice(0, 200);
  }
  throw new Error(`agent-browser 执行失败：${lastErr}`);
}

ab(['--session', session, 'cookies', 'set', 'wenflow_token', token, '--url', WEB, '--httpOnly']);
ab(['--session', session, 'open', url]);
if (waitMs > 0) ab(['--session', session, 'wait', String(waitMs)]);
const title = ab(['--session', session, 'get', 'title']);
const cur = ab(['--session', session, 'get', 'url']);

// 用同一枚令牌确认当前是哪个账号（只打印账号与路径条数，不打印令牌）
let account = '(未确认)';
let pathCount = 0;
let firstPath = '';
try {
  const r = await fetch(`${API}/api/learning/paths`, { headers: { Cookie: `wenflow_token=${token}` } });
  const j = await r.json();
  const list = j?.data ?? [];
  pathCount = Array.isArray(list) ? list.length : 0;
  firstPath = String(list?.[0]?.title ?? '');
  // 用路径归属反推账号：查询接口不含邮箱，这里回显第一条路径标题即可确认身份一致
  account = firstPath ? `路径首条「${firstPath}」` : '无路径';
} catch (e) {
  account = `(账号确认失败：${String(e?.message ?? e).slice(0, 60)})`;
}
console.log(`[walk-open] 会话=${session}`);
console.log(`[walk-open] 账号确认=${account}（该账号共 ${pathCount} 条路径）`);
console.log(`[walk-open] 页面标题=${title}`);
console.log(`[walk-open] 当前 URL=${cur}`);
