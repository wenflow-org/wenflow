import prisma from '../config/database';

/**
 * 用户 Skill 配置（user_skill_configs）只读 + 启停单点。
 *
 * 供 `routes/user-skills.ts` 消费：用户只能查看系统配置的 Skills 并控制启停，
 * 不能创建/修改自定义代码。DB 访问收敛到服务层。
 */

/** 列表：按 userId 过滤（可选 enabled），createdAt 倒序 */
export function listUserSkillConfigs(userId: string, enabled?: boolean) {
  const where: { userId: string; enabled?: boolean } = { userId };
  if (enabled !== undefined) where.enabled = enabled;
  return prisma.user_skill_configs.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      skillName: true,
      enabled: true,
      sourceType: true,
      endpoint: true,
      parameters: true,
      stats: true,
      createdAt: true,
      updatedAt: true,
    },
  });
}

/** 详情：按 userId + skillName 取单条 */
export function findUserSkillConfig(userId: string, skillName: string) {
  return prisma.user_skill_configs.findFirst({
    where: { userId, skillName },
  });
}

/** 启用/禁用：按 id 更新 enabled 并刷新 updatedAt */
export function setUserSkillEnabled(id: string, enabled: boolean) {
  return prisma.user_skill_configs.update({
    where: { id },
    data: { enabled, updatedAt: new Date() },
  });
}
