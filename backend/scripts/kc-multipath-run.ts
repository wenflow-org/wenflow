/* eslint-disable no-console -- 一次性跑数 CLI */
/**
 * 单用户 · 多路径 · 跨日模拟驱动（看概念图有没有被消费 + 动态调整轨迹）
 *
 * 与 `simulate-learner-e2e.ts` 的差别：它一个学习者只跑**一条**路径（一个 story → 一个 goal → 一个 path），
 * 无法观察"同一学习者的多条路径之间"的关系。本脚本给同一 (profile,user) 起 **N 个会话**（N 个不同 story），
 * 于是同一 user 名下得到 N 条路径，再逐日推进——用于回答：
 *   1. 改造后的概念图在多路径下有没有被填满、有没有被 L3 消费；
 *   2. 难度/pacing/重规划的**动态调整**逐日轨迹；
 *   3. 哪些学习者侧信号适合**跨 path**（用户级），哪些只该 **path 内**。
 *
 * 用法：
 *   E2E_ADMIN_PASSWORD=*** npx ts-node --transpile-only scripts/kc-multipath-run.ts \
 *     --name="[kc] 多路径 0923" --paths=3 --days=2 --base-days-ago=21 --out=C:/tmp/kc-multipath.json --keep
 */
import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';

const ORIGIN = 'http://localhost:5173';
const REQUEST_TIMEOUT_MS = 30 * 60_000;
const GOAL_MAX_STEPS = 16;
const NOT_READY_POLL_MS = 30_000;
const RETRY_BUDGET_MS = 20 * 60_000;

try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Agent, setGlobalDispatcher } = require('undici');
  setGlobalDispatcher(new Agent({ headersTimeout: 0, bodyTimeout: 0, connectTimeout: 30_000 }));
} catch { /* 无 undici 退化：长请求可能被 300s 掐断 */ }

/** 三个不同领域但共享"数据分析"底层的诉求 —— 便于观察跨 path 概念是否该被共享 */
const STORIES = [
  {
    id: 'story_mp_demand',
    title: '[mp] 客流预测排班',
    visibleOpening: '我在做门店排班，想学会用历史客流数据预测下周高峰时段；现在只会凭经验拍脑袋。',
    goalSeed: { surfaceGoal: '学会用历史客流数据预测下周高峰时段', realProblem: '排班靠拍脑袋，高峰缺人低谷闲人' },
    triggerEvent: '上个月排班失误，周末高峰连续两天顾客流失',
  },
  {
    id: 'story_mp_sales',
    title: '[mp] 销售环比分析',
    visibleOpening: '我做销售助理，每月要出销售报表，想学会算环比同比、找出下滑的品类，现在只会把数字贴进表格。',
    goalSeed: { surfaceGoal: '学会做月度销售报表的环比同比分析', realProblem: '报表只会罗列数字，看不出问题在哪' },
    triggerEvent: '季度汇报被问"为什么这个月下滑"，答不上来',
  },
  {
    id: 'story_mp_retention',
    title: '[mp] 用户留存分析',
    visibleOpening: '我在做小程序运营，想知道用户留存怎么样、哪一步流失最多，但不会写查询也不会算。',
    goalSeed: { surfaceGoal: '学会用数据算用户留存与流失节点', realProblem: '只看总用户数，不知道人从哪一步走的' },
    triggerEvent: '改版后日活掉了两成，说不清是拉新还是留存的问题',
  },
];

/**
 * 具名案例（`--case=`）。用于跑一个指定主题的单路径案例。
 */
const CASES: Record<string, typeof STORIES> = {
  children36: [
    {
      id: 'story_case_children36',
      title: '[case] 3-6岁儿童行为判断',
      visibleOpening:
        '我在幼儿园带中班，家长天天问我「我家孩子抢玩具、不肯分享，是不是有问题」。'
        + '我手里有《3-6岁儿童学习与发展指南》，但翻完还是说不清这个行为对应哪一条、该不该干预。'
        + '我想学会拿孩子的具体表现去对照指南做判断。',
      goalSeed: {
        surfaceGoal: '学会用《3-6岁儿童学习与发展指南》判断中班孩子的行为处于什么发展水平',
        realProblem: '家长问「这样正常吗」时只会说「再看看」，说不出依据，也不知道该不该引导',
      },
      triggerEvent: '上周家长开放日，一位家长当场问「我儿子总打断别人说话，是不是多动」，我没答上来',
    },
  ],
};

interface ApiResult { status: number; body: Record<string, unknown> | null }
let cookie: string | null = null;
let logFile: string | null = null;

function log(line: string): void {
  const stamped = `[${new Date().toISOString()}] ${line}`;
  console.log(stamped);
  if (logFile) { try { fs.appendFileSync(logFile, `${stamped}\n`); } catch { /* best effort */ } }
}
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const asRecord = (v: unknown): Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const pick = (body: Record<string, unknown> | null, key: string): unknown => asRecord(body?.data)[key];

async function login(baseUrl: string, name: string, password: string): Promise<void> {
  const res = await fetch(`${baseUrl}/api/admin-auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
    body: JSON.stringify({ name, password, remember: true }),
  });
  cookie = (res.headers.get('set-cookie') || '').split(';')[0] || null;
  if (!res.ok || !cookie) throw new Error(`登录失败 http=${res.status}：${(await res.text().catch(() => '')).slice(0, 200)}`);
}

async function api(baseUrl: string, method: string, urlPath: string, body?: unknown): Promise<ApiResult> {
  try {
    const res = await fetch(`${baseUrl}${urlPath}`, {
      method,
      headers: { 'Content-Type': 'application/json', Origin: ORIGIN, ...(cookie ? { Cookie: cookie } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    let parsed: Record<string, unknown> | null = null;
    try { parsed = asRecord(await res.json()); } catch { parsed = null; }
    return { status: res.status, body: parsed };
  } catch (e) {
    log(`  (网络异常：${(e as { code?: string }).code || (e as Error).message})`);
    return { status: 0, body: null };
  }
}

const sessionStage = (body: Record<string, unknown> | null) => {
  const d = asRecord(body?.data);
  return {
    status: typeof d.status === 'string' ? d.status : 'unknown',
    stage: typeof d.currentStage === 'string' ? d.currentStage : 'unknown',
    pathId: typeof d.pathId === 'string' ? d.pathId : (typeof asRecord(d.stageResults).pathId === 'string' ? asRecord(d.stageResults).pathId as string : null),
  };
};

function parseArgs(argv: string[], env: NodeJS.ProcessEnv) {
  const a = {
    baseUrl: (env.VIRTUAL_LAB_BASE_URL || 'http://127.0.0.1:3001').replace(/\/+$/, ''),
    adminName: env.E2E_ADMIN_NAME || env.INIT_ADMIN_NAME || 'admin',
    adminPassword: env.E2E_ADMIN_PASSWORD || env.INIT_ADMIN_PASSWORD || null,
    name: '', paths: 3, days: 2, baseDaysAgo: 21, keep: false, out: 'C:/tmp/kc-multipath.json' as string | null,
    caseName: null as string | null,
  };
  for (const arg of argv) {
    if (arg === '--keep') { a.keep = true; continue; }
    if (!arg.startsWith('--')) continue;
    const eq = arg.indexOf('='); const k = eq >= 0 ? arg.slice(2, eq) : arg.slice(2); const v = eq >= 0 ? arg.slice(eq + 1) : '';
    if (k === 'base-url') a.baseUrl = v.replace(/\/+$/, '');
    else if (k === 'name') a.name = v.trim();
    else if (k === 'paths') a.paths = Math.max(1, Math.min(3, Number(v)));
    else if (k === 'days') a.days = Math.max(1, Math.min(10, Number(v)));
    else if (k === 'base-days-ago') a.baseDaysAgo = Math.max(1, Number(v));
    else if (k === 'out') a.out = v.trim() || null;
    else if (k === 'case') a.caseName = v.trim() || null;
    else if (arg === '--keep') { /* handled */ }
    else throw new Error(`未知参数：${arg}`);
  }
  return a;
}

/** goal 阶段：step 到离开 goal（有界） */
async function driveGoal(baseUrl: string, sessionId: string): Promise<boolean> {
  for (let step = 1; step <= GOAL_MAX_STEPS; step += 1) {
    const t0 = Date.now();
    const r = await api(baseUrl, 'POST', `/api/admin/virtual-learners/sessions/${sessionId}/step`, {});
    const after = await api(baseUrl, 'GET', `/api/admin/virtual-learners/sessions/${sessionId}`);
    const f = sessionStage(after.body);
    log(`    step#${step} ${((Date.now() - t0) / 1000).toFixed(0)}s http=${r.status} → ${f.stage}/${f.status}`);
    if (r.status === 0 || r.status >= 500) { await sleep(5000); continue; }
    if (r.status !== 200) return false;
    if (f.status === 'failed') return false;
    if (f.stage !== 'goal') return true;
  }
  return false;
}

/** 推进一天；遇到 未就绪/可重试 就等（不消耗模拟日） */
async function advanceOneDay(baseUrl: string, sessionId: string, day: number): Promise<{ ok: boolean; simulatedDay?: string; lessons?: number; note: string }> {
  let notReadySince: number | null = null; let retrySince: number | null = null;
  for (;;) {
    const t0 = Date.now();
    const r = await api(baseUrl, 'POST', `/api/admin/virtual-learners/sessions/${sessionId}/advance-day`, { days: 1, runTasks: true });
    const secs = ((Date.now() - t0) / 1000).toFixed(0);
    const d = asRecord(r.body?.data);
    const errMsg = JSON.stringify(asRecord(r.body?.error).message ?? r.body?.error ?? '');
    if (r.status === 200 && r.body?.success !== false) {
      const advanced = Array.isArray(d.advancedDayIndexes) ? d.advancedDayIndexes.length : 0;
      const learning = asRecord(d.learning);
      if (advanced === 0) {
        // 未就绪：时钟未推进，同日重试
        if (notReadySince === null) notReadySince = Date.now();
        if (Date.now() - notReadySince > RETRY_BUDGET_MS) return { ok: false, note: `同日未就绪累计超预算 ${errMsg}` };
        log(`    [day${day}] ${secs}s 未就绪（${errMsg}）→ 30s 后重试同日`);
        await sleep(NOT_READY_POLL_MS); continue;
      }
      log(`    [day${day}] ${secs}s 已推进 simDay=${d.simulatedDay} 课次=${learning.chunks ?? '?'}`);
      return { ok: true, simulatedDay: String(d.simulatedDay ?? ''), lessons: Number(learning.chunks ?? 0) };
    }
    // 失败/忙：可重试（409/0/5xx/429）就退避
    const retryable = r.status === 0 || r.status === 409 || r.status === 429 || r.status >= 500;
    if (!retryable) return { ok: false, note: `http=${r.status} ${errMsg}`.slice(0, 200) };
    if (retrySince === null) retrySince = Date.now();
    if (Date.now() - retrySince > RETRY_BUDGET_MS) return { ok: false, note: `可重试累计超预算 http=${r.status} ${errMsg}`.slice(0, 200) };
    const wait = r.status === 429 ? 60_000 : Math.min(3000 * (2 ** Math.min(4, Math.floor((Date.now() - retrySince) / 15_000))), 60_000);
    log(`    [day${day}] ${secs}s 可重试（http=${r.status} ${errMsg}）→ 等 ${Math.round(wait / 1000)}s`);
    await sleep(wait);
  }
}

async function main(): Promise<void> {
  const a = parseArgs(process.argv.slice(2), process.env);
  if (!a.adminPassword) throw new Error('缺少管理员密码：设置 E2E_ADMIN_PASSWORD 或 .env 的 INIT_ADMIN_PASSWORD');
  if (!a.name) a.name = `[kc] 多路径 ${new Date().toISOString().slice(0, 16)}`;
  if (a.out) logFile = `${a.out}.log`;

  await login(a.baseUrl, a.adminName, a.adminPassword);
  log(`已登录 ${a.baseUrl}（admin=${a.adminName}）`);

  const stories = a.caseName
    ? (CASES[a.caseName] ?? (() => { throw new Error(`未知案例：${a.caseName}（可选：${Object.keys(CASES).join(', ')}）`) })())
    : STORIES.slice(0, a.paths);
  const created = await api(a.baseUrl, 'POST', '/api/admin/virtual-learners', {
    name: a.name,
    learningGoal: '掌握用数据支撑日常决策（排班/报表/留存）',
    knowledgeLevel: 'beginner',
    profile: { role: '多路径跑数学习者', scenario: '单用户多路径跨日观察', storyPool: stories },
    tags: ['kc-multipath', 'disposable'],
    notes: 'auto-created by kc-multipath-run; safe to delete',
  });
  if (created.status !== 200) throw new Error(`创建学习者失败 http=${created.status} ${JSON.stringify(created.body?.error ?? created.body).slice(0, 240)}`);
  const profileId = String(pick(created.body, 'id') ?? '');
  const userId = String(pick(created.body, 'userId') ?? '');
  const baseDate = new Date(Date.now() - a.baseDaysAgo * 86_400_000).toISOString().slice(0, 10);
  log(`===== 新建 name="${a.name}" profileId=${profileId} userId=${userId} baseDate=${baseDate} paths=${stories.length} =====`);

  const result: Record<string, unknown> = {
    learnerName: a.name, profileId, userId, baseDate, paths: [], days: [], timelines: {},
  };
  const paths = result.paths as Array<Record<string, unknown>>;

  // ── 逐条生成路径（每个 story → 一个会话 → 一条 path） ──
  for (let i = 0; i < stories.length; i += 1) {
    const story = stories[i]!;
    log(`── path#${i + 1} 起会话（story=${story.title}）`);
    const started = await api(a.baseUrl, 'POST', `/api/admin/virtual-learners/${profileId}/start-session`, { storyIndex: i });
    const sessionId = String(pick(started.body, 'id') ?? '');
    if (started.status !== 200 || !sessionId) { log(`  ✗ start-session 失败 http=${started.status} ${JSON.stringify(started.body?.error ?? '').slice(0, 160)}`); paths.push({ index: i, story: story.title, sessionId: null, error: `start-session http=${started.status}` }); continue; }
    const clock = await api(a.baseUrl, 'PUT', `/api/admin/virtual-learners/sessions/${sessionId}/simulation-config`, {
      simulationClock: { enabled: true, baseDate, autoAdvance: false },
    });
    log(`  会话 ${sessionId}｜simulation-config http=${clock.status}`);
    const ok = await driveGoal(a.baseUrl, sessionId);
    const detail = await api(a.baseUrl, 'GET', `/api/admin/virtual-learners/sessions/${sessionId}`);
    const f = sessionStage(detail.body);
    log(`  goal 完成=${ok} → ${f.stage}/${f.status} pathId=${f.pathId ?? '(生成中)'}`);
    paths.push({ index: i, story: story.title, sessionId, goalOk: ok, stage: f.stage, status: f.status });
    fs.mkdirSync(path.dirname(a.out || 'C:/tmp/x'), { recursive: true });
    fs.writeFileSync(a.out || 'C:/tmp/kc-multipath.json', JSON.stringify(result, null, 2));
  }

  // ── 逐日推进（每条会话各推进一天；未就绪会话内部轮询等待） ──
  for (let day = 1; day <= a.days; day += 1) {
    log(`===== 第 ${day} 天 =====`);
    const row: Record<string, unknown> = { day };
    for (const p of paths) {
      const sid = p.sessionId as string | null;
      if (!sid) continue;
      const r = await advanceOneDay(a.baseUrl, sid, day);
      (row as Record<string, unknown>)[sid] = r;
      log(`  path#${(p.index as number) + 1} day${day} → ${r.ok ? `simDay=${r.simulatedDay} 课次=${r.lessons}` : `未完成（${r.note}）`}`);
    }
    (result.days as unknown[]).push(row);
    fs.writeFileSync(a.out || 'C:/tmp/kc-multipath.json', JSON.stringify(result, null, 2));
  }

  // ── 取每条会话的按天时间线（观测量） ──
  for (const p of paths) {
    const sid = p.sessionId as string | null;
    if (!sid) continue;
    const tl = await api(a.baseUrl, 'GET', `/api/admin/virtual-learners/sessions/${sid}/day-timeline`);
    (result.timelines as Record<string, unknown>)[sid] = tl.body?.data ?? null;
    log(`时间线 ${sid} http=${tl.status}`);
  }

  fs.writeFileSync(a.out || 'C:/tmp/kc-multipath.json', JSON.stringify(result, null, 2));
  log(`===== 完成：out=${a.out} =====`);
  if (!a.keep) log(`  清理：DELETE ${a.baseUrl}/api/admin/virtual-learners/${profileId}`);
  else log(`  --keep：保留 profileId=${profileId} userId=${userId}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
