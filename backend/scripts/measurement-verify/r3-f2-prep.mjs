// R3 F2 前置：把 VL-B1（=vl-r1b-01-strong，任务书指名）的模拟钟重锚到 baseDate=2026-10-05
// （dayIndex→0），使「下一个上课日」=2026-10-06（今天，日始已过）——R2 已把 6 个 VL 推到
// dayIndex 5=10-06（当日已消耗），下一上课日 10-07 被未来日护栏挡住（simulated-day.service.ts:455
// planClockAdvance 过滤 dayStart>now；PUT simulation-config 不接受 dayIndex，virtual-learners.ts:2993），
// 唯一产品 API 合规路径 = POST /simulation-clock/reset（virtual-learners.ts:3050，dayIndex=0+可选重设 baseDate）。
// 只重锚这一个 VL；其余 5 个不动。随后由 ad-driver.mjs day1 --vl=VL-B1 --basedate=2026-10-05 推进。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..', '..');
const OUT = path.join(__dirname, 'out');
const BASE = 'http://127.0.0.1:3011';
const VSESSION = '01b3ab42-79c3-45a4-b4f4-0cfeadb96357'; // VL-B1 vsession（DB 实读）
const NEW_BASE = process.argv[2] || '2026-10-05'; // 默认 Mon → index1=Tue 10-06；可传 2026-10-04（Sun）→ index1=Mon 10-05

const envText = fs.readFileSync(path.join(ROOT, 'backend', '.env'), 'utf8');
const envGet = (k) => (envText.match(new RegExp('^' + k + '=(.*)$', 'm')) || [])[1]?.trim() || '';
const { getAdminCookie } = await import(pathToFileURL(path.join(ROOT, 'scripts', 'vlab-eval', 'admin-session.mjs')).href);

// 0) 备份 R2 的 ad-day1.json（ad-driver 合并写按 vlKey 覆盖，防 R2 证据被覆写）
const adDay1 = path.join(OUT, 'ad-day1.json');
const backup = path.join(OUT, 'ad-day1.r2-backup.json');
if (fs.existsSync(adDay1) && !fs.existsSync(backup)) {
  fs.copyFileSync(adDay1, backup);
  console.log('[backup] ad-day1.json → ad-day1.r2-backup.json');
}

const cookie = await getAdminCookie(BASE, envGet);
if (!cookie) throw new Error('admin cookie 获取失败');

async function call(method, urlPath, body) {
  const res = await fetch(BASE + urlPath, {
    method, headers: { Cookie: cookie, 'Content-Type': 'application/json', Origin: 'http://localhost:5173' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 300) }; }
  return { status: res.status, json };
}

// 1) reset 前读钟
let r = await call('GET', `/api/admin/virtual-learners/sessions/${VSESSION}/simulation-clock`);
console.log('[clock before]', r.status, JSON.stringify(r.json?.data));

// 2) reset（dayIndex=0、history=[]，重锚 baseDate=2026-10-05）
r = await call('POST', `/api/admin/virtual-learners/sessions/${VSESSION}/simulation-clock/reset`, { baseDate: NEW_BASE });
console.log('[reset]', r.status, JSON.stringify(r.json?.data ?? r.json).slice(0, 400));

// 3) reset 后读钟
r = await call('GET', `/api/admin/virtual-learners/sessions/${VSESSION}/simulation-clock`);
console.log('[clock after]', r.status, JSON.stringify(r.json?.data));
