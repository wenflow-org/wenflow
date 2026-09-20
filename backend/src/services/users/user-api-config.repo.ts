import prisma from '../../config/database';
import type { Prisma } from '@prisma/client';

/**
 * 用户第三方 API 配置仓储（routes/user-api-config.ts 的取数层）。
 * 密钥加解密与端点匹配语义留在路由/服务层。
 */

export function findUserApiConfig(userId: string) {
  return prisma.user_api_configs.findUnique({ where: { userId } });
}

export function updateUserApiConfig(args: Prisma.user_api_configsUpdateArgs) {
  return prisma.user_api_configs.update(args);
}

export function createUserApiConfig(args: Prisma.user_api_configsCreateArgs) {
  return prisma.user_api_configs.create(args);
}
