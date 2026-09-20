import prisma from '../../config/database';
import type { Prisma } from '@prisma/client';

/**
 * 用户 MCP 配置仓储（routes/user-mcp.ts 的取数层）。
 * user_mcp_configs 单行（按 userId）读写；JSON 解析/密钥保留/脱敏在 user-mcp-config.service。
 */

export function findUserMcpConfig(userId: string) {
  return prisma.user_mcp_configs.findUnique({
    where: { userId }
  });
}

export function updateUserMcpConfig(args: Prisma.user_mcp_configsUpdateArgs) {
  return prisma.user_mcp_configs.update(args);
}

export function createUserMcpConfig(args: { data: Prisma.user_mcp_configsCreateInput }) {
  return prisma.user_mcp_configs.create(args);
}
