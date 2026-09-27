#!/usr/bin/env node
/**
 * WenFlow 一键自诊：`npm run doctor`（跨平台，Node >= 20，零依赖）。
 *
 * 为什么要有它：启动脚本已经覆盖「全新环境一把起」，但"起不来/起了一半/起了不好用"
 * 时的排查全靠读日志。本脚本把部署体验事故库里最常见的坑变成一次性体检，
 * 每一项都带修复指引，只读不改（不会动 .env / 数据库 / 进程）。
 *
 * 覆盖项：
 *  - Node 版本、前后端依赖
 *  - backend/.env 必需键（JWT/双密钥环/AI 网关/初始管理员/双库 URL）与占位值检测
 *  - 双 SQLite 库路径风格（旧嵌套路径检测）与文件存在性
 *  - CORS_ORIGIN 是否同时覆盖 localhost 与 127.0.0.1（历史事故：浏览器走 127.0.0.1
 *    被「请求来源不被允许」拦下，症状与登录失效极难区分）
 *  - 3001/5173 端口与服务健康（已在跑时直接探活，而不是报端口冲突）
 *  - AI 网关可达性（只报可达性，绝不回显密钥）
 *
 * 用法：`node scripts/doctor.mjs [--deep]`
 *   --deep 额外执行 prompts 三方对账等慢检查（默认跳过，保持秒级出结果）。
 * 退出码：无 FAIL 即 0（WARN 不影响）；有 FAIL 为 1，便于 CI/脚本串联。
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const backendDir = join(root, 'backend');
const frontendDir = join(root, 'frontend');
const envPath = join(backendDir, '.env');
const deep = process.argv.includes('--deep');

const results = [];
function report(status, label, detail = '', hint = '') {
  results.push({ status, label, detail, hint });
}
const pass = (label, detail) => report('pass', label, detail);
const warn = (label, detail, hint) => report('warn', label, detail, hint);
const fail = (label, detail, hint) => report('fail', label, detail, hint);
const info = (label, detail) => report('info', label, detail);

function readEnvFile(path) {
  if (!existsSync(path)) return null;
  const map = new Map();
  const raw = readFileSync(path, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m) map.set(m[1], m[2].replace(/^["']|["']$/g, '').trim());
  }
  return map;
}

async function main() {
  // ── Node 版本 ──────────────────────────────────────────────
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major > 20 || (major === 20 && minor >= 17)) {
    pass(`Node ${process.versions.node}`);
  } else {
    fail(`Node ${process.versions.node} 过低`, '', '需要 >= 20.17，请升级 Node.js');
  }

  // ── 依赖 ──────────────────────────────────────────────────
  for (const [dir, name] of [[backendDir, 'backend'], [frontendDir, 'frontend']]) {
    if (existsSync(join(dir, 'node_modules'))) {
      pass(`${name} 依赖已安装`);
    } else {
      fail(`${name} 依赖缺失`, '', `cd ${name} && npm install（或直接 npm run dev，会自动装）`);
    }
  }

  // ── backend/.env ──────────────────────────────────────────
  const env = readEnvFile(envPath);
  if (!env) {
    fail('backend/.env 不存在', '', 'npm run env:setup（Windows）或 cp backend/.env.example backend/.env 后填写');
  } else {
    pass('backend/.env 存在');

    const jwt = env.get('JWT_SECRET') || '';
    if (jwt.length >= 32) pass('JWT_SECRET 强度合格');
    else fail('JWT_SECRET 缺失或弱于 32 字符', '', 'npm run env:setup 可自动生成');

    const encKeys = env.get('SECRET_ENCRYPTION_KEYS') || '';
    const encId = env.get('SECRET_ENCRYPTION_CURRENT_KEY_ID') || '';
    if (encKeys && encId) pass('Secret 加密密钥环已配置');
    else fail('SECRET_ENCRYPTION_KEYS / CURRENT_KEY_ID 未配置', '', 'npm run env:setup');

    // AI 网关（缺失只降级 WARN：纯前端调试可以不配）
    const aiUrl = env.get('AI_API_URL') || '';
    const aiKey = env.get('AI_API_KEY') || '';
    const aiPlaceholder = /^(your[-_].*|changeme|sk-xxx|\$\{.*\})$/i.test(aiKey);
    if (!aiUrl || !aiKey || aiPlaceholder) {
      warn('AI 网关未配置或为占位值', `AI_API_URL=${aiUrl || '(空)'}，AI_API_KEY=${aiKey ? '(已填)' : '(空)'}`,
        'AI 教学功能不可用；填真实网关地址与 Key 后重启后端');
    } else {
      pass('AI 网关已配置');
    }

    // 双库（路径风格判定与 backend/scripts/validate-runtime-environment.js 同口径）
    const dbChecks = [
      { key: 'DATABASE_URL', want: 'file:./dev.db', bad: /^file:\.\/prisma\/(dev\.db)?\s*$/i, badHint: '当前本地路径应为 file:./dev.db' },
      { key: 'SYSTEM_DATABASE_URL', want: 'file:../system.db', bad: /^file:\.\/(?:prisma\/)?system\.db(?:[?#].*)?$/i, badHint: '当前本地路径应为 file:../system.db' },
    ];
    for (const { key, want, bad, badHint } of dbChecks) {
      const url = env.get(key) || '';
      if (!url) {
        fail(`${key} 未配置`, '', `backend/.env 中设置，如 ${want}`);
        continue;
      }
      if (bad.test(url.trim())) {
        fail(`${key} 使用了旧路径`, url, badHint);
        continue;
      }
      if (url.startsWith('file:')) {
        // Prisma 的 file: 相对路径按 schema 文件位置解析（主库 prisma/schema.prisma，
        // 系统库 prisma/system/schema.prisma），不是按 backend/ 目录——按各自 schema 基准解析。
        const schemaBase = key === 'DATABASE_URL'
          ? join(backendDir, 'prisma')
          : join(backendDir, 'prisma', 'system');
        const dbFile = resolve(schemaBase, url.replace(/^file:/, '').split('?')[0]);
        if (existsSync(dbFile) && statSync(dbFile).size > 0) {
          const mb = (statSync(dbFile).size / 1024 / 1024).toFixed(1);
          pass(`${key} → ${dbFile.split(/[\\/]/).pop()}（${mb} MB）`);
        } else {
          warn(`${key} 指向的库文件不存在`, url, 'cd backend && npm run prisma:prepare（会建库并部署迁移）');
        }
      } else {
        pass(`${key} 已配置（非 sqlite 本地路径）`);
      }
    }

    // CORS 覆盖（历史事故：只配 localhost，浏览器走 127.0.0.1 被拦）
    const cors = env.get('CORS_ORIGIN') || '';
    const corsList = cors.split(',').map(s => s.trim());
    if (!cors) warn('CORS_ORIGIN 未配置', '', '本地开发至少含 http://localhost:5173');
    else {
      const hasLocal = corsList.includes('http://localhost:5173');
      const has127 = corsList.includes('http://127.0.0.1:5173');
      if (hasLocal && has127) pass('CORS_ORIGIN 覆盖 localhost 与 127.0.0.1');
      else if (hasLocal) warn('CORS_ORIGIN 缺 http://127.0.0.1:5173', cors,
        '用 127.0.0.1 访问前端会被「请求来源不被允许」拦截；补进 backend/.env 的 CORS_ORIGIN 后重启后端');
      else warn('CORS_ORIGIN 缺 http://localhost:5173', cors, '本地开发必需');
    }

    // 初始管理员
    const adminKeys = ['INIT_ADMIN_NAME', 'INIT_ADMIN_EMAIL', 'INIT_ADMIN_PASSWORD'];
    const missingAdmin = adminKeys.filter(k => !(env.get(k) || '').trim());
    if (missingAdmin.length === 0) pass('初始管理员已配置（首次启动自动创建）');
    else warn(`初始管理员未配置完整（缺 ${missingAdmin.join('/')})`, '', '不配置则启动后没有管理员账号；npm run env:setup 可补');
  }

  // ── 服务状态（先探活再说端口冲突）──────────────────────────
  async function ping(url, timeoutMs = 2500) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
      return r.ok;
    } catch { return false; }
  }
  const backendUp = await ping('http://localhost:3001/readyz');
  if (backendUp) pass('后端已在运行（/readyz 健康）', 'http://localhost:3001');
  else info('后端未运行', 'npm run dev 会自动拉起；若端口被其他进程占用会明确报错');

  const frontendUp = await ping('http://localhost:5173', 1500);
  if (frontendUp) pass('前端 dev server 已在运行', 'http://localhost:5173');
  else info('前端未运行', 'npm run dev 会自动拉起');

  // ── AI 网关可达性（仅在有配置时；绝不回显密钥）──────────────
  if (env && (env.get('AI_API_URL') || '').startsWith('http')) {
    const base = env.get('AI_API_URL').replace(/\/+$/, '');
    const ok = await ping(base, 3000).then(ok => ok || ping(`${base}/health`, 3000));
    if (ok) pass('AI 网关可达');
    else warn('AI 网关不可达（超时/拒连）', base, '检查网络/代理；网关不可用时教学与规划功能会失败');
  }

  // ── 深检：prompts 三方对账 ────────────────────────────────
  if (deep) {
    const r = spawnSync('npm', ['run', 'prompts:core:check'], { cwd: backendDir, encoding: 'utf8', shell: process.platform === 'win32' });
    if (r.status === 0) pass('prompts 三方对账一致（core/编译产物/DB）');
    else warn('prompts 对账不一致', '', 'cd backend && npm run prompts:compile-all 后经管理台 publish，或 npm run prompts:sync-core');
  } else {
    info('深检未启用', '加 --deep 可额外执行 prompts 三方对账（较慢）');
  }

  // ── 输出 ─────────────────────────────────────────────────
  const icon = { pass: '✅', warn: '⚠️ ', fail: '❌', info: 'ℹ️ ' };
  console.log('\nWenFlow Doctor');
  console.log('='.repeat(56));
  for (const r of results) {
    console.log(`${icon[r.status]} ${r.label}${r.detail ? `  ${r.detail}` : ''}`);
    if (r.hint) console.log(`     ↳ 修复：${r.hint}`);
  }
  const fails = results.filter(r => r.status === 'fail').length;
  const warns = results.filter(r => r.status === 'warn').length;
  console.log('='.repeat(56));
  console.log(`结果：${results.filter(r => r.status === 'pass').length} 项通过，${warns} 项警告，${fails} 项失败\n`);
  process.exit(fails > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('doctor 执行失败:', e?.message || e);
  process.exit(1);
});
