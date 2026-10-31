#!/usr/bin/env node
/**
 * vl-two-arm-batch.mjs — assisted 轨「多课批量 + 双臂交错」驱动（#85/#104/#124 数据前置）
 *
 * 每个会话：
 *   1) restart-learning（清理旧课堂 + 按第一个可运行任务开新课堂）
 *   2) 逐课推进：写臂标签（A/B 按课次交替）→ teaching-step 直到 taskCompleted/currentTaskStopped/失败
 *      完课后下一节课由完成链路自动开好，无需手动 start-learning
 *   3) 记录每课：臂、任务、回合数、是否完课、错误
 *
 * 产物：--out 指定的 JSONL（默认 .tmp-batch/logs/two-arm-<ts>.jsonl），不写仓库。
 *
 * 用法：
 *   node scripts/vlab-eval/vl-two-arm-batch.mjs --sessions=id1,id2 --lessons=4 --max-turns=16 --concurrency=3
 *   node scripts/vlab-eval/vl-two-arm-batch.mjs --config=path.json
 *   config 形状：{ sessions:[{id, 'armStart':'A'}], lessons, maxTurns, concurrency, base }
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath, pathToFileURL } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(import.meta.url);
try {
  const undici = require(path.resolve(ROOT, 'backend/node_modules/undici'));
  undici.setGlobalDispatcher(new undici.Agent({ headersTimeout: 900000, bodyTimeout: 900000, connectTimeout: 30000 }));
} catch { /* 无 undici 时退回默认 */ }

const arg = (k, d) => {
  const hit = process.argv.find((a) => a.startsWith(`--${k}=`));
  return hit ? hit.split('=').slice(1).join('=') : (process.argv.includes(`--${k}`) ? true : d);
};
const CONFIG = (() => {
  const p = arg('config', '');
  if (!p) return null;
  return JSON.parse(fs.readFileSync(path.isAbsolute(p) ? p : path.join(ROOT, p), 'utf8'));
})();
const BASE = arg('base', CONFIG?.base || 'http://127.0.0.1:3011');
const LESSONS = Number(arg('lessons', CONFIG?.lessons ?? 4));
const MAX_TURNS = Number(arg('max-turns', CONFIG?.maxTurns ?? 20));
const CONCURRENCY = Math.max(1, Number(arg('concurrency', CONFIG?.concurrency ?? 3)));
// 错峰启动：多路同时打同一批技能会把上游长尾叠在一起（实测 6 路同起时 tail 从 66s 涨到 120s+）
const STAGGER_MS = Math.max(0, Number(arg('stagger-ms', CONFIG?.staggerMs ?? 0)));
// 失败课（超回合/中断）不计入样本量，按同一臂重试；上限防死循环
// 强制臂（补样本量用）：A/B 之一；留空 = 按已完成样本数交替
const FORCE_ARM = String(arg('arm', CONFIG?.arm ?? '')).toUpperCase();
const MAX_ATTEMPTS_PER_LESSON = Math.max(1, Number(arg('attempts-per-lesson', CONFIG?.attemptsPerLesson ?? 2)));
const SESSIONS = (() => {
  if (CONFIG?.sessions) return CONFIG.sessions.map((item) => (typeof item === 'string' ? { id: item, armStart: 'A' } : item));
  const raw = String(arg('sessions', ''));
  return raw.split(',').map((s) => s.trim()).filter(Boolean).map((id) => ({ id, armStart: 'A' }));
})();
if (SESSIONS.length === 0) {
  console.error('用法：node scripts/vlab-eval/vl-two-arm-batch.mjs --sessions=id1,id2 [--lessons=4] [--max-turns=16] [--concurrency=3]');
  process.exit(2);
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const OUT = arg('out', path.join(ROOT, '.tmp-batch', 'logs', `two-arm-${stamp}.jsonl`));
fs.mkdirSync(path.dirname(OUT), { recursive: true });

const { getAdminCookie } = await import(pathToFileURL(path.resolve(ROOT, 'scripts/vlab-eval/admin-session.mjs')).href);
const envText = fs.readFileSync(path.join(ROOT, 'backend/.env'), 'utf8');
const envGet = (k) => (envText.match(new RegExp('^' + k + '=(.*)$', 'm')) || [])[1]?.trim() || '';
const cookie = await getAdminCookie(BASE, envGet);

const log = (obj) => {
  const line = JSON.stringify({ ts: new Date().toISOString(), ...obj });
  fs.appendFileSync(OUT, line + '\n');
  const brief = obj.kind === 'lesson'
    ? `lesson ${obj.arm} ${obj.lessonsDone}/${obj.lessonsTarget} turns=${obj.turns} ${obj.elapsedSec}s completed=${obj.completed} stopped=${obj.stopped}${obj.error ? ' err=' + String(obj.error).slice(0, 60) : ''}`
    : obj.kind === 'session'
      ? `session ${obj.sessionId} done lessons=${obj.lessonsCompleted} arms=${JSON.stringify(obj.counts || obj.arms)} attempts=${obj.attempts ?? '-'} ${obj.elapsedSec ?? '-'}s${obj.error ? ' err=' + String(obj.error).slice(0, 80) : ''}`
      : obj.kind;
  console.log(`[${new Date().toISOString().slice(11, 19)}] ${brief}`);
};

async function api(method, p, body) {
  const res = await fetch(BASE + p, {
    method,
    headers: { 'content-type': 'application/json', cookie, origin: 'http://localhost:5173' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 500) }; }
  return { status: res.status, json };
}

async function setArm(sessionId, arm) {
  return api('PUT', `/api/admin/virtual-learners/sessions/${sessionId}/simulation-config`, { experimentArm: arm });
}

/**
 * 读路径得到「下一节课」的任务 id。
 * 背景：restart-learning 不带 taskId 时按「第一个可运行任务」重开 = 还是那道卡住的课，
 * 同一条 lane 会把 20 回合硬课反复重跑（实测 8339d216 同一 st_…_2_4 连跑 3 次 ×10 分钟）。
 */
function readTaskCursor(sessionId) {
  let db;
  try {
    db = new DatabaseSync(path.join(ROOT, 'backend', 'prisma', 'dev.db'), { readOnly: true });
    const vs = db.prepare('select currentTaskId, learningPathId from virtual_sessions where id=?').get(sessionId);
    if (!vs?.currentTaskId || !vs?.learningPathId) return { currentTaskId: null, nextTaskId: null };
    const cur = db.prepare('select id, milestoneId, "order" from subtasks where id=?').get(vs.currentTaskId);
    if (!cur) return { currentTaskId: vs.currentTaskId, nextTaskId: null };
    const sibling = db.prepare('select id from subtasks where milestoneId=? and "order">? and status<>\'completed\' order by "order" limit 1').get(cur.milestoneId, cur.order);
    if (sibling) return { currentTaskId: cur.id, nextTaskId: sibling.id };
    const ms = db.prepare('select id, "order" from milestones where id=?').get(cur.milestoneId);
    const nextMs = ms
      ? db.prepare('select id from milestones where learningPathId=? and "order">? order by "order" limit 1').get(vs.learningPathId, ms.order)
      : null;
    const first = nextMs
      ? db.prepare('select id from subtasks where milestoneId=? and status<>\'completed\' order by "order" limit 1').get(nextMs.id)
      : null;
    return { currentTaskId: cur.id, nextTaskId: first?.id || null };
  } catch {
    return { currentTaskId: null, nextTaskId: null };
  } finally {
    try { db?.close(); } catch { /* ignore */ }
  }
}

async function runSession(entry, index) {
  const sessionId = entry.id;
  const arms = [];
  let lessonsCompleted = 0;
  let attempts = 0;
  let sessionError = null;
  const counts = { A: 0, B: 0 };
  const startedAt = Date.now();
  // 臂按「已完成样本数」分配：失败课折算成重试，不会把某一臂的样本量打歪
  const firstArm = entry.armStart === 'B' ? 'B' : 'A';
  const otherArm = firstArm === 'A' ? 'B' : 'A';
  const maxAttempts = LESSONS * MAX_ATTEMPTS_PER_LESSON;
  let sameTaskFailures = 0;
  let lastFailedTaskId = null;
  try {
    if (STAGGER_MS > 0) await new Promise((resolve) => setTimeout(resolve, index * STAGGER_MS + Math.floor(Math.random() * 1500)));
    // 清理旧课堂并按首个可运行任务开课
    const restart = await api('POST', `/api/admin/virtual-learners/sessions/${sessionId}/restart-learning`, {});
    if (restart.status !== 200 || !restart.json?.success) {
      sessionError = `restart-learning 失败：${restart.json?.error || restart.status}`;
      log({ kind: 'session', sessionId, lessonsCompleted, arms, error: sessionError });
      return;
    }
    while (lessonsCompleted < LESSONS && attempts < maxAttempts) {
      attempts += 1;
      const arm = FORCE_ARM === 'A' || FORCE_ARM === 'B'
        ? FORCE_ARM
        : (counts[firstArm] <= counts[otherArm] ? firstArm : otherArm);
      const lessonStartedAt = Date.now();
      const armRes = await setArm(sessionId, arm);
      if (armRes.status !== 200) {
        sessionError = `写臂标签失败：${armRes.status}`;
        break;
      }
      let turns = 0;
      let completed = false;
      let stopped = false;
      let lessonError = null;
      let consecutiveErrors = 0;
      for (let step = 1; step <= MAX_TURNS; step += 1) {
        const r = await api('POST', `/api/admin/virtual-learners/sessions/${sessionId}/teaching-step`, {});
        const d = r.json?.data || {};
        turns = step;
        if (d.taskCompleted) { completed = true; break; }
        if (d.currentTaskStopped || d.isPathCompleted) { stopped = true; break; }
        if (!d.success) {
          consecutiveErrors += 1;
          lessonError = d.error || r.json?.error || `http ${r.status}`;
          if (consecutiveErrors >= 2) break;
          await new Promise((resolve) => setTimeout(resolve, 5000));
          continue;
        }
        consecutiveErrors = 0;
      }
      if (completed) {
        lessonsCompleted += 1;
        counts[arm] += 1;
      }
      arms.push(arm);
      log({
        kind: 'lesson',
        sessionId,
        arm,
        lesson: lessonsCompleted,
        attempt: attempts,
        lessonsTarget: LESSONS,
        lessonsDone: lessonsCompleted,
        turns,
        completed,
        stopped,
        elapsedSec: Math.round((Date.now() - lessonStartedAt) / 1000),
        error: lessonError,
      });
      if (!completed) {
        // 同一道课连续失败 2 次就跳下一节，否则会把卡死的课反复重跑
        const cursor = readTaskCursor(sessionId);
        sameTaskFailures = cursor.currentTaskId && cursor.currentTaskId === lastFailedTaskId
          ? sameTaskFailures + 1
          : 1;
        lastFailedTaskId = cursor.currentTaskId;
        const skip = sameTaskFailures >= 2 && cursor.nextTaskId ? cursor.nextTaskId : null;
        // 未完课（超回合/暂停/停止）：用 restart-learning 复课——它按「第一个可运行任务」重开；
        // start-learning 只认第一个里程碑，里程碑已走完时会报「没有可用任务」把整条 lane 打死
        let recovered = false;
        for (let attempt = 0; attempt < 3 && !recovered; attempt += 1) {
          if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 10000));
          const restart = await api('POST', `/api/admin/virtual-learners/sessions/${sessionId}/restart-learning`, skip ? { taskId: skip } : {});
          if (restart.status === 200 && restart.json?.success) recovered = true;
          else sessionError = `restart-learning 复课失败：${restart.json?.error || restart.status}`;
        }
        if (!recovered) break;
        if (skip) sameTaskFailures = 0;
        log({ kind: 'recover', sessionId, skippedTaskId: skip, sameTaskFailures });
        sessionError = null;
      }
    }
  } catch (error) {
    sessionError = error instanceof Error ? error.message : String(error);
  }
  log({
    kind: 'session',
    sessionId,
    index,
    lessonsCompleted,
    arms,
    counts,
    attempts,
    elapsedSec: Math.round((Date.now() - startedAt) / 1000),
    error: sessionError,
  });
}

async function main() {
  log({ kind: 'start', sessions: SESSIONS.map((s) => s.id), lessons: LESSONS, maxTurns: MAX_TURNS, concurrency: CONCURRENCY, staggerMs: STAGGER_MS, maxAttemptsPerLesson: MAX_ATTEMPTS_PER_LESSON, out: OUT });
  let cursor = 0;
  const workers = Array.from({ length: Math.min(CONCURRENCY, SESSIONS.length) }, async () => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= SESSIONS.length) return;
      await runSession(SESSIONS[index], index);
    }
  });
  await Promise.all(workers);
  log({ kind: 'done', out: OUT });
}

main().catch((error) => {
  console.error('批量失败：', error);
  process.exitCode = 1;
});
