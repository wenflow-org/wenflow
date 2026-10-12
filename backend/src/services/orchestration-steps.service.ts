/**
 * 编排步骤解析（编排定义 steps → Agent manifest）
 *
 * `resolveStepAgent` 原住在 routes/admin/runtime-definitions.ts 的路由文件内（orchestrators 端点
 * 实时编译用）。健康中心「步骤解析」检查项要与该端点同口径（哪些步骤的 agentId 在 manifest 里
 * 查不到），按 health-center.service.ts 头注的约定「全部复用既有纯函数/装配函数，禁止复制逻辑」
 * 提升为本模块单一实现，两处共用。
 *
 * 语义：manifest 命中 → 用 manifest 的 name/kind；未命中 → 保留原 id 并标注 unresolved
 * （该步骤运行时不可路由：显示名/类型无从解析）。
 */
import { getAgentManifest } from './agent-manifest.service';
import { auxSkillDefinitionMap } from '../skills';
import { ORCHESTRATOR_RUNTIME_DEFINITIONS } from '../coordinators/definitions-registry';

export interface ResolvedStepAgent {
  agentId: string;
  displayName: string;
  kind: string;
  nodeKind: string;
  unresolved?: boolean;
}

export function resolveStepAgent(agentId: string, step?: { kind?: string }): ResolvedStepAgent {
  const entry = getAgentManifest(agentId);
  if (entry) {
    return {
      agentId: entry.id,
      displayName: entry.name,
      kind: entry.kind,
      nodeKind: step?.kind || entry.kind,
    };
  }
  return {
    agentId,
    displayName: agentId,
    kind: step?.kind || 'unknown',
    nodeKind: step?.kind || 'unknown',
    unresolved: true,
  };
}

export interface UnresolvedOrchestrationStep {
  orchestratorId: string;
  orchestratorName: string;
  step: number;
  agentId: string;
  role: string;
}

/** 步骤参与方是否在已注册的两个表里：Agent 名册（含主技能，支持短 id/别名）或 v4 辅助技能表 */
function isKnownParticipant(agentId: string): boolean {
  if (getAgentManifest(agentId)) return true;
  const bare = agentId.replace(/^skill:/, '');
  return Object.prototype.hasOwnProperty.call(auxSkillDefinitionMap, bare);
}

/**
 * 全量编排定义里真正查不到参与方的步骤（健康中心「步骤解析」项的数据源；空数组 = 全部可路由）。
 *
 * 两类「未解析」属预期、**不算缺陷**，故排除在外：
 * - kind: 'service'：确定性内部实现（无 LLM 步骤，如 buildFramedNormalizedInput / TeachingContextBuilder），
 *   按约定不进 Agent 名册（编排图页「如实标注 unresolved」即此义——那是注解，不是故障）；
 * - v4 辅助技能（skills/v4-aux-skills，如 teaching-opening-generator）：独立注册表，不在 Agent 名册。
 * 只有「既非服务实现、agentId 又不在任一注册表」才是真缺陷（引用了不存在的 agent，
 * 或 agent 改名/删除后编排没同步）——那种步骤运行时不可路由。
 */
export function collectUnresolvedOrchestrationSteps(): UnresolvedOrchestrationStep[] {
  const out: UnresolvedOrchestrationStep[] = [];
  for (const def of ORCHESTRATOR_RUNTIME_DEFINITIONS) {
    for (const step of (def.steps || []) as Array<{ step?: number; agentId?: string; role?: string; kind?: string }>) {
      const agentId = String(step.agentId || '');
      if (!agentId) continue;
      if (step.kind === 'service') continue;
      if (isKnownParticipant(agentId)) continue;
      out.push({
        orchestratorId: def.id,
        orchestratorName: def.displayName,
        step: Number(step.step || 0),
        agentId,
        role: String(step.role || ''),
      });
    }
  }
  return out;
}
