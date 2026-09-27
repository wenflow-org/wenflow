#!/usr/bin/env node
/**
 * tq- 案例夜跑编排（凌晨批量执行入口）。
 *
 * 用法（在 backend dev 与 gateway 运行正常时）：
 *   node scripts/paradigm-eval/tq-night-run.mjs --phase=goal    # 12 条 tq- 全量 goal→path（断点续跑）
 *   node scripts/paradigm-eval/tq-night-run.mjs --phase=learn   # 选中 5 条做全量 learn（含跨日回写）
 *   node scripts/paradigm-eval/tq-night-run.mjs --phase=cache   # 缓存率快照（追加到结果文件）
 *
 * 设计：全部委托既有驱动器（drive.mjs / learn-drive.mjs），本脚本只做编排、断点与产物落盘；
 * 状态文件 results/tq-night-state.json 支持中断后重跑（已完成的案例自动跳过）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RESULTS = path.join(HERE, 'results');
const STATE = path.join(RESULTS, 'tq-night-state.json');

const ALL_CASES = [
  'tq-phys-newton', 'tq-linalg-grad', 'tq-stat-pvalue', 'tq-cs-notional',
  'tq-econ-micro', 'tq-acct-debit', 'tq-chem-bond', 'tq-psy-myths',
  'tq-hist-mingqing', 'tq-ielts-academic', 'tq-xingce-quant', 'tq-theory-harmony',
];
// learn 全量测试的选择（≤5，按覆盖矩阵：理科 weak 误区 / 社科 mid 误区 / 通识 interest /
// 语言 exam 归因错误 / 知识型边界探针），可用 TQ_SELECTED 覆盖
const SELECTED = (process.env.TQ_SELECTED || 'tq-phys-newton,tq-stat-pvalue,tq-econ-micro,tq-ielts-academic,tq-theory-harmony').split(',');

const log = (m) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);
const loadState = () => (fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE, 'utf8')) : {});
const saveState = (s) => fs.writeFileSync(STATE, JSON.stringify(s, null, 1));

function run(cmd, args, env = {}) {
  try {
    execFileSync(cmd, args, { stdio: 'inherit', cwd: HERE, env: { ...process.env, ...env }, timeout: 30 * 60 * 1000 });
    return true;
  } catch (e) {
    log(`执行失败: ${cmd} ${args.join(' ')} → ${e?.status ?? e?.message}`);
    return false;
  }
}

function phaseGoal() {
  const st = loadState();
  st.goal = st.goal || {};
  for (const id of ALL_CASES) {
    if (st.goal[id]?.pathId) { log(`goal ${id} 已完成（${st.goal[id].pathId}），跳过`); continue; }
    log(`goal→path: ${id}`);
    const ok = run('node', ['drive.mjs', 'cell', id, '1']);
    let pathId = null;
    try {
      const r1 = JSON.parse(fs.readFileSync(path.join(RESULTS, `${id}-r1.json`), 'utf8'));
      pathId = r1.pathId || null;
    } catch { /* 状态文件不存在=未完成 */ }
    st.goal[id] = { ok, pathId, at: new Date().toISOString() };
    saveState(st);
    if (!ok || !pathId) log(`⚠️ ${id} goal 阶段未拿到 pathId，稍后可单独重跑`);
  }
}

function phaseLearn() {
  const st = loadState();
  st.learn = st.learn || {};
  for (const id of SELECTED) {
    if (st.learn[id]?.done) { log(`learn ${id} 已完成，跳过`); continue; }
    const pathId = st.goal?.[id]?.pathId;
    if (!pathId) { log(`⚠️ ${id} 无 pathId（goal 未完成），跳过`); continue; }

    log(`learn A（首轮+冲完课，任务#1）: ${id}`);
    const okA = run('node', ['learn-drive.mjs', id], { LEARN_PATH_ID: pathId, LEARN_COMPLETION: '1', LEARN_TAG: 'A' });
    st.learn[id] = { sessionA: okA ? 'ok' : 'fail', at: new Date().toISOString() };
    saveState(st);

    log(`跨日回写 -3 天: ${id}`);
    let back = false;
    try {
      execFileSync('node', ['tq-crossday.mjs', `--user=pe-${id}`, '--days=3'], { stdio: 'inherit', cwd: HERE });
      back = true;
    } catch { log('⚠️ 跨日回写失败（继续，不影响主链路）'); }

    log(`learn B（跨日后续课，任务#2）: ${id}`);
    const okB = run('node', ['learn-drive.mjs', id], { LEARN_PATH_ID: pathId, LEARN_TASK_INDEX: '1', LEARN_PRESET: 'weak', LEARN_TAG: 'B' });
    st.learn[id] = { ...st.learn[id], crossday: back, sessionB: okB ? 'ok' : 'fail', done: true };
    saveState(st);
    phaseCache();
  }
}

function phaseCache() {
  const out = path.join(RESULTS, `tq-night-cache-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`);
  try {
    execFileSync('npx', ['ts-node', '--transpile-only', 'src/scripts/measure-prompt-cache-rate.ts', '--sinceMin=600'],
      { stdio: ['ignore', fs.openSync(out, 'a'), 'ignore'], cwd: path.join(HERE, '..', '..', 'backend'), shell: process.platform === 'win32' });
    log(`缓存率快照 → ${out}`);
  } catch (e) {
    log(`缓存率量测失败: ${e?.status ?? e?.message}`);
  }
}

const phase = String(Object.fromEntries(process.argv.slice(2).map(a => { const m = a.match(/^--([^=]+)=?(.*)$/); return m ? [m[1], m[2] || true] : [a, true]; })).phase || 'goal');
fs.mkdirSync(RESULTS, { recursive: true });
if (phase === 'goal') phaseGoal();
else if (phase === 'learn') phaseLearn();
else if (phase === 'cache') phaseCache();
else { console.error('未知 phase（goal|learn|cache）'); process.exit(1); }
