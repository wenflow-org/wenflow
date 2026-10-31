#!/usr/bin/env node
/**
 * 按变更面短路的门禁子集跑法（架构优化批 #4）。
 *
 * 背景：`npm run check:quality` 是 22 步全链（PR 合并前权威口径，**保持不动**）。
 * 本脚本面向开发循环 / PR 早期反馈：读取相对基线的变更文件，只跑受影响的门禁子集；
 * 出现任何无法安全分类的变更（lockfile、CI 配置、脚本自身、新增未知目录等）→ 回退全链。
 *
 * 用法：
 *   node scripts/check-quality-fast.mjs [--base <git-ref>] [--staged]
 * 缺省基线：BASE_REF 环境变量 > origin/develop（存在时） > HEAD~1；
 * 工作区未提交改动（已暂存 + 已修改）始终计入。
 *
 * 子集映射（保守方向：宁多跑不漏跑）：
 *   backend/src/**        → typecheck:backend、llm:calls:check、constants:check、boundaries:check、
 *                            layering:check、preset:invariants、measurement:frozen-exam:selftest、lint(backend)
 *   backend/prisma/**     → + prisma:migrate:verify-clean、prisma:migrate:deploy:all、prompts:seed-routings
 *   prompts/** 或后端提示消费面（services|skills|composers|agents|scripts） → prompts:check、prompts:core:check、
 *                            prompts:runtime-contract:check、constants:check
 *   frontend/**           → check:frontend-types、design:check、lint(frontend)
 *   任意层级的 .md 与 docs 目录     → check-doc-dead-links
 *   其余 / 无法分类       → 完整 check:quality
 * 恒跑（便宜且与变更面无关）：security:scan:current、prisma:validate。
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const args = process.argv.slice(2);
function argOf(flag) {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}

function sh(cmd, opts = {}) {
  const r = spawnSync(cmd, { shell: true, encoding: 'utf8', ...opts });
  // 只取 stdout：git 在 Windows 下会往 stderr 打 CRLF 换行警告，混入会污染文件清单
  return r.stdout || '';
}

// ---- 1. 基线与变更文件收集 ----
function resolveBase() {
  const explicit = argOf('--base') || process.env.BASE_REF;
  if (explicit) return explicit;
  if (sh('git rev-parse --verify --quiet origin/develop').trim()) return 'origin/develop';
  return 'HEAD~1';
}

const base = resolveBase();
const mergeBase = sh(`git merge-base ${base} HEAD`).trim() || base;
const changed = new Set();
for (const cmd of [
  `git diff --name-only ${mergeBase}...HEAD`,
  `git diff --name-only HEAD`, // 未提交（已暂存 + 未暂存）
  ...(args.includes('--staged') ? ['git diff --name-only --staged'] : []),
  'git ls-files -o --exclude-standard', // 新增未跟踪文件（新模块等，diff 看不到）
]) {
  for (const line of sh(cmd).split('\n')) {
    const f = line.trim();
    if (f) changed.add(f);
  }
}
const files = [...changed];
if (files.length === 0) {
  console.log('[quality:fast] 相对基线无变更，无事可做。');
  process.exit(0);
}

// ---- 2. 分类 ----
const inDir = (prefix) => files.some((f) => f === prefix || f.startsWith(prefix.endsWith('/') ? prefix : `${prefix}/`));
const touched = (re) => files.some((f) => re.test(f));

const backendSrc = inDir('backend/src');
const backendPrisma = inDir('backend/prisma');
const frontend = inDir('frontend/src') || touched(/^frontend\/(package\.json|tsconfig.*|vite\.config.*)$/);
const prompts = inDir('prompts');
const backendPromptSurface = touched(/backend\/src\/(services|skills|composers|agents|scripts)\//);
const docs = touched(/\.mdx?$/) || inDir('docs');

// 不可安全分类 → 全链（lockfile / CI / 仓库脚本 / 配置顶层文件等）
const RISKY = [
  /^(package(-lock)?\.json|package\.json)$/,
  /^\.github\//,
  /^scripts\//,
  /(^|\/)(tsconfig|jest\.config|eslintrc|eslint\.config)\.[cm]?[jt]s$/,
  /^backend\/(package\.json|tsconfig.*|jest\.config.*|\.eslintrc.*)$/,
  /^frontend\/package\.json$/,
];
const unsafe = files.filter((f) => RISKY.some((re) => re.test(f)) || !/^(backend|frontend|prompts|docs)\//.test(f));
if (unsafe.length > 0 || files.length > 500) {
  console.log(`[quality:fast] 存在无法安全分类的变更（示例：${unsafe.slice(0, 3).join(', ') || '变更面过大'}）→ 回退完整 check:quality。`);
  process.exit(runAll());
}

// ---- 3. 组装子集（保持与全链相同的失败即停语义） ----
const steps = ['security:scan:current', 'prisma:validate'];
if (backendSrc) {
  steps.push('typecheck:backend', 'llm:calls:check', '--prefix backend run lint');
}
if (backendPrisma) {
  steps.push('prisma:migrate:verify-clean', '--prefix backend run prisma:migrate:deploy:all', '--prefix backend run prompts:seed-routings');
}
if (prompts || backendPromptSurface || backendSrc) {
  steps.push('--prefix backend run constants:check');
}
if (prompts || backendPromptSurface) {
  steps.push('prompts:check', 'prompts:core:check', 'prompts:runtime-contract:check');
}
if (frontend) {
  steps.push('check:frontend-types', 'design:check', '--prefix frontend run lint');
}
if (backendSrc) {
  steps.push('--prefix backend run boundaries:check', '--prefix backend run layering:check',
    '--prefix backend run preset:invariants', '--prefix backend run measurement:frozen-exam:selftest');
}
if (docs) {
  steps.push('node scripts/check-doc-dead-links.mjs');
}

function runAll() {
  return runSteps(['check:quality']);
}

function runSteps(stepList, dry = args.includes('--dry-run')) {
  console.log(`[quality:fast] 基线 ${base}，变更 ${files.length} 个文件；执行 ${stepList.length} 步：`);
  for (const name of stepList) console.log(`  - ${name}`);
  if (dry) {
    console.log('\n[quality:fast] --dry-run：仅打印计划，不执行。');
    return 0;
  }
  for (const step of stepList) {
    const cmd = step.startsWith('node ') ? step : `npm run ${step}`;
    console.log(`\n[quality:fast] ▶ ${cmd}`);
    const r = spawnSync(cmd, { shell: true, stdio: 'inherit' });
    if (r.status !== 0) {
      console.error(`\n[quality:fast] ✗ 在「${step}」失败（全链口径不变，可用 npm run check:quality 复现）。`);
      return r.status ?? 1;
    }
  }
  console.log(`\n[quality:fast] ✓ 全部 ${stepList.length} 步通过（跳过面之外的全链门禁在合并前由 check:quality 兜底）。`);
  return 0;
}

process.exit(runSteps(steps));
