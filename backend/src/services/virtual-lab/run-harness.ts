/**
 * 虚拟学习者 · 端到端跑数 harness 的**纯函数部分**（不触网、不读库，便于单测）。
 *
 * 背景（跑数脚本化提案 / 虚拟学习者跑数观察）：手工跑数反复要处理三件事，容易出错且难复现——
 *   ① 用**可丢弃**学习者跑（不污染真实画像/统计，跑完级联删除）；
 *   ② 路径尚未生成好时 `advance-day runTasks` 会返回 `started:false`，此时**不消耗模拟日**，
 *      应等就绪后重试同一天（跑数观察 Fix D：去掉"先推进再回滚"）；
 *   ③ 另一进程重启后端会掐断在途请求（ECONNRESET / 502 / 503），应**断点续跑**而不是从头再来。
 *
 * 本模块把上述判定固化为纯函数；HTTP/落库粘合见 `scripts/simulate-learner-e2e.ts`。
 */

/** advance-day 一轮的处置分类 */
export type AdvanceKind =
  /** 当天确实上了课，模拟日已推进 */
  | 'advanced'
  /** 路径未就绪等原因没上课，模拟日**未消耗** → 等就绪后重试同一天 */
  | 'day-not-started'
  /** 传输/繁忙类问题（网络中断、租约忙、429/502/503/504）→ 退避重试 */
  | 'retryable'
  /** 会话已完成（终局，正常结束） */
  | 'completed'
  /** 会话已失败（终局） */
  | 'failed'
  /** 其它契约/参数错误（终局，需人看） */
  | 'fatal';

export interface AdvanceOutcome {
  kind: AdvanceKind;
  /** 模拟日（YYYY-MM-DD，UTC）；未知为 null */
  simulatedDay: string | null;
  /** 当天完成的课次数（响应里的 learning.chunks，未知为 null） */
  lessons: number | null;
  detail: string;
}

/** 会话阶段（终局判定） */
export type SessionPhase = 'active' | 'completed' | 'failed';

export interface RunFinding {
  code: string;
  detail: string;
}

/** 断点续跑状态（落在一个 JSON 文件里，进程被杀后同命令可续） */
export interface RunState {
  version: 1;
  runId: string;
  learnerName: string;
  /** 会话级模拟时钟起始日（YYYY-MM-DD，UTC） */
  baseDate: string | null;
  profileId: string | null;
  userId: string | null;
  sessionId: string | null;
  /** 已完成的模拟日轮数 */
  round: number;
  findings: RunFinding[];
  updatedAt: string;
}

export interface HarnessArgs {
  baseUrl: string;
  adminName: string;
  adminPassword: string | null;
  learnerName: string;
  learningGoal: string;
  maxDays: number;
  baseDaysAgo: number;
  /** 等路径就绪的最长时间（毫秒）；超过则放弃当天并记 finding */
  readyTimeoutMs: number;
  keep: boolean;
  statePath: string | null;
  resumeSessionId: string | null;
}

const RETRYABLE_HTTP = new Set([408, 425, 429, 502, 503, 504]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const asString = (value: unknown): string => (typeof value === 'string' ? value : '');

/** 从错误文案识别"会话已终局"（已完成/已失败）；识别不出返回 fatal（未知错误需人看）。 */
function terminalKindFromMessage(message: string): 'completed' | 'failed' | 'fatal' {
  if (/会话已完成|已完成|completed/i.test(message)) return 'completed';
  if (/会话已失败|已失败|failed/i.test(message)) return 'failed';
  return 'fatal';
}

/**
 * `POST /sessions/:id/advance-day` 的响应 → 处置分类（纯函数，供 harness 决策）。
 *
 * 判定顺序即"终局优先"：认证/参数错误先判死，再判网络/繁忙可重试，最后看 200 的 body
 * 是否"当天真上了课"。注意 `success=true` 但 `learning.started=false` 属**未消耗模拟日**，
 * 必须重试同一天（对应 Fix D），不能计入 maxDays。
 */
export function classifyAdvanceResponse(input: { httpStatus: number; body?: unknown }): AdvanceOutcome {
  const body = input.body;
  const data = isRecord(body) ? (isRecord(body.data) ? body.data : null) : null;
  const errorText = isRecord(body) ? asString(body.error) : '';
  const simulatedDay = data && typeof data.simulatedDay === 'string'
    ? data.simulatedDay
    : data && typeof data.simulatedDay === 'number' ? String(data.simulatedDay) : null;
  const learning = data && isRecord(data.learning) ? data.learning : null;
  const lessons = learning && typeof learning.chunks === 'number' ? learning.chunks : null;

  if (input.httpStatus === 0) {
    return { kind: 'retryable', simulatedDay: null, lessons: null, detail: '网络中断（后端可能正在重启）' };
  }
  if (RETRYABLE_HTTP.has(input.httpStatus)) {
    return { kind: 'retryable', simulatedDay, lessons, detail: `http=${input.httpStatus}（上游/网关繁忙）` };
  }
  if (input.httpStatus === 401 || input.httpStatus === 403) {
    return { kind: 'fatal', simulatedDay, lessons, detail: `http=${input.httpStatus} 认证失败（检查 E2E_ADMIN_NAME/PASSWORD）` };
  }
  if (input.httpStatus === 409) {
    // 409 有三种语义：会话已终局（完成/失败）、时钟/天数上限（终止）、会话租约忙（可重试）
    const terminal = terminalKindFromMessage(errorText);
    if (terminal !== 'fatal') {
      return { kind: terminal, simulatedDay, lessons, detail: errorText };
    }
    if (/已达模拟天数上限|课表为空|日期模拟未开启/.test(errorText)) {
      return { kind: 'fatal', simulatedDay, lessons, detail: `http=409 ${errorText}` };
    }
    return { kind: 'retryable', simulatedDay, lessons, detail: `http=409 会话忙（${errorText || '租约冲突'}）` };
  }
  if (input.httpStatus !== 200) {
    return { kind: terminalKindFromMessage(errorText), simulatedDay, lessons, detail: `http=${input.httpStatus} ${errorText}`.trim() };
  }
  if (isRecord(body) && body.success === false) {
    if (/未就绪|生成中|尚未就绪/.test(errorText)) {
      return { kind: 'day-not-started', simulatedDay, lessons: 0, detail: `路径未就绪：${errorText}` };
    }
    const terminal = terminalKindFromMessage(errorText);
    if (terminal !== 'fatal') {
      return { kind: terminal, simulatedDay, lessons, detail: errorText };
    }
    if (/租约|busy|进行中/.test(errorText)) {
      return { kind: 'retryable', simulatedDay, lessons, detail: `会话忙：${errorText}` };
    }
    return { kind: 'fatal', simulatedDay, lessons, detail: errorText || 'success=false' };
  }
  if (data?.reverted === true) {
    return { kind: 'day-not-started', simulatedDay, lessons: 0, detail: '时钟未推进（当天未上课，模拟日未消耗）' };
  }
  if (learning && learning.started === false) {
    return {
      kind: 'day-not-started',
      simulatedDay,
      lessons: 0,
      detail: `当天未开课：${asString(learning.error) || '路径未就绪'}`,
    };
  }
  return { kind: 'advanced', simulatedDay, lessons, detail: `模拟日 ${simulatedDay ?? '?'} 已推进` };
}

/** 会话 status → 阶段（终局判定；未知值一律视为进行中，由 maxDays 兜底） */
export function classifySessionStatus(status: unknown): SessionPhase {
  if (status === 'completed') return 'completed';
  if (status === 'failed') return 'failed';
  return 'active';
}

/**
 * `GET /sessions/:id/path-status` → 路径是否就绪（有路径 + 有可教的当前子任务）。
 * 仅用于日志/提前等待；即使本函数判断有偏，advance-day 的 `day-not-started` 也会兜住。
 */
export function isPathReady(data: unknown): boolean {
  if (!isRecord(data)) return false;
  if (asString(data.learningPathId).length === 0) return false;
  const status = asString(data.status);
  if (['generating', 'not_started', 'not_found', 'archived', 'deleted'].includes(status)) return false;
  const pathContext = isRecord(data.pathContext) ? data.pathContext : null;
  return asString(pathContext?.currentTaskTitle).length > 0;
}

/** 指数退避（毫秒）：attempt 从 1 起 */
export function nextBackoffMs(attempt: number, baseMs = 5_000, maxMs = 60_000): number {
  const exponent = Math.max(0, Math.floor(attempt) - 1);
  return Math.min(maxMs, baseMs * 2 ** Math.min(exponent, 10));
}

/** 默认可丢弃学习者名（带时间戳，便于在管理台辨认与清理） */
export function defaultLearnerName(now: Date): string {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  return `[e2e] 跑数 ${stamp}`;
}

export function createRunState(input: { runId: string; learnerName: string }): RunState {
  return {
    version: 1,
    runId: input.runId,
    learnerName: input.learnerName,
    baseDate: null,
    profileId: null,
    userId: null,
    sessionId: null,
    round: 0,
    findings: [],
    updatedAt: new Date().toISOString(),
  };
}

/** 解析状态文件；结构不符或版本不识别返回 null（视为"从头跑"）。 */
export function parseRunState(raw: unknown): RunState | null {
  if (!isRecord(raw)) return null;
  if (raw.version !== 1) return null;
  if (typeof raw.sessionId !== 'string' || raw.sessionId.length === 0) return null;
  const findings = Array.isArray(raw.findings)
    ? raw.findings.flatMap((item) =>
        isRecord(item) && typeof item.code === 'string'
          ? [{ code: item.code, detail: asString(item.detail) }]
          : [],
      )
    : [];
  return {
    version: 1,
    runId: asString(raw.runId) || 'resumed',
    learnerName: asString(raw.learnerName),
    baseDate: asString(raw.baseDate) || null,
    profileId: asString(raw.profileId) || null,
    userId: asString(raw.userId) || null,
    sessionId: raw.sessionId,
    round: typeof raw.round === 'number' && raw.round >= 0 ? Math.floor(raw.round) : 0,
    findings,
    updatedAt: asString(raw.updatedAt) || new Date().toISOString(),
  };
}

/**
 * 解析 CLI 参数（`--k=v` / 开关）。凭据只从 env 取，**不落到命令行历史**。
 * env：`VIRTUAL_LAB_BASE_URL`、`E2E_ADMIN_NAME`、`E2E_ADMIN_PASSWORD`。
 */
export function parseHarnessArgs(argv: string[], env: Record<string, string | undefined>): HarnessArgs {
  const args: HarnessArgs = {
    baseUrl: (env.VIRTUAL_LAB_BASE_URL || 'http://127.0.0.1:3001').replace(/\/+$/, ''),
    adminName: env.E2E_ADMIN_NAME || env.INIT_ADMIN_NAME || 'admin',
    adminPassword: env.E2E_ADMIN_PASSWORD || env.INIT_ADMIN_PASSWORD || null,
    learnerName: '',
    learningGoal: '端到端跑数：验证虚拟学习者在日期模拟下能连续多日上课',
    maxDays: 6,
    baseDaysAgo: 21,
    readyTimeoutMs: 15 * 60_000,
    keep: false,
    statePath: null,
    resumeSessionId: null,
  };

  const numberArg = (name: string, value: string, min: number, max: number): number => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
      throw new Error(`${name} 必须是 ${min}..${max} 的数字，收到：${value}`);
    }
    return parsed;
  };

  for (const arg of argv) {
    if (arg === '--keep') { args.keep = true; continue; }
    if (!arg.startsWith('--')) continue;
    const eq = arg.indexOf('=');
    const key = eq >= 0 ? arg.slice(2, eq) : arg.slice(2);
    const value = eq >= 0 ? arg.slice(eq + 1) : '';
    switch (key) {
      case 'base-url': args.baseUrl = value.replace(/\/+$/, ''); break;
      case 'name': args.learnerName = value.trim(); break;
      case 'goal': args.learningGoal = value.trim() || args.learningGoal; break;
      case 'days': args.maxDays = numberArg('--days', value, 1, 60); break;
      case 'base-days-ago': args.baseDaysAgo = numberArg('--base-days-ago', value, 1, 3650); break;
      case 'ready-timeout-ms': args.readyTimeoutMs = numberArg('--ready-timeout-ms', value, 0, 6 * 3600_000); break;
      case 'state': args.statePath = value.trim() || null; break;
      case 'session': args.resumeSessionId = value.trim() || null; break;
      case 'admin-name': args.adminName = value.trim() || args.adminName; break;
      case 'admin-password': throw new Error('请用环境变量 E2E_ADMIN_PASSWORD 传密码，不要放进命令行');
      case 'keep': break; // 开关形式（--keep）已在上面的分支处理
      default:
        throw new Error(`未知参数：${arg}`);
    }
  }
  return args;
}
