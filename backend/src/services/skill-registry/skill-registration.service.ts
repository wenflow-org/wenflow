import systemPrisma from '../../config/system-database';

/**
 * Skill 注册（system 库 `skill_registrations`）只读查询单点。
 *
 * 供 `routes/admin/skills.ts` 的四向对账消费：把 DB 访问从 routes 收敛到服务层。
 */

/** 全部注册名称（name 无 `skill:` 前缀） */
export function listSkillRegistrationNames() {
  return systemPrisma.skill_registrations.findMany({
    select: { name: true },
  });
}
