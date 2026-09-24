/**
 * 走正规发布入口的 prompt core 发布器（dev scratch，不入库）
 *
 * 为什么不直接用 sync-one-prompt.ts：那条路是"直接写 DB"，
 * 绕过五块结构 / 字段冻结 / classifyCoreEdit / 语义冻结判官四道闸门。
 * 本脚本 POST /api/admin/prompt-lab/publish-core，让闸门真正生效。
 *
 * 用法：
 *   node scripts/publish-core-api.cjs --skill=teaching-turn --dry     # 只登录 + 看当前版本（只读）
 *   node scripts/publish-core-api.cjs --skill=teaching-turn --apply
 *   node scripts/publish-core-api.cjs --skill=teaching-turn --apply --confirm-uncertain
 */
const fs = require('node:fs');
const path = require('node:path');

const BASE = process.env.WENFLOW_BASE_URL || 'http://127.0.0.1:3001';

function arg(name) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
}
const has = (name) => process.argv.includes(`--${name}`);

function readEnv(key) {
  const p = path.join(__dirname, '..', '.env');
  const text = fs.readFileSync(p, 'utf8');
  const m = new RegExp(`^${key}=(.*)$`, 'm').exec(text);
  return m ? m[1].trim().replace(/^["']|["']$/g, '') : null;
}

async function main() {
  const skill = arg('skill');
  if (!skill) throw new Error('必须给 --skill=<skillId>');
  const apply = has('apply');

  const name = readEnv('INIT_ADMIN_NAME');
  const password = readEnv('INIT_ADMIN_PASSWORD');
  if (!name || !password) throw new Error('.env 缺少 INIT_ADMIN_NAME / INIT_ADMIN_PASSWORD');

  const loginRes = await fetch(`${BASE}/api/admin-auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, password }),
  });
  const login = await loginRes.json();
  if (!loginRes.ok) throw new Error(`登录失败 ${loginRes.status}: ${JSON.stringify(login)}`);
  // admin 登录把 JWT 放在 HttpOnly Cookie（wenflow_admin_token），响应体只有 user
  const setCookie = loginRes.headers.getSetCookie?.() || [];
  const adminCookie = setCookie
    .map((c) => c.split(';')[0])
    .find((c) => c.startsWith('wenflow_admin_token='));
  const token = adminCookie || login.token || login.data?.token;
  if (!token) throw new Error(`登录响应无 token（cookie/body 都没有）: ${JSON.stringify(setCookie)}`);
  const authHeaders = {
    Cookie: token,
    Authorization: `Bearer ${token.split('=').slice(1).join('=')}`,
    // csrfMiddleware：带 Cookie 的写请求必须有被允许的 Origin/Referer
    Origin: (process.env.CORS_ORIGIN || 'http://localhost:5173').split(',')[0].trim(),
  };

  const manifestRes = await fetch(`${BASE}/api/admin/prompt-lab/manifest/${skill}`, {
    headers: authHeaders,
  });
  const manifest = await manifestRes.json();
  console.log('--- 发布前 manifest ---');
  console.log(JSON.stringify({
    ok: manifestRes.ok,
    activeVersion: manifest?.activeVersion ?? manifest?.data?.activeVersion,
    coreHash: manifest?.coreHash ?? manifest?.data?.coreHash,
    coreVersion: manifest?.coreVersion ?? manifest?.data?.coreVersion,
  }, null, 2));

  if (!apply) {
    console.log(JSON.stringify({ mode: 'dry', skill, note: '加 --apply 才真正发布' }, null, 2));
    return;
  }

  const body = { skillId: skill };
  if (has('confirm-uncertain')) body.confirmUncertain = true;

  const res = await fetch(`${BASE}/api/admin/prompt-lab/publish-core`, {
    method: 'POST',
    headers: { "Content-Type": "application/json", ...authHeaders },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let parsed;
  try { parsed = JSON.parse(text); } catch { parsed = { raw: text }; }
  console.log('--- 发布结果 ---');
  console.log(JSON.stringify({ status: res.status, ok: res.ok, ...parsed }, null, 2));
  if (!res.ok) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exit(1); });
