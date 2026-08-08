/**
 * Sandbox Resolver（L2 声明化装配）
 *
 * 让 core 文件声明的 `sandbox:<agentAlias>.<key>` ref 在运行时真正可解析：
 *  - 解析失败打 warn（把"纯文档/静默脱节"变成运行时可见）
 *  - 不改变现有装配行为（当前仍是编排代码装配，本服务做声明↔运行时对账）
 *
 * 第二阶段（2026-08）：各业务链的状态池形状集中为本模块的 pool builder，
 * 后续可升级为 provider 注册表（agentAlias → pool 构造函数）支撑声明驱动装配。
 */

export interface SandboxResolveResult {
  path: string;
  value: unknown;
  resolved: boolean;
  missing: string | null;
}

/**
 * 按点路径从状态池取值。
 * @param path   不含 agent 前缀的沙盘键，形如 `collectedData.state`
 * @param pool   该 agent 的状态池对象（由编排代码按声明键组装）
 */
export function resolveSandboxPath(path: string, pool: Record<string, unknown>): SandboxResolveResult {
  const parts = path.split('.');
  let cur: unknown = pool;
  for (const part of parts) {
    if (cur && typeof cur === 'object' && part in (cur as Record<string, unknown>)) {
      cur = (cur as Record<string, unknown>)[part];
    } else {
      return {
        path,
        value: undefined,
        resolved: false,
        missing: `缺少 ${part}（路径 ${path}）`,
      };
    }
  }
  return { path, value: cur, resolved: true, missing: null };
}

export interface SandboxRefsCheckResult {
  refs: SandboxResolveResult[];
  missingCount: number;
  resolvedCount: number;
}

/**
 * 批量校验某 agent 声明的 sandbox refs 能否从状态池解析。
 * 纯对账：缺键不抛错，返回明细供调用方打 warn/落观测。
 */
export function checkSandboxRefs(
  agentAlias: string,
  sandboxPaths: string[],
  pools: Record<string, Record<string, unknown>>
): SandboxRefsCheckResult {
  const pool = pools[agentAlias];
  if (!pool) {
    const refs = sandboxPaths.map((path) => ({
      path,
      value: undefined,
      resolved: false,
      missing: `${path}（agent ${agentAlias} 无状态池）`,
    }));
    return { refs, missingCount: refs.length, resolvedCount: 0 };
  }

  const refs = sandboxPaths.map((path) => resolveSandboxPath(path, pool));
  return {
    refs,
    missingCount: refs.filter((r) => !r.resolved).length,
    resolvedCount: refs.filter((r) => r.resolved).length,
  };
}

/**
 * 从 core 文件声明的 inputs 里提取 sandbox ref（拆分 agent 别名与池内路径）。
 * 动态读取声明，core yaml 变更后自动生效。
 * 例：`sandbox:goal.collectedData.state` → { agentAlias: 'goal', path: 'collectedData.state' }
 */
export async function extractSandboxRefsFromCore(skillId: string): Promise<Array<{ agentAlias: string; path: string }>> {
  try {
    const { scanCoreFiles } = await import('./prompt-lab/core-file-loader');
    const core = scanCoreFiles().files.find((file) => file.skillId === skillId);
    if (!core?.inputs) return [];
    const refs: Array<{ agentAlias: string; path: string }> = [];
    for (const input of core.inputs) {
      if (input.kind !== 'sandbox' || !input.sandboxPath) continue;
      const dotIndex = input.sandboxPath.indexOf('.');
      if (dotIndex === -1) {
        refs.push({ agentAlias: input.sandboxPath, path: '' });
        continue;
      }
      refs.push({
        agentAlias: input.sandboxPath.slice(0, dotIndex),
        path: input.sandboxPath.slice(dotIndex + 1),
      });
    }
    return refs;
  } catch {
    return [];
  }
}

// ============================================================
// 统一对账入口：extract + filter + check + warn（各业务链一行接入）
// ============================================================

export interface CheckAgentSandboxRefsOptions {
  /** 对账失败时 warn 日志的附加上下文 */
  warnContext?: Record<string, unknown>;
}

/**
 * 校验某 skill 声明的、归属某 agent 的 sandbox refs 能否从状态池解析。
 * 缺键打 warn（不阻断）；无声明/无状态池时静默返回。
 */
export async function checkAgentSandboxRefs(
  skillId: string,
  agentAlias: string,
  pools: Record<string, Record<string, unknown>>,
  options: CheckAgentSandboxRefsOptions = {}
): Promise<SandboxRefsCheckResult | null> {
  try {
    const refs = await extractSandboxRefsFromCore(skillId);
    const agentRefs = refs.filter((ref) => ref.agentAlias === agentAlias);
    if (agentRefs.length === 0) return null;

    const result = checkSandboxRefs(agentAlias, agentRefs.map((ref) => ref.path), pools);
    if (result.missingCount > 0) {
      const { logger } = await import('../utils/logger');
      logger.warn(`[sandbox-resolver] ${skillId} 沙盘声明键运行时不可解析（声明与装配脱节）`, {
        agentAlias,
        ...(options.warnContext || {}),
        missing: result.refs.filter((r) => !r.resolved).map((r) => r.missing),
      });
    }
    return result;
  } catch {
    return null;
  }
}

// ============================================================
// 各业务链的状态池 builder（状态池形状集中于此，后续可升级为 provider 注册表）
// ============================================================

/** goal 链：goal.conversation.service buildPreviousState + 可见历史 */
export function buildGoalSandboxPool(
  previousState: { understanding?: any; confirmedProposal?: any },
  history: Array<{ role: string; content: string }>
): Record<string, Record<string, unknown>> {
  const latestMessage = history.length > 0 ? history[history.length - 1]?.content : undefined;
  return {
    goal: {
      collectedData: {
        state: previousState,
        history: history.map((msg) => ({ role: msg.role, text: msg.content })),
        understanding: previousState.understanding,
        confirmedProposal: previousState.confirmedProposal ?? null,
        latestMessage,
      },
    },
  };
}

/** teaching 链：AITeachingCoordinator.buildTeachingTurnInput 组装产物 */
export function buildTeachingSandboxPool(options: {
  sessionMessages: Array<{ role: string; content: string }>;
  sessionId: string;
  mode: string;
  topic?: string;
  learnerProjection?: unknown;
  knowledgeState?: unknown;
  classroomContext?: Record<string, unknown>;
  teachingControlContext?: unknown;
  scenario?: Record<string, unknown>;
  interactionProfile?: unknown;
}): Record<string, Record<string, unknown>> {
  return {
    teaching: {
      session: {
        messages: options.sessionMessages,
        topic: options.topic,
        info: { sessionId: options.sessionId, mode: options.mode },
        evidence: options.sessionMessages,
      },
      learner: { learnerProjection: options.learnerProjection },
      knowledge: { state: options.knowledgeState },
      classroomContext: options.classroomContext || {},
      visibleDialogueContext: options.sessionMessages,
      controls: { teachingControlContext: options.teachingControlContext },
      scenario: {
        ...(options.scenario || {}),
        interactionProfile: options.interactionProfile,
      },
    },
  };
}

/** path 链：path.coordinator.buildNormalizedGoalInput 确定性定帧结果 */
export function buildPathSandboxPool(
  normalizedInputV1: object
): Record<string, Record<string, unknown>> {
  return {
    path: {
      normalizedInput: normalizedInputV1,
      replan: null, // goal→path 生成场景无 replan（replan 走 learn 链）
      previousMilestone: null, // stage-designer 通道，由 stage 链单独校验
    },
  };
}
