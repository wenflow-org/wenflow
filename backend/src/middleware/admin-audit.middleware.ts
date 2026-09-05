import { Request, Response, NextFunction } from 'express';
import prisma from '../config/database';
import { logger } from '../utils/logger';
import { redactLogValue } from '../utils/secret-redaction';
import { getAuditContext } from './audit-context';

// query 脱敏：key 为 token/key/secret 系列的值一律打 ***
const SENSITIVE_QUERY_PARAM_KEYS = new Set(['token', 'key', 'secret', 'apikey', 'api_key', 'api-key', 'accesstoken', 'access_token']);

// 请求体/前后快照最大长度（超出截断，避免单行无限膨胀）
const SNAPSHOT_MAX_CHARS = 4096;
const USER_AGENT_MAX_CHARS = 300;
const IP_MAX_CHARS = 100;

/**
 * 设计定稿：只审计写操作。GET/HEAD/OPTIONS 只读请求不落库
 * （列表加载噪音），登录审计独立承接登录事件。
 */
const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * 高频执行类黑名单（仅对写方法生效）：路由命中则仅失败（success=false）时落库，避免成功噪音。
 * - virtual-learners 的 step/auto/advance-path/blackbox 系列（逐帧/逐轮推进，均为 POST）
 * - virtual-quick-learn 的 runs 系列（自动学习运行轮询/推进）
 */
const HIGH_FREQUENCY_PATH_PATTERNS: RegExp[] = [
  /\/virtual-learners\/.*\/(step|auto|advance-path)(\/|$)/,
  /\/virtual-learners\/.*\/blackbox/,
  /\/virtual-quick-learn\/.*\/runs/,
];

interface ActionRule {
  method: string;
  pattern: RegExp;
  action: string;
  targetType?: string;
}

// method+path → 语义动作映射表（未知路径回退为 `${method} ${path}` 原文）
const ACTION_RULES: ActionRule[] = [
  { method: 'POST', pattern: /^\/api\/admin\/users$/, action: 'user-create', targetType: 'user' },
  { method: 'PATCH', pattern: /^\/api\/admin\/users\/[^/]+\/role$/, action: 'user-role-change', targetType: 'user' },
  { method: 'PATCH', pattern: /^\/api\/admin\/users\/[^/]+$/, action: 'user-update', targetType: 'user' },
  { method: 'DELETE', pattern: /^\/api\/admin\/users\/[^/]+$/, action: 'user-delete', targetType: 'user' },
  { method: 'POST', pattern: /^\/api\/admin\/users\/batch-delete$/, action: 'user-batch-delete', targetType: 'user' },
  { method: 'POST', pattern: /^\/api\/admin\/announcements$/, action: 'announcement-create', targetType: 'announcement' },
  { method: 'PUT', pattern: /^\/api\/admin\/announcements\/[^/]+\/publish$/, action: 'announcement-publish', targetType: 'announcement' },
  { method: 'PUT', pattern: /^\/api\/admin\/announcements\/[^/]+\/archive$/, action: 'announcement-archive', targetType: 'announcement' },
  { method: 'PUT', pattern: /^\/api\/admin\/announcements\/[^/]+$/, action: 'announcement-update', targetType: 'announcement' },
  { method: 'DELETE', pattern: /^\/api\/admin\/announcements\/[^/]+$/, action: 'announcement-delete', targetType: 'announcement' },
  // 虚拟学习者域（A5 审计语义化）：创建/画像/删除/故事/会话/批量终止/回收
  { method: 'POST', pattern: /^\/api\/admin\/virtual-learners$/, action: 'virtual-create', targetType: 'virtual-learner' },
  { method: 'PUT', pattern: /^\/api\/admin\/virtual-learners\/[^/]+$/, action: 'virtual-update', targetType: 'virtual-learner' },
  { method: 'DELETE', pattern: /^\/api\/admin\/virtual-learners\/[^/]+$/, action: 'virtual-delete', targetType: 'virtual-learner' },
  { method: 'POST', pattern: /^\/api\/admin\/virtual-learners\/batch-delete$/, action: 'virtual-batch-delete', targetType: 'virtual-learner' },
  { method: 'POST', pattern: /^\/api\/admin\/virtual-learners\/[^/]+\/draft-stories$/, action: 'virtual-story-generate', targetType: 'virtual-learner' },
  { method: 'PUT', pattern: /^\/api\/admin\/virtual-learners\/[^/]+\/stories\/[^/]+$/, action: 'virtual-story-update', targetType: 'virtual-learner' },
  { method: 'DELETE', pattern: /^\/api\/admin\/virtual-learners\/[^/]+\/stories\/[^/]+$/, action: 'virtual-story-delete', targetType: 'virtual-learner' },
  { method: 'POST', pattern: /^\/api\/admin\/virtual-learners\/[^/]+\/start-session$/, action: 'virtual-session-start', targetType: 'virtual-session' },
  { method: 'POST', pattern: /^\/api\/admin\/virtual-learners\/[^/]+\/start-blackbox-session$/, action: 'virtual-session-start', targetType: 'virtual-session' },
  { method: 'DELETE', pattern: /^\/api\/admin\/virtual-learners\/sessions\/[^/]+$/, action: 'virtual-session-delete', targetType: 'virtual-session' },
  { method: 'POST', pattern: /^\/api\/admin\/virtual-learners\/sessions\/reclaim-stale$/, action: 'virtual-session-stale-reclaim', targetType: 'virtual-session' },
  { method: 'POST', pattern: /^\/api\/admin\/virtual-learners\/sessions\/terminate$/, action: 'virtual-session-batch-terminate', targetType: 'virtual-session' },
];

/** 去掉末尾斜杠后匹配映射表（路由注册在挂载点下时 baseUrl+path 即为完整路径） */
function inferAction(req: Request, effectivePath: string): ActionRule | undefined {
  const path = effectivePath.replace(/\/+$/, '');
  for (const rule of ACTION_RULES) {
    if (rule.method === req.method && rule.pattern.test(path)) {
      return rule;
    }
  }
  return undefined;
}

/** query 脱敏：key 为 token/key/secret 系列的值打 ***；无敏感参数时原样返回 */
function redactQueryString(originalUrl: string): string {
  const queryIndex = originalUrl.indexOf('?');
  if (queryIndex === -1) return originalUrl;
  const pathname = originalUrl.slice(0, queryIndex);
  const searchParams = new URLSearchParams(originalUrl.slice(queryIndex + 1));
  let changed = false;
  for (const key of [...searchParams.keys()]) {
    if (SENSITIVE_QUERY_PARAM_KEYS.has(key.toLowerCase())) {
      searchParams.set(key, '***');
      changed = true;
    }
  }
  if (!changed) return originalUrl;
  const query = searchParams.toString();
  return query ? `${pathname}?${query}` : pathname;
}

/** req.body 脱敏摘要（复用 redactLogValue，≤4KB）；空对象/不可序列化返回 undefined */
function buildRequestBodySnapshot(body: unknown): string | undefined {
  if (body === undefined || body === null) return undefined;
  if (typeof body === 'object' && !Array.isArray(body) && Object.keys(body as object).length === 0) {
    return undefined;
  }
  try {
    const json = JSON.stringify(redactLogValue(body));
    if (!json) return undefined;
    return json.length <= SNAPSHOT_MAX_CHARS ? json : json.slice(0, SNAPSHOT_MAX_CHARS);
  } catch {
    return undefined;
  }
}

function serializeSnapshot(value: unknown): string | undefined {
  try {
    const json = JSON.stringify(redactLogValue(value));
    if (!json) return undefined;
    return json.length <= SNAPSHOT_MAX_CHARS ? json : json.slice(0, SNAPSHOT_MAX_CHARS);
  } catch {
    return undefined;
  }
}

/**
 * 操作审计中间件：挂在 admin 路由链上（adminMiddleware 之后，req.user 已解析）。
 * 只审计 POST/PUT/PATCH/DELETE 写操作（GET/HEAD/OPTIONS 直接放行不落库）。
 * 响应 finish 时以 fire-and-forget 方式写入 admin_audit_logs，任何失败仅告警、不阻塞主流程。
 */
export const adminAuditMiddleware = (req: Request, res: Response, next: NextFunction) => {
  // 入口过滤：非写方法直接放行，不注册 finish 监听（GET 列表加载等只读噪音不入审计）
  if (!WRITE_METHODS.has(req.method)) {
    next();
    return;
  }

  const startedAt = Date.now();

  res.on('finish', () => {
    try {
      const effectivePath = `${req.baseUrl}${req.path}`;
      const success = res.statusCode >= 200 && res.statusCode < 400;

      // 高频执行类黑名单：成功不落库，失败才记录
      const isHighFrequency = HIGH_FREQUENCY_PATH_PATTERNS.some(pattern => pattern.test(effectivePath));
      if (isHighFrequency && success) return;

      const context = getAuditContext(res);
      const inferred = inferAction(req, effectivePath);
      const targetId = context.targetId || (typeof req.params?.id === 'string' ? req.params.id : null);

      const record = {
        adminId: req.user?.userId ?? null,
        adminName: req.user?.email ?? null,
        action: context.action || inferred?.action || `${req.method} ${effectivePath}`,
        targetType: context.targetType || inferred?.targetType || null,
        targetId,
        beforeJson: context.before !== undefined ? serializeSnapshot(context.before) : null,
        afterJson: context.after !== undefined ? serializeSnapshot(context.after) : null,
        requestJson: buildRequestBodySnapshot(req.body),
        method: req.method,
        path: redactQueryString(req.originalUrl),
        statusCode: res.statusCode,
        success,
        ip: (req.ip || req.headers['x-forwarded-for'] || 'unknown').toString().slice(0, IP_MAX_CHARS),
        userAgent: typeof req.headers['user-agent'] === 'string'
          ? req.headers['user-agent'].slice(0, USER_AGENT_MAX_CHARS)
          : null,
        durationMs: Date.now() - startedAt
      };

      prisma.admin_audit_logs.create({ data: record }).catch((error) => {
        logger.warn('[admin-audit] 操作审计写入失败', {
          error: error instanceof Error ? error.message : String(error),
          method: record.method,
          path: record.path
        });
      });
    } catch (error) {
      // 审计逻辑自身异常绝不波及主流程
      logger.warn('[admin-audit] 操作审计收集失败', {
        error: error instanceof Error ? error.message : String(error),
        method: req.method,
        path: req.originalUrl
      });
    }
  });

  next();
};
