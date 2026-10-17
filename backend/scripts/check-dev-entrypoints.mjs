#!/usr/bin/env node
/**
 * check-dev-entrypoints.mjs — 「禁止裸启」门禁（#80）。
 *
 * 背景：后端有三种旁路写法会造出「代码是新的、进程是旧的」假象，且绕过类型快检 /
 * 端口清理 / 就绪等待：
 *   ① `ts-node src/index.ts` 或 `ts-node-dev --respawn` 裸启；
 *   ② 手工 `taskkill` / `Stop-Process` / netstat 找 PID 杀端口；
 *   ③ `touch` 源文件触发 respawn（旧监听模式的补丁）。
 * 正规入口是 `backend/restart.mjs`（重启 / --stop / --status），见根 package.json 的
 * `restart:backend` 与 backend 的 `dev:server`。
 *
 * 扫描面：git 跟踪的 md / ps1 / sh / mjs / cjs / js / yml 与 package.json。
 * 豁免（附理由，改这里必须同步在注释里写清为什么）：
 *   - backend/restart.mjs：唯一入口，内部本来就要 netstat + taskkill；
 *   - backend/scripts/check-dev-entrypoints.mjs：本门禁自身，规则字符串会自匹配；
 *   - docker-start.sh：容器内「端口是否已监听」探测，不涉及 node 进程生命周期。
 *
 * 用法：
 *   node backend/scripts/check-dev-entrypoints.mjs            # 扫仓库，违规退出码 1
 *   node backend/scripts/check-dev-entrypoints.mjs --json      # 机器可读
 *   node backend/scripts/check-dev-entrypoints.mjs --self-test # 用正反例自检规则本身
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..');

const RULES = [
  {
    id: 'bare-backend-start',
    re: /ts-node(?:-dev)?\b[^\n]*\bsrc[\\/]index\.ts/,
    hint: '用 node backend/restart.mjs 启动（裸启绕过类型快检 / 端口清理 / 就绪等待）',
  },
  {
    // 只认「命令式」用法：正文里描述 watcher 行为（「ts-node-dev 会重启」）不算旁路
    id: 'ts-node-dev-watch',
    re: /\bts-node-dev\b[^\n]*(--respawn|--transpile-only|src[\\/]index\.ts)/,
    hint: 'respawn 监听会造出「代码新、进程旧」；改完用 node backend/restart.mjs',
  },
  {
    id: 'manual-node-kill',
    re: /(taskkill[^\n]*\/IM\s+node|Stop-Process\s+-Name\s+node|Get-Process[^\n]*\|\s*Stop-Process)/,
    hint: '手工杀 node 会连带杀掉别的会话；用 node backend/restart.mjs --stop --port=<端口>',
  },
  {
    id: 'manual-port-kill',
    re: /netstat\s+-ano[^\n]*(findstr|grep)[^\n]*:(3001|3011)\b/,
    hint: '按端口手工找 PID 再杀；用 node backend/restart.mjs --status / --stop',
  },
  {
    id: 'touch-respawn',
    re: /\btouch\s+[^\n]*\.(ts|tsx|js|vue)\b/,
    hint: 'touch 触发 respawn 是旧监听模式的补丁；改完直接 restart',
  },
];

/** 单文件豁免：改这里必须写清理由，否则下一个人不知道能不能动。 */
const ALLOWLIST_FILES = new Map([
  ['backend/restart.mjs', '唯一入口：内部本来就要 netstat + taskkill'],
  ['backend/scripts/check-dev-entrypoints.mjs', '门禁自身：规则字符串会自匹配'],
  ['docker-start.sh', '容器内「端口是否已监听」探测，不管理 node 进程生命周期'],
  ['doc/DEV_SCRIPTS.md', '运维手册口径由另一条线维护（#80 已登记该处已过时）；门禁不越权改它'],
]);

/** 目录级豁免：历史快照按只读留档，描述的是当时流程。 */
const ALLOWLIST_PREFIXES = [
  { prefix: 'doc/re_test/', reason: '历史快照（只读留档）' },
  { prefix: 'doc/local/', reason: 'gitignored 过程材料' },
];

function allowlistReason(file) {
  if (ALLOWLIST_FILES.has(file)) return ALLOWLIST_FILES.get(file);
  for (const entry of ALLOWLIST_PREFIXES) {
    if (file.startsWith(entry.prefix)) return entry.reason;
  }
  return null;
}

const SCAN_EXTENSIONS = new Set(['.md', '.ps1', '.sh', '.mjs', '.cjs', '.js', '.yml', '.yaml']);

const AS_JSON = process.argv.includes('--json');
const SELF_TEST = process.argv.includes('--self-test');

/** 规则命中（逐行，保留行号；规则都是单行正则）。 */
export function scanText(text) {
  const hits = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    for (const rule of RULES) {
      if (rule.re.test(line)) hits.push({ line: i + 1, rule: rule.id, hint: rule.hint, text: line.trim() });
    }
  }
  return hits;
}

function trackedFiles() {
  const out = execFileSync('git', ['ls-files', '-z'], { cwd: REPO_ROOT, encoding: 'utf8' });
  return out.split('\0').filter(Boolean);
}

function shouldScan(file) {
  if (allowlistReason(file)) return false;
  if (file.endsWith('package.json')) return true;
  return SCAN_EXTENSIONS.has(path.extname(file));
}

/** package.json 只扫 scripts 块：devDependencies 里出现 ts-node-dev 不是旁路。 */
function scanPackageJson(file, raw) {
  const hits = [];
  let pkg;
  try {
    pkg = JSON.parse(raw);
  } catch {
    return hits;
  }
  const lines = raw.split(/\r?\n/);
  for (const [key, value] of Object.entries(pkg.scripts || {})) {
    if (typeof value !== 'string') continue;
    for (const rule of RULES) {
      if (!rule.re.test(value)) continue;
      const line = lines.findIndex((l) => l.includes(`"${key}"`) && l.includes(value.slice(0, 24)));
      hits.push({ line: line >= 0 ? line + 1 : 0, rule: rule.id, hint: rule.hint, text: `scripts.${key} = ${value}` });
    }
  }
  return hits;
}

function runScan() {
  const violations = [];
  let scanned = 0;
  for (const file of trackedFiles()) {
    if (!shouldScan(file)) continue;
    let text;
    try {
      text = fs.readFileSync(path.join(REPO_ROOT, file), 'utf8');
    } catch {
      continue;
    }
    if (text.includes('\0')) continue; // 二进制
    scanned += 1;
    for (const hit of scanText(text)) violations.push({ file, ...hit });
  }
  if (AS_JSON) {
    console.log(JSON.stringify({ scanned, violations }, null, 2));
  } else {
    console.log(`[dev-entrypoints] 扫描 ${scanned} 个文件，违规 ${violations.length} 条`);
    for (const v of violations) {
      console.log(`  ${v.file}:${v.line}  [${v.rule}]  ${v.text.slice(0, 110)}`);
      console.log(`      → ${v.hint}`);
    }
    if (!violations.length) console.log('  未发现裸启 / 手工杀端口 / touch respawn 旁路。');
  }
  return violations.length;
}

/** 规则自检：每条规则至少命中一个正例、且不误伤已改造后的正确写法。 */
function runSelfTest() {
  const positive = [
    ['bare-backend-start', 'npx ts-node --transpile-only src/index.ts'],
    ['ts-node-dev-watch', 'ts-node-dev --respawn --transpile-only src/index.ts'],
    ['ts-node-dev-watch', 'ts-node-dev src/index.ts'],
    ['manual-node-kill', 'taskkill /F /IM node.exe'],
    ['manual-node-kill', 'Get-Process -Id $pid | Stop-Process -Force'],
    ['manual-port-kill', 'netstat -ano | findstr :3011'],
    ['touch-respawn', 'touch src/index.ts'],
  ];
  const negative = [
    'node backend/restart.mjs --port 3011',
    'nodes = ts-node scripts/page.ts',            // 一次性脚本，不是服务裸启
    'node backend/restart.mjs --status --port=3011',
    'npm run restart:backend',
    'ts-node-dev 会重启，跑批期间别改源码',       // 描述行为，不是旁路命令
    // 注意：restart.mjs 内部的 taskkill/netstat 靠 ALLOWLIST_FILES 豁免，不靠规则放过
  ];
  const failures = [];
  for (const [expectedRule, line] of positive) {
    const hits = scanText(line);
    if (!hits.some((h) => h.rule === expectedRule)) {
      failures.push(`规则 ${expectedRule} 未命中正例：${line}`);
    }
  }
  for (const line of negative) {
    const hits = scanText(line);
    if (hits.length) failures.push(`负例被误伤：${line} → ${hits.map((h) => h.rule).join(',')}`);
  }
  if (failures.length) {
    console.error(`[dev-entrypoints] 自检失败 ${failures.length} 条`);
    for (const f of failures) console.error(`  - ${f}`);
    return 1;
  }
  console.log(`[dev-entrypoints] 自检通过：${positive.length} 条正例命中、${negative.length} 条负例未误伤`);
  return 0;
}

const code = SELF_TEST ? runSelfTest() : runScan() === 0 ? 0 : 1;
process.exit(code);
