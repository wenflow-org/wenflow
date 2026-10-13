// 让指定 VL 会话去上课：start-learning → teaching-step 循环跑到 N 个任务完成（--until-tasks）。
// 用法：node scripts/vlab-eval/vl-teach.mjs --sessions=<id1>,<id2> --until-tasks=2 --base=http://127.0.0.1:3011
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const DB = path.join(ROOT, 'backend', 'prisma', 'dev.db');
const arg = (k, d) => { const hit = process.argv.find((a) => a.startsWith(`--${k}=`)); return hit ? hit.split('=').slice(1).join('=') : d; };
const BASE = arg('base', 'http://127.0.0.1:3011');
const SESSIONS = arg('sessions', '').split(',').filter(Boolean);
const UNTIL = Math.max(1, Number(arg('until-tasks', 2)));
const OUT = path.join(ROOT, 'doc', 'local', 'runs', '20261014', 'vl-goal-path');
fs.mkdirSync(OUT, { recursive: true });
const log = (m) => { const line = `[${new Date().toISOString().slice(11, 19)}] ${m}`; console.log(line); fs.appendFileSync(path.join(OUT, 'teach.log'), line + '\n'); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const env = fs.readFileSync(path.join(ROOT, 'backend', '.env'), 'utf8');
const envGet = (k) => (env.match(new RegExp('^' + k + '=(.*)$', 'm')) || [])[1]?.trim() || '';
let cookie = '';
const { adminLoginOnce, getAdminCookie } = await import(pathToFileURL(path.join(HERE, 'admin-session.mjs')).href);
cookie = (await getAdminCookie(BASE, envGet)) || (await adminLoginOnce(BASE, envGet));
if (!cookie) throw new Error('admin 登录失败');

function api(method, urlPath, body, timeoutMs = 300000) {
  const url = new URL(BASE + urlPath);
  const payload = body !== undefined ? JSON.stringify(body) : null;
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: url.hostname, port: url.port || 80, path: url.pathname + url.search, method,
      headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5173', ...(cookie ? { Cookie: cookie } : {}), ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}) }, timeout: timeoutMs }, (res) => {
      let text = ''; res.on('data', (c) => { text += c; });
      res.on('end', () => { let j = null; try { j = JSON.parse(text); } catch { /* */ } resolve({ status: res.statusCode, json: j, raw: text.slice(0, 200) }); });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function name(pathId) { const db = new DatabaseSync(DB, { readOnly: true }); const r = db.prepare('SELECT title FROM learning_paths WHERE id = ?').get(pathId); db.close(); return r?.title || pathId; }
function doneCount(sessionId) {
  const db = new DatabaseSync(DB, { readOnly: true });
  const vs = db.prepare('SELECT learningPathId, completedTasks FROM virtual_sessions WHERE id = ?').get(sessionId);
  let n = 0;
  if (vs?.learningPathId) n = db.prepare("SELECT COUNT(*) c FROM subtasks WHERE milestoneId IN (SELECT id FROM milestones WHERE learningPathId = ?) AND status = 'completed'").get(vs.learningPathId).c;
  db.close();
  return { n, pathId: vs?.learningPathId };
}

async function teach(sessionId) {
  log(`\n=== 会话 ${sessionId} ===`);
  const st = await api('GET', `/api/admin/virtual-learners/sessions/${sessionId}`, undefined, 30000);
  log(`  当前阶段=${st.json?.data?.currentStage} path=${st.json?.data?.learningPathId}`);
  const sl = await api('POST', `/api/admin/virtual-learners/sessions/${sessionId}/start-learning`, {}, 300000);
  log(`  start-learning http=${sl.status} err=${String(sl.json?.error || '').slice(0, 100)}`);

  let baseline = doneCount(sessionId).n;
  let steps = 0, deadline = Date.now() + 90 * 60 * 1000;
  while (Date.now() < deadline && doneCount(sessionId).n < UNTIL) {
    let r;
    try { r = await api('POST', `/api/admin/virtual-learners/sessions/${sessionId}/teaching-step`, {}, 300000); }
    catch (e) { log(`  step 抛错：${String(e.message).slice(0, 90)}`); await sleep(15000); continue; }
    steps++;
    const d = r.json?.data || {};
    const cur = doneCount(sessionId).n;
    if (steps % 5 === 0 || cur > baseline) log(`  step#${steps} http=${r.status} taskCompleted=${d.taskCompleted} done=${cur}/${UNTIL}${d.aiResponse ? '' : ''}`);
    if (cur > baseline || d.taskCompleted === true || Number(d.completedTasks || 0) > 0) {
      // finalize（补 2 步）
      for (let f = 0; f < 2; f++) { try { await api('POST', `/api/admin/virtual-learners/sessions/${sessionId}/teaching-step`, {}, 300000); } catch { break; } }
      await api('POST', `/api/admin/virtual-learners/sessions/${sessionId}/wrapup`, {}, 120000).catch(() => {});
      baseline = cur;
      log(`  ✓ 本节完成 → done=${baseline}/${UNTIL}（${steps} 步）`);
      continue;
    }
    await sleep(2000);
    if (steps > 260) { log(`  step 超 260，退出（done=${doneCount(sessionId).n}）`); break; }
  }
  const fin = doneCount(sessionId);
  log(`  -- 结束：path=「${name(fin.pathId)}」 已完成 ${fin.n}/${UNTIL} 节`);
}

(async () => {
  for (const s of SESSIONS) await teach(s);
  log('\n=== 上课结束 ===');
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
