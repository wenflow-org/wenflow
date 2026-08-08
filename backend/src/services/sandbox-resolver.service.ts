/**
 * Sandbox Resolver（L2 声明化装配 · 第一阶段）
 *
 * 让 core 文件声明的 `sandbox:<agentAlias>.<key>` ref 在运行时真正可解析：
 *  - 解析失败打 warn（把"纯文档/静默脱节"变成运行时可见）
 *  - 不改变现有装配行为（当前仍是编排代码装配，本服务只做声明↔运行时对账）
 *
 * 后续阶段：SANDBOX_EXTRA_KEYS 升级为 provider 注册表后，装配本身可切换为
 * 声明驱动（resolveSandboxPath 作为统一取值内核）。
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
