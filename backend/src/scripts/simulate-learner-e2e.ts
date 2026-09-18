/**
 * 虚拟学习者 · 端到端跑数 harness（可丢弃学习者 / 等就绪不烧日 / 断点续跑 / 自动清理）
 *
 * 为什么需要它（跑数脚本化提案）：
 * - 手工跑数会用**真实虚拟学习者**（污染画像/统计），且失败后残渣要手清；
 * - 路径生成窗口内 `advance-day runTasks` 会"未就绪"（Fix D 不烧模拟日），手工跑容易误判；
 * - 另一进程重启后端会掐断在途请求，手工跑只能从头再来。
 *
 * 做法：
 *   1. 新建**可丢弃**学习者（直接给 profile/goal，不花一次 LLM 生成人设）；
 *   2. 只开**会话级**模拟时钟（不动全局 `dateSimulation` 设置），起始日选过去以隔离真实历史；
 *   3. `step` 驱动 goal 阶段 → 逐日 `advance-day {days:1, runTasks:true}`；
 *      未就绪 → 等就绪重试同日（不消耗模拟日）；网络/租约问题 → 指数退避重试；
 *   4. 状态写 JSON（`--state=`），进程被杀后同命令续跑；
 *   5. 跑完**级联删除**可丢弃学习者；失败则保留现场并打印续跑/清理命令。
 *
 * 用法：
 *   E2E_ADMIN_NAME=admin E2E_ADMIN_PASSWORD=*** \
 *     npx ts-node --transpile-only src/scripts/simulate-learner-e2e.ts \
 *       --name="[e2e] 跑数 0918" --days=6 --base-days-ago=21 \
 *       --state=C:/tmp/e2e-run.json
 *
 * 依赖**正在运行的后端**（走 admin HTTP API）。`--keep` 保留学习者；`--session=<id>` 显式续跑。
 */
import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import {
  beginRunAttempt,
  classifyAdvanceResponse,
  classifySessionStatus,
  createRunState,
  defaultLearnerName,
  isPathReady,
  nextBackoffMs,
  parseHarnessArgs,
  parseRunState,
  type HarnessArgs,
  type RunState,
} from '../services/virtual-lab/run-harness';

const GOAL_MAX_STEPS = 14;
/** 同一天"未就绪"时的重试间隔（不消耗模拟日，Fix D） */
const NOT_READY_POLL_MS = 30_000;
/**
 * 连续"可重试"的总时长预算。不能按次数：会话租约 TTL 为 10 分钟，一次被杀掉的
 * `advance-day` 会留下未过期的租约，后续请求持续 409「会话忙」——必须能等过 TTL。
 */
const RETRY_BUDGET_MS = 20 * 60_000;
/** 被限流（429）时的等待：限流窗口通常按分钟计，用固定较长等待而非指数短退避 */
const RATE_LIMIT_WAIT_MS = 60_000;
/** 单次 HTTP 请求上限：`advance-day runTasks` 会同步跑完当天课程，实测可达 ~5 分钟 */
const REQUEST_TIMEOUT_MS = 30 * 60_000;
const ORIGIN = 'http://localhost:5173';

/**
 * 手写故事（省一次 LLM）：`start-session` 要求虚拟人已有故事（`STORY_REQUIRED`），
 * 而故事池读的是 `profile.profile.storyPool`。种一条故事即可自动选中（单条免 storyId）。
 * `visibleOpening` 会作为 Goal 对话的首条用户诉求（见 `virtual-lab/story-demand.ts`）。
 */
const DISPOSABLE_STORY = {
  id: 'story_e2e_disposable',
  title: '[e2e] 跑数故事',
  visibleOpening: '我在做门店排班，想学会用历史客流数据预测下周高峰时段；现在只会凭经验拍脑袋。',
  goalSeed: {
    surfaceGoal: '学会用历史客流数据预测下周高峰时段',
    realProblem: '排班靠拍脑袋，高峰期人手不够、低谷期人又闲着',
  },
  triggerEvent: '上个月排班失误，周末高峰连续两天顾客流失',
};

interface ApiResult {
  status: number;
  body: Record<string, unknown> | null;
}

let cookie: string | null = null;
let logFile: string | null = null;

function log(line: string): void {
  const stamped = `[${new Date().toISOString()}] ${line}`;
  console.log(stamped);
  if (logFile) {
    try { fs.appendFileSync(logFile, `${stamped}\n`); } catch { /* best effort */ }
  }
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Node 内置 fetch（undici）默认 `headersTimeout = 300s`：而 `advance-day runTasks` 会
 * **同步跑完当天课程**（实测 ~5 分钟），于是请求总在 300s 处被 undici 掐断——表现为
 * `TypeError: fetch failed` / `UND_ERR_HEADERS_TIMEOUT`，且 `AbortSignal.timeout` **覆盖不了它**。
 * 这里关掉 undici 自身的 headers/body 超时，统一交给 `REQUEST_TIMEOUT_MS`。
 *
 * undici 非本包直接依赖（随环境传递安装），故防御式加载：缺失只告警、不阻断。
 */
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Agent, setGlobalDispatcher } = require('undici');
  setGlobalDispatcher(new Agent({ headersTimeout: 0, bodyTimeout: 0, connectTimeout: 30_000 }));
} catch (error) {
  log(`⚠ 未能加载 undici 关闭默认 headersTimeout(300s)：长耗时的 advance-day 可能被中断（${(error as Error).message}）`);
}

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

const pick = (body: Record<string, unknown> | null, key: string): unknown => {
  const data = asRecord(body?.data);
  return data[key];
};

async function login(baseUrl: string, name: string, password: string): Promise<void> {
  const response = await fetch(`${baseUrl}/api/admin-auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
    body: JSON.stringify({ name, password, remember: true }),
  });
  const setCookie = response.headers.get('set-cookie') || '';
  cookie = setCookie.split(';')[0] || null;
  if (!response.ok || !cookie) {
    const text = await response.text().catch(() => '');
    throw new Error(`管理员登录失败（http=${response.status}）：${text.slice(0, 200)}`);
  }
}

/** 单次请求；网络异常收敛为 `status:0`，由分类函数决定是否重试（不在此处隐式重试）。 */
async function api(method: string, urlPath: string, body?: unknown): Promise<ApiResult> {
  try {
    const response = await fetch(urlPath, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Origin: ORIGIN,
        ...(cookie ? { Cookie: cookie } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    let parsed: Record<string, unknown> | null = null;
    try { parsed = asRecord(await response.json()); } catch { parsed = null; }
    return { status: response.status, body: parsed };
  } catch (error) {
    log(`  (网络异常：${(error as { code?: string; message?: string }).code || (error as Error).message})`);
    return { status: 0, body: null };
  }
}

function makeApi(baseUrl: string, method: string, urlPath: string, body?: unknown): Promise<ApiResult> {
  return api(method, `${baseUrl}${urlPath}`, body);
}

function persist(statePath: string | null, state: RunState): void {
  if (!statePath) return;
  state.updatedAt = new Date().toISOString();
  try {
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
  } catch (error) {
    log(`  (状态文件写入失败：${(error as Error).message})`);
  }
}

function loadState(statePath: string | null): RunState | null {
  if (!statePath || !fs.existsSync(statePath)) return null;
  try {
    return parseRunState(JSON.parse(fs.readFileSync(statePath, 'utf-8')));
  } catch {
    return null;
  }
}

function addFinding(state: RunState, code: string, detail: string): void {
  state.findings.push({ code, detail });
  log(`  ⚠ FINDING ${code}: ${detail}`);
}

function sessionFields(body: Record<string, unknown> | null): { status: string; currentStage: string; profileId: string | null; userId: string | null } {
  const data = asRecord(body?.data);
  const profile = asRecord(data.profile);
  return {
    status: typeof data.status === 'string' ? data.status : 'unknown',
    currentStage: typeof data.currentStage === 'string' ? data.currentStage : 'unknown',
    profileId: typeof data.virtualProfileId === 'string' ? data.virtualProfileId : (typeof profile.id === 'string' ? profile.id : null),
    userId: typeof data.userId === 'string' ? data.userId : null,
  };
}

/** goal 阶段推进：`step` 直到离开 goal（有界），记录失败 finding。 */
async function driveGoalPhase(args: HarnessArgs, state: RunState, statePath: string | null): Promise<boolean> {
  for (let step = 1; step <= GOAL_MAX_STEPS; step += 1) {
    const detail = await makeApi(args.baseUrl, 'GET', `/api/admin/virtual-learners/sessions/${state.sessionId}`);
    const { status, currentStage } = sessionFields(detail.body);
    if (currentStage !== 'goal') {
      log(`[goal] 离开 goal（第 ${step - 1} 步后）→ ${currentStage}/${status}`);
      return true;
    }
    const started = Date.now();
    const response = await makeApi(args.baseUrl, 'POST', `/api/admin/virtual-learners/sessions/${state.sessionId}/step`, {});
    const after = await makeApi(args.baseUrl, 'GET', `/api/admin/virtual-learners/sessions/${state.sessionId}`);
    const afterFields = sessionFields(after.body);
    log(`[goal] step#${step} ${((Date.now() - started) / 1000).toFixed(0)}s http=${response.status} → ${afterFields.currentStage}/${afterFields.status}`);
    if (response.status === 0 || response.status >= 500) {
      // 传输问题：退避后重试同一步（不改状态）
      addFinding(state, 'goal-step-transport', `step#${step} http=${response.status}`);
      await sleep(nextBackoffMs(step));
      continue;
    }
    if (response.status !== 200) {
      addFinding(state, 'goal-step-failed', `step#${step} http=${response.status} ${JSON.stringify(response.body?.error ?? '')}`.slice(0, 240));
      return false;
    }
    if (afterFields.status === 'failed') {
      addFinding(state, 'session-failed-at-goal', `${afterFields.currentStage}/${afterFields.status}`);
      return false;
    }
    if (afterFields.currentStage !== 'goal') {
      log(`[goal] 已完成（${afterFields.currentStage}/${afterFields.status}）`);
      return true;
    }
    persist(statePath, state);
    if (step === GOAL_MAX_STEPS) {
      addFinding(state, 'goal-not-converged', `${GOAL_MAX_STEPS} 步仍未离开 goal`);
      return false;
    }
  }
  return true;
}

/** 逐日上课：未就绪重试同日（不烧日）、可重试退避、限流长等、终局返回。 */
async function runDailyLoop(args: HarnessArgs, state: RunState, statePath: string | null): Promise<'completed' | 'failed' | 'exhausted'> {
  let transportRetries = 0;
  /** 同一天"未就绪"的起始时刻；推进/终局时清零 */
  let notReadySince: number | null = null;
  /** 连续"可重试"的起始时刻；出现任何非可重试结果时清零 */
  let retrySince: number | null = null;
  while (state.round < args.maxDays) {
    const dayLabel = state.round + 1;
    const started = Date.now();
    const response = await makeApi(args.baseUrl, 'POST', `/api/admin/virtual-learners/sessions/${state.sessionId}/advance-day`, { days: 1, runTasks: true });
    const outcome = classifyAdvanceResponse({ httpStatus: response.status, body: response.body });
    const seconds = ((Date.now() - started) / 1000).toFixed(0);

    if (outcome.kind === 'retryable') {
      transportRetries += 1;
      if (retrySince === null) retrySince = Date.now();
      const waitedMinutes = ((Date.now() - retrySince) / 60_000).toFixed(1);
      if (Date.now() - retrySince > RETRY_BUDGET_MS) {
        addFinding(state, 'retry-exhausted', `连续可重试累计 ${waitedMinutes} 分钟：${outcome.detail}`);
        return 'failed';
      }
      // 限流（429）窗口通常按分钟计：固定长等，别用指数短退避继续撞
      const waitMs = outcome.httpStatus === 429 ? RATE_LIMIT_WAIT_MS : nextBackoffMs(transportRetries);
      log(`[day${dayLabel}] ${seconds}s 可重试（${outcome.detail}）→ 等 ${Math.round(waitMs / 1000)}s`
        + `（累计 ${waitedMinutes}/${Math.round(RETRY_BUDGET_MS / 60_000)} 分）`);
      await sleep(waitMs);
      continue;
    }
    transportRetries = 0;
    retrySince = null;

    if (outcome.kind === 'day-not-started') {
      // 路径生成窗口内：**不消耗模拟日**，退避后重试同一天（Fix D）。
      // `advance-day` 本身是权威就绪信号；path-status 只用于日志诊断、不作等待门
      // ——否则一旦它被限流/异常（返回体无 data）就会 `isPathReady=false` 死等到超时。
      if (notReadySince === null) notReadySince = Date.now();
      const waitedMinutes = ((Date.now() - notReadySince) / 60_000).toFixed(1);
      if (Date.now() - notReadySince > args.readyTimeoutMs) {
        addFinding(state, 'path-not-ready-timeout', `同日未就绪累计 ${waitedMinutes} 分钟：${outcome.detail}`);
        return 'failed';
      }
      const pathStatus = await makeApi(args.baseUrl, 'GET', `/api/admin/virtual-learners/sessions/${state.sessionId}/path-status`);
      log(`[day${dayLabel}] 未就绪（${outcome.detail}；已等 ${waitedMinutes} 分｜path-status http=${pathStatus.status}`
        + ` ready=${isPathReady(asRecord(pathStatus.body?.data))}）→ ${Math.round(NOT_READY_POLL_MS / 1000)}s 后重试同日`);
      await sleep(NOT_READY_POLL_MS);
      continue;
    }
    notReadySince = null;

    if (outcome.kind === 'completed') {
      log(`advance-day 报告会话已完成（${outcome.detail}）`);
      return 'completed';
    }
    if (outcome.kind === 'failed') {
      addFinding(state, 'advance-day-session-failed', outcome.detail);
      return 'failed';
    }
    if (outcome.kind === 'fatal') {
      addFinding(state, 'advance-day-fatal', outcome.detail);
      return 'failed';
    }

    // advanced（当天确实上了课）
    state.round += 1;
    log(`[day${dayLabel}] ${seconds}s 已推进 simDay=${outcome.simulatedDay} 课次=${outcome.lessons ?? '?'} round=${state.round}/${args.maxDays}`);
    persist(statePath, state);

    const detail = await makeApi(args.baseUrl, 'GET', `/api/admin/virtual-learners/sessions/${state.sessionId}`);
    const phase = classifySessionStatus(sessionFields(detail.body).status);
    if (phase === 'completed') {
      log(`本会话已完成（round ${state.round}，simDay=${outcome.simulatedDay}）`);
      return 'completed';
    }
    if (phase === 'failed') {
      addFinding(state, 'session-failed', `round ${state.round} stage=${sessionFields(detail.body).currentStage}`);
      return 'failed';
    }
  }
  return 'exhausted';
}

async function cleanupLearner(args: HarnessArgs, state: RunState): Promise<void> {
  if (!state.profileId) {
    log('[cleanup] 无 profileId，跳过删除（可用 --session 续跑或手工清理）');
    return;
  }
  if (args.keep) {
    log(`[cleanup] --keep：保留可丢弃学习者 profileId=${state.profileId}`);
    return;
  }
  const response = await makeApi(args.baseUrl, 'DELETE', `/api/admin/virtual-learners/${state.profileId}`);
  if (response.status === 200) {
    log(`[cleanup] 已级联删除可丢弃学习者 profileId=${state.profileId}`);
  } else {
    log(`[cleanup] 删除失败（http=${response.status}）：可稍后执行 `
      + `DELETE ${args.baseUrl}/api/admin/virtual-learners/${state.profileId}`);
  }
}

async function main(): Promise<void> {
  const args = parseHarnessArgs(process.argv.slice(2), process.env);
  if (!args.adminPassword) {
    throw new Error('缺少管理员密码：请设置 E2E_ADMIN_PASSWORD（或让 .env 里有 INIT_ADMIN_PASSWORD）');
  }
  if (!args.learnerName) args.learnerName = defaultLearnerName(new Date());
  if (args.statePath) logFile = `${args.statePath}.log`;

  await login(args.baseUrl, args.adminName, args.adminPassword);
  log(`已登录 ${args.baseUrl}（admin=${args.adminName}）`);

  let state = loadState(args.statePath);
  if (state) {
    // 续跑：清空上一轮 findings（只反映本次运行；历史见 <state>.log），否则汇总会混入已失效的问题
    const staleFindings = state.findings.length;
    state = beginRunAttempt(state);
    if (staleFindings > 0) {
      log(`（已清空上一轮的 ${staleFindings} 条 findings；历史见 ${args.statePath}.log）`);
    }
  }
  const resumeSessionId = args.resumeSessionId || state?.sessionId || null;

  if (resumeSessionId) {
    const detail = await makeApi(args.baseUrl, 'GET', `/api/admin/virtual-learners/sessions/${resumeSessionId}`);
    if (detail.status !== 200) {
      throw new Error(`续跑失败：会话 ${resumeSessionId} 不存在（http=${detail.status}）`);
    }
    const fields = sessionFields(detail.body);
    state = state ?? createRunState({ runId: `resume-${resumeSessionId.slice(0, 8)}`, learnerName: args.learnerName });
    state.sessionId = resumeSessionId;
    if (!state.profileId) state.profileId = fields.profileId;
    if (!state.userId) state.userId = fields.userId;
    log(`===== 续跑：session=${resumeSessionId} status=${fields.status} stage=${fields.currentStage} round=${state.round}/${args.maxDays} =====`);
  } else {
    const created = await makeApi(args.baseUrl, 'POST', '/api/admin/virtual-learners', {
      name: args.learnerName,
      learningGoal: args.learningGoal,
      knowledgeLevel: 'beginner',
      profile: {
        role: '可丢弃跑数学习者',
        scenario: '端到端验证日期模拟与多日上课',
        note: '由 simulate-learner-e2e 自动创建，跑完自删',
        // 手写故事：避免为"故事生成"多花一次 LLM，并满足 start-session 的 STORY_REQUIRED
        storyPool: [DISPOSABLE_STORY],
      },
      tags: ['e2e', 'disposable'],
      notes: 'auto-created by simulate-learner-e2e; safe to delete',
    });
    if (created.status !== 200) {
      throw new Error(`创建可丢弃学习者失败（http=${created.status}）：${JSON.stringify(created.body?.error ?? created.body).slice(0, 240)}`);
    }
    const profileId = String(pick(created.body, 'id') ?? '');
    const userId = String(pick(created.body, 'userId') ?? '');
    if (!profileId) throw new Error('创建成功但响应缺少 profileId');
    state = createRunState({ runId: `e2e${Date.now().toString(36)}`, learnerName: args.learnerName });
    state.profileId = profileId;
    state.userId = userId;

    const started = await makeApi(args.baseUrl, 'POST', `/api/admin/virtual-learners/${profileId}/start-session`, {});
    const sessionId = String(pick(started.body, 'id') ?? '');
    if (started.status !== 200 || !sessionId) {
      throw new Error(`start-session 失败（http=${started.status}）：${JSON.stringify(started.body?.error ?? started.body).slice(0, 240)}`);
    }
    state.sessionId = sessionId;

    const baseDate = new Date(Date.now() - args.baseDaysAgo * 86_400_000).toISOString().slice(0, 10);
    const clock = await makeApi(args.baseUrl, 'PUT', `/api/admin/virtual-learners/sessions/${sessionId}/simulation-config`, {
      simulationClock: { enabled: true, baseDate, autoAdvance: false },
    });
    if (clock.status !== 200) {
      addFinding(state, 'clock-config-failed', `http=${clock.status} ${JSON.stringify(clock.body?.error ?? '')}`.slice(0, 200));
    }
    state.baseDate = baseDate;
    log(`===== 新建：name="${args.learnerName}" profileId=${profileId} session=${sessionId} baseDate=${baseDate} =====`);
  }

  persist(args.statePath, state);

  const goalOk = await driveGoalPhase(args, state, args.statePath);
  let result: 'completed' | 'failed' | 'exhausted' = goalOk ? 'exhausted' : 'failed';
  if (goalOk) {
    result = await runDailyLoop(args, state, args.statePath);
    if (result === 'exhausted') {
      addFinding(state, 'max-days-reached', `已达 ${args.maxDays} 天仍未 completed`);
    }
  }

  persist(args.statePath, state);
  if (result === 'completed') {
    log(`===== 成功：${args.learnerName} session=${state.sessionId} findings=${state.findings.length} =====`);
    await cleanupLearner(args, state);
  } else {
    log(`===== 未完成（${result}）：保留现场以续跑 =====`);
    log(`  续跑：E2E_ADMIN_PASSWORD=*** npx ts-node --transpile-only src/scripts/simulate-learner-e2e.ts `
      + `${args.statePath ? `--state=${args.statePath} ` : `--session=${state.sessionId} `}--keep`);
    log(`  清理：DELETE ${args.baseUrl}/api/admin/virtual-learners/${state.profileId ?? '<profileId>'}`);
    process.exitCode = 1;
  }
  if (state.findings.length > 0) {
    log('-- findings');
    for (const finding of state.findings) log(`   ${finding.code}: ${finding.detail}`);
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
