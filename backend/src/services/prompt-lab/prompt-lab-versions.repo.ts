import systemPrisma from '../../config/system-database';
import prismaMain from '../../config/database';
import type { SystemTransactionClient } from '../../utils/with-transaction';


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
    // A/B 变体后：字段结构分类的基准口径 = 基线行（变体行不参与结构分类判定）
    where: { agentId, status: 'ACTIVE', variant: null },
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
      description: true, coreHash: true, coreVersion: true, metadata: true,
    },
  });
}

export function findActivePromptBrief(agentId: string) {
  return systemPrisma.agent_prompts.findFirst({
    // A/B 变体后："当前生效基线"= variant 为空的 ACTIVE（审计快照口径对齐实际基线）
    where: { agentId, status: 'ACTIVE', variant: null },
    orderBy: { version: 'desc' },
    select: { id: true, version: true, status: true, coreHash: true, coreVersion: true },
  });
}

/** 回滚/晋级翻转：除目标版本外其余**基线**ACTIVE 置 ARCHIVED（A/B 变体行不受影响，继续服役） */
export function archiveOtherActivePrompts(agentId: string, keepId: string) {
  return systemPrisma.agent_prompts.updateMany({
    where: { agentId, status: 'ACTIVE', variant: null, id: { not: keepId } },
    data: { status: 'ARCHIVED', updatedAt: new Date() },
  });
}

/** 回滚翻转：激活目标版本并确保它以**基线**身份生效——若目标是实验臂（变体行），
 *  variant/trafficWeight 一并清空（回滚到变体行 = 晋级语义），否则它会被继续当 arm 分流。 */
export function activateAgentPrompt(id: string) {
  return systemPrisma.agent_prompts.update({
    where: { id },
    data: { status: 'ACTIVE', variant: null, trafficWeight: null, updatedAt: new Date() },
  });
}

// ---------- A/B 实验变体（2026-10-01） ----------

/** 列出某 agent 的 ACTIVE 行集合（基线 + 变体臂），供变体管理页与分流诊断 */
export function listActivePromptRows(agentId: string) {
  return systemPrisma.agent_prompts.findMany({
    where: { agentId, status: 'ACTIVE' },
    orderBy: { version: 'desc' },
    select: {
      id: true,
      agentId: true,
      version: true,
      name: true,
      variant: true,
      trafficWeight: true,
      status: true,
      coreHash: true,
      coreVersion: true,
      createdBy: true,
      publishedAt: true,
      updatedAt: true,
      useCount: true,
    },
  });
}

export function findPromptRowById(id: string) {
  return systemPrisma.agent_prompts.findUnique({ where: { id } });
}

/** 变体行创建：克隆源版本的内容与元数据，单独占一个 version 号 */
export function createPromptVariantRow(data: {
  id: string;
  agentId: string;
  version: number;
  name: string;
  description: string | null;
  systemPrompt: string;
  temperature: number | null;
  maxTokens: number | null;
  metadata: string | null;
  coreHash: string | null;
  coreVersion: number | null;
  variant: string;
  trafficWeight: number;
  createdBy: string;
}) {
  return systemPrisma.agent_prompts.create({
    data: { ...data, status: 'ACTIVE', model: null, publishedAt: new Date() },
  });
}

export function updatePromptVariantWeight(id: string, trafficWeight: number) {
  return systemPrisma.agent_prompts.update({
    where: { id },
    data: { trafficWeight, updatedAt: new Date() },
  });
}

export function archivePromptRow(id: string) {
  return systemPrisma.agent_prompts.update({
    where: { id },
    data: { status: 'ARCHIVED', updatedAt: new Date() },
  });
}

/** 晋级：target 转为基线（variant/trafficWeight 清空），由调用方在事务内配合归档旧基线 */
export async function promoteVariantToBaselineTx(tx: SystemTransactionClient, id: string) {
  return tx.agent_prompts.update({
    where: { id },
    data: { variant: null, trafficWeight: null, status: 'ACTIVE', updatedAt: new Date() },
  });
}

/** 变体近 N 天调用指标（主库 prompt_call_logs，按 systemPromptVersion 归因；SQLite DateTime=epoch 毫秒） */
export async function variantCallMetrics(agentId: string, skillId: string, sinceMs: number) {
  const map: Record<string, { calls: number; successRate: number | null; avgDurationMs: number | null }> = {};
  try {
    const rows: Array<{ v: number | null; n: bigint | number; ok: bigint | number; dur: number | null }> =
      await prismaMain.$queryRawUnsafe(
        `SELECT systemPromptVersion AS v, COUNT(*) AS n,
                SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) AS ok,
                AVG(durationMs) AS dur
         FROM prompt_call_logs
         WHERE agentId IN (?, ?) AND createdAt >= ?
         GROUP BY systemPromptVersion`,
        agentId, skillId, sinceMs,
      );
    for (const r of rows) {
      const calls = Number(r.n) || 0;
      map[String(r.v ?? 'null')] = {
        calls,
        successRate: calls ? Number(r.ok) / calls : null,
        avgDurationMs: r.dur == null ? null : Math.round(Number(r.dur)),
      };
    }
  } catch {
    // 指标是辅助信息：查询失败返回空表，不阻断变体管理
  }
  return map;
}
