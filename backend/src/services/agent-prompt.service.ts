import systemPrisma from '../config/system-database';
import type { Prisma } from '../generated/system-client';

/**
 * Agent Prompt 只读查询（system 库 `agent_prompts`）。
 *
 * 供管理端 runtime-definitions / agent-prompts 路由消费，把 DB 访问收敛到服务层。
 */

/** GET /runtime-definitions/agents：按 skill agentId 集合读取 ACTIVE prompt 摘要 */
export function listActiveAgentPrompts(agentIds: string[]) {
  return systemPrisma.agent_prompts.findMany({
    where: {
      agentId: { in: agentIds },
      status: 'ACTIVE',
    },
    select: {
      agentId: true,
      id: true,
      version: true,
      name: true,
      variant: true,
      updatedAt: true,
      publishedAt: true,
      temperature: true,
      maxTokens: true,
      model: true,
    },
  });
}

/**
 * 「线上生效版本」的单一定义（Skill 列表「版本」列、详情 hero、运行时定义共用）：
 * 每个 agent 取 ACTIVE 基线（variant 为空）里版本最高的一行；没有基线时退最高版本。
 * A/B 实验臂不参与这个读数——它命中与否取决于分流键，不是配置版本。
 * 与 AgentConfigService.getActivePrompt 的「不传 selection → 取最新基线」同一条规则。
 */
export function pickActivePromptPerAgent<
  T extends { agentId: string; version: number; variant?: string | null }
>(rows: T[]): Map<string, T> {
  const baseline = new Map<string, T>();
  const latest = new Map<string, T>();
  for (const row of rows) {
    const prevLatest = latest.get(row.agentId);
    if (!prevLatest || row.version > prevLatest.version) latest.set(row.agentId, row);
    if (row.variant) continue;
    const prevBase = baseline.get(row.agentId);
    if (!prevBase || row.version > prevBase.version) baseline.set(row.agentId, row);
  }
  const out = new Map<string, T>();
  for (const [agentId, row] of latest) {
    out.set(agentId, baseline.get(agentId) ?? row);
  }
  return out;
}

/** GET /admin/agent-prompts：按条件列出 Prompt 版本（不含 systemPrompt 大字段，避免响应过大） */
export function listAgentPrompts(where: Prisma.agent_promptsWhereInput) {
  return systemPrisma.agent_prompts.findMany({
    where,
    orderBy: [
      { agentId: 'asc' },
      { version: 'desc' },
    ],
    select: {
      id: true,
      agentId: true,
      version: true,
      name: true,
      description: true,
      status: true,
      model: true,
      temperature: true,
      maxTokens: true,
      useCount: true,
      avgLatency: true,
      successRate: true,
      createdBy: true,
      createdAt: true,
      // 不包含 systemPrompt，避免数据过大
    },
  });
}

/** GET /admin/agent-prompts/compare：按 id 读取完整 Prompt（含 systemPrompt，用于 diff） */
export function findAgentPromptById(id: string) {
  return systemPrisma.agent_prompts.findUnique({ where: { id } });
}

/** GET /admin/skills/:skillId/workbench-meta：按 agentId 列出 Prompt 版本（不含 systemPrompt 大字段） */
export function listAgentPromptVersions(agentId: string) {
  return systemPrisma.agent_prompts.findMany({
    where: { agentId },
    orderBy: { version: 'desc' },
    select: {
      id: true,
      version: true,
      name: true,
      description: true,
      status: true,
      temperature: true,
      maxTokens: true,
      model: true,
      createdAt: true,
      updatedAt: true,
      publishedAt: true,
    },
  });
}

/** GET /admin/skills/:skillId/workbench-meta：按 agentId 读取字段契约 */
export function findAgentContract(agentId: string) {
  return systemPrisma.agent_contracts.findUnique({ where: { agentId } });
}

/** GET /admin/skills/reconciliation：全部 ACTIVE prompt 的 agentId 集合 */
export function listActiveAgentPromptAgentIds() {
  return systemPrisma.agent_prompts.findMany({
    where: { status: 'ACTIVE' },
    select: { agentId: true },
  });
}
