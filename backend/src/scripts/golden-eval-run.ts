/**
 * 黄金评测集 harness（夜批版）：N 个人设 → 建可丢弃虚拟学习者 → 走真实 goal 对话 → 生成路径 → 收集。
 *
 * 与 simulate-learner-e2e 的区别：只跑到「路径生成完成」，不进多日授课
 * （本批评的是路径质量，不是教学会话质量）。
 *
 * 夜批版改造（2026-10-27）：
 * - 外层并发 worker pool（--concurrency，默认 5，夜批从 5 起步找低报错平衡点）
 * - 429/5xx/传输错误指数退避重试（5s→15s→45s→45s→45s）
 * - 单调用超时 5 分钟（原 30 分钟一条卡死拖全批）；路径等待上限 20 分钟
 * - 负样本分支：spec.expect==='triage' 时不等路径，goal 6 步后直读 collectedData 分诊结果
 * - --deadline=ISO：到点不取新样本（08:00 收工保护）
 * - 默认 --keep（跨轮分析需要路径留库；确要清理显式传 --cleanup）
 *
 * 用法：
 *   npx ts-node --transpile-only src/scripts/golden-eval-run.ts \
 *     --spec=../outputs/verify-20261024/golden-100.json \
 *     --state=../outputs/verify-20261024/golden-100-r1-state.json \
 *     --concurrency=5 --deadline=2026-10-27T07:40:00
 *     --only=A04-lin-alg-concepts,...     # 可选，冒烟/补跑
 */
import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';

const BASE_URL = process.env.GOLDEN_EVAL_BASE_URL || 'http://127.0.0.1:3002';
const ORIGIN = 'http://localhost:5173'; // 必须在 .env CORS_ORIGIN 白名单内（CSRF 写请求校验）
const GOAL_MAX_STEPS = 18; // R2/R3 实证：1-3%/轮的样本对话质量到位但 14 步耗尽未走到确认（A14/A23/C17/D08），提额化解
const TRIAGE_MAX_STEPS = 6;
const CALL_TIMEOUT_MS = 5 * 60_000;
const PATH_WAIT_MS = 20 * 60_000;
const BACKOFF_MS = [5_000, 15_000, 45_000, 45_000, 45_000];

const DB_PATH = path.resolve(__dirname, '..', 'prisma', 'dev.db');

try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Agent, setGlobalDispatcher } = require('undici');
  setGlobalDispatcher(new Agent({ headersTimeout: 0, bodyTimeout: 0, connectTimeout: 30_000 }));
} catch { /* 无 undici 也能跑 */ }

interface Spec {
  id: string; name: string; learningGoal: string; knowledgeLevel: string;
  opening: string; surfaceGoal: string; realProblem: string;
  story: { id: string; title: string; visibleOpening: string; goalSeed: { surfaceGoal: string; realProblem: string }; triggerEvent: string };
  budget: Record<string, unknown>; outOfScope: string[]; expectedStages: number;
  bucket?: string; expect?: 'path' | 'triage'; negativeType?: string;
}

const arg = (key: string): string | null => {
  const hit = process.argv.find((a) => a.startsWith(`--${key}=`));
  return hit ? hit.slice(key.length + 3) : null;
};
const has = (key: string): boolean => process.argv.includes(`--${key}`);
const SPEC = arg('spec') || 'outputs/verify-20261024/golden-10.json';
const STATE = arg('state') || 'outputs/verify-20261024/golden-run-state.json';
const ONLY = arg('only') ? new Set(String(arg('only')).split(',').map((s) => s.trim())) : null;
const CONCURRENCY = Number(arg('concurrency')) || 5;
const DEADLINE = arg('deadline') ? new Date(String(arg('deadline'))).getTime() : null;
const KEEP = has('keep') || !has('cleanup');

let cookie: string | null = null;
const log = (s: string): void => { console.log(`[${new Date().toISOString().slice(11, 19)}] ${s}`); };
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const rec = (v: unknown): Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

async function apiOnce(method: string, urlPath: string, body?: unknown, timeoutMs = CALL_TIMEOUT_MS): Promise<{ status: number; body: any }> {
  try {
    const res = await fetch(`${BASE_URL}${urlPath}`, {
      method,
      headers: { 'Content-Type': 'application/json', Origin: ORIGIN, ...(cookie ? { Cookie: cookie } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    let parsed: any = null;
    try { parsed = await res.json(); } catch { parsed = null; }
    return { status: res.status, body: parsed };
  } catch (e) {
    return { status: 0, body: { error: String((e as Error).message).slice(0, 160) } };
  }
}

/** 429/5xx/传输错误指数退避；其余状态原样返回（业务失败由调用方判定） */
async function api(method: string, urlPath: string, body?: unknown, timeoutMs = CALL_TIMEOUT_MS): Promise<{ status: number; body: any }> {
  let last: { status: number; body: any } = { status: 0, body: {} };
  for (let attempt = 0; attempt <= BACKOFF_MS.length; attempt++) {
    last = await apiOnce(method, urlPath, body, timeoutMs);
    if (last.status === 429 || last.status >= 500 || last.status === 0) {
      if (attempt < BACKOFF_MS.length) {
        log(`  ↯ ${method} ${urlPath.split('?')[0]} http=${last.status} ${String(last.body?.error ?? '').slice(0, 80)} → 退避 ${BACKOFF_MS[attempt] / 1000}s（第 ${attempt + 1} 次）`);
        await sleep(BACKOFF_MS[attempt]);
        continue;
      }
    }
    return last;
  }
  return last;
}

async function login(): Promise<void> {
  const name = process.env.E2E_ADMIN_NAME || process.env.INIT_ADMIN_NAME;
  const password = process.env.E2E_ADMIN_PASSWORD || process.env.INIT_ADMIN_PASSWORD;
  if (!name || !password) throw new Error('缺少 E2E_ADMIN_NAME/E2E_ADMIN_PASSWORD（或 INIT_*）');
  const res = await fetch(`${BASE_URL}/api/admin-auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
    body: JSON.stringify({ name, password, remember: true }),
  });
  const setCookie = res.headers.get('set-cookie') || '';
  cookie = setCookie.split(';')[0] || null;
  if (!res.ok || !cookie) throw new Error(`管理员登录失败 http=${res.status}`);
}

const sessionFields = (body: any) => {
  const d = rec(body?.data ?? body);
  return {
    status: String(d.status ?? ''),
    currentStage: String(d.currentStage ?? ''),
    profileId: String(d.profileId ?? ''),
    userId: String(d.userId ?? ''),
    learningPathId: String(d.learningPathId ?? d.pathId ?? ''),
  };
};

interface RunState {
  runs: Record<string, {
    profileId?: string; userId?: string; sessionId?: string; goalSteps?: number; learningPathId?: string;
    phase: string; note?: string; triage?: Record<string, unknown>; seconds?: number;
  }>;
}

function loadState(): RunState {
  try { return JSON.parse(fs.readFileSync(STATE, 'utf8')); } catch { return { runs: {} }; }
}
function saveState(s: RunState): void {
  fs.mkdirSync(path.dirname(STATE), { recursive: true });
  fs.writeFileSync(STATE, JSON.stringify(s, null, 2));
}

/** 只读 dev.db：负样本分诊结果（collectedData.understanding + 最后一条 AI 回复）。
 * understanding 字段在 step 返回后异步落库，抓不到时等待重试。 */
function dumpTriage(sessionId: string): Record<string, unknown> | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { DatabaseSync } = require('node:sqlite');
    const read = (): { u: Record<string, unknown>; lastAi: string } | null => {
      const db = new DatabaseSync(DB_PATH, { readOnly: true });
      const row = db.prepare(
        `SELECT g.collectedData AS collectedData, g.messages AS messages
         FROM virtual_sessions s JOIN goal_conversations g ON g.id = s.goalConversationId
        WHERE s.id = ?`,
      ).get(sessionId) as { collectedData?: string; messages?: string } | undefined;
      db.close();
      if (!row) return null;
      let collected: any = {}; let lastAi = '';
      try { collected = JSON.parse(row.collectedData || '{}'); } catch { /* */ }
      try {
        const msgs = JSON.parse(row.messages || '[]');
        const ai = msgs.filter((m: any) => (m.role === 'assistant' || m.role === 'ai'));
        lastAi = ai.length ? String(ai[ai.length - 1].content || ai[ai.length - 1].text || '').slice(0, 400) : '';
      } catch { /* */ }
      const u = (collected?.understanding ?? {}) as Record<string, unknown>;
      return { u, lastAi };
    };
    let snapshot = read();
    for (let i = 0; i < 10; i++) {
      const u = snapshot?.u ?? {};
      if (u.platform_judgment || u.skill_nature) break;
      const wait = Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10000);
      if (wait === 'timed-out') snapshot = read() ?? snapshot;
    }
    if (!snapshot) return null;
    const u = snapshot.u;
    return {
      skill_nature: u.skill_nature ?? null,
      platform_judgment: u.platform_judgment ?? null,
      primary_block_type: u.primary_block_type ?? null,
      support_need: u.support_need ?? null,
      lastAiReply: snapshot.lastAi,
    };
  } catch (e) {
    return { dumpError: String((e as Error).message).slice(0, 120) };
  }
}

async function runOne(spec: Spec, state: RunState): Promise<void> {
  const key = spec.id;
  const entry = state.runs[key] || { phase: 'new' };
  state.runs[key] = entry;
  const isTriage = spec.expect === 'triage';
  const t0 = Date.now();

  // 1) 建可丢弃学习者（含手写故事）
  if (!entry.profileId) {
    const created = await api('POST', '/api/admin/virtual-learners', {
      name: spec.name,
      learningGoal: spec.learningGoal,
      knowledgeLevel: spec.knowledgeLevel,
      profile: {
        role: '黄金评测集虚拟学习者',
        scenario: spec.realProblem,
        note: `golden-eval: ${key}`,
        storyPool: [spec.story],
      },
      tags: ['golden-eval', key],
      notes: `auto-created by golden-eval-run (${key}); safe to delete`,
    });
    const d = rec(created.body?.data ?? created.body);
    entry.profileId = String(d.id ?? '');
    entry.userId = String(d.userId ?? '');
    if (!entry.profileId) { entry.phase = 'create-failed'; entry.note = JSON.stringify(created.body).slice(0, 200); log(`${key} 创建失败 ${entry.note}`); saveState(state); return; }
    log(`${key} 学习者已建 ${entry.profileId}`);
  }

  // 2) 开会话（autopilot='off'：评测只需要路径就绪，绝不触发 teaching 循环烧额度）
  if (!entry.sessionId) {
    const started = await api('POST', `/api/admin/virtual-learners/${entry.profileId}/start-session`, { autopilot: 'off' });
    const d = rec(started.body?.data ?? started.body);
    entry.sessionId = String(d.id ?? '');
    if (!entry.sessionId) { entry.phase = 'start-failed'; entry.note = JSON.stringify(started.body).slice(0, 200); log(`${key} 开会话失败 ${entry.note}`); saveState(state); return; }
    log(`${key} 会话 ${entry.sessionId}`);
  }

  // 3) 驱动 goal（step 自动应答）；负样本 6 步封顶
  const stepCap = isTriage ? TRIAGE_MAX_STEPS : GOAL_MAX_STEPS;
  let steps = entry.goalSteps || 0;
  while (steps < stepCap) {
    const detail = await api('GET', `/api/admin/virtual-learners/sessions/${entry.sessionId}`, undefined, 60_000);
    const f = sessionFields(detail.body);
    if (f.currentStage !== 'goal') { log(`${key} 离开 goal → ${f.currentStage}/${f.status}（${steps} 步）`); break; }
    if (f.status === 'failed') { entry.phase = 'goal-failed'; entry.seconds = Math.round((Date.now() - t0) / 1000); saveState(state); return; }
    const stepRes = await api('POST', `/api/admin/virtual-learners/sessions/${entry.sessionId}/step`, {});
    steps += 1;
    entry.goalSteps = steps;
    saveState(state);
    if (stepRes.status !== 200) { entry.phase = 'goal-step-failed'; entry.note = `http=${stepRes.status} ${String(stepRes.body?.error ?? '').slice(0, 120)}`; entry.seconds = Math.round((Date.now() - t0) / 1000); saveState(state); return; }
    log(`${key} goal step#${steps}`);
  }

  // 3.5) 负样本：不进路径，直接收分诊结果
  if (isTriage) {
    entry.triage = dumpTriage(entry.sessionId) ?? undefined;
    entry.phase = 'triage-done';
    entry.seconds = Math.round((Date.now() - t0) / 1000);
    saveState(state);
    log(`${key} [triage] platform_judgment=${(entry.triage as any)?.platform_judgment} primary_block_type=${(entry.triage as any)?.primary_block_type}`);
    return;
  }

  // 4) 等路径生成完成（20 分钟上限，超时标记继续下一条）
  // 就绪判定：pathId 存在且该路径没有 processing 中的生成 run
  // （path 行在 core 阶段就落库为 active，仅看 pathId 会提前放行、漏等 stageDesign）
  const stageDone = (pathId: string): boolean => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { DatabaseSync } = require('node:sqlite');
      const db = new DatabaseSync(DB_PATH, { readOnly: true });
      const runs = db.prepare(
        `SELECT phase, status FROM path_generation_runs WHERE learningPathId = ? ORDER BY createdAt`,
      ).all(pathId) as Array<{ phase: string; status: string }>;
      db.close();
      if (runs.some((r) => r.status === 'processing')) return false;
      const core = runs.filter((r) => r.phase === 'core');
      if (!core.length || core[core.length - 1].status !== 'succeeded') return false; // core 失败/缺失 → 永不就绪
      const sd = runs.filter((r) => r.phase === 'stageDesign');
      return !sd.length || sd[sd.length - 1].status === 'succeeded';
    } catch { return false; } // 读库失败（瞬时锁等）→ 视为未就绪继续轮询，宁可超时不误报
  };
  const deadline = Date.now() + PATH_WAIT_MS;
  while (Date.now() < deadline) {
    const st = await api('GET', `/api/admin/virtual-learners/sessions/${entry.sessionId}/path-status`, undefined, 60_000);
    const d = rec(st.body?.data ?? st.body);
    const status = String(d.status ?? d.pathStatus ?? '');
    const pathId = String(d.learningPathId ?? d.pathId ?? '');
    if (pathId) entry.learningPathId = pathId;
    const inFlight = /generating|processing|queued|running|pending/i.test(status);
    if (!inFlight && (status === 'ready' || status === 'completed') && (!pathId || stageDone(pathId))) {
      log(`${key} 路径就绪 ${pathId || entry.learningPathId} (${status})`);
      entry.phase = 'path-ready';
      entry.seconds = Math.round((Date.now() - t0) / 1000);
      saveState(state);
      return;
    }
    if (!inFlight && pathId && stageDone(pathId)) {
      log(`${key} 路径就绪 ${pathId} (stageDesign 完成)`);
      entry.phase = 'path-ready';
      entry.seconds = Math.round((Date.now() - t0) / 1000);
      saveState(state);
      return;
    }
    if (status === 'failed') {
      const retry = await api('POST', `/api/admin/virtual-learners/sessions/${entry.sessionId}/retry-path-generation`, {});
      log(`${key} 路径失败，重试 http=${retry.status}`);
    }
    await sleep(30_000);
  }
  entry.phase = 'path-timeout';
  entry.seconds = Math.round((Date.now() - t0) / 1000);
  saveState(state);
  log(`${key} 等待路径超时（${PATH_WAIT_MS / 60000}min）`);
}

async function cleanup(spec: Spec, state: RunState): Promise<void> {
  const entry = state.runs[spec.id];
  if (!entry?.profileId) return;
  const res = await api('DELETE', `/api/admin/virtual-learners/${entry.profileId}`);
  log(`${spec.id} 清理学习者 http=${res.status}`);
}

(async () => {
  const specsAll: Spec[] = JSON.parse(fs.readFileSync(SPEC, 'utf8'));
  let targets = ONLY ? specsAll.filter((s) => ONLY.has(s.id)) : specsAll;
  await login();
  const state = loadState();
  // 断点续跑：已完成（path-ready / triage-done）的跳过
  targets = targets.filter((s) => !['path-ready', 'triage-done'].includes(state.runs[s.id]?.phase || ''));
  log(`开始：${targets.length} 个样本（并发 ${CONCURRENCY}${DEADLINE ? `，死线 ${new Date(DEADLINE).toISOString().slice(11, 19)}` : ''}）→ ${BASE_URL}`);

  let cursor = 0;
  let stopped = false;
  const worker = async (slot: number): Promise<void> => {
    while (cursor < targets.length) {
      if (DEADLINE && Date.now() > DEADLINE) { stopped = true; return; }
      const spec = targets[cursor++];
      log(`===== [w${slot}] ${spec.id}${spec.expect === 'triage' ? '（triage 负样本）' : ''} =====`);
      try { await runOne(spec, state); }
      catch (e) { state.runs[spec.id] = { ...(state.runs[spec.id] || {}), phase: 'error', note: String((e as Error).message).slice(0, 200) }; log(`${spec.id} 异常 ${(e as Error).message}`); }
      saveState(state);
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, Math.max(1, targets.length)) }, (_, i) => worker(i + 1)));

  if (stopped) log(`到达死线，停止取新样本（已完成 ${Object.values(state.runs).filter((r) => ['path-ready', 'triage-done'].includes(r.phase)).length}/${specsAll.length}）`);
  if (!KEEP) for (const spec of specsAll) { if (state.runs[spec.id]?.phase === 'path-ready') await cleanup(spec, state); }
  const summary = Object.entries(state.runs).map(([k, v]) => `${k}: ${v.phase}${v.learningPathId ? ` ${v.learningPathId}` : ''}`);
  log(`DONE\n  ${summary.join('\n  ')}`);
})();
