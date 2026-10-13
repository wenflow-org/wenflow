#!/usr/bin/env node
/**
 * A/B 对照 —— 跨日重跑驱动（2026-10-13 用户令：「让这两个虚拟学习者继续跑课程，注意加入跨日模拟，
 * 不要都堆到一天，先重新跑一下对照，看看之前五节课问题解决了吗」）
 *
 * 与 ab-pair-setup.mjs 的关系：setup 搭好 VL/路径/会话后，用 --grind 逐课推进会把课**堆在同一真实日**；
 * 本驱动改用「模拟钟 + advance-day(runTasks=true)」：每天推进一个上课日、跑 lessonsPerDay 节，
 * 使课堂/记忆/指标的业务时间戳落在**不同模拟日**（跨日衰减/温故链由此真实发生）。
 *
 * 三件事（幂等）：
 *   --fresh   为两身份各克隆一条**全新**复刻路径 + 建新会话（不碰旧对照数据）→ 写 manifest-fresh.json
 *   --run     启钟（simulation-config）→ 逐模拟日 advance-day(runTasks=true) 直到完成 --until-tasks 个任务
 *   --status  只读盘点（会话状态 / 已完成任务 / 模拟钟）
 *
 * 用法：
 *   node scripts/vlab-eval/ab-pair-crossday.mjs --fresh
 *   node scripts/vlab-eval/ab-pair-crossday.mjs --run --until-tasks=5 --basedate=2026-09-28
 *   node scripts/vlab-eval/ab-pair-crossday.mjs --status
 */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { spawnSync } from 'node:child_process';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const arg = (k, d) => { const hit = process.argv.find((a) => a.startsWith(`--${k}=`)); return hit ? hit.split('=').slice(1).join('=') : (process.argv.includes(`--${k}`) ? true : d); };

const BASE = arg('base', 'http://127.0.0.1:3011');
const SOURCE = arg('source', 'lp_1791817016486_mot0ov1');
const BASE_DATE = arg('basedate', '2026-09-28');
const UNTIL_TASKS = Number(arg('until-tasks', 5));
const MAX_DAYS = Number(arg('max-days', 20));
const DB_PATH = path.join(ROOT, 'backend/prisma/dev.db');
// 旧日课表基线（周三~周日上课）——改用周一到周五、每天 1 节，凸显「不堆一天」
const OUT_DIR = path.join(ROOT, 'doc/local/runs/20261013/ab-pair-rerun');
const MANIFEST = path.join(OUT_DIR, 'manifest-fresh.json');

const env = fs.readFileSync(path.join(ROOT, 'backend', '.env'), 'utf8');
const envGet = (k) => (env.match(new RegExp('^' + k + '=(.*)$', 'm')) || [])[1]?.trim() || '';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (m) => { const line = `[${new Date().toISOString().slice(11, 19)}] ${m}`; console.log(line); fs.appendFileSync(path.join(OUT_DIR, 'crossday.log'), line + '\n'); };
let cookie = '';
const ADMIN_MOD = pathToFileURL(path.join(ROOT, 'scripts', 'vlab-eval', 'admin-session.mjs')).href;

async function ensureCookie() {
  const { getAdminCookie, adminLoginOnce } = await import(ADMIN_MOD);
  cookie = (await getAdminCookie(BASE, envGet)) || (await adminLoginOnce(BASE, envGet));
  if (!cookie) throw new Error('admin 登录失败');
}

function api(method, urlPath, body, timeoutMs = 60000) {
  const url = new URL(BASE + urlPath);
  const payload = body !== undefined ? JSON.stringify(body) : null;
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: url.hostname, port: url.port || 80, path: url.pathname + url.search, method,
      headers: {
        'Content-Type': 'application/json', Origin: 'http://localhost:5173',
        ...(cookie ? { Cookie: cookie } : {}),
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
      },
      timeout: timeoutMs,
    }, (res) => {
      let text = '';
      res.on('data', (c) => { text += c; });
      res.on('end', () => {
        let parsed = null; try { parsed = JSON.parse(text); } catch { /* keep raw */ }
        resolve({ status: res.statusCode, json: parsed, raw: parsed ? null : text.slice(0, 400) });
      });
    });
    req.on('timeout', () => req.destroy(new Error(`timeout ${timeoutMs}ms`)));
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}
async function apiOk(method, urlPath, body, timeoutMs) {
  const r = await api(method, urlPath, body, timeoutMs);
  if (r.status >= 400) throw new Error(`${r.status} ${(r.raw || JSON.stringify(r.json)).slice(0, 300)}`);
  return r.json;
}

/* ---------------- 路径复刻（DB 直写，同 ab-pair-setup.clonePath） ---------------- */
const rand = () => Math.random().toString(36).substring(2, 9);
function insertRow(db, table, row) {
  const cols = Object.keys(row);
  db.prepare(`INSERT INTO ${table} (${cols.map((c) => `"${c}"`).join(',')}) VALUES (${cols.map(() => '?').join(',')})`).run(...cols.map((c) => row[c]));
}
function clonePath(db, sourceId, targetUserId, targetName) {
  const src = db.prepare('SELECT * FROM learning_paths WHERE id = ?').get(sourceId);
  if (!src) throw new Error(`源路径不存在: ${sourceId}`);
  const srcMs = db.prepare('SELECT * FROM milestones WHERE learningPathId = ? ORDER BY stageNumber').all(sourceId);
  if (!srcMs.length) throw new Error('源路径没有里程碑');
  const now = Date.now();
  const newPathId = `lp_${now}_${rand()}`;
  const taskIdMap = new Map();
  const msIdMap = new Map();
  for (const m of srcMs) {
    msIdMap.set(m.id, `ms_${now}_${rand()}_${m.stageNumber}`);
    for (const t of db.prepare('SELECT id FROM subtasks WHERE milestoneId = ?').all(m.id)) {
      taskIdMap.set(t.id, `st_${now}_${rand()}_${m.stageNumber}_${t.id.slice(-1)}`);
    }
  }
  let template = src.aiPromptTemplate;
  try {
    const t = JSON.parse(template);
    if (t.misconceptionHints?.byTask) {
      const remapped = {};
      for (const [oldId, val] of Object.entries(t.misconceptionHints.byTask)) remapped[taskIdMap.get(oldId) || oldId] = val;
      t.misconceptionHints.byTask = remapped;
    }
    t._clonedFrom = sourceId; t._clonedAt = new Date().toISOString();
    template = JSON.stringify(t);
  } catch { /* 非 JSON 原样带过 */ }
  insertRow(db, 'learning_paths', {
    ...src, id: newPathId, userId: targetUserId, status: 'active', completedMilestones: 0,
    aiPromptTemplate: template, createdAt: now, updatedAt: now,
    replanMode: null, replanReason: null, replanTriggerSource: null,
    sourcePathId: sourceId, activeGenerationRunId: null,
  });
  for (const m of srcMs) {
    const newMsId = msIdMap.get(m.id);
    insertRow(db, 'milestones', {
      ...m, id: newMsId, learningPathId: newPathId,
      status: m.stageNumber === 1 ? 'active' : 'locked',
      unlockedAt: null, startedAt: null, completedAt: null, createdAt: now, updatedAt: now,
    });
    for (const t of db.prepare('SELECT * FROM subtasks WHERE milestoneId = ?').all(m.id)) {
      insertRow(db, 'subtasks', {
        ...t, id: taskIdMap.get(t.id), milestoneId: newMsId, userId: targetUserId,
        status: 'todo', completedAt: null, rating: null, feedback: null, createdAt: now, updatedAt: now,
      });
    }
  }
  log(`复刻路径 ${newPathId} → ${targetName}（${srcMs.length} 阶段）`);
  return newPathId;
}

const completedCount = (db, pathId) => db.prepare(
  `SELECT COUNT(*) c FROM subtasks WHERE milestoneId IN (SELECT id FROM milestones WHERE learningPathId = ?) AND status = 'completed'`
).get(pathId).c;

/* ---------------- --fresh ---------------- */
/**
 * 克隆路径后补跑「概念图物化」——走平台自己的服务（backfill 脚本 → conceptGraphService.materializePathGraph）。
 * 为什么必须补：正常路径生成链（kc-annotation）在写 aiPromptTemplate 后会物化 concept_edges；而克隆是
 * 直写 DB，copy 了模板 JSON 却没跑这步 → 图谱 0 关系、全是散点（2026-10-13 用户复现）。
 */
function materializeClonedPaths(pathIds) {
  if (!pathIds.length) return;
  const r = spawnSync(process.execPath, [
    'node_modules/ts-node/dist/bin.js', '--transpile-only',
    'src/scripts/backfill-concept-graph.ts', `--path-ids=${pathIds.join(',')}`,
  ], { cwd: path.join(ROOT, 'backend'), stdio: 'inherit' });
  if (r.status !== 0) log(`  !! 概念图物化失败（exit ${r.status}）：克隆路径无关系边，图谱会显示为散点`);
}

async function cmdFresh() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  await ensureCookie();
  const db = new DatabaseSync(DB_PATH);
  db.exec('PRAGMA busy_timeout = 15000');
  const source = db.prepare('SELECT id,title FROM learning_paths WHERE id = ?').get(SOURCE);
  if (!source) throw new Error(`源路径不存在：${SOURCE}`);
  const list = await apiOk('GET', '/api/admin/virtual-learners?page=1&pageSize=200');
  const existing = list?.data?.profiles || [];
  const manifest = { source: SOURCE, sourceTitle: source.title, base: BASE, fresh: new Date().toISOString(), pair: [] };
  const clonedPathIds = [];
  for (const name of ['林然', '周雅']) {
    const vl = existing.find((p) => p.name === name || p.profile?.nameHint === name);
    if (!vl?.id || !vl?.userId) throw new Error(`未找到 VL「${name}」`);
    const pathId = clonePath(db, SOURCE, vl.userId, name);
    clonedPathIds.push(pathId);
    const sess = await apiOk('POST', `/api/admin/virtual-learners/${vl.id}/start-session`, { storyIndex: 0 });
    const sessionId = sess?.data?.id || sess?.data?.session?.id;
    if (!sessionId) throw new Error(`「${name}」start-session 未返回会话`);
    db.prepare('UPDATE virtual_sessions SET learningPathId = ?, currentStage = ?, updatedAt = ? WHERE id = ?')
      .run(pathId, 'learn', Date.now(), sessionId);
    log(`新会话 ${sessionId}（${name}）绑定 ${pathId}`);
    manifest.pair.push({ name, vlId: vl.id, userId: vl.userId, pathId, sessionId });
  }
  db.close();
  materializeClonedPaths(clonedPathIds);
  fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2), 'utf8');
  console.log(JSON.stringify(manifest, null, 2));
}

/* ---------------- 模拟钟 / 跨日 ---------------- */
async function getClock(sessionId) {
  const r = await api('GET', `/api/admin/virtual-learners/sessions/${sessionId}/simulation-clock`, undefined, 30000);
  return r.json?.data ?? null;
}
async function enableClock(sessionId) {
  return apiOk('PUT', `/api/admin/virtual-learners/sessions/${sessionId}/simulation-config`,
    { simulationClock: { enabled: true, baseDate: BASE_DATE, autoAdvance: false } }, 30000);
}
async function restartLearning(sessionId) {
  const r = await api('POST', `/api/admin/virtual-learners/sessions/${sessionId}/restart-learning`, {}, 300000);
  return { ok: r.status === 200 && r.json?.success !== false, error: r.json?.error ?? r.raw };
}
async function sessionStatus(db, sessionId) {
  const row = db.prepare('SELECT status, currentStage FROM virtual_sessions WHERE id = ?').get(sessionId);
  return row || {};
}
async function reviveIfFailed(db, sessionId, name) {
  const st = await sessionStatus(db, sessionId);
  if (['failed', 'abandoned'].includes(String(st.status))) {
    const rs = await restartLearning(sessionId);
    log(`  [${name}] 复活: ok=${rs.ok} err=${String(rs.error || '').slice(0, 120)}`);
    await sleep(8000);
    return rs.ok;
  }
  return true;
}
async function advanceOneDay(sessionId, name) {
  for (let i = 1; i <= 4; i += 1) {
    if (i > 1) await reviveIfFailed(dbSingleton, sessionId, name);
    let r;
    try {
      r = await api('POST', `/api/admin/virtual-learners/sessions/${sessionId}/advance-day`, { days: 1, runTasks: true }, 70 * 60 * 1000);
    } catch (e) {
      log(`  [${name}] advance 网络错（${e.message}），30s 重试 ${i}/4`);
      await sleep(30000); continue;
    }
    const learning = r.json?.data?.learning ?? null;
    const reverted = r.json?.data?.reverted === true;
    const notConsumed = reverted || learning?.started !== true;
    const learningErr = learning?.error;
    const retryable = r.status === 429 || r.status >= 500 || (r.status === 200 && notConsumed && !!learningErr);
    log(`  [${name}] advance #${i}: http=${r.status} success=${r.json?.success} learning=${JSON.stringify(learning)} reverted=${reverted}`);
    if (!retryable) return r.json?.data ?? null;
    if (i < 4) { log(`  [${name}] 可重试失败（${String(learningErr || '').slice(0, 120)}），退避 30s`); await sleep(30000); }
  }
  return null;
}

/* ---------------- --run ---------------- */
let dbSingleton = null;

/** 纯推进模拟钟一个上课日（runTasks=false：只记账、不跑课）。返回是否真的推进了。 */
async function advanceClockOnly(sessionId, name) {
  const r = await api('POST', `/api/admin/virtual-learners/sessions/${sessionId}/advance-day`, { days: 1, runTasks: false }, 60000);
  const d = r.json?.data ?? null;
  const advanced = Array.isArray(d?.advancedDayIndexes) && d.advancedDayIndexes.length > 0;
  log(`  [${name}] 推进模拟日: http=${r.status} success=${r.json?.success} advanced=${advanced} dayIndexes=${JSON.stringify(d?.advancedDayIndexes)} day=${d?.simulatedDay} err=${String(r.json?.error || '').slice(0, 110)}`);
  return { advanced, day: d?.simulatedDay ?? null };
}

/** 用 teaching-step 把「本课」推到完成（复刻 --grind 权威配方：step 到完课信号 + 补 2 步 finalize）。 */
async function grindLesson(sessionId, name, pathId) {
  const baseline = completedCount(dbSingleton, pathId);
  const deadline = Date.now() + 45 * 60 * 1000;
  let steps = 0, restarts = 0, stepRetries = 0, upstreamPauses = 0;
  while (Date.now() < deadline) {
    if (steps >= 220) { log(`  [${name}] 本课 ${steps} 步无完课信号（判定停滞），换日`); break; }
    await reviveIfFailed(dbSingleton, sessionId, name);
    let r;
    try {
      r = await api('POST', `/api/admin/virtual-learners/sessions/${sessionId}/teaching-step`, {}, 300000);
    } catch (e) {
      const msg = String(e.message || e);
      if (/已停止|已失败/.test(msg) && restarts < 3) { restarts += 1; log(`  [${name}] 会话已停 → 复活 ${restarts}/3`); await restartLearning(sessionId); await sleep(5000); continue; }
      if (/valid JSON|retry budget exhausted|已暂停本回合|暂时未能生成/i.test(msg) && stepRetries < 6) { stepRetries += 1; log(`  [${name}] 模型抖动 → 30s 重试 ${stepRetries}/6`); await sleep(30000); continue; }
      log(`  [${name}] teaching-step 失败：${msg.slice(0, 120)}`); await sleep(15000); continue;
    }
    stepRetries = 0;
    const d = r.json?.data || {};
    steps += 1;
    if (d.success === false && /已暂停本回合|暂时未能生成/.test(String(d.aiResponse || d.error || ''))) {
      upstreamPauses += 1;
      if (upstreamPauses >= 12) { log(`  [${name}] 上游连续 ${upstreamPauses} 次暂停 → 换日`); break; }
      await sleep(30000); continue;
    }
    if (d.taskCompleted === true || Number(d.completedTasks || 0) > 0 || completedCount(dbSingleton, pathId) > baseline) {
      log(`  [${name}] 本课完成（${steps} 步）｜已完成 ${completedCount(dbSingleton, pathId)}/${UNTIL_TASKS}`);
      // 补 finalize（step N+1 才 endSession→wrapup→completeTask→推进）
      for (let f = 0; f < 2; f += 1) {
        try { const fd = await api('POST', `/api/admin/virtual-learners/sessions/${sessionId}/teaching-step`, {}, 300000); if (fd?.json?.data?.taskCompleted === true) continue; break; } catch { break; }
      }
      await api('POST', `/api/admin/virtual-learners/sessions/${sessionId}/wrapup`, {}, 120000).catch(() => {});
      return true;
    }
    await sleep(2000);
  }
  log(`  [${name}] 本课未在窗口内完成（${steps} 步），换日继续`);
  return false;
}

async function cmdRun() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  await ensureCookie();
  const db = new DatabaseSync(DB_PATH);
  db.exec('PRAGMA busy_timeout = 15000');
  dbSingleton = db;
  const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  await Promise.all(manifest.pair.map(async (p) => {
    log(`== ${p.name} session=${p.sessionId} path=${p.pathId} 目标 ${UNTIL_TASKS} 任务（1 课/模拟日）`);
    await enableClock(p.sessionId);
    let days = 0;
    while (days < MAX_DAYS && completedCount(db, p.pathId) < UNTIL_TASKS) {
      // 1) 推进到下一个上课日（课落在不同模拟日）；推不动（未来日护栏/达上限）= 停止
      const adv = await advanceClockOnly(p.sessionId, p.name);
      if (!adv.advanced) { log(`  [${p.name}] 模拟钟无法再推进（${adv.day ?? 'future-day guard'}），停止`); break; }
      days += 1;
      // 2) 在该模拟日内把本课跑到完成
      await grindLesson(p.sessionId, p.name, p.pathId);
      await sleep(4000);
    }
    log(`-- ${p.name} 结束：已完成 ${completedCount(db, p.pathId)}/${UNTIL_TASKS}，模拟日 ${days}`);
  }));
  db.close();
}

/* ---------------- --status ---------------- */
async function cmdStatus() {
  const db = new DatabaseSync(DB_PATH, { readOnly: true });
  const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  for (const p of manifest.pair) {
    const st = db.prepare('SELECT status, currentStage, stageResults FROM virtual_sessions WHERE id = ?').get(p.sessionId);
    const done = completedCount(db, p.pathId);
    let clock = null;
    try { clock = JSON.parse(String(st?.stageResults || '{}')).simulationClock ?? null; } catch { /* ignore */ }
    log(`== ${p.name} status=${st?.status} stage=${st?.currentStage} tasks=${done} clock=${JSON.stringify(clock)}`);
  }
  db.close();
}

const MODE = arg('fresh', false) ? 'fresh' : arg('run', false) ? 'run' : arg('status', false) ? 'status' : null;
(async () => {
  if (MODE === 'fresh') await cmdFresh();
  else if (MODE === 'run') await cmdRun();
  else if (MODE === 'status') await cmdStatus();
  else console.error('用法：--fresh | --run | --status');
})().catch((e) => { console.error('[ab-pair-crossday] 失败：', e); process.exitCode = 1; });
