#!/usr/bin/env node
/**
 * 10 个虚拟学习者 · 顺序跑几节课
 *
 * 只把 public 字段传给平台；internal（taskType/kindHint/coreTestPoint）留在本地，不进请求。
 *
 *   node outputs/e2e/run-learners-10.mjs --days=2
 *   node outputs/e2e/run-learners-10.mjs --only=f2,f3 --days=1
 *   node outputs/e2e/run-learners-10.mjs --skip-existing
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, createWriteStream } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const backend = resolve(root, 'backend');
const outDir = resolve(here, 'learners');
mkdirSync(outDir, { recursive: true });

const argv = process.argv.slice(2);
const argOf = (name, fallback) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const days = argOf('days', '2');
const baseUrl = argOf('base-url', 'http://127.0.0.1:3011');
const only = argOf('only', '');
const skipExisting = argv.includes('--skip-existing');
const baseDaysAgo = argOf('base-days-ago', '14');

const config = JSON.parse(readFileSync(resolve(here, 'learner-cases-10.json'), 'utf8'));
const wanted = new Set(only ? only.split(',').map((s) => s.trim()).filter(Boolean) : []);
const cases = config.cases.filter((c) => !wanted.size || wanted.has(c.id));

const runOne = (c) =>
  new Promise((resolveRun) => {
    const state = resolve(outDir, `${c.id}-state.json`);
    const logPath = resolve(outDir, `${c.id}.run.log`);
    const log = createWriteStream(logPath, { flags: 'a' });
    const p = c.public;
    const args = [
      'ts-node',
      '--transpile-only',
      'src/scripts/simulate-learner-e2e.ts',
      `--base-url=${baseUrl}`,
      `--name=${p.learnerName}`,
      `--goal=${p.learningGoal}`,
      `--days=${days}`,
      `--base-days-ago=${baseDaysAgo}`,
      '--keep',
      `--state=${state}`,
      `--story-title=${p.storyTitle}`,
      `--story-opening=${p.storyOpening}`,
      `--story-problem=${p.storyProblem}`,
      `--story-trigger=${p.storyTrigger}`,
      `--profile-role=${p.profileRole}`,
      `--profile-scenario=${p.profileScenario}`,
    ];
    // 不经 shell：窗口命令行会把带空格的 --name/--story-* 拆开（实测 name 被截成「[评测]」）。
    const tsnode = resolve(backend, 'node_modules/ts-node/dist/bin.js');
    const child = spawn(process.execPath, [tsnode, ...args.slice(2)], {
      cwd: backend,
      env: { ...process.env, E2E_ADMIN_NAME: process.env.E2E_ADMIN_NAME || 'admin' },
      shell: false,
    });
    child.stdout.pipe(log, { end: false });
    child.stderr.pipe(log, { end: false });
    const started = Date.now();
    child.on('exit', (code) => {
      log.end();
      const mins = ((Date.now() - started) / 60000).toFixed(1);
      console.log(`[${c.id}] exit=${code} ${mins}min  log=${logPath}`);
      resolveRun(code === 0);
    });
  });

let failed = 0;
for (const c of cases) {
  const state = resolve(outDir, `${c.id}-state.json`);
  if (skipExisting && existsSync(state)) {
    console.log(`[${c.id}] 已有状态，跳过`);
    continue;
  }
  console.log(`[${c.id}] 开始：${c.public.learnerName}（${days} 天）`);
  const ok = await runOne(c);
  if (!ok) failed += 1;
}
console.log(`完成：${cases.length - failed}/${cases.length} 成功`);
process.exit(failed ? 1 : 0);
