#!/usr/bin/env node
/**
 * content-review-queue.mjs — 每日内容抽检队列（运营节奏）
 *
 * 每天跑一次：拉取当前抽样批次里未标注的教师回合，落到
 * doc/local/content-review/QUEUE-YYYY-MM-DD.md，按 10 条/天的目标人工判分。
 * 判分请在运营中心→运维工具→内容抽检里点，或调用 POST /api/admin/content-review/label；
 * 与 CLI 同表同键，标注后 audit-content-review --metrics 立即可见。
 *
 * 用法：
 *   INIT_ADMIN_NAME=... INIT_ADMIN_PASSWORD=... node scripts/content-review-queue.mjs [--days=7] [--rate=0.05]
 *
 * 环境变量（不写进源码）：
 *   WENFLOW_BASE（默认 http://127.0.0.1:3001）
 *   WENFLOW_ORIGIN（默认 http://localhost:5173）
 *   INIT_ADMIN_NAME / INIT_ADMIN_PASSWORD
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.env.WENFLOW_BASE || 'http://127.0.0.1:3001';
const ORIGIN = process.env.WENFLOW_ORIGIN || 'http://localhost:5173';
const arg = (k, d) => {
  const hit = process.argv.find((a) => a.startsWith(`--${k}=`));
  return hit ? hit.split('=').slice(1).join('=') : d;
};
const DAYS = Math.max(1, Number(arg('days', 7)) || 7);
const RATE = Math.max(0.001, Math.min(1, Number(arg('rate', 0.05)) || 0.05));

function cookieFrom(response) {
  const raw = typeof response.headers.getSetCookie === 'function'
    ? response.headers.getSetCookie().join('; ')
    : (response.headers.get('set-cookie') || '');
  return raw.split(/,\s*(?=[^;]+=)/).map((part) => part.split(';')[0]).join('; ');
}

async function login() {
  const name = process.env.INIT_ADMIN_NAME;
  const password = process.env.INIT_ADMIN_PASSWORD;
  if (!name || !password) throw new Error('缺少 INIT_ADMIN_NAME / INIT_ADMIN_PASSWORD（只从环境变量读取）');
  const res = await fetch(`${BASE}/api/admin-auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
    body: JSON.stringify({ name, password, remember: true }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.success) throw new Error(`管理员登录失败：HTTP ${res.status}`);
  return cookieFrom(res);
}

async function main() {
  const cookie = await login();
  const res = await fetch(`${BASE}/api/admin/content-review?days=${DAYS}&rate=${RATE}`, {
    headers: { Cookie: cookie, Origin: ORIGIN },
  });
  const body = await res.json();
  if (!res.ok || !body.success) throw new Error(`抽检读取失败：HTTP ${res.status}`);
  const data = body.data;
  const pending = (data.items || []).filter((item) => !item.label);
  const target = Number(data.dailyTarget || 10);
  const pick = pending.slice(0, target);

  const date = new Date().toISOString().slice(0, 10);
  const dir = path.join(ROOT, 'doc', 'local', 'content-review');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `QUEUE-${date}.md`);
  const lines = [
    `# 内容抽检队列 ${date}`,
    '',
    `抽中 ${data.sampled} · 已标注 ${data.labeled} · 覆盖率 ${(Number(data.coverage || 0) * 100).toFixed(1)}% · 今日 ${data.todayLabeled ?? 0}/${target}`,
    `待标注 ${pending.length} 条；本日队列 ${pick.length} 条。`,
    '',
    '| # | 消息 | 会话 | 内容摘要 | 判分 |',
    '| --- | --- | --- | --- | --- |',
    ...pick.map((item) => `| ${item.messageId} | ${item.messageId} | ${item.sessionId} | ${String(item.content || '').replace(/\s+/g, ' ').slice(0, 90)} | 正确 / 判错 / 存疑 |`),
    '',
    '判分入口：运营中心 → 运维工具 → 内容抽检；或 POST /api/admin/content-review/label。',
  ];
  fs.writeFileSync(file, lines.join('\n'));
  console.log(`[content-review] 待标注 ${pending.length} · 今日 ${data.todayLabeled ?? 0}/${target} · 队列 ${pick.length} 条`);
  console.log(`[content-review] 已写入 ${file}`);
}

main().catch((error) => {
  console.error(`[content-review] ${error.message}`);
  process.exit(1);
});
