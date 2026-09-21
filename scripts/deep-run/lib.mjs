/**
 * 深度体验测试共享库 — 驱动脚本(scripts/deep-run/*.mjs)的公共设施
 * - 统一请求入口:15次/分钟限速、429/5xx 退避、全程 JSONL 日志(journal/)
 * - 双身份 cookie:admin(驾驶 VL)/ user(学习者B),过期自动重登
 * - 只读 SQLite 查询、PROGRESS.json 断点状态、路径结构快照
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, '../..');
export const BASE = 'http://127.0.0.1:3001';

// 档案目录:动态定位 data/ 下 deep-experience-* 目录,避免路径手误
export const DATA = path.join(ROOT, 'data', fs.readdirSync(path.join(ROOT, 'data')).find(d => d.startsWith('deep-experience')));
export const JOURNAL_DIR = path.join(DATA, 'journal');
export const LESSONS_DIR = path.join(DATA, 'lessons');
fs.mkdirSync(JOURNAL_DIR, { recursive: true });
fs.mkdirSync(LESSONS_DIR, { recursive: true });

export const sleep = ms => new Promise(r => setTimeout(r, ms));
export const now = () => new Date().toISOString();
export function log(msg) { console.log(`[${now().slice(11, 19)}] ${msg}`); }

// ---------- 凭据 ----------
export function accounts() {
  return JSON.parse(fs.readFileSync(path.join(DATA, 'accounts.json'), 'utf8'));
}
function readEnvAdmin() {
  const text = fs.readFileSync(path.join(ROOT, 'backend', '.env'), 'utf8');
  const get = k => (text.match(new RegExp(`^${k}=(.*)$`, 'm')) || [])[1]?.trim() || '';
  return { name: get('INIT_ADMIN_NAME'), password: get('INIT_ADMIN_PASSWORD') };
}

// ---------- cookie(缓存 + 探测 + 重登) ----------
const cookieFile = { admin: path.join(DATA, 'admin-cookie.txt'), user: path.join(DATA, 'userB-cookie.txt') };
async function login(kind) {
  let body, url;
  if (kind === 'admin') {
    const a = readEnvAdmin();
    url = '/api/admin-auth/login';
    body = { name: a.name, password: a.password, remember: true };
  } else {
    const a = accounts().B;
    url = '/api/auth/login';
    body = { name: a.name, password: a.password, remember: true };
  }
  const res = await fetch(BASE + url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5173' },
    body: JSON.stringify(body),
  });
  const cookie = (res.headers.get('set-cookie') || '').split(';')[0];
  if (!cookie) throw new Error(`${kind} 登录失败: ${(await res.text()).slice(0, 200)}`);
  fs.writeFileSync(cookieFile[kind], cookie);
  return cookie;
}
export async function getCookie(kind) {
  const f = cookieFile[kind];
  const cookie = fs.existsSync(f) ? fs.readFileSync(f, 'utf8').trim() : '';
  if (cookie) {
    const probe = await fetch(BASE + (kind === 'admin' ? '/api/admin/virtual-learners/stats' : '/api/users/me'), {
      headers: { Cookie: cookie, Origin: 'http://localhost:5173' }, signal: AbortSignal.timeout(15000),
    });
    if (probe.status !== 401) return cookie;
  }
  return login(kind);
}

// ---------- 限速(网关 15 req/min ⇒ AI 类调用最小间隔 4.5s) ----------
const AI_GAP = 4500;
let lastCallAt = 0;

function journal(run, rec) {
  fs.appendFileSync(path.join(JOURNAL_DIR, `${run}.jsonl`), JSON.stringify(rec) + '\n');
}

/**
 * 统一请求。opts: { run, action, pace(bool, 默认 method!=='GET'), retries(默认4), timeoutMs(默认300s), quiet }
 * 返回解析后的 json;非 2xx 且不可重试时返回 {_failed:true,status,error,json}
 */
export async function call(kind, method, urlPath, body, opts = {}) {
  const run = opts.run || 'misc';
  const action = opts.action || `${method} ${urlPath}`;
  const pace = opts.pace ?? method !== 'GET';
  const retries = opts.retries ?? 4;
  if (pace) {
    const wait = lastCallAt + AI_GAP - Date.now();
    if (wait > 0) await sleep(wait);
    lastCallAt = Date.now();
  }
  let lastErr = '';
  for (let attempt = 1; attempt <= retries; attempt++) {
    const t0 = Date.now();
    let res, text;
    try {
      const headers = { Cookie: await getCookie(kind), Origin: 'http://localhost:5173' };
      if (body !== undefined) headers['Content-Type'] = 'application/json';
      res = await fetch(BASE + urlPath, {
        method, headers, body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(opts.timeoutMs || 300000),
      });
      text = await res.text();
    } catch (e) {
      lastErr = e.message;
      log(`! ${action} 网络层失败(${attempt}/${retries}): ${lastErr}`);
      await sleep(10000 * attempt);
      continue;
    }
    let json; try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 500) }; }
    const rec = { ts: now(), run, action, method, path: urlPath, req: body ?? null, status: res.status, durMs: Date.now() - t0, res: json };
    const ok = res.ok && json?.success !== false;
    if (ok || res.status === 429 || res.status === 409 || res.status >= 500 || attempt === retries) {
      // 成功或重试耗尽都落日志(大响应截断 80KB)
      const size = JSON.stringify(json).length;
      journal(run, size > 80000 ? { ...rec, res: { _truncated: true, head: JSON.stringify(json).slice(0, 80000) } } : rec);
    }
    if (ok) return json;
    lastErr = String(json?.error?.message || json?.error || json?.raw || text).slice(0, 300);
    if (res.status === 429 || res.status === 409 || res.status >= 500) {
      log(`! ${action} → ${res.status},退避 ${20 * attempt}s(${attempt}/${retries}): ${lastErr}`);
      await sleep(20000 * attempt);
      continue;
    }
    if (!opts.quiet) log(`! ${action} → ${res.status}: ${lastErr}`);
    return { _failed: true, status: res.status, error: lastErr, json };
  }
  return { _failed: true, error: lastErr };
}

// ---------- 只读 DB ----------
const DB_PATH = path.join(ROOT, 'backend', 'prisma', 'dev.db');
export function q(sql, params = []) {
  const db = new DatabaseSync(DB_PATH, { readOnly: true });
  try { return db.prepare(sql).get(...params); } finally { db.close(); }
}
export function qa(sql, params = []) {
  const db = new DatabaseSync(DB_PATH, { readOnly: true });
  try { return db.prepare(sql).all(...params); } finally { db.close(); }
}

// ---------- PROGRESS.json ----------
const PROGRESS_FILE = path.join(DATA, 'PROGRESS.json');
export function loadProgress() {
  return fs.existsSync(PROGRESS_FILE) ? JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf8')) : { runs: {} };
}
export function saveProgress(mutate) {
  const p = loadProgress();
  mutate(p);
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify(p, null, 2));
  return p;
}
export function runState(run) {
  const p = loadProgress();
  return p.runs?.[run] || {};
}
export function setRunState(run, patch) {
  return saveProgress(p => {
    p.runs = p.runs || {};
    p.runs[run] = { ...(p.runs[run] || {}), ...patch };
  });
}

// ---------- 路径结构快照 ----------
export function pathSnapshot(userId, sinceIso) {
  const sinceMs = sinceIso ? new Date(sinceIso).getTime() : null;
  const lp = sinceMs
    ? q('SELECT * FROM learning_paths WHERE userId=? AND createdAt>=? ORDER BY createdAt DESC LIMIT 1', [userId, sinceMs])
    : q('SELECT * FROM learning_paths WHERE userId=? ORDER BY createdAt DESC LIMIT 1', [userId]);
  if (!lp) return null;
  const milestones = qa('SELECT id, stageNumber, title, description, estimatedHours, status FROM milestones WHERE learningPathId=? ORDER BY stageNumber', [lp.id]);
  const tasks = qa(`SELECT s.id, s.milestoneId, s.title, s.description, s.taskType, s.estimatedMinutes, s.acceptanceCriteria,
                    s."order" AS sortOrder, s.status, s.cognitiveLevel, s.icapLevel, s.knowledgeType, s.transferable
                    FROM subtasks s JOIN milestones m ON m.id=s.milestoneId WHERE m.learningPathId=? ORDER BY m.stageNumber, s."order"`, [lp.id]);
  const totalMinutes = tasks.reduce((s, t) => s + (t.estimatedMinutes || 0), 0);
  return { pathId: lp.id, title: lp.title, name: lp.name, subject: lp.subject, status: lp.status, difficulty: lp.difficulty, estimatedHours: lp.estimatedHours, milestones, tasks, totalMinutes, taskCount: tasks.length, milestoneCount: milestones.length };
}

// ---------- 课堂边界报告骨架 ----------
export function writeLessonReport(run, idx, md) {
  const file = path.join(LESSONS_DIR, `${run}-L${String(idx).padStart(2, '0')}.md`);
  fs.writeFileSync(file, md);
  return file;
}
export function writeText(rel, content) {
  const file = path.join(DATA, rel);
  fs.writeFileSync(file, content);
  return file;
}

// ---------- CLI 参数 ----------
export function arg(name, fallback = undefined) {
  const i = process.argv.indexOf('--' + name);
  if (i === -1) return fallback;
  const v = process.argv[i + 1];
  return v && !v.startsWith('--') ? v : true;
}
