import systemPrisma from '../../config/system-database';
import type { Prisma } from '@prisma/client';

/**
 * Prompt Lab 版本域仓储（routes/prompt-lab.ts 的取数层，系统库）。
 * coreVersion 推进、字段变更分级基准、版本历史与回滚翻转。
 */

export function findPlatformReasoningDefaultModelRow() {
  return systemPrisma.platform_api_configs.findFirst({
    select: { defaultReasoningModel: true }
  });
}

/** v4：查询某 agentId 的下一个 coreVersion（无历史则从 1 起） */
export function findLatestCoreVersionRow(agentId: string) {
  return systemPrisma.agent_prompts.findFirst({
    where: { agentId, coreVersion: { not: null } },
    orderBy: { coreVersion: 'desc' },
    select: { coreVersion: true }
  });
}

/** 字段结构变更分级基准：ACTIVE 版本的 metadata（coreSnapshot 所在） */
export function findActivePromptMetadata(agentId: string) {
  return systemPrisma.agent_prompts.findFirst({
    where: { agentId, status: 'ACTIVE' },
    orderBy: { version: 'desc' },
    select: { metadata: true },
  });
}

export function listCoreVersionHistory(agentId: string) {
  return systemPrisma.agent_prompts.findMany({
    where: { agentId },
    orderBy: { version: 'desc' },
    select: {
      version: true,
      status: true,
      coreHash: true,
      coreVersion: true,
      createdBy: true,
      publishedAt: true,
      temperature: true,
      maxTokens: true,
      metadata: true,
    },
    take: 30,
  });
}

export function findPromptVersionRow(agentId: string, version: number) {
  return systemPrisma.agent_prompts.findFirst({
    where: { agentId, version },
    select: {
      id: true, version: true, systemPrompt: true, temperature: true, maxTokens: true,
      coreHash: true, coreVersion: true, metadata: true,
    },
  });
}

export function findActivePromptBrief(agentId: string) {
  return systemPrisma.agent_prompts.findFirst({
    where: { agentId, status: 'ACTIVE' },
    orderBy: { version: 'desc' },
    select: { id: true, version: true, status: true, coreHash: true, coreVersion: true },
  });
}

/** 回滚翻转：除目标版本外其余 ACTIVE 置 ARCHIVED */
export function archiveOtherActivePrompts(agentId: string, keepId: string) {
  return systemPrisma.agent_prompts.updateMany({
    where: { agentId, status: 'ACTIVE', id: { not: keepId } },
    data: { status: 'ARCHIVED', updatedAt: new Date() },
  });
}

export function activateAgentPrompt(id: string) {
  return systemPrisma.agent_prompts.update({
    where: { id },
    data: { status: 'ACTIVE', updatedAt: new Date() },
  });
}
