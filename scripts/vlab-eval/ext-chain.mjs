#!/usr/bin/env node
/** ext-chain.mjs — 多故事续章延展测试驱动（2026-10-11 用户令「进行延展测试，今晚继续跑数据，往深了跑，还有单人的多样性」）
 *
 * 目标：证明「一节真课完课 → 自动长出下一章故事（承接学习成果）」这根线在真机上成立，
 * 并让保留下来的虚拟学习者一晚上在各自的故事宇宙里连续推进（同一人 × 多场景 = 单人多故事多样性）。
 *
 * 每波（wave）：
 *   1) 只清「已完成本波首课」(learn-done) 的 VL 状态 → 下一波为它开新章；失败者状态**保留**，
 *      让 run-full 从断点续跑（goal 对话增量持久化，**绝不 terminate/删全部状态**——见
 *      resetCompletedStates 注释与 2026-10-12 用户纠偏）
 *   2) run-vl-batch --story-mode=frontier --learn（frontier = 每人当前无续章的最新章）
 *   3) 等续章生长落库（勾子 fire-and-forget，可能晚于驱动返回）→ 快照每人的故事池
 * 证据落 <run-date>/vl-evals/ext-chain-log.jsonl + ext-chain-summary.json
 *
 * 用法：node scripts/vlab-eval/ext-chain.mjs [--waves=4] [--concurrency=2]
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
// 与 run-vl-batch 同一 RUN_DATE 口径（env 可钉住跨零点目录）：否则本脚本扫错目录 → wave2+ 静默不再推进（审 2026-10-12）
const RUN_DATE = process.env.VL_RUN_DATE || (() => { const d = new Date(); return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`; })();
const V = path.join(ROOT, 'doc', 'local', 'runs', RUN_DATE, 'vl-evals');
const BASE = 'http://127.0.0.1:3011';
const DB_PATH = path.join(ROOT, 'backend', 'prisma', 'dev.db');
const WAVES = Number((process.argv.find((a) => a.startsWith('--waves=')) || '').split('=')[1]) || 4;
const CONC = Number((process.argv.find((a) => a.startsWith('--concurrency=')) || '').split('=')[1]) || 2;

fs.mkdirSync(V, { recursive: true });
const log = (m) => { const line = `[${new Date().toISOString().slice(5, 19)}] ${m}`; console.log(line); fs.appendFileSync(path.join(V, 'ext-chain.log'), line + '\n'); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 故事键：池条目 id 与 storyId 两种写法都算（生长写的是 s.id||s.storyId，审 2026-10-12）。 */
const storyKey = (s) => s && (s.id || s.storyId);

function readTargets() {
  const db = new DatabaseSync(DB_PATH, { readOnly: true });
  db.exec('PRAGMA busy_timeout=10000');
  const rows = db.prepare('SELECT id, userId, presetKey, profile FROM virtual_learner_profiles').all();
  db.close();
  return rows.map((r) => {
    let pool = []; let name = '';
    try { const d = JSON.parse(r.profile || '{}'); pool = Array.isArray(d.storyPool) ? d.storyPool : []; name = d.name || d.nameHint || ''; } catch { /* 坏档案 */ }
    const successorParent = new Set(pool.map((s) => s && s.progressesFrom).filter(Boolean));
    let frontier = null; let bestCi = -1;
    for (const s of pool) { const k = storyKey(s); if (!k || successorParent.has(k)) continue; const ci = Number.isFinite(Number(s.chapterIndex)) ? Number(s.chapterIndex) : 1; if (ci >= bestCi) { bestCi = ci; frontier = s; } }
    return {
      profileId: r.id, userId: r.userId, presetKey: r.presetKey, name,
      storyCount: pool.length,
      grownCount: pool.filter((s) => s && s.progressesFrom).length,
      frontierTitle: frontier?.title || null,
      frontierChapter: frontier?.chapterIndex || 1,
      titles: pool.map((s) => `${s.title}(${s.status || 'legacy'}/ch${s.chapterIndex || 1})`),
    };
  });
}

/**
 * 只清「已完成本波首课」的 VL 状态（learn-done）→ 下一波为它开新章；
 * 其余状态（goal-path / poll-path / learn 等）**保留** → 本波 run-full 从断点续跑。
 * 关键认识（2026-10-12 用户纠偏「goal 对话不是逐步完成吗」）：goal 对话是增量持久化的，
 * run-full 重入同一会话即续跑（session-factory 的 !session.goalConversationId 守卫）；而
 * start-session 每次都是全新会话（createSessionForProfile 恒 create）。所以**绝不能 terminate +
 * 删全部状态**——那等于扔掉已完成的 goal 轮次、逼出全新对话。
 */
function resetCompletedStates() {
  let reset = 0; let kept = 0;
  for (const f of fs.readdirSync(V)) {
    if (!/^vlstate-preset[:_].*\.json$/.test(f)) continue; // 只碰本次目标（preset VL）的状态，别动其它批的状态
    const full = path.join(V, f);
    let st = {};
    try { st = JSON.parse(fs.readFileSync(full, 'utf8')); } catch { /* 坏文件按保留处理 */ }
    if (st.phase === 'learn-done') { fs.unlinkSync(full); reset++; } else { kept++; }
  }
  return { reset, kept };
}

function runBatch(tag, idsFile) {
  return new Promise((resolve) => {
    log(`run-vl-batch 启动（tag=${tag}, story-mode=frontier, conc=${CONC}）`);
    const out = fs.openSync(path.join(V, `ext-${tag}-driver.log`), 'a');
    const p = spawn('node', ['scripts/vlab-eval/run-vl-batch.mjs', `--ids-file=${idsFile}`, '--learn', '--story-mode=frontier', `--concurrency=${CONC}`, `--tag=${tag}`, `--base=${BASE}`],
      { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], shell: process.platform === 'win32', env: { ...process.env, VL_RUN_DATE: RUN_DATE } });
    p.stdout.on('data', (d) => fs.writeSync(out, d));
    p.stderr.on('data', (d) => fs.writeSync(out, d));
    // spawn 失败（ENOENT 等）走 'error' 而非 'exit'：不监听会 unhandled error 崩溃且 promise 永挂（审 2026-10-12）
    p.on('error', (e) => { try { fs.closeSync(out); } catch { /* 已关 */ } log(`run-vl-batch spawn 失败（${tag}）: ${String(e && e.message || e)}`); resolve(-1); });
    p.on('exit', (code) => { try { fs.closeSync(out); } catch { /* 已关 */ } log(`run-vl-batch 退出 code=${code}（${tag}）`); resolve(code ?? -1); });
  });
}

/** 等续章生长：勾子 fire-and-forget，可能晚于驱动返回；轮询直到 grownCount 增加或超时。 */
async function waitForGrowth(beforeSnap, timeoutMs = 180000) {
  const before = new Map(beforeSnap.map((t) => [t.profileId, t.grownCount]));
  const deadline = Date.now() + timeoutMs;
  let last = readTargets();
  while (Date.now() < deadline) {
    last = readTargets();
    if (last.some((t) => t.grownCount > (before.get(t.profileId) ?? 0))) return last;
    await sleep(15000);
  }
  return last;
}

const before = readTargets();
if (before.length === 0) { log('FATAL: 无虚拟学习者档案，先导入/保留目标 VL'); process.exit(1); }
// ids 文件就地生成（personaId = preset:<key>），不依赖外部遗留文件，保证与新 RUN_DATE 目录一致
const idsFile = path.join(V, 'keep-ids.txt');
fs.writeFileSync(idsFile, before.map((t) => `preset:${t.presetKey}`).join('\n') + '\n');

log(`延展测试开始：RUN_DATE=${RUN_DATE}｜目标 ${before.length} 人｜共 ${WAVES} 波`);
for (const t of before) log(`  ${t.name}(${t.presetKey}) stories=${t.storyCount} grown=${t.grownCount} frontier=「${t.frontierTitle}」ch${t.frontierChapter}`);

const summary = { startedAt: new Date().toISOString(), runDate: RUN_DATE, waves: WAVES, perWave: [], targets: before.map((t) => ({ presetKey: t.presetKey, name: t.name, storyCount: t.storyCount })) };
let hardFail = false;
for (let w = 1; w <= WAVES; w++) {
  log(`\n===== Wave ${w}/${WAVES} =====`);
  const reset = resetCompletedStates();
  log(`Wave ${w} 状态重置：已完课 ${reset.reset} 个（下一波开新章）｜保留续跑 ${reset.kept} 个`);
  const code = await runBatch(`ext-w${w}`, idsFile);
  if (code !== 0 && code !== null) hardFail = true;
  const snap = await waitForGrowth(before);
  for (const t of snap) {
    fs.appendFileSync(path.join(V, 'ext-chain-log.jsonl'), JSON.stringify({ at: new Date().toISOString(), wave: w, ...t }) + '\n');
    log(`Wave ${w} 快照 ${t.name}: stories=${t.storyCount} grown=${t.grownCount} frontier=「${t.frontierTitle}」ch${t.frontierChapter}`);
  }
  summary.perWave.push({ wave: w, exitCode: code, stateReset: reset, snap: snap.map((s) => ({ presetKey: s.presetKey, storyCount: s.storyCount, grownCount: s.grownCount, frontier: s.frontierTitle, chapter: s.frontierChapter })) });
}
summary.finishedAt = new Date().toISOString();
summary.final = readTargets();
// 原子写（截断-写会留半截 JSON）
const tmp = path.join(V, 'ext-chain-summary.json.tmp');
fs.writeFileSync(tmp, JSON.stringify(summary, null, 1));
fs.renameSync(tmp, path.join(V, 'ext-chain-summary.json'));
log(`\n延展测试结束。最终状态:`);
for (const t of summary.final) log(`  ${t.name}: stories=${t.storyCount} grown=${t.grownCount} | ${t.titles.join(' / ')}`);
if (hardFail) { log('注意：存在非零退出的波（见 perWave.exitCode），已置非零退出码'); process.exitCode = 1; }
