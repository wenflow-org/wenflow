/**
 * Agent 调用失败归因分类（调用级，agent_call_logs）。
 * 由 routes/admin/platform.ts 下沉：概览失败归因 / 活动流异常事件 / /agents/logs 类别筛选
 * 三处消费，口径必须同源（归因计数 ↔ 日志列表闭环一致）。
 */
export const timeoutErrorSignals = [
  'timeout',
  'timed out',
  'etimedout',
  'deadline exceeded',
  'request timeout',
  'socket hang up'
];

// 超时识别：优先 errorCode/errorCategory（现代 gateway 行写 errorCode=ATTEMPT_TIMEOUT、errorCategory=provider_timeout），
// 兼容旧行 errorCode 中直接含 timeout 字样（ETIMEDOUT 等）。
export const isTimeoutLog = (log: { errorCode: string | null; errorCategory?: string | null }) => {
  const errorCode = String(log.errorCode || '').toLowerCase();
  const errorCategory = String(log.errorCategory || '').toLowerCase();
  return errorCategory.includes('timeout')
    || timeoutErrorSignals.some(signal => errorCode.includes(signal));
};

/**
 * 失败归因分类（调用级，agent_call_logs）：
 * - 现代 gateway 行带 errorCategory 列 → 直接采用；
 * - 老平台/skill 行 errorCategory 为空 → 由 errorCode/error 文本启发式归并
 *   （CALLER_ABORTED/取消 → caller_abort；超时信号 → provider_timeout；限流信号 → rate_limit；其余 → internal）。
 * 与 buildErrorCategoryWhere（/agents/logs 筛选）同源，保证「归因计数 ↔ 日志列表」闭环一致。
 */
export function classifyFailureCategory(row: {
  errorCategory: string | null;
  errorCode: string | null;
  error: string | null;
}): string {
  const category = String(row.errorCategory || '').toLowerCase();
  if (category) return category;
  const code = String(row.errorCode || '').toUpperCase();
  const text = String(row.error || '').toLowerCase();
  if (code.includes('CALLER_ABORTED') || text.includes('cancel')) return 'caller_abort';
  if (isTimeoutLog(row) || timeoutErrorSignals.some(signal => text.includes(signal))) return 'provider_timeout';
  if (code.includes('RATE') || code.includes('429') || text.includes('rate limit') || text.includes('throttl')) {
    return 'rate_limit';
  }
  return 'internal';
}

/** 限流信号条件（classifyFailureCategory 的 rate_limit 分支镜像） */
const RATE_LIMIT_CONDITION = {
  OR: [
    { errorCode: { contains: 'RATE' } },
    { errorCode: { contains: '429' } },
    { error: { contains: 'rate limit' } },
  ],
};

/** 取消信号条件（classifyFailureCategory 的 caller_abort 分支镜像） */
const CALLER_ABORT_CONDITION = {
  OR: [
    { errorCode: { contains: 'CALLER_ABORTED' } },
    { error: { contains: 'cancel' } },
  ],
};

/** 超时信号条件（与 /agents/logs 状态筛选同构；provider_timeout 分支镜像） */
const TIMEOUT_CONDITION = {
  OR: [
    { errorCode: { contains: 'TIMEOUT' } },
    ...timeoutErrorSignals.map(signal => ({ error: { contains: signal } })),
  ],
};

/**
 * /agents/logs 的 errorCategory 筛选条件：列值精确匹配 + errorCategory 为空行的
 * 启发式归并（与 classifyFailureCategory 同口径，纯函数便于单测）。
 * 未知类别 → 仅精确匹配。
 */
export function buildErrorCategoryWhere(category: string): { OR: Record<string, unknown>[] } | null {
  const cat = String(category || '').toLowerCase();
  if (!cat) return null;
  const extra: Record<string, unknown>[] = [];
  if (cat === 'caller_abort') {
    extra.push({ errorCategory: null, ...CALLER_ABORT_CONDITION });
  } else if (cat === 'provider_timeout') {
    extra.push({ errorCategory: null, ...TIMEOUT_CONDITION });
  } else if (cat === 'rate_limit') {
    extra.push({ errorCategory: null, ...RATE_LIMIT_CONDITION });
  } else if (cat === 'internal') {
    extra.push({
      errorCategory: null,
      AND: [
        { NOT: CALLER_ABORT_CONDITION },
        { NOT: TIMEOUT_CONDITION },
        { NOT: RATE_LIMIT_CONDITION },
      ],
    });
  }
  return { OR: [{ errorCategory: cat }, ...extra] };
}

/** 超时信号 where 条件（TIMEOUT_CONDITION 的函数形式，/agents/logs 状态筛选与计数共用） */
export function buildTimeoutCondition(): { OR: Record<string, unknown>[] } {
  return TIMEOUT_CONDITION;
}
