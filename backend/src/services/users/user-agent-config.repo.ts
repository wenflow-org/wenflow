import prisma from '../../config/database';
import type { Prisma } from '@prisma/client';

/**
 * 用户 Agent 托管配置仓储（routes/user-agents.ts 的取数层）。
 * user_agent_configs 的查询/写入与该用户 Agent 调用日志；加解密与校验留在路由层。
 */

export function listUserAgentConfigs(userId: string) {
  return prisma.user_agent_configs.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' }
  });
}

export function findUserAgentConfig(userId: string, agentName: string) {
  return prisma.user_agent_configs.findFirst({
    where: {
      userId,
      agentName
    }
  });
}

export function updateUserAgentConfig(args: Prisma.user_agent_configsUpdateArgs) {
  return prisma.user_agent_configs.update(args);
}

export function createUserAgentConfig(args: { data: Prisma.user_agent_configsCreateInput }) {
  return prisma.user_agent_configs.create(args);
}

/** 该用户对指定 Agent 的最近调用日志（limit 已在路由层钳制） */
export function listUserAgentCallLogs(userId: string, agentId: string, limit: number) {
  return prisma.agent_call_logs.findMany({
    where: {
      userId,
      agentId
    },
    orderBy: { calledAt: 'desc' },
    take: limit,
    select: {
      id: true,
      success: true,
      durationMs: true,
      tokensUsed: true,
      error: true,
      calledAt: true
    }
  });
}
