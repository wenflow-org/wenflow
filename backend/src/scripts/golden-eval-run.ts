/**
 * 黄金评测集 harness：10 个人设 → 建可丢弃虚拟学习者 → 走真实 goal 对话 → 生成路径 → 收集。
 *
 * 与 simulate-learner-e2e 的区别：只跑到「路径生成完成」，不进多日授课
 * （本批评的是路径质量，不是教学会话质量）。
 *
 * 用法：
 *   npx ts-node --transpile-only src/scripts/golden-eval-run.ts \
 *     --spec=../outputs/verify-20261024/golden-10.json \
 *     --state=../outputs/verify-20261024/golden-run-state.json \
 *     --only=macro-econ-01,cog-memory-02        # 可选，分批跑
 *     --keep                                     # 保留学习者（默认跑完删除）
 */
import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';

const BASE_URL = process.env.GOLDEN_EVAL_BASE_URL || 'http://127.0.0.1:3002';
const ORIGIN = 'http://localhost:5175';
const GOAL_MAX_STEPS = 14;
const REQUEST_TIMEOUT_MS = 30 * 60_000;
const PATH_WAIT_MS = 40 * 60_000;

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
}

const arg = (key: string): string | null => {
  const hit = process.argv.find((a) => a.startsWith(`--${key}=`));
  return hit ? hit.slice(key.length + 3) : null;
};
const has = (key: string): boolean => process.argv.includes(`--${key}`);
const SPEC = arg('spec') || 'outputs/verify-20261024/golden-10.json';
const STATE = arg('state') || 'outputs/verify-20261024/golden-run-state.json';
const ONLY = arg('only') ? new Set(String(arg('only')).split(',').map((s) => s.trim())) : null;
const KEEP = has('keep');

let cookie: string | null = null;
const log = (s: string): void => { console.log(`[${new Date().toISOString().slice(11, 19)}] ${s}`); };
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const rec = (v: unknown): Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

async function api(method: string, urlPath: string, body?: unknown): Promise<{ status: number; body: any }> {
  try {
    const res = await fetch(`${BASE_URL}${urlPath}`, {
      method,
      headers: { 'Content-Type': 'application/json', Origin: ORIGIN, ...(cookie ? { Cookie: cookie } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    let parsed: any = null;
    try { parsed = await res.json(); } catch { parsed = null; }
    return { status: res.status, body: parsed };
  } catch (e) {
    return { status: 0, body: { error: String((e as Error).message).slice(0, 160) } };
  }
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
  runs: Record<string, { profileId?: string; userId?: string; sessionId?: string; goalSteps?: number; learningPathId?: string; phase: string; note?: string }>;
}

function loadState(): RunState {
  try { return JSON.parse(fs.readFileSync(STATE, 'utf8')); } catch { return { runs: {} }; }
}
function saveState(s: RunState): void {
  fs.mkdirSync(path.dirname(STATE), { recursive: true });
  fs.writeFileSync(STATE, JSON.stringify(s, null, 2));
}

async function runOne(spec: Spec, state: RunState): Promise<void> {
  const key = spec.id;
  const entry = state.runs[key] || { phase: 'new' };
  state.runs[key] = entry;

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

  // 2) 开会话（autopilot='off'：评测只需要路径就绪；默认 'final' 会让自动驾驶在
    // path-ready 后继续自动「上课」——4 个样本各留一个 teaching 循环持续烧模型额度）
  if (!entry.sessionId) {
    const started = await api('POST', `/api/admin/virtual-learners/${entry.profileId}/start-session`, { autopilot: 'off' });
    const d = rec(started.body?.data ?? started.body);
    entry.sessionId = String(d.id ?? '');
    if (!entry.sessionId) { entry.phase = 'start-failed'; entry.note = JSON.stringify(started.body).slice(0, 200); log(`${key} 开会话失败 ${entry.note}`); saveState(state); return; }
    log(`${key} 会话 ${entry.sessionId}`);
  }

  // 3) 驱动 goal（step 自动应答）
  let steps = entry.goalSteps || 0;
  while (steps < GOAL_MAX_STEPS) {
    const detail = await api('GET', `/api/admin/virtual-learners/sessions/${entry.sessionId}`);
    const f = sessionFields(detail.body);
    if (f.currentStage !== 'goal') { log(`${key} 离开 goal → ${f.currentStage}/${f.status}（${steps} 步）`); break; }
    if (f.status === 'failed') { entry.phase = 'goal-failed'; saveState(state); return; }
    const stepRes = await api('POST', `/api/admin/virtual-learners/sessions/${entry.sessionId}/step`, {});
    steps += 1;
    entry.goalSteps = steps;
    saveState(state);
    if (stepRes.status === 0 || stepRes.status >= 500) { log(`${key} step#${steps} 传输问题，退避`); await sleep(30_000); continue; }
    if (stepRes.status !== 200) { entry.phase = 'goal-step-failed'; entry.note = `http=${stepRes.status}`; saveState(state); return; }
    log(`${key} goal step#${steps}`);
  }

  // 4) 等路径生成完成
  const deadline = Date.now() + PATH_WAIT_MS;
  while (Date.now() < deadline) {
    const st = await api('GET', `/api/admin/virtual-learners/sessions/${entry.sessionId}/path-status`);
    const d = rec(st.body?.data ?? st.body);
    const status = String(d.status ?? d.pathStatus ?? '');
    const pathId = String(d.learningPathId ?? d.pathId ?? '');
    if (pathId) entry.learningPathId = pathId;
    const inFlight = /generating|processing|queued|running|pending/i.test(status);
    if (!inFlight && (status === 'ready' || status === 'completed' || pathId)) {
      log(`${key} 路径就绪 ${pathId || entry.learningPathId} (${status})`);
      entry.phase = 'path-ready';
      saveState(state);
      return;
    }
    if (status === 'failed') {
      const retry = await api('POST', `/api/admin/virtual-learners/sessions/${entry.sessionId}/retry-path-generation`, {});
      log(`${key} 路径失败，重试 http=${retry.status}`);
    }
    await sleep(45_000);
  }
  entry.phase = 'path-timeout';
  saveState(state);
  log(`${key} 等待路径超时`);
}

async function cleanup(spec: Spec, state: RunState): Promise<void> {
  const entry = state.runs[spec.id];
  if (!entry?.profileId) return;
  const res = await api('DELETE', `/api/admin/virtual-learners/${entry.profileId}`);
  log(`${spec.id} 清理学习者 http=${res.status}`);
}

(async () => {
  const specs: Spec[] = JSON.parse(fs.readFileSync(SPEC, 'utf8'));
  const targets = ONLY ? specs.filter((s) => ONLY.has(s.id)) : specs;
  await login();
  const state = loadState();
  log(`开始：${targets.length} 个样本 → ${BASE_URL}`);
  for (const spec of targets) {
    log(`===== ${spec.id} =====`);
    try { await runOne(spec, state); }
    catch (e) { state.runs[spec.id] = { ...(state.runs[spec.id] || {}), phase: 'error', note: String((e as Error).message).slice(0, 200) }; saveState(state); log(`${spec.id} 异常 ${(e as Error).message}`); }
    saveState(state);
  }
  if (!KEEP) for (const spec of targets) { if (state.runs[spec.id]?.phase === 'path-ready') await cleanup(spec, state); }
  const summary = Object.entries(state.runs).map(([k, v]) => `${k}: ${v.phase}${v.learningPathId ? ` ${v.learningPathId}` : ''}`);
  log(`DONE\n  ${summary.join('\n  ')}`);
})();
