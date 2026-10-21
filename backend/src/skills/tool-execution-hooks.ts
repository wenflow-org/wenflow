/**
 * 工具执行 hooks 与审批闸门（2026-10-21）。
 *
 * 背景：本项目的「工具」是 Skill + MCP Gateway 两套能力执行面（没有模型驱动的
 * function calling）。此前 `executeSkillHandler` 是唯一收口，但**没有任何前置/后置
 * 扩展点**：想加审计、审批、脱敏、限流都只能改 executor 本身；工具失败一律转成
 * 抛异常，调用方拿不到结构化错误去降级。
 *
 * 本模块提供三件事，默认全部关闭、不改变现有行为：
 *
 * 1. **hook 链**：`before` / `after` / `error` 三个阶段，可注册多个。
 *    - before 返回 veto → 直接拒绝执行（用于审批、熔断、配额）；
 *    - after / error 只观察，异常被吞掉（旁路不能把成功的工具调用变成失败）。
 * 2. **审批闸门**：按 `TOOL_APPROVAL_REQUIRED_SKILLS`（逗号分隔的 skillId）声明
 *    需要人工确认的工具；调用方需在 `SkillExecutionOptions.approved === true`
 *    时才能执行，否则抛 `TOOL_APPROVAL_REQUIRED`（HTTP 428）。
 * 3. **结构化失败**：`SkillExecutionOptions.allowStructuredFailure === true` 时，
 *    handler 返回 `success:false` 不再转异常，而是把结构化错误返回给调用方，
 *    由业务决定降级（默认仍抛异常，保持既有语义）。
 */
import { logger } from '../utils/logger';

export type ToolExecutionPhase = 'before' | 'after' | 'error';

export interface ToolExecutionInfo {
  skillId: string;
  userId?: string;
  executionLogId?: string;
  sessionId?: string;
  /** 原始输入（hook 自行决定是否落日志；不要在此处打印密钥） */
  input: unknown;
  /** 已脱敏的输入摘要，供审计 hook 直接用 */
  inputSummary?: string;
}

export interface ToolExecutionVeto {
  code: string;
  message: string;
  status?: number;
  details?: unknown;
}

export interface ToolExecutionHook {
  id: string;
  phase: ToolExecutionPhase;
  run(info: ToolExecutionInfo, payload?: { result?: unknown; error?: unknown }): Promise<void | ToolExecutionVeto> | void | ToolExecutionVeto;
}

const hooks: ToolExecutionHook[] = [];

/** 注册 hook，返回注销函数（测试用）。同 id 重复注册按后注册覆盖。 */
export function registerToolExecutionHook(hook: ToolExecutionHook): () => void {
  const existing = hooks.findIndex((entry) => entry.id === hook.id && entry.phase === hook.phase);
  if (existing >= 0) hooks.splice(existing, 1);
  hooks.push(hook);
  return () => {
    const index = hooks.findIndex((entry) => entry === hook);
    if (index >= 0) hooks.splice(index, 1);
  };
}

/** 测试用：清空全部 hook。 */
export function clearToolExecutionHooks(): void {
  hooks.length = 0;
}

export function listToolExecutionHooks(): ReadonlyArray<Pick<ToolExecutionHook, 'id' | 'phase'>> {
  return hooks.map(({ id, phase }) => ({ id, phase }));
}

/** 依次执行 before hook：任一返回 veto 即短路。 */
export async function runBeforeToolHooks(info: ToolExecutionInfo): Promise<ToolExecutionVeto | null> {
  for (const hook of hooks.filter((entry) => entry.phase === 'before')) {
    try {
      const outcome = await hook.run(info);
      if (outcome && typeof outcome === 'object' && 'code' in outcome) return outcome as ToolExecutionVeto;
    } catch (error) {
      // before hook 自身故障 = 保守放行并告警：审批链路坏掉不应让全部工具不可用，
      // 但必须可在日志里发现（与「工具失败就是业务失败」区分开）。
      logger.warn('[tool-hooks] before hook 执行失败，按放行处理', {
        hook: hook.id,
        skillId: info.skillId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return null;
}

/** 后置观察 hook：异常只记日志，不影响工具结果。 */
export async function runAfterToolHooks(info: ToolExecutionInfo, result: unknown): Promise<void> {
  for (const hook of hooks.filter((entry) => entry.phase === 'after')) {
    try {
      await hook.run(info, { result });
    } catch (error) {
      logger.warn('[tool-hooks] after hook 执行失败', {
        hook: hook.id,
        skillId: info.skillId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

/** 错误观察 hook：同样不影响错误传播。 */
export async function runErrorToolHooks(info: ToolExecutionInfo, error: unknown): Promise<void> {
  for (const hook of hooks.filter((entry) => entry.phase === 'error')) {
    try {
      await hook.run(info, { error });
    } catch (hookError) {
      logger.warn('[tool-hooks] error hook 执行失败', {
        hook: hook.id,
        skillId: info.skillId,
        error: hookError instanceof Error ? hookError.message : String(hookError),
      });
    }
  }
}

/** 审批开关：逗号分隔的 skillId；`*` 表示全部工具。 */
export function readApprovalRequiredSkills(envValue: string | undefined = process.env.TOOL_APPROVAL_REQUIRED_SKILLS): string[] {
  return String(envValue ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

export function isToolApprovalRequired(skillId: string, required: string[] = readApprovalRequiredSkills()): boolean {
  return required.includes('*') || required.includes(skillId);
}

export class ToolApprovalRequiredError extends Error {
  readonly code = 'TOOL_APPROVAL_REQUIRED';
  readonly status = 428;
  readonly skillId: string;

  constructor(skillId: string) {
    super(`工具 ${skillId} 需要人工确认后才能执行`);
    this.name = 'ToolApprovalRequiredError';
    this.skillId = skillId;
  }
}
